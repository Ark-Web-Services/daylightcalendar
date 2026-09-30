'use strict';

const DISTRICT_TOKEN = /^[a-z0-9-]+$/;
const DATE_TOKEN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  district: 'cms',
  schoolSlug: 'pineville-es',
  schoolName: 'Pineville ES',
  menus: Object.freeze([
    Object.freeze({ slug: 'breakfast', label: 'Breakfast' }),
    Object.freeze({ slug: 'k-8-lunch', label: 'Lunch' })
  ])
});

class SchoolMenuError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'SchoolMenuError';
    this.status = status;
  }
}

function cloneDefaultSettings() {
  return {
    ...DEFAULT_SETTINGS,
    menus: DEFAULT_SETTINGS.menus.map(menu => ({ ...menu }))
  };
}

function cleanText(value, fallback = '', maxLength = 200) {
  const text = typeof value === 'string' ? value.trim() : '';
  return (text || fallback).slice(0, maxLength);
}

function normalizeToken(value, fieldName) {
  const token = cleanText(value).toLowerCase();
  if (!DISTRICT_TOKEN.test(token)) {
    throw new SchoolMenuError(`${fieldName} must contain only lowercase letters, numbers, and hyphens.`, 400);
  }
  return token;
}

function normalizeSettings(value, { useDefaults = true } = {}) {
  const defaults = cloneDefaultSettings();
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const district = normalizeToken(input.district ?? (useDefaults ? defaults.district : ''), 'District');
  const schoolSlug = normalizeToken(input.schoolSlug ?? (useDefaults ? defaults.schoolSlug : ''), 'School slug');
  const schoolName = cleanText(input.schoolName, useDefaults ? defaults.schoolName : schoolSlug);
  const sourceMenus = Array.isArray(input.menus) ? input.menus : (useDefaults ? defaults.menus : []);
  const seen = new Set();
  const menus = sourceMenus.slice(0, 12).map(menu => {
    const slug = normalizeToken(menu && menu.slug, 'Menu slug');
    if (seen.has(slug)) return null;
    seen.add(slug);
    return { slug, label: cleanText(menu && menu.label, slug, 80) };
  }).filter(Boolean);

  if (!menus.length) throw new SchoolMenuError('Choose at least one menu type.', 400);
  return {
    enabled: input.enabled !== false,
    district,
    schoolSlug,
    schoolName,
    menus
  };
}

function parseIsoDate(value) {
  if (!DATE_TOKEN.test(String(value || ''))) {
    throw new SchoolMenuError('Date must use YYYY-MM-DD format.', 400);
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new SchoolMenuError('Date is not valid.', 400);
  }
  return date;
}

function addDays(dateString, count) {
  const date = parseIsoDate(dateString);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function weekStart(dateString) {
  const date = parseIsoDate(dateString);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}

function dayFromWeek(week, dateString) {
  const days = week && Array.isArray(week.days) ? week.days : [];
  return days.find(day => String(day && day.date || '').slice(0, 10) === dateString) || null;
}

function parseSections(day) {
  const sections = [];
  let current = null;
  const items = day && Array.isArray(day.menu_items) ? day.menu_items : [];

  items.forEach(item => {
    if (!item || item.is_holiday === true) return;
    if (item.is_section_title === true) {
      const title = cleanText(item.text, 'Menu');
      current = { title, items: [], names: new Set() };
      sections.push(current);
      return;
    }

    const name = cleanText(item.food && item.food.name);
    if (!name) return;
    if (!current) {
      current = { title: 'Menu', items: [], names: new Set() };
      sections.push(current);
    }
    const key = name.toLocaleLowerCase('en-US');
    if (current.names.has(key)) return;
    current.names.add(key);
    current.items.push({
      name,
      imageUrl: cleanText(item.food && item.food.image_url, '', 2000) || null
    });
  });

  return sections
    .filter(section => section.items.length)
    .map(({ title, items }) => ({ title, items }));
}

function hasMenuItems(day) {
  return parseSections(day).some(section => section.items.length > 0);
}

function createSchoolMenuService({
  readJsonFile,
  writeJsonFile,
  withHouseholdStorageLock,
  fetch,
  getLocalDate,
  cacheTtlMs = 4 * 60 * 60 * 1000,
  schoolsCacheTtlMs = 12 * 60 * 60 * 1000,
  timeoutMs = 10 * 1000,
  now = () => Date.now()
}) {
  const SETTINGS_FILE = 'school_menu_settings.json';
  const CACHE_FILE = 'school_menu_cache.json';
  const inFlight = new Map();

  function readCache() {
    const cache = readJsonFile(CACHE_FILE, {});
    return cache && typeof cache === 'object' && !Array.isArray(cache)
      ? {
          version: 1,
          schools: cache.schools && typeof cache.schools === 'object' ? cache.schools : {},
          weeks: cache.weeks && typeof cache.weeks === 'object' ? cache.weeks : {},
          responses: cache.responses && typeof cache.responses === 'object' ? cache.responses : {},
          lastResponse: cache.lastResponse && typeof cache.lastResponse === 'object' ? cache.lastResponse : null
        }
      : { version: 1, schools: {}, weeks: {}, responses: {}, lastResponse: null };
  }

  function getSettings() {
    try {
      return normalizeSettings(readJsonFile(SETTINGS_FILE, cloneDefaultSettings()));
    } catch (error) {
      console.warn('[school-menu] Invalid saved settings; using defaults:', error.message);
      return cloneDefaultSettings();
    }
  }

  async function saveSettings(value) {
    const settings = normalizeSettings(value, { useDefaults: false });
    return withHouseholdStorageLock(async () => {
      writeJsonFile(SETTINGS_FILE, settings);
      return settings;
    });
  }

  async function requestJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    console.log(`[school-menu] Fetching ${url}`);
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'Daylight-Calendar/School-Menu' },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Nutrislice returned HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function cachedRequest(namespace, key, url, ttlMs, { cacheOnly = false } = {}) {
    const requestKey = `${namespace}:${key}`;
    const cached = readCache()[namespace][key];
    const cachedAt = Date.parse(cached && cached.fetchedAt);
    if (cached && Number.isFinite(cachedAt) && now() - cachedAt < ttlMs) {
      return { data: cached.data, fetchedAt: cached.fetchedAt, stale: false, source: 'cache' };
    }
    if (cacheOnly) {
      if (cached && cached.data) {
        return { data: cached.data, fetchedAt: cached.fetchedAt, stale: true, source: 'stale-cache' };
      }
      throw new SchoolMenuError('No cached school menu is available for that date.', 503);
    }

    if (inFlight.has(requestKey)) return inFlight.get(requestKey);
    const pending = (async () => {
      try {
        const data = await requestJson(url);
        const fetchedAt = new Date(now()).toISOString();
        await withHouseholdStorageLock(async () => {
          const cache = readCache();
          cache[namespace][key] = { fetchedAt, data };
          writeJsonFile(CACHE_FILE, cache);
        });
        return { data, fetchedAt, stale: false, source: 'network' };
      } catch (error) {
        const fallback = readCache()[namespace][key];
        if (fallback && fallback.data) {
          console.warn(`[school-menu] Nutrislice unavailable; using cached ${requestKey}: ${error.message}`);
          return { data: fallback.data, fetchedAt: fallback.fetchedAt, stale: true, source: 'stale-cache' };
        }
        throw error;
      } finally {
        inFlight.delete(requestKey);
      }
    })();
    inFlight.set(requestKey, pending);
    return pending;
  }

  function schoolsUrl(district) {
    return `https://${district}.api.nutrislice.com/menu/api/schools/`;
  }

  function weekUrl(settings, menuSlug, dateString) {
    const [year, month, day] = dateString.split('/').length === 3
      ? dateString.split('/') : dateString.split('-');
    return `https://${settings.district}.api.nutrislice.com/menu/api/weeks/school/${settings.schoolSlug}/menu-type/${menuSlug}/${year}/${month}/${day}/`;
  }

  async function getSchools(districtValue) {
    const district = normalizeToken(districtValue, 'District');
    const result = await cachedRequest('schools', district, schoolsUrl(district), schoolsCacheTtlMs);
    if (!Array.isArray(result.data)) throw new Error('Nutrislice returned an invalid schools list.');
    return result.data.map(school => ({
      name: cleanText(school && school.name, 'Unnamed school'),
      slug: cleanText(school && school.slug),
      active_menu_types: Array.isArray(school && school.active_menu_types)
        ? school.active_menu_types.map(menu => ({
            name: cleanText(menu && menu.name, 'Menu'),
            slug: cleanText(menu && menu.slug)
          })).filter(menu => menu.slug)
        : []
    })).filter(school => school.slug);
  }

  async function getWeek(settings, menuSlug, dateString, options = {}) {
    const start = weekStart(dateString);
    const key = [settings.district, settings.schoolSlug, menuSlug, start].join('|');
    return cachedRequest('weeks', key, weekUrl(settings, menuSlug, start), cacheTtlMs, options);
  }

  function buildMenus(settings, resultsBySlug, dateString) {
    return settings.menus.map(menu => {
      const sources = resultsBySlug.get(menu.slug) || [];
      const day = sources.map(source => dayFromWeek(source.data, dateString)).find(Boolean);
      return { ...menu, sections: parseSections(day) };
    });
  }

  function getFreshness(resultsBySlug) {
    const sources = [...resultsBySlug.values()].flat();
    const timestamps = sources.map(source => Date.parse(source.fetchedAt)).filter(Number.isFinite);
    return {
      fetchedAt: timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : new Date(now()).toISOString(),
      stale: sources.some(source => source.stale)
    };
  }

  async function rememberResponse(dateString, response) {
    await withHouseholdStorageLock(async () => {
      const cache = readCache();
      cache.responses[dateString] = response;
      cache.lastResponse = response;
      const responseDates = Object.keys(cache.responses).sort().reverse();
      responseDates.slice(20).forEach(date => delete cache.responses[date]);
      writeJsonFile(CACHE_FILE, cache);
    });
  }

  function staleResponseFallback(dateString) {
    const cache = readCache();
    const fallback = cache.responses[dateString] || cache.lastResponse;
    return fallback ? { ...fallback, stale: true } : null;
  }

  async function getMenu(dateValue, { cacheOnly = false } = {}) {
    const date = dateValue || getLocalDate();
    parseIsoDate(date);
    const settings = getSettings();
    const resultsBySlug = new Map();

    try {
      await Promise.all(settings.menus.map(async menu => {
        resultsBySlug.set(menu.slug, [await getWeek(settings, menu.slug, date, { cacheOnly })]);
      }));

      let menus = buildMenus(settings, resultsBySlug, date);
      const isSchoolDay = menus.some(menu => menu.sections.some(section => section.items.length));
      let nextSchoolDate = null;

      if (!isSchoolDay) {
        const initialStart = weekStart(date);
        const needsNextWeek = addDays(date, 10) > addDays(initialStart, 6);
        if (needsNextWeek) {
          await Promise.all(settings.menus.map(async menu => {
            const source = await getWeek(settings, menu.slug, addDays(date, 7), { cacheOnly });
            resultsBySlug.get(menu.slug).push(source);
          }));
        }

        for (let offset = 1; offset <= 10; offset += 1) {
          const candidate = addDays(date, offset);
          const hasItems = settings.menus.some(menu => (resultsBySlug.get(menu.slug) || [])
            .some(source => hasMenuItems(dayFromWeek(source.data, candidate))));
          if (hasItems) {
            nextSchoolDate = candidate;
            break;
          }
        }
        menus = buildMenus(settings, resultsBySlug, date);
      }

      const freshness = getFreshness(resultsBySlug);
      const response = {
        date,
        schoolName: settings.schoolName,
        isSchoolDay,
        nextSchoolDate,
        menus,
        fetchedAt: freshness.fetchedAt,
        stale: freshness.stale
      };
      await rememberResponse(date, response);
      return response;
    } catch (error) {
      const cache = readCache();
      const fallback = cacheOnly
        ? (cache.responses[date] ? { ...cache.responses[date], stale: true } : null)
        : staleResponseFallback(date);
      if (fallback) {
        console.warn(`[school-menu] Menu fetch failed; using last saved response: ${error.message}`);
        return fallback;
      }
      throw error;
    }
  }

  function getCachedMenu(dateValue) {
    return getMenu(dateValue, { cacheOnly: true });
  }

  return { getSettings, saveSettings, getSchools, getMenu, getCachedMenu };
}

module.exports = {
  DEFAULT_SETTINGS,
  SchoolMenuError,
  createSchoolMenuService,
  normalizeSettings,
  parseSections
};

'use strict';

// Announcements put a message on every connected wall panel and, when a text-to-speech engine is
// available in Home Assistant, say it out loud. They arrive either as the Home Assistant event
// `daylight_announce` (the channel automations use) or through POST /api/announcements.

const { randomUUID } = require('crypto');

const SETTINGS_FILE = 'announcement_settings.json';
const RECENT_LIMIT = 20;
const AUDIO_CACHE_LIMIT = 20;
const TTS_TIMEOUT_MS = 20000;
const ICON_TOKEN = /^[a-z0-9_]{1,40}$/;
const TIME_TOKEN = /^([01]\d|2[0-3]):[0-5]\d$/;
const ENTITY_TOKEN = /^tts\.[a-z0-9_]+$/;

const DEFAULT_SETTINGS = Object.freeze({
  speak: true,
  ttsEngine: null,
  quietStart: '21:00',
  quietEnd: '07:00'
});

class AnnouncementError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'AnnouncementError';
    this.status = status;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Returns a clean announcement or throws AnnouncementError. Home Assistant event data and REST
// bodies go through the same rules, so an automation cannot send something the panel would not.
function validateAnnouncement(input) {
  if (!isPlainObject(input)) throw new AnnouncementError('Announcement must be an object');
  const message = typeof input.message === 'string' ? input.message.trim() : '';
  if (!message) throw new AnnouncementError('message is required');
  if (message.length > 300) throw new AnnouncementError('message must be 300 characters or fewer');

  let title = null;
  if (input.title !== undefined && input.title !== null) {
    if (typeof input.title !== 'string' || input.title.trim().length > 60) {
      throw new AnnouncementError('title must be text of 60 characters or fewer');
    }
    title = input.title.trim() || null;
  }

  let icon = 'campaign';
  if (input.icon !== undefined && input.icon !== null) {
    if (typeof input.icon !== 'string' || !ICON_TOKEN.test(input.icon)) {
      throw new AnnouncementError('icon must be a Material icon name such as directions_bus');
    }
    icon = input.icon;
  }

  if (input.speak !== undefined && typeof input.speak !== 'boolean') {
    throw new AnnouncementError('speak must be true or false');
  }
  const priority = input.priority === undefined ? 'normal' : input.priority;
  if (priority !== 'normal' && priority !== 'urgent') {
    throw new AnnouncementError("priority must be 'normal' or 'urgent'");
  }
  let durationSeconds = 45;
  if (input.duration_seconds !== undefined) {
    const value = Number(input.duration_seconds);
    if (!Number.isInteger(value) || value < 5 || value > 600) {
      throw new AnnouncementError('duration_seconds must be a whole number from 5 to 600');
    }
    durationSeconds = value;
  }

  return { message, title, icon, speak: input.speak !== false, priority, durationSeconds };
}

function normalizeSettings(value) {
  const input = isPlainObject(value) ? value : {};
  return {
    speak: typeof input.speak === 'boolean' ? input.speak : DEFAULT_SETTINGS.speak,
    ttsEngine: typeof input.ttsEngine === 'string' && ENTITY_TOKEN.test(input.ttsEngine) ? input.ttsEngine : null,
    quietStart: typeof input.quietStart === 'string' && TIME_TOKEN.test(input.quietStart) ? input.quietStart : DEFAULT_SETTINGS.quietStart,
    quietEnd: typeof input.quietEnd === 'string' && TIME_TOKEN.test(input.quietEnd) ? input.quietEnd : DEFAULT_SETTINGS.quietEnd
  };
}

function validateSettingsInput(input) {
  if (!isPlainObject(input)) throw new AnnouncementError('Settings must be an object');
  if (input.speak !== undefined && typeof input.speak !== 'boolean') throw new AnnouncementError('speak must be true or false');
  if (input.ttsEngine !== undefined && input.ttsEngine !== null &&
    (typeof input.ttsEngine !== 'string' || !ENTITY_TOKEN.test(input.ttsEngine))) {
    throw new AnnouncementError('ttsEngine must be a tts.* entity id or null');
  }
  for (const key of ['quietStart', 'quietEnd']) {
    if (input[key] !== undefined && (typeof input[key] !== 'string' || !TIME_TOKEN.test(input[key]))) {
      throw new AnnouncementError(`${key} must be a 24-hour time such as 21:00`);
    }
  }
}

function minutesOfDay(hhmm) {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
}

// Quiet hours may wrap midnight (21:00-07:00). Equal start and end means no quiet hours.
function isQuietTime(settings, date) {
  const start = minutesOfDay(settings.quietStart);
  const end = minutesOfDay(settings.quietEnd);
  if (start === end) return false;
  const now = date.getHours() * 60 + date.getMinutes();
  return start < end ? now >= start && now < end : now >= start || now < end;
}

function createAnnouncementService({
  readJsonFile,
  writeJsonFile,
  withHouseholdStorageLock,
  fetch,
  hassApiUrl,
  getToken,
  emit,
  now = () => new Date(),
  haAvailable = true
}) {
  const recent = [];
  const audioCache = new Map(); // id -> Buffer, insertion order = age

  function getSettings() {
    return normalizeSettings(readJsonFile(SETTINGS_FILE, DEFAULT_SETTINGS));
  }

  async function saveSettings(input) {
    validateSettingsInput(input);
    return withHouseholdStorageLock(async () => {
      const settings = { ...getSettings() };
      for (const key of ['speak', 'ttsEngine', 'quietStart', 'quietEnd']) {
        if (input[key] !== undefined) settings[key] = input[key];
      }
      const normalized = normalizeSettings(settings);
      writeJsonFile(SETTINGS_FILE, normalized);
      return normalized;
    });
  }

  function haHeaders() {
    return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
  }

  async function haFetch(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function listTtsEngines() {
    if (!haAvailable || !getToken()) return [];
    const response = await haFetch(`${hassApiUrl}/states`, { headers: haHeaders() });
    if (!response.ok) throw new AnnouncementError(`Home Assistant answered ${response.status}`, 502);
    const states = await response.json();
    return states
      .filter(state => typeof state.entity_id === 'string' && state.entity_id.startsWith('tts.'))
      .map(state => ({ entityId: state.entity_id, name: state.attributes?.friendly_name || state.entity_id }));
  }

  async function resolveEngine(settings) {
    if (settings.ttsEngine) return settings.ttsEngine;
    const engines = await listTtsEngines();
    return engines.find(engine => engine.entityId === 'tts.piper')?.entityId || engines[0]?.entityId || null;
  }

  function rememberAudio(id, buffer) {
    audioCache.set(id, buffer);
    while (audioCache.size > AUDIO_CACHE_LIMIT) audioCache.delete(audioCache.keys().next().value);
  }

  function getAudio(id) {
    return audioCache.get(id) || null;
  }

  // HA answers tts_get_url with both `url` and `path`. `url` carries HA's own idea of its address,
  // which on this install is a NAT address the panel cannot reach, so only `path` is used and the
  // clip is fetched here and re-served to the panel.
  async function synthesize(announcement, settings) {
    const engineId = await resolveEngine(settings);
    if (!engineId) return null;
    const response = await haFetch(`${hassApiUrl}/tts_get_url`, {
      method: 'POST',
      headers: haHeaders(),
      body: JSON.stringify({ engine_id: engineId, message: announcement.title ? `${announcement.title}. ${announcement.message}` : announcement.message })
    });
    if (!response.ok) throw new Error(`tts_get_url answered ${response.status}`);
    const { path: audioPath } = await response.json();
    if (typeof audioPath !== 'string' || !audioPath.startsWith('/api/tts_proxy/')) {
      throw new Error('tts_get_url returned no usable path');
    }
    const audio = await haFetch(`${hassApiUrl.replace(/\/api\/?$/, '')}${audioPath}`, { headers: haHeaders() });
    if (!audio.ok) throw new Error(`TTS audio download answered ${audio.status}`);
    return Buffer.from(await audio.arrayBuffer());
  }

  function getRecent() {
    return recent.slice();
  }

  // Accepts raw input, broadcasts the banner at once, then follows up with audio when it is ready,
  // so a slow TTS engine never delays the text.
  function announce(input, source) {
    const clean = validateAnnouncement(input);
    const settings = getSettings();
    const createdAt = now();
    const quiet = isQuietTime(settings, createdAt);
    const willSpeak = clean.speak && settings.speak && (!quiet || clean.priority === 'urgent');
    const announcement = {
      id: randomUUID(),
      ...clean,
      speak: willSpeak,
      source,
      createdAt: createdAt.toISOString()
    };
    recent.unshift(announcement);
    recent.length = Math.min(recent.length, RECENT_LIMIT);
    emit('announcement', announcement);

    if (willSpeak && haAvailable && getToken()) {
      synthesize(announcement, settings)
        .then(buffer => {
          if (!buffer) return emit('announcement-audio', { id: announcement.id, audioUrl: null });
          rememberAudio(announcement.id, buffer);
          emit('announcement-audio', { id: announcement.id, audioUrl: `api/announcements/${announcement.id}/audio` });
        })
        .catch(error => {
          console.warn('[WARN] Announcement speech failed; panels will use their own voice:', error.message);
          emit('announcement-audio', { id: announcement.id, audioUrl: null });
        });
    } else if (willSpeak) {
      emit('announcement-audio', { id: announcement.id, audioUrl: null });
    }
    return announcement;
  }

  // Home Assistant event handler: bad data is logged and dropped, never thrown into the socket.
  function handleHaEvent(event) {
    try {
      return announce(event?.data, 'home-assistant');
    } catch (error) {
      console.warn(`[WARN] Ignored daylight_announce event: ${error.message}`);
      return null;
    }
  }

  return { getSettings, saveSettings, listTtsEngines, announce, handleHaEvent, getRecent, getAudio };
}

module.exports = {
  AnnouncementError,
  DEFAULT_SETTINGS,
  createAnnouncementService,
  isQuietTime,
  normalizeSettings,
  validateAnnouncement
};

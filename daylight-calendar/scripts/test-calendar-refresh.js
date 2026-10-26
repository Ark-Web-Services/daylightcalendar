'use strict';

// Browser regression checks with real FullCalendar and a simulated clock.
// Playwright stays outside the add-on's dependencies, as with check-layout.mjs:
// NODE_PATH=/scratch/node_modules node scripts/test-calendar-refresh.js
// Optional: PLAYWRIGHT_CHROMIUM and CALENDAR_TEST_ASSET_DIR (containing
// moment.min.js and fullcalendar.min.js, otherwise loaded from the app's CDN).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const publicDir = path.resolve(__dirname, '../public');
const appScript = process.env.CALENDAR_TEST_SCRIPT || path.join(publicDir, 'script.js');
const indexHtml = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<link\b[^>]*>/gi, '');
const calendarHtml = fs.readFileSync(path.join(publicDir, 'pages/calendar.html'), 'utf8')
  .replace(/<\/?turbo-frame\b[^>]*>/gi, '');

async function fixture(browser, time, view = 'timeGridDay', timezoneId = 'America/New_York') {
  const page = await browser.newPage({ timezoneId, viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://daylight.test/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: indexHtml });
    const json = url.pathname === '/api/ha/calendars' ? [{ entity_id: 'calendar.test' }]
      : url.pathname === '/api/calendar' ? [] : {};
    return route.fulfill({ json });
  });
  await page.goto('http://daylight.test/');
  await page.clock.install({ time: new Date(time) });
  await page.locator('#calendar-content').evaluate((frame, html) => { frame.innerHTML = html; }, calendarHtml);
  for (const name of ['fullcalendar.min.css', 'styles.css']) {
    await page.addStyleTag({ path: path.join(publicDir, name) });
  }
  for (const [name, url] of [
    ['moment.min.js', 'https://cdn.jsdelivr.net/npm/moment@2.29.4/moment.min.js'],
    ['fullcalendar.min.js', 'https://cdn.jsdelivr.net/npm/fullcalendar@5.10.1/main.min.js']
  ]) {
    await page.addScriptTag(process.env.CALENDAR_TEST_ASSET_DIR
      ? { path: path.join(process.env.CALENDAR_TEST_ASSET_DIR, name) } : { url });
  }
  // Load after DOMContentLoaded so these tests exercise the calendar and global
  // UI directly, without starting unrelated integrations or backend services.
  await page.addScriptTag({ path: appScript });
  await page.evaluate(viewType => {
    window.appConfig = { show_weather: false };
    setupCalendar();
    calendar.changeView(viewType);
    initializeGlobalUI();
    initializeSidebar();
    window.eventRefreshes = 0;
    const refetch = calendar.refetchEvents.bind(calendar);
    calendar.refetchEvents = () => { window.eventRefreshes += 1; return refetch(); };
  }, view);
  page.testErrors = errors;
  return page;
}

async function snapshot(page) {
  return page.evaluate(() => ({
    date: moment(calendar.getDate()).format('YYYY-MM-DD'),
    title: document.getElementById('calendar-view-title').textContent,
    time: document.getElementById('current-time').textContent,
    today: [...document.querySelectorAll('.fc-day-today')].map(cell => cell.dataset.date),
    refreshes: window.eventRefreshes
  }));
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM });
  let passed = 0;
  async function check(name, time, view, callback, timezone) {
    const page = await fixture(browser, time, view, timezone);
    try {
      await callback(page);
      assert.deepEqual(page.testErrors, []);
      console.log(`PASS ${name}`);
      passed += 1;
    } finally { await page.close(); }
  }
  try {
    for (const [name, time, view, expected, timezone] of [
      ['day advances at midnight', '2026-10-26T23:59:58-04:00', 'timeGridDay', '2026-10-27'],
      ['today moves within the current week', '2026-10-26T23:59:58-04:00', 'timeGridWeek', '2026-10-27'],
      ['today moves within the current month', '2026-10-26T23:59:58-04:00', 'dayGridMonth', '2026-10-27'],
      ['week advances at its boundary', '2026-10-31T23:59:58-04:00', 'timeGridWeek', '2026-11-01'],
      ['month advances at its boundary', '2026-10-31T23:59:58-04:00', 'dayGridMonth', '2026-11-01'],
      ['year advances at its boundary', '2026-12-31T23:59:58-05:00', 'dayGridMonth', '2027-01-01'],
      ['local midnight ahead of UTC', '2026-10-26T23:59:58+05:30', 'timeGridDay', '2026-10-27', 'Asia/Kolkata'],
      ['UTC midnight keeps the local day', '2026-10-26T19:59:58-04:00', 'timeGridDay', '2026-10-26']
    ]) {
      await check(name, time, view, async page => {
        const before = await snapshot(page);
        await page.clock.runFor(3000);
        const after = await snapshot(page);
        assert.equal(after.date, expected);
        assert.ok(after.today.length > 0 && after.today.every(date => date === expected));
        assert.equal(after.time, name.startsWith('UTC') ? '8:00 PM' : '12:00 AM');
        if (!name.startsWith('UTC')) {
          if (!name.startsWith('today moves')) assert.notEqual(after.title, before.title);
          assert.equal(after.refreshes, 1);
          await page.clock.runFor(2000);
          assert.equal((await snapshot(page)).refreshes, 1, 'refresh only once per day change');
        }
      }, timezone);
    }

    await check('browsed date survives midnight', '2026-10-26T23:59:58-04:00', 'timeGridDay', async page => {
      await page.evaluate(() => calendar.gotoDate('2026-11-12'));
      await page.clock.runFor(3000);
      assert.equal((await snapshot(page)).date, '2026-11-12');
    });

    for (const event of ['focus', 'pageshow', 'visibilitychange']) {
      await check(`catch up after sleep via ${event}`, '2026-10-26T12:00:00-04:00', 'timeGridDay', async page => {
        await page.clock.setSystemTime(new Date('2026-10-29T09:30:00-04:00'));
        await page.evaluate(eventName => {
          (eventName === 'visibilitychange' ? document : window).dispatchEvent(new Event(eventName));
        }, event);
        const state = await snapshot(page);
        assert.equal(state.date, '2026-10-29');
        assert.equal(state.time, '9:30 AM');
        assert.ok(state.today.every(date => date === '2026-10-29'));
      });
    }

    await check('returning to calendar catches up before the next tick', '2026-10-26T12:00:00-04:00', 'timeGridDay', async page => {
      await page.locator('[data-tab-target="chores-content"]').click();
      await page.clock.setSystemTime(new Date('2026-10-28T08:00:00-04:00'));
      await page.evaluate(() => document.querySelector('[data-tab-target="calendar-content"]').click());
      assert.equal((await snapshot(page)).date, '2026-10-28');
    });

    await check('DST repeated hour keeps the same day', '2026-11-01T01:59:58-04:00', 'timeGridDay', async page => {
      await page.clock.runFor(3000);
      const state = await snapshot(page);
      assert.equal(state.date, '2026-11-01');
      assert.equal(state.time, '1:00 AM');
      assert.equal(state.refreshes, 0);
    });

    await check('five-minute data poll stays active', '2026-10-26T12:00:00-04:00', 'timeGridDay', async page => {
      await page.evaluate(() => { startCalendarAutoRefresh(); startCalendarAutoRefresh(); });
      await page.clock.fastForward(5 * 60 * 1000);
      assert.equal((await snapshot(page)).refreshes, 1);
    });

    await check('hidden poll pauses and resumes once', '2026-10-26T12:00:00-04:00', 'timeGridDay', async page => {
      await page.evaluate(() => {
        window.testVisibility = 'hidden';
        Object.defineProperty(document, 'visibilityState', { get: () => window.testVisibility });
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('focus'));
      });
      await page.clock.fastForward(5 * 60 * 1000);
      assert.equal((await snapshot(page)).refreshes, 0);
      await page.evaluate(() => {
        window.testVisibility = 'visible';
        document.dispatchEvent(new Event('visibilitychange'));
      });
      assert.equal((await snapshot(page)).refreshes, 1);
      await page.clock.fastForward(5 * 60 * 1000);
      assert.equal((await snapshot(page)).refreshes, 2);
    });
    console.log(`${passed} calendar refresh checks passed.`);
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

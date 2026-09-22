// Daylight layout verification harness.
//
// The wall panel must never scroll and must adapt to any screen. This renders the
// glanceable pages at four viewports and fails on anything that scrolls, anything
// clipped by an ancestor's overflow:hidden (just as invisible to the user), a
// primary content area squeezed below 55% of its page, or event text below a
// 4.5:1 contrast ratio.
//
//   cd daylight-calendar && (STANDALONE_DEV=true PORT=8100 node index.js &) ; sleep 6
//
//   # Playwright is deliberately NOT a project dependency (it must not reach the
//   # add-on image). Node resolves ESM imports from the SCRIPT's directory, not the
//   # cwd, so copy this file next to an installed playwright and run it there:
//   mkdir -p /tmp/dl-harness && cd /tmp/dl-harness
//   npm init -y && npm install playwright
//   cp <repo>/daylight-calendar/scripts/check-layout.mjs .
//   PLAYWRIGHT_CHROMIUM=<path-to-chromium> node check-layout.mjs http://localhost:8100/ ./shots
//
//   lsof -ti:8100 | xargs kill -9
//
// Exits non-zero on any failure. Look at the screenshots too: a layout can pass
// every check and still look wrong.

// Layout verification harness for Daylight.
// usage: node check-layout.mjs [baseUrl] [outDir]
// Renders each glanceable page at several viewports and fails if anything scrolls.
import { chromium } from 'playwright';
import fs from 'fs';

const BASE = process.argv[2] || 'http://localhost:8100/';
const OUT  = process.argv[3] || './shots';
// Point at any Chromium build. Playwright's own download is used when this is
// unset; PLAYWRIGHT_CHROMIUM lets you reuse an already-cached browser instead of
// downloading a second copy (`ls ~/Library/Caches/ms-playwright` to find one).
const EXEC = process.env.PLAYWRIGHT_CHROMIUM || undefined;

const VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1280x800',  width: 1280, height: 800  },
  { name: '1024x768',  width: 1024, height: 768  },
  { name: '1080x1920', width: 1080, height: 1920 },
];
// Pages that must NEVER scroll. Settings is deliberately excluded.
const PAGES = ['calendar', 'chores', 'meals', 'lists'];

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
let failures = 0;

function luminance([r, g, b]) {
  const a = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  for (const name of PAGES) {
    await page.evaluate(p => {
      const tab = document.querySelector(`[data-tab-target="${p}-content"]`);
      if (tab) tab.click();
    }, name);
    await page.waitForTimeout(3000);

    const res = await page.evaluate(() => {
      const doc = document.documentElement;
      const bad = [];
      const visible = el => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
        // A closed modal is inert: it only becomes visible with .show
        const modal = el.closest('.modal');
        if (modal && !modal.classList.contains('show')) return false;
        return el.getClientRects().length > 0;
      };
      for (const el of document.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        const scrolly = /auto|scroll/.test(cs.overflowY) || /auto|scroll/.test(cs.overflowX);
        // FullCalendar's internal .fc-scroller panes are scrollbars too, even when
        // their overflow is set inline by the library.
        const isFcScroller = el.classList.contains('fc-scroller');
        if (!scrolly && !isFcScroller) continue;
        if (!visible(el)) continue;
        const dy = el.scrollHeight - el.clientHeight;
        const dx = el.scrollWidth - el.clientWidth;
        if (dy > 2 || dx > 2) {
          const id = el.id ? '#' + el.id : '';
          const cls = typeof el.className === 'string' && el.className.trim()
            ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
          bad.push({ sel: el.tagName.toLowerCase() + id + cls, dy, dx });
        }
      }
      // Content can also be CLIPPED by an ancestor's overflow:hidden rather than
      // scrolled - invisible to the user either way. Flag anything whose box
      // extends past the bottom or right of the viewport.
      const clipped = [];
      const vh = window.innerHeight, vw = window.innerWidth;
      const frame = [...document.querySelectorAll('.tab-content, turbo-frame')]
        .find(f => f.getClientRects().length > 0 && getComputedStyle(f).display !== 'none');
      if (frame) {
        for (const el of frame.querySelectorAll('*')) {
          if (!visible(el)) continue;
          const cs = getComputedStyle(el);
          if (cs.position === 'fixed' || cs.position === 'absolute') continue;
          const r = el.getBoundingClientRect();
          if (r.height < 4 || r.width < 4) continue;
          if (r.bottom > vh + 4 || r.right > vw + 4) {
            const id = el.id ? '#' + el.id : '';
            const cls = typeof el.className === 'string' && el.className.trim()
              ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
            clipped.push({ sel: el.tagName.toLowerCase() + id + cls,
                           over: Math.round(Math.max(r.bottom - vh, r.right - vw)) });
          }
        }
      }
      // Keep only the outermost few offenders, deduped.
      const seen = new Set();
      const clippedTop = clipped.filter(c => !seen.has(c.sel) && seen.add(c.sel)).slice(0, 6);

      // The primary content of a page must actually get the space. A board squeezed
      // into a fifth of its own screen by secondary panels is the "overload" failure
      // even when nothing technically overflows.
      let primaryShare = null;
      const board = document.querySelector('#chore-board');
      if (board && board.getClientRects().length) {
        const area = board.closest('.content-scrollable') || board.parentElement;
        if (area) {
          const ah = area.getBoundingClientRect().height;
          if (ah > 0) primaryShare = Math.round((board.getBoundingClientRect().height / ah) * 100);
        }
      }

      const cal = document.querySelector('#calendar');
      return {
        clipped: clippedTop,
        primaryShare,
        pageScrolls: doc.scrollHeight > doc.clientHeight + 2,
        docH: doc.scrollHeight, viewH: doc.clientHeight,
        calendar: cal ? { client: cal.clientHeight, scroll: cal.scrollHeight } : null,
        overflowing: bad.slice(0, 10),
      };
    });

    const shareBad = res.primaryShare !== null && res.primaryShare < 55;
    const ok = !res.pageScrolls && res.overflowing.length === 0 && res.clipped.length === 0 && !shareBad;
    if (!ok) failures++;
    const calInfo = res.calendar ? ` cal=${res.calendar.client}/${res.calendar.scroll}` : '';
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(9)} ${vp.name.padEnd(10)} page=${res.docH}/${res.viewH}${calInfo}` +
      (res.overflowing.length ? ` SCROLLS: ${res.overflowing.map(o => `${o.sel}(+${o.dy}h)`).join(', ')}` : '') +
      (res.clipped.length ? ` CLIPPED: ${res.clipped.map(o => `${o.sel}(+${o.over}px)`).join(', ')}` : '') +
      (res.primaryShare !== null ? ` board=${res.primaryShare}%${shareBad ? ' TOO-SMALL(<55%)' : ''}` : ''));

    await page.screenshot({ path: `${OUT}/${name}-${vp.name}.png` });
  }
  await page.close();
}

// Contrast audit of calendar event chips at one viewport.
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);
const contrast = await page.evaluate(() => {
  const parse = c => (c.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
  // Measure the elements that actually paint text. Wrapper elements such as
  // a.fc-daygrid-event set color == background and render nothing themselves,
  // which produced a meaningless 1.00:1 reading.
  return [...document.querySelectorAll('.fc-event-title, .fc-event-time, .fc-event-main')]
    .filter(el => (el.innerText || '').trim())
    .slice(0, 15)
    .map(el => {
      const cs = getComputedStyle(el);
      // A transparent background means the element paints nothing; the real
      // backdrop is the nearest opaque ancestor. Measuring the transparent value
      // yields a meaningless 1.00:1.
      const opaque = node => {
        for (let n = node; n && n !== document.documentElement; n = n.parentElement) {
          const c = getComputedStyle(n).backgroundColor;
          const m = c.match(/rgba?\(([^)]+)\)/);
          if (!m) continue;
          const parts = m[1].split(',').map(Number);
          const alpha = parts.length > 3 ? parts[3] : 1;
          if (alpha > 0.5) return c;
        }
        return getComputedStyle(document.body).backgroundColor;
      };
      return { text: (el.innerText || '').trim().slice(0, 28), fg: cs.color, bg: opaque(el), size: cs.fontSize };
    });
});
if (contrast.length === 0) {
  // A silent pass on an empty sample is worse than a failure - it looks like
  // proof when it is the absence of it. Fixture weeks drift out of range.
  console.log('contrast WARN: no event chips were present to measure (is the visible week empty?)');
  failures++;
}
for (const c of contrast) {
  const fg = (c.fg.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
  const bg = (c.bg.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
  if (fg.length < 3 || bg.length < 3) continue;
  const L1 = luminance(fg), L2 = luminance(bg);
  const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  const flag = ratio < 4.5 ? 'LOW ' : 'ok  ';
  console.log(`contrast ${flag}${ratio.toFixed(2)}:1  ${c.size.padEnd(6)} "${c.text}"`);
  if (ratio < 4.5) failures++;
}
await page.close();
await browser.close();

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

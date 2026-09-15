/**
 * Calendar Styles
 *
 * This module used to inject a <style> block at runtime. Every rule it added was
 * either harmful or superseded by public/styles.css, and because it was injected
 * into <head> after page load it outranked the stylesheet and could not be fixed
 * by editing CSS:
 *
 *   .fc { display: block !important; }
 *       FullCalendar's liquid-height mode (height: '100%') lays .fc out as a flex
 *       column so .fc-view-harness can flex-grow into the remaining space. Forcing
 *       display:block killed that, the harness collapsed to 0px, and the calendar
 *       rendered as a blank area with the day cells and events present in the DOM
 *       but invisible.
 *
 *   #calendar { min-height: 600px; background-color: #fff; }
 *   .fc-view-harness { background-color: #fff; }
 *       Hardcoded white breaks the five non-light themes (constraint: style only
 *       with the --md-* custom properties), and the min-height forced the page to
 *       overflow on any short panel.
 *
 *   .fc .fc-button { background-color: #4285f4; ... }
 *       Styled FullCalendar's built-in toolbar, which is no longer used
 *       (headerToolbar: false — the app renders its own top bar).
 *
 *   .tab-content { padding: 20px; }
 *       Page padding belongs in styles.css alongside the rest of the layout.
 *
 * Calendar styling now lives entirely in public/styles.css, using theme tokens.
 * This file is intentionally a no-op and is kept only so the existing
 * <script src="js/calendar-styles.js"> tag in index.html resolves.
 */

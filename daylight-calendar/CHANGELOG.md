# Changelog

## [1.1.9.29] - 2026-09-25

Receipt photos can now be queued for the local Qwen vision model and turned into durable,
reviewable grocery rows without making the wall panel wait for inference. One background worker
feeds Ollama a receipt at a time, survives add-on restarts by re-queuing interrupted work, records
timings and readable failures, and supports retry, row correction, confirmation, deletion and CSV
export. Reader address and model settings live in the persistent add-on data volume and include a
connection/model check.

The parser accepts both the current item-code format and the earlier four-field output, distrusts
unsupported quantities, recovers weights from printed evidence, removes payment, tax, total and
adjacent weight-artifact rows, and reconciles included prices and counts against the receipt. A
confirmed correction is remembered by store and item code (or printed text), so later receipts
start with the household's preferred name and category.

Receipt JPEGs are capped at 12 MB, stay in the persistent private data directory only while review
is pending, and are deleted on confirmation or receipt deletion. Payment/card text is never kept as
an item and is redacted in the dropped-row audit. Verified through the real HTTP API with an
isolated Ollama stub: queued/processing/review state, strict one-at-a-time inference, confirmation
and item memory, garbage and timeout failures, retry, photo deletion and spreadsheet-safe CSV.

## [1.1.9.28] - 2026-09-25

Security update to the add-on's JavaScript dependencies. `npm audit` reported 31 known
vulnerabilities (3 critical, 14 high); after this release it reports none in production
dependencies and 3 moderate ones in development-only build tooling. Twenty production packages
moved by patch or minor versions — notably express 4.21.2 -> 4.22.3, axios 1.9.0 -> 1.20.0 and
ws 8.17.1 -> 8.21.3.

`ws` is now declared as a runtime dependency. The server requires it, but it was listed as a
development dependency, so it only worked because the image installs development packages too;
a production-only install would have crashed the add-on.

Verified on Node 16.20.2 — the exact runtime of the current base image — in a throwaway
container: every API endpoint answered 200 with no runtime errors.


## [1.1.9.27] - 2026-09-25

Hextris is gone from the game library. Its site, hextris.io, no longer exists (the domain stopped
resolving), so its tile opened to an empty frame on the wall panel. It is removed from the defaults
and retired automatically from libraries that were seeded before it died; the clean-up runs at
start-up, before any request can race it.

The Debug tab no longer appears on the family panel. The code revealed it when development mode
was on but nothing ever hid it otherwise, so it showed in production too. It now defaults to hidden
and appears only with `development_mode` enabled — verified both ways.

Also verified end to end in a browser for the first time: tapping a game (the launch target covers
98% of the tile) starts a session, the countdown runs and shows its one-minute warning, and at zero
the game is unloaded, "Time's up" appears, and the server refuses a restart.


## [1.1.9.26] - 2026-09-25

Choosing a player on the wall display still required a tap even though the Dell panel already has
a camera. Face recognition can now be enabled from Settings and enrolled per household profile;
on Games, three clear matches in a row offer to choose that person after a three-second “Not me”
window. Recognition never starts a game, and chores, remaining time, and the one-player limit all
continue through the same screen-time gate. Similar-looking faces must also beat the next-best
match by a safe margin, so uncertainty leaves manual selection in control.

The face library and models are bundled with the add-on for offline use and load only when the
feature actually needs them. Daylight saves no photos or video: only numeric face vectors remain
in the add-on data volume, nothing is sent away from the device, and enabling, enrolling, or
deleting those vectors requires the existing parent PIN and its lockout protection. Camera tracks
stop when Games is left, the page is hidden, a game or modal takes over, or enrollment closes;
permission and model failures fall back to tapping a name without blocking the kiosk.

The “Finish these first” checklist on Games is now functional as well. Its chore rows are large
touch controls that complete the underlying Home Assistant todo item, run the existing star-award
path, and refresh the gate immediately instead of looking tappable while doing nothing.

Two defects were found by exercising the camera pipeline in a real browser with a fake camera feed
before release. TensorFlow.js was never told which backend to use, so on any machine without WebGL
it chose its WebAssembly backend — which downloads its binaries from a CDN, unreachable offline and
through ingress — and every detection failed. It is now pinned to WebGL with a pure-JavaScript CPU
fallback that needs no downloads. And recognition discarded any face the detector scored below 0.8,
but this detector scores a plainly visible face around 0.6-0.85, so an enrolled face measured at
0.685 was never compared at all. The detector floor is now 0.5 (0.6 when enrolling); protection
against choosing the wrong child comes from the match distance, the runner-up margin, three
consecutive frames and the "Not me" button. Verified: an enrolled face matched at distance 0.33 and
was chosen after 3 seconds; a stranger measured 0.70-0.73 and was never chosen in 60 seconds; the
camera was released on leaving the tab in both runs.

## [1.1.9.25] - 2026-09-25

The Games page looked as though it enforced playtime, but its 30-minute balance and every
per-game limit were static labels: the 15:00 overlay never moved, selecting a profile changed
nothing, and a launched game could run without any limit at all. Adding a game also stopped at a
console message, so the library reset to three hardcoded tiles whose artwork depended on dead or
third-party image hosts.

Games now use a durable, append-only session ledger with per-profile daily allowances, parent
grants, server-enforced expiry, and heartbeat recovery that charges only through the last known
play when the panel loses power or the page crashes. Assigned chores that are due now—and,
optionally, today’s routines—must be complete before play begins; the block names the exact work
remaining and a PIN-protected parent can allow one session. The same 4–8 digit parent PIN protects
added time, settings changes, and game removal, with a temporary lock after repeated wrong tries.

The wall display now asks who is playing, shows each person’s remaining time, counts down against
the server while a game is open, stops the iframe and its audio at zero, and keeps the page fixed
to the viewport while only a large library scrolls inside its own bounded area. The game library
persists under the add-on data volume and uses local Material icons instead of hotlinked images;
Screen time settings now include household defaults, individual limits, chore and routine gates,
and a touchscreen numeric PIN pad.

## [1.1.9.24] - 2026-09-22

The week view stopped showing when things actually happen. Fitting the calendar to the panel in
1.1.9.18 also switched the week from a time grid to `dayGridWeek`, which has no hour axis at all —
every event collapsed into a chip stacked at the top of its day, so a 6:30pm parent-teacher meeting
and an all-day trip looked identical and nothing conveyed duration. The week is a time grid again:
events sit at their real start time and span their real length, multi-day events continue correctly
across columns, and all-day items keep their own row.

It still fits without scrolling, which is what the switch had been avoiding. Gridlines are hourly
rather than the 30-minute default, so the 06:00-24:00 window is 18 rows instead of 36 and fits any
panel height; `slotDuration` governs only the gridlines, so events keep exact placement — verified
at 46.4px per hour, with an 18:30-20:00 event landing 580px down and 69px tall. Also adds a current
-time indicator and side-by-side rather than overlapping events.


## [1.1.9.23] - 2026-09-17

The dimmer had been protecting the panel for only 30 seconds at a time, then waking itself back
up to full brightness. At the same time, a wall panel could stay on an old JavaScript page after
an add-on restart, leaving a perfectly healthy touchscreen with nothing current to talk to.

### Fixed
- **Screen protection now stays protective.** After the configured idle period, the full-screen
  dimmer remains in place until the next touch or other interaction, without a countdown, message,
  or precisely targeted wake button.
- **Wall panels now recover after add-on updates.** The page checks the existing configuration
  endpoint for the running add-on version every minute, reloads when that version changes, and
  retries with a bounded backoff through an interrupted restart before reloading once the service
  returns. Reloads defer while a modal or active edit is open.

## [1.1.9.22] - 2026-09-15

The Chores board had reclaimed the page, but the furniture around it had not caught up. Seven
header controls squeezed the title into two lines and clipped the primary New Chore action off
the right edge of the screen, while the household stars strip spent more room on repeated empty
states than on the people it was meant to show.

### Fixed
- **New Chore stays reachable.** The header now keeps Hide Completed, Manage, and the primary
  action visible without a fixed-height clipping point; its controls wrap when space is tight.

### Changed
- **Chore management now lives in one touch-friendly menu.** Rewards, star adjustments, star
  settings, and routines continue to open their existing modals from the Manage menu.
- **Household stars now use full-name profile chips.** The strip no longer carries a decorative
  heading or repeats “No rewards yet” for every family member, and its routine summary can wrap
  instead of running past the edge.

## [1.1.9.21] - 2026-09-15

The Chores board had been squeezed into 22% of its own page by the stars and rewards panels.
Those management features made the actual household work the smallest, most crowded part of a
wall display meant to be read at a glance.

### Changed
- **Chores now leads with the board.** Stars, next-reward progress, and today’s routine total share
  one compact strip, leaving the bounded board the clear majority of the page.
- **Reward management, star adjustments, star settings, and routine setup now live behind header
  buttons and their existing modals.** A profile’s compact reward button still opens the existing
  redemption confirmation before any stars are spent.

## [1.1.9.20] - 2026-09-15

The Chores board could give each lane a scrollbar while the lane itself still extended beneath the
fixed page. That left the final cards and their controls cut off, especially after the dashboard
panels above the board had claimed their space. Each card also repeated a full routine editor,
which made a family board harder to scan from across the room.

### Fixed
- **Chore lanes now receive the bounded remainder of the page.** The frame, content area, board,
  lanes, and lane contents all permit their flex children to shrink; only the lane content scrolls,
  so no card is clipped by an ancestor.

### Changed
- **Chore cards now show compact step progress.** Tapping a card opens the existing modal-style
  detail surface for adding, editing, ordering, and checking off individual steps, while the board
  keeps assignment initials, stars, due dates, and the completion toggle at a glance.

## [1.1.9.19] - 2026-09-15

Version 1.1.9.18 shipped the intended two-bar calendar structure, but FullCalendar could still
render while its frame was hidden and cache a zero-height container. The events and day cells
were present in the DOM, yet the entire visible grid collapsed. The Chores board also made its
new inline subtask controls unreachable when a card grew beyond its lane.

### Fixed
- **Calendar sizing now waits for a visible, non-zero container.** A queued post-activation
  `updateSize()` remeasures FullCalendar after Calendar becomes active, while a guarded
  `ResizeObserver` keeps the grid sized through viewport, orientation, and sidebar changes
  without resize feedback loops.
- **Chore lanes now scroll internally instead of clipping cards.** The board remains
  page-fixed, with token-coloured scroll indicators on each bounded lane so every chore card and
  its add-step control can be reached.

## [1.1.9.18] - 2026-09-15

The calendar had accumulated five competing bands around a time grid that FullCalendar sized to
its content rather than its container. On a 1080p wall display that made the week cut off at 3pm
and required scrolling to see the evening, defeating the purpose of a glanceable family calendar.

### Changed
- **The calendar is now a two-bar, full-height display.** Navigation, the one date title, view
  switcher, and small time/weather readout share a thin top bar; profile chips form the only row
  below it, leaving the grid to use everything else.
- **Week defaults to compact day columns and every event is a solid, contrast-checked chip.**
  Profile star balances now live on their profile chips, so household momentum remains visible
  without a separate panel.

### Fixed
- **FullCalendar now fills its available container rather than growing to its 18-hour content.**
  The page and its glanceable companion pages can adapt to the panel without a page scrollbar.

## [1.1.9.17] - 2026-09-12

The household loop previously stopped at recording stars and rewards on the Chores page. That
left recurring habits, unassigned work, and the daily reason to participate out of sight of the
calendar screen families actually use together.

### Added
- **Up for Grabs, routines, and chore checklists.** Unassigned chores can now be claimed or
  released safely, multi-step routines award once per person per local day, and chore subtasks
  stay beside their Home Assistant todo identity without completing the todo by surprise.
- **A compact, collapsible household-momentum strip on the calendar.** It shows each profile’s
  stars, next-reward progress, routine steps, and available household work, while honestly
  explains when the household has not set those features up yet.

## [1.1.9.16] - 2026-09-12

The chore board previously treated chores as a two-column checklist and then discarded the
assignee and due-date information collected by its own form. That made it impossible for a
child to see ownership, earn reliable credit for work completed outside this screen, or turn
that credit into something motivating.

### Changed
- **Chores now retain household-only assignment, dates, and star values beside their Home
  Assistant todo identity.** Completion awards are an append-only, derived-balance ledger so
  Home Assistant, voice, and wall-panel completions all receive the same idempotent treatment.
- **Stars and rewards are visible on the Chores page.** Profiles can see their current balance,
  progress toward the next reward, and the rewards they can redeem; adults can manage rewards
  and make reasoned ledger adjustments without browser-blocking dialogs.

### Fixed
- **Chore titles could break completion controls or inject markup.** The board now escapes titles
  and uses delegated controls instead of interpolating user text into an inline handler.
- **Lane colours were hardcoded and unreadable in several themes.** The board now uses the
  Material theme tokens shared by all Daylight themes.

## [1.1.9.15] - 2026-09-12

Daylight now has durable household Lists rather than an inert Grocery List modal. Grocery,
to-do, and custom lists persist in the add-on's `/data` volume, report their last successful
sync, and refresh while the Lists tab is visible so a phone and wall display stay aligned. List
writes are serialized before reaching `lists.json`, which prevents simultaneous item adds from
silently replacing each other. Recipe ingredients can now be added to a chosen grocery list;
ingredients already on that list are called out and left unchanged instead of being duplicated.

## [1.1.9.14] - 2026-09-12

The Meal Planner previously presented a convincing but entirely hardcoded sample week: none of
the meals shown came from the household, and submitting the Add Meal form only wrote the entered
data to the browser console before discarding it. Meals and recipes now persist in the add-on's
durable `/data` storage, so planning a meal, changing weeks, editing a plan, and reopening the
Recipe Book all use the data the household actually entered. The Recipe Book's previously inert
controls now create, edit, select, and delete recipes, and a selected recipe can be attached to
a meal plan entry. Grocery-list integration and cooking mode remain intentionally unavailable
until their underlying workflows exist.

## [1.1.9.13] - 2026-09-12

Calendar routing in 1.1.9.12 was only half-shipped: the calendar-management screen rendered
controls for assigning a calendar source to one or more profiles, but the server endpoints those
controls saved to were absent, so every save failed. The routing API now persists calendar-to-profile
assignments and returns the consequence preview's destinations correctly, including shared calendars
that belong to more than one person. Calendars such as Holidays, School, or Birthdays that do not
belong to a person can now be routed to a separately coloured non-person label instead, while
unassigned calendars remain visible rather than silently disappearing.

## [1.1.9.12] - 2026-09-11

### Fixed
- **Collapsed sidebar never restored correctly after a page refresh.** Two independent
  implementations were bound to the same toggle element: `initializeSidebar()` in `script.js`
  toggled `#app.sidebar-collapsed`, while `js/sidebar-fix.js` toggled `#sidebar.collapsed` plus
  `.main-content.expanded` and owned the localStorage persistence. On load only the latter was
  restored, so the two states disagreed and the next click drove them in opposite directions —
  which is why collapsing and expanding within one session worked, but surviving a refresh did
  not. `script.js` no longer binds a listener, and a single `applySidebarState()` in
  `sidebar-fix.js` sets every participating class together for both toggle and restore.
- **People filter chips drew stray rectangles around their contents.** `.user-toggle` had three
  competing definitions; the original pinned it to a fixed 36x36 circle, so the initials disc and
  name label added in 1.1.9.11 overflowed that box. Consolidated to one pill definition and
  dropped the `transform: scale()` hover/active rules that distorted it.

## [1.1.9.11] - 2026-09-11

Informed by a Skylight Calendar UI/VOC teardown whose central finding is that profile
(who an event is for), source (where it came from) and destination (where edits write
back) must be visibly separate concepts.

### Changed
- **Profiles now have distinct identities.** Every user previously defaulted to the same
  `#4285f4`, so the people filter row was a line of identical blue circles rendering the
  same generic person icon — there was no way to tell whose filter was whose. Colors are
  now derived from a ten-color palette keyed on the user id, so they are distinct and
  stable across restarts without needing a migration. Filter chips show initials and the
  person's name instead of a generic icon, with 44px tap targets and `aria-pressed` state.
- **Synced calendars are labelled read-only**, in both the calendar management list and the
  event detail dialog. Daylight has no CalDAV write path (`scripts/caldav-service.js` has no
  create, update or delete), so no surface should imply a synced event can be edited here.

## [1.1.9.10] - 2026-09-11

### Fixed
- **Recurring events never appeared on their repeat dates.** `parseICalEvent` is a regex VEVENT
  reader with no `RRULE`, `EXDATE` or `RECURRENCE-ID` handling — it emits one event at the
  original `DTSTART`, so a weekly event that began months ago was invisible today. CalDAV queries
  now request server-side recurrence expansion (`expand: true`), which also handles deleted and
  individually-edited occurrences correctly. Falls back to the unexpanded query if a server
  doesn't support expansion.
- **Events appeared to vanish on refresh.** There was no loading feedback, so the gap between
  render and data arriving looked like data loss. Added an "Updating…" indicator via
  FullCalendar's `loading` callback, and existing events now dim rather than disappear while the
  next fetch is in flight.
- **Meal description field overflowed its dialog.** `.meal-input-group` had no CSS at all, so the
  input and "Select Recipe" button laid out at natural width and escaped the 600px modal.

### Changed
- **The Recipe Book is not implemented**, and now says so instead of showing a spinner forever.
  `loadRecipes()` is called in three places but defined nowhere, and there are no recipe API
  endpoints. The "Select Recipe" button, which had no handler at all, is now visibly disabled with
  an explanation rather than silently doing nothing.

## [1.1.9.9] - 2026-09-11

### Fixed
- **Only ever fetched 7 days of events.** `/api/calendar` ignored the `start`/`end` the calendar
  view requested; `fetchCalendarData()` always built a fixed today-00:00 -> +7 days window. Month
  view drew six weeks and received one, and nothing before today was fetched at all, so the wall
  display showed far fewer events than the phone. The requested range is now threaded through to
  both the Home Assistant and CalDAV fetches, with a sane fallback and a defensive span cap.
- **Day view was missing**, leaving only Week and Month. Restored to the switcher, the button
  labels and the saved-view allowlist.
- **The calendar never refreshed itself.** Nothing refetched events on a timer, so a wall display
  nobody touches stayed stale indefinitely. Added a 5-minute refresh that pauses while the page is
  hidden, refreshes immediately when it becomes visible, and cannot stack duplicate timers when the
  page loader re-enters the calendar.
- **Tapping an event did nothing** — `eventClick` only wrote to the console. Added an event detail
  dialog showing time, calendar, assigned person, location and description, with touchscreen-sized
  tap targets and theme-token styling.
- **Settings page stretched edge to edge** on a wide display. `.settings-section` and
  `.settings-card` are `width: 100%` with no max-width, so forms had no readable measure. Content
  is now capped and centred, collapsing back to full width on narrow screens.

## [1.1.9.8] - 2026-09-11

### Fixed
- **Connected iCloud/CalDAV accounts were wiped by every add-on update.** Accounts were saved to
  `/app/data/caldav_accounts.json`, which lives in the container's writable image layer and is
  destroyed whenever the add-on is rebuilt. Home Assistant only persists `/data`. Account storage
  now uses `/data` in production, matching the `DATA_DIR` logic already used in `index.js`, and
  migrates any accounts found at the old path on first load. User mappings and calendar settings
  were unaffected — they already used `/data`.

## [1.1.9.7] - 2026-09-11

### Added
- **Calendar management**: connected calendars (Home Assistant and CalDAV) are now listed in
  Settings with source, color and a persisted enable/disable toggle, backed by new
  `GET`/`PUT /api/calendar-settings` endpoints. Previously calendars could only be reached
  from inside the edit-user modal.
- **Month view** on the calendar page, alongside the existing week view.
- **Per-day weather icons** on calendar days, tappable for condition and high/low. Uses the
  `weather.get_forecasts` service (the `forecast` entity attribute was removed in HA 2024.4).
- **Empty states** for the calendar view and calendar management when nothing is connected.
- **"Next Event" panel is now populated.** `#next-event-info` had no JavaScript writing to it,
  so it permanently read "No upcoming events" regardless of what was scheduled.

### Fixed
- **Connected calendars rendered nothing.** The calendar view dropped every event lacking a
  `userId`, and events only gained one if a person was mapped to that exact calendar. With no
  mappings, all events were silently discarded. Calendars are now visible by default; assigning
  a person is optional and controls color-coding and the people filters.
- **Unreadable CalDAV sync log.** The box was styled inline with `rgba(0,0,0,0.3)` and
  `#a1b2c3`, which rendered grey-on-grey on every light theme. Now a token-based
  `.caldav-sync-logs` class meeting WCAG AA across all six themes (4.76:1 worst case).
- **Meals page was squished and unreadable**; rebuilt as a responsive card grid.
- **Theme buttons intermittently stopped responding** after re-entering Settings, caused by
  listeners bound to DOM that the page loader swaps out.
- **Automatic night mode ignored the selected theme**, flipping to generic dark. Pastel, Forest,
  Ocean and Sunset now have hue-preserving dark variants, and auto mode switches between the
  light and dark variant of the active theme.
- **Hardcoded demo users** ("Alex"/"Jordan") removed from the games profile list, chores
  assignee dropdown, meal fixtures, and the unused `--color-alex`/`--color-jordan` tokens.
  These surfaces now populate from real users.

### Development
- Added `mock-data/` fixtures so the `STANDALONE_DEV=true` mode documented in DEVELOPMENT.md
  can actually run without a Home Assistant instance.

## [1.1.9.6] - 2026-09-11

### Fixed
- **CalDAV "Assign to User" dropdown stuck on "Loading users..."**: the call to
  `populateCalDAVUserDropdown()`, along with the `edit-user-form` submit wiring, sat after
  the `finally` block *inside* `handleCalDAVSync()`. Both only ran if the user clicked
  "Sync Now" first, so the dropdown never left its placeholder. Moved into
  `initializeCalDAVSettings()`, which is what the settings-page init already calls and
  whose call site comment already claimed it wired the edit form.
- **Editing a user silently did nothing**: same root cause — `edit-user-form`'s submit
  handler was never attached, so `handleUpdateUser` never fired.

## [1.1.9.5] - 2026-09-11

### Fixed
- **User creation/editing crashed under ingress**: `handleCreateUser` and `handleUpdateUser`
  read `.selectedOptions` from `#new-user-calendar` / `#edit-user-calendar`, but those are
  `<div class="calendar-checkbox-list">` containers filled with checkboxes, not `<select>`
  elements. `.selectedOptions` was `undefined`, so `Array.from(undefined)` threw
  "can't access property Symbol.iterator, items is undefined". Both now read
  `.cal-checkbox:checked`.
- **Empty user list, calendar list and notify-service dropdown under ingress**: 17 `fetch()`
  calls in `public/script.js` used absolute `/api/...` paths. Home Assistant serves add-ons
  from `/api/hassio_ingress/<token>/`, so those requests escaped the add-on and hit the
  Home Assistant API instead (401). They now use relative paths, matching the convention
  already used by `page-loader.js` and `populateEditDropdowns`.
- **Socket.io client 404**: `<script src="/socket.io/socket.io.js">` was absolute and failed
  to load under ingress in `index.html` and `refactored-index.html`. Now relative.

## [1.1.9.4] - 2025-06-17

### Major Improvements
- **🔧 Complete Debug Page Redesign**: Completely redesigned the debug/diagnostic page to eliminate confusion and redundancy
- **📊 Clear System Status Dashboard**: Added intuitive status grid with visual indicators for environment, access mode, connections
- **🎯 Eliminated Port Confusion**: Removed confusing "port mismatch" diagnostics that were irrelevant to end users
- **🧹 Removed Redundant Sections**: Consolidated multiple sections that tested the same functionality
- **📱 Modern UI Design**: Implemented clean, organized interface with proper visual hierarchy

### Fixed
- **Confusing Diagnostics**: Removed irrelevant port mismatch warnings that users couldn't control
- **Redundant Information**: Eliminated duplicate testing sections and overlapping functionality
- **Poor User Experience**: Replaced complex, technical jargon with clear, actionable information
- **Visual Clarity**: Added proper status indicators (✅ success, ⚠️ warning, ❌ error) throughout interface

### Enhanced
- **Access Mode Clarity**: Clear explanation of Development vs Production vs Ingress modes
- **Streamlined Testing**: Simplified connection testing with focused, relevant tests
- **Better Error Reporting**: Improved error messages with actionable solutions
- **Configuration Display**: Clean presentation of system configuration and environment
- **Diagnostic Reports**: Comprehensive but organized diagnostic report generation

### Removed
- **URL Fixer Tool**: Unnecessary tool that added confusion without solving real problems
- **Complex Authentication Testing**: Overly technical tests that weren't useful for troubleshooting
- **Redundant API Sections**: Multiple sections testing the same endpoints
- **Confusing Port Diagnostics**: Misleading information about port mismatches

### Technical Details
- Reduced debug page from 939 lines to ~400 lines while improving functionality
- Implemented responsive grid layout for status indicators
- Added proper error handling and user feedback throughout
- Simplified JavaScript from complex multi-function approach to focused, single-purpose functions
- Improved accessibility with better color coding and clear labels

## [1.1.9.3] - 2025-05-31

### Fixed
- **Calendar Display Issues**: Downloaded correct FullCalendar CSS file to fix calendar formatting and display problems
- **Weather Data Population**: Enhanced weather API to provide mock data in development mode when Home Assistant is unavailable
- **Settings Page Functionality**: Fixed theme buttons and other settings controls not working properly
- **Calendar Initialization**: Added better error handling and retry logic for FullCalendar library loading
- **Modal Functionality**: Enhanced modal setup to work properly with dynamically loaded settings page content

### Enhanced
- **Calendar Styling**: Improved calendar appearance with Material Design 3 theming and proper sizing
- **Weather Error Handling**: Added comprehensive fallback weather data to prevent authentication errors in development
- **Debug Logging**: Added extensive debugging to settings page initialization for better troubleshooting
- **Theme System**: Enhanced theme button event handling with proper event prevention and state management
- **Development Experience**: Improved development mode with better mock data and error handling

### Technical Improvements
- Fixed FullCalendar CSS corruption issue by downloading fresh copy from CDN
- Enhanced setupCalendar() function with proper error handling and library availability checks
- Improved initializeSettingsPage() function with comprehensive element detection and event binding
- Added proper modal event listener management to prevent duplicate listeners
- Enhanced weather API with structured error responses and development mode fallbacks

## [1.1.9.2] - 2025-05-28

### Fixed
- Fixed modal close buttons not working in dynamically loaded content (meals, games, chores pages)
- Added escape key support for closing modals
- Added click-outside-modal-to-close functionality
- Fixed debug page button functionality by correcting function name mismatches
- Fixed theme button functionality in settings page with improved event handling
- Improved modal event listener management to prevent duplicate listeners
- Fixed data file check buttons in debug page to use correct file paths

### Enhanced
- Improved modal user experience with multiple ways to close modals (X button, escape key, click outside)
- Added better debugging for theme button functionality
- Enhanced modal setup to work properly with Turbo frame content loading
- Improved error handling and logging for modal interactions

## [1.1.9.1] - 2025-05-25

## [1.1.9.0] - 2025-05-25

### Changed
- Complete redesign of the theming system to implement Material Design 3 principles
- Converted all UI components to follow Material Design guidelines
- Added improved color system with primary, secondary, and tertiary colors
- Enhanced accessibility with better color contrast ratios
- Implemented Material elevation system with consistent shadows
- Refined component shapes with consistent border radius values
- Improved typography with Material Design type scale
- Standardized spacing system with Material Design spacing units

## [1.1.8.7] - 2025-05-25

### Changed
- Updated development documentation to clearly explain the port 3001 usage for backend during development
- Improved documentation clarity regarding the separation between development and production ports

## [1.1.8.6] - 2025-05-25

### Added
- Enhanced debug interface with "Run Full Diagnostic Suite" button
- Added token revelation feature to show token source information
- Added "Copy All Results" button to easily share diagnostic information
- Added current URL display for improved debugging context

### Fixed
- Fixed token-info API endpoint to support detailed token information
- Improved debug panel styling for better visibility in all themes

## [1.1.8.5] - 2025-05-25

### Fixed
- Fixed debug page not scrolling properly in Home Assistant ingress mode
- Fixed theme color issues causing dark text on dark background in debug interface
- Fixed debug page width not respecting sidebar layout in ingress mode
- Added ingress API path detection to debug tools for proper operation through Home Assistant
- Restored styles.css reference in debug.html
- Improved error handling for API requests in Home Assistant ingress mode

## [1.1.8.4] - 2025-05-24

### Added
- Added dedicated development mode toggle in add-on configuration
- Consolidated diagnostic tools into a single page accessible via `/debug.html`, `/ingress`, or `/local_daylight_calendar/ingress`
- Added runtime configuration override API for easier troubleshooting
- Added detailed request logging in development mode
- Added ingress path detection for better Home Assistant integration

### Fixed
- Fixed webfont loading in ingress mode by serving fonts at multiple paths
- Improved error handling for JSON parsing errors in API responses
- Enhanced diagnostics endpoint with more detailed environment information
- Fixed 404 errors when accessing API endpoints through ingress

### Changed
- Upgraded debugging infrastructure to support Home Assistant's ingress path handling
- Improved socket.io connection with more detailed server information
- Enhanced error responses with structured data to prevent client crashes

## [1.1.8.3] - 2025-05-24

### Fixed
- Fixed duplicate code in server initialization
- Fixed Socket.io configuration for ingress connections

## [1.1.8.2] - 2025-05-24

### Added
- Added proper support for Home Assistant ingress mode
- Added API endpoint for token information (/api/token-info)
- Added Home Assistant API proxy endpoint (/api/ha-proxy)
- Added initial_data event to socket.io for client configuration

### Fixed
- Fixed webfonts loading in ingress mode by serving them directly
- Added CORS headers for ingress mode to allow cross-origin requests
- Improved detection of ingress environment


### Changed
- Updated server to detect and adapt to ingress mode automatically
- Simplified API error responses to prevent client parsing errors

## [1.1.8.1] - 2025-05-24

### Fixed
- Fixed ESM module import error with node-fetch by using dynamic import syntax
- Resolved MIME type issues with external resources by hosting them locally
- Improved error handling in API endpoints to prevent client-side crashes
- Added proper fallbacks for API responses to ensure valid data structures
- Fixed Font Awesome font file loading issues by including local webfonts

### Changed
- Updated initialization process to handle ESM imports properly

## [1.1.8] - 2025-05-23

### Fixed
- Resolved `webpack-dev-server` intermittent startup failures by downgrading to `^4.15.1`.
- Ensured frontend changes are reliably hot-reloaded during development.
- Corrected JavaScript `ReferenceError` for `weatherForecastData` (Temporal Dead Zone) by moving its declaration.
- Fixed `setTheme is not defined` JavaScript error by correcting function call to `updateTheme`.
- Eliminated persistent dummy weather icons on calendar days by ensuring JavaScript changes were loading correctly.
- Improved text contrast in dark mode for header elements (time, date, weather) and FullCalendar toolbar components.

### Changed
- Updated `DEVELOPMENT.MD` with current `npm run dev` instructions for `webpack-dev-server` and `nodemon` via `concurrently`.

### Removed
- Unnecessary root-level `package.json` and `package-lock.json` files.

### Known Issues
- **Critical:** Frontend API calls (for calendar data, weather, chores, etc.) are failing with `TypeError: NetworkError when attempting to fetch resource`. This prevents most data from loading in the calendar and other sections. Suspected issue with the backend server not starting or being reachable via the proxy. Investigation pending backend logs.
- Daily weather icons on the calendar will not display until the above NetworkError is resolved and weather data can be fetched.

## [1.1.7.1] - 2025-05-12
- Correct build errors


## [1.1.7] - 2025-05-12

### Added
- Screen burn prevention feature that automatically dims the display after a period of inactivity
- Auto night mode that shifts to warmer colors based on time to reduce blue light at night
- Persistent clock display option for always visible time
- Display settings in the Settings tab for configuring screen protection features
- Countdown timer when screen is dimmed with tap-to-wake functionality

## [1.1.6] - 2025-05-09

### Added
- Added Hextris hexagonal puzzle game to Games tab
- Added Clumsy Bird arcade game to Games tab
- Improved game modal interface for consistent user experience

## [1.1.5] - 2025-05-09

### Added
- Recipe book feature with ingredient tracking
- Grocery list management system
- Integration between recipe ingredients and grocery list
- Ability to track ingredient availability and purchase dates
- Select recipes when adding to meal plan

## [1.1.4] - 2025-05-09

### Added
- Expanded "Chores" feature with interactive Kanban board.
- New "Meals" tab for meal planning functionality.
- New "Games" tab placeholder for future functionality.
- Added Geometry Dash to the Games tab with fullscreen modal play capability.
- Added modals for adding new chores and meals.
- Implemented user color coding system.

### Changed
- Enhanced UI with improved styles and layout.
- Better mobile responsiveness.
- Optimized sidebar navigation with toggle functionality.

---

## [1.1.3] - 2025-05-09

### Fixed
- Re-enabled `/api/calendar` and `/api/weather` endpoints in `index.js`.
- Added more detailed error logging for these API calls.

---

## [1.1.2] - 2025-05-09

### Fixed
- Ensured `options.json` is included in the Git repository for the Docker build process.

---

## [1.1.1] - 2025-05-09

### Fixed
- Corrected Dockerfile to properly build and place application files in `/app`.
- Simplified and fixed `rootfs/etc/cont-init.d/setup.sh` to work with the new Dockerfile structure, resolving startup errors when running the add-on via S6 init.

---

## [1.1.0] - 2025-05-09

### Added
- Sidebar navigation with tabs for "Calendar" and "Chores".
- Basic display for "Chore Chart" feature (read-only from sample data).
- Icons to sidebar tabs.
- Fallback mechanism to load local `options.json` for easier local development.

### Changed
- Main UI restructured to support tabbed content.
- Webpack configuration updated to correctly bundle client-side assets (`public/script.js`) and not server-side code.
- `public/index.html` updated to load bundled JavaScript (`dist/bundle.js`).

### Fixed
- Initial Webpack build errors due to incorrect entry point and missing Node.js core module polyfills for client-side context.
- JavaScript error preventing chore chart from displaying.
- Error preventing server startup (`npm start`) locally due to missing `/data/options.json`.

---

## [1.0.0] - Initial Release

- Basic calendar display from Home Assistant.
- Weather integration.
- Light and dark themes.
- Kiosk mode.

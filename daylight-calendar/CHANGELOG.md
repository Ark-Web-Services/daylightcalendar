# Changelog
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
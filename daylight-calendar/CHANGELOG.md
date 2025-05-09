# Changelog

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
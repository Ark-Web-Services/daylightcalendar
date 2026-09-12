# Daylight — Handoff & Roadmap

Written 2026-09-11 at the end of a long working session. Purpose: let a fresh session
continue without re-deriving what took hours to find.

Current deployed version: **1.1.9.12**. Repo `main` is level with origin.

---

## 1. The deployment, and how to reach it

Daylight Calendar is a **Home Assistant Supervisor add-on** (`daylight-calendar/config.yaml`
declares `ingress`, `hassio_api`, `homeassistant_api`). It therefore requires **HAOS or HA
Supervised** — it cannot run on HA Container/Core.

| Thing | Where |
|---|---|
| Host | Windows 11 Pro, Dell Latitude 7490, `192.168.1.118` |
| Shell | `ssh user@192.168.1.118` (key `~/.ssh/id_ed25519`), runs **elevated** |
| HA | HAOS 18.2 in Hyper-V VM `HomeAssistant`, NAT via Default Switch |
| HA URL | `http://192.168.1.118:8123/` |
| Add-on slug | `01a45dd4_daylight_calendar` |
| Repo | `https://github.com/Ark-Web-Services/daylightcalendar` (public) |

Gotchas that cost time:

- The Windows SSH key must live in `C:\ProgramData\ssh\administrators_authorized_keys`,
  **not** `~/.ssh/authorized_keys`, because `user` is an Administrator.
- HA is reachable on the LAN only via a `netsh portproxy` maintained by
  `C:\HAOS\update-portproxy.ps1`, run at boot by scheduled task `HA-PortProxy`. The Hyper-V
  Default Switch re-subnets on host reboot, so the script rediscovers the VM IP each time.
- **The proxy must target the VM's port 80, not 8123.** The 8123 listener emits an absolute
  redirect that strips the port and loops.

### Deploy loop

You need a **fresh HA long-lived access token** (HA profile → Security → Create Token); the
previous session's token was session-local and is gone.

`/api/hassio/*` REST returns 401 in HA 2026.x. Drive the Supervisor over the **WebSocket API**
instead: connect `ws://192.168.1.118:8123/api/websocket`, auth with the token, then send
`{"type":"supervisor/api","endpoint":"/store/reload","method":"post"}`. Useful endpoints:
`/store/reload`, `/store/addons/<slug>/update`, `/addons/<slug>/info`, `/supervisor/info`.

Release steps: bump `daylight-calendar/config.yaml` version → add a CHANGELOG entry → commit
→ **push to `main`** (HA add-on repos track the default branch, so a feature branch will not
reach the instance) → `/store/reload` → `/store/addons/<slug>/update`.

**An update can report `{"code":"unknown_error","message":""}` and still succeed** — the build
continues after the API call returns. Always re-check `/addons/<slug>/info` before concluding
it failed.

---

## 2. Hard constraints — violating these has caused real bugs

1. **Ingress-relative fetches.** Every `fetch()` must be `fetch('api/...')` with **no leading
   slash**. HA serves add-ons from `/api/hassio_ingress/<token>/`; a leading slash escapes the
   add-on and hits Home Assistant, returning 401. This broke the entire user/calendar UI once.
2. **Only `/data` survives an add-on rebuild.** Anything written elsewhere (e.g. `/app/data`)
   is destroyed on **every update**. This silently deleted the user's connected iCloud account.
   `index.js` and `scripts/caldav-service.js` both resolve `DATA_DIR = isProduction ? '/data'
   : ...`. Never use a bare `path.join(__dirname, ...)` for runtime state.
3. **`public/index.html` loads `public/script.js` directly.** `public/dist/bundle.js` is NOT
   used by the main page. Edit `script.js`; do not assume a webpack build is in the path.
4. **Six themes.** `:root` (light), `.theme-dark`, `.theme-pastel`, `.theme-forest`,
   `.theme-ocean`, `.theme-sunset`, plus `-dark` variants of the last four. Style only with
   the `--md-*` custom properties. Hardcoded `rgba(0,0,0,0.3)` on `#a1b2c3` once shipped a
   sync-log box that was unreadable on every light theme.
5. **Wall-mounted touchscreen.** 44px minimum tap targets, nothing hover-dependent.
6. **CalDAV is read-only.** `scripts/caldav-service.js` has no create/update/delete. No UI may
   imply a synced event can be edited here.

---

## 3. Architecture facts worth not re-deriving

- `fetchHaCalendars()` (`index.js`) returns HA **and** CalDAV calendars merged, each
  `{entity_id, name, source:'ha'|'caldav', accountId, calendarUrl, color}`, exposed at
  `api/ha/calendars`. CalDAV entries use a synthetic id `caldav_<accountId>_<calendarUrl>`.
- `api/users` returns `{id, name, calendar_entity_id, notify_service, color, icon}`.
  `calendar_entity_id` may be a **string or an array**. Mappings persist via
  `readUserMappings`/`saveUserMapping`.
- `api/calendar-settings` persists `{disabledCalendarIds: []}`.
- `api/calendar` honours `?start=&end=`; `getCalendarRange()` normalises it and
  `caldavService.fetchAllEvents({start,end})` accepts the range (legacy numeric form still
  works). Span capped at 62 days.
- Recurrence is expanded **server-side** via tsdav `expand: true`, with a fallback to the
  unexpanded query. The local iCal parser is regex-based and has **no** RRULE/EXDATE/
  RECURRENCE-ID handling, so do not rely on it for recurring events.
- Profile colours come from `defaultProfileColor(id)` in `index.js` — a stable hash into a
  ten-colour palette. Do not reintroduce a single default colour.
- Sidebar collapse is owned **solely** by `public/js/sidebar-fix.js` via `applySidebarState()`.
  Do not add a second listener in `script.js`; that exact duplication broke restore-after-refresh.

### Local verification

```bash
cd daylight-calendar && npm install
STANDALONE_DEV=true PORT=8100 node index.js   # http://localhost:8100
```

`mock-data/` (committed) holds fixtures: 3 profiles, 8 events — two deliberately **unassigned**
so the show-by-default path is exercised — and a 7-day forecast.

**Warning:** in non-production the CalDAV service reads `daylight-calendar/data/
caldav_accounts.json`, which contains the user's **real Apple ID and app-specific password in
plaintext** (gitignored, never committed). Running the local server will attempt a real iCloud
login. Delete or stub that file before local dev if you don't want that.

---

## 4. Remaining work

### Package 1 — sync mental model (PARTIALLY DONE)

The driving idea, from the Skylight teardown: **PROFILE** (who it's for) ≠ **SOURCE** (where it
came from) ≠ **DESTINATION** (where edits write back). Conflating these is what made Daylight
render nothing from 7 connected iCloud calendars.

Done: distinct stable profile colours; initials + name on filter chips; read-only badges on
calendar management rows and in the event detail dialog; source badge (HA vs iCloud) per row.

Remaining:
- [ ] Assign a calendar to one or more profiles **from the calendar management screen**.
      Today assignment only exists inside the edit-user modal.
- [ ] Show the consequence before committing — e.g. "events from School will appear in Lily's
      colour" — rather than letting the user discover it afterwards.
- [ ] Non-person **label** calendars (holidays, birthdays, school terms) with their own colour,
      instead of forcing every calendar onto a person.

### Package 2 — recipes + grocery wiring (NOT STARTED)

`loadRecipes()` is **called in three places and defined in none**
(`js/event-fixer.js`, `js/page-loader.js`, `js/script-bridge.js` — all guarded by
`typeof loadRecipes === 'function'`, so they silently no-op). There are **no recipe API
endpoints**. `#select-recipe-btn` in `pages/meals.html` has **no handler** and is currently
disabled with an explanatory title. The Recipe Book modal placeholder now says the feature
isn't set up.

- [ ] Recipe storage under `/data` + CRUD endpoints
- [ ] Browsable recipe book UI (replacing the honest placeholder)
- [ ] Selecting a recipe fills the meal description; re-enable `#select-recipe-btn`
- [ ] Push recipe ingredients to a grocery list (pairs with Package 3)

### Package 3 — lists (NOT STARTED)

A whole tab Daylight lacks. Teardown is emphatic (p.8): for shared lists, **reliability beats
features** — stale state is worse than missing capability.

- [ ] Grocery / to-do / custom lists, persisted under `/data`
- [ ] New nav tab + page, matching the existing page-loader pattern
- [ ] Add/check/reorder/delete items; visible "last synced" state
- [ ] Multi-device consistency (the wall panel and any phone browser)

### Package 4 — stars, rewards, routines, up-for-grabs (NOT STARTED, LARGEST)

Skylight's main differentiator; Daylight has a chores board with none of the motivation loop.
This is a new data model, not a UI tweak.

- [ ] Stars awarded on chore completion, per profile
- [ ] Rewards with star cost, partial progress, and redemption
- [ ] Routines — repeating multi-step habits (morning/evening sequences)
- [ ] "Up for Grabs" — unassigned chores anyone can claim
- [ ] Nested subtasks/checklists (teardown rec #5)
- [ ] Surface the loop on the calendar home screen, not buried in a tab

### Cross-cutting, from the teardown's ranked recommendations

- [ ] Household change notifications — alert when someone adds/edits an event (rec #4)
- [ ] "Event ending soon" reminders for pickup travel time
- [ ] Two-way calendar editing — **a project, not a patch**: CalDAV write-back, conflict
      handling, a finger-usable event editor, text entry on a wall panel. Decide whether
      "phones create, wall displays" is actually the right division of labor first.

---

## 5. Known unverified / open

- The browser extension disconnected partway through the session, so several shipped changes
  were **never seen rendering**: the calendar management section, the sync-log box appearance,
  theme-button responsiveness after re-entering Settings, and the event detail dialog.
- **Week-view event contrast** looked poor — pale blue blocks with near-white text. Never
  measured. Likely the first thing a user notices from across a room.
- `repository.yaml` / GitHub reports **84 Dependabot vulnerabilities** (3 critical, 36 high).
  Pre-existing, from a Node 16 / Alpine 3.15-era dependency tree. Not triaged.
- The add-on stores app-specific passwords **unencrypted** on disk.
- gitleaks findings in `.gitleaks-report.json` are **false positives** — two `curl-auth-header`
  hits in a historical `debug.html` that were the literals `YOUR_LONG_LIVED_TOKEN` and
  `SUPERVISOR_TOKEN`. No credential has ever been committed.

## 6. Process notes

- **Codex subagents were unreliable here.** Three attempts: 1 of 5 items, 1 of 5, then 0 of 5
  after sitting idle for five hours. Tasks detach and give no completion signal. If used,
  verify with `git diff` rather than trusting a completion notification.
- **Match edits by content, not indentation.** Several scripted edits failed because indentation
  was inferred from `sed`-piped output that had added leading spaces. Use regex anchored on
  distinctive code, and capture the existing indent.
- The user tests between releases and their feedback has found real bugs every time. Ship small,
  let them use it, then iterate.

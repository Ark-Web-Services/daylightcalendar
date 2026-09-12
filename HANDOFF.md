# Daylight — Handoff & Roadmap

Written 2026-09-11, updated 2026-09-12. Purpose: let a fresh session continue without
re-deriving what took hours to find.

Repo `main` is at **1.1.9.17** and level with origin. **The add-on is still running 1.1.9.12**
— every release below 1.1.9.13..17 is pushed but NOT deployed. See §7.

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
- `api/calendar-settings` persists `{disabledCalendarIds, labels, calendarLabels}`.
- `api/calendar` honours `?start=&end=`; `getCalendarRange()` normalises it and
  `caldavService.fetchAllEvents({start,end})` accepts the range (legacy numeric form still
  works). Span capped at 62 days.
- Recurrence is expanded **server-side** via tsdav `expand: true`, with a fallback to the
  unexpanded query. The local iCal parser is regex-based and has **no** RRULE/EXDATE/
  RECURRENCE-ID handling, so do not rely on it for recurring events.
- Profile colours come from `PROFILE_PALETTE` + `getNextAvailableColor()` + `ensureProfileColors()`
  in `index.js`, and are **persisted** to `user_mappings.json` so identities stay stable. (The old
  `defaultProfileColor(id)` hash is gone.) Do not reintroduce a single default colour.
- **New durable state added 2026-09-12**, all via the `readJsonFile`/`writeJsonFile` helpers that
  resolve to `DATA_DIR`: `recipes.json`, `meal_plan.json`, `lists.json`, `chore_meta.json`,
  `chore_settings.json`, `stars.json`, `rewards.json`, `routines.json`, `routine_progress.json`.
- **Writes that can race are serialised** behind an in-process promise lock
  (`withHouseholdStorageLock`, and the equivalent for lists). A plain read-modify-write on these
  JSON files loses records when the wall panel and a phone write at once. Reuse the existing lock;
  do not add a second mechanism.
- **Stars are an append-only ledger; balances are derived by summing it.** Never store a mutable
  balance counter. Awards are idempotent per `completionKey`; routine keys include the date.
- Chores live in a Home Assistant `todo.` entity — Daylight does **not** own chore identity.
  Metadata is a side-car keyed by todo `uid`. Never assume a uid you hold metadata for still
  exists, and tolerate uids you have never seen.
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

Packages 1-4 were completed on 2026-09-12 (versions 1.1.9.13 through 1.1.9.17), each verified
against the standalone dev server. **None of it has been seen rendering in a browser, and none
of it is deployed.** See §7.

### Done

- **Package 1 — sync mental model (1.1.9.13).** Calendar-to-profile assignment from the calendar
  management screen, the consequence preview, and non-person label calendars.
  `GET/PUT /api/calendar-routing`, `POST /api/calendar-labels`. Events carry `profileIds`,
  `labelId`/`labelName`/`labelColor`, `destinationType`, `sourceType`, `readOnly`,
  `sourceAccountName`.
  *1.1.9.12 shipped this feature's UI without its endpoints — the controls 404'd on save.*
- **Package 2 — meals + recipes (1.1.9.14).** The Meal Planner was entirely mock: a hardcoded
  `sampleMeals` array, and an Add Meal handler that console.logged and discarded. Now
  `recipes.json` + `meal_plan.json` under DATA_DIR, full CRUD, week navigation, and a working
  Recipe Book. `loadRecipes()` is finally defined, so its three pre-existing guarded call sites
  resolve.
- **Package 3 — lists (1.1.9.15).** `lists.json`, grocery/todo/custom lists, a new Lists tab,
  reorder, clear-checked. Writes are serialised behind a promise chain — verified by 20
  concurrent POSTs all landing. The Meals grocery modal and recipe-ingredient push both use it.
- **Package 4 — motivation loop (1.1.9.16 + 1.1.9.17).** Append-only star ledger with derived
  balances, rewards with partial progress and redemption, chore metadata side-car, routines with
  per-profile per-day progress, Up for Grabs with atomic claiming, chore subtasks, and a
  collapsible "Household momentum" strip on the calendar page.

### Still open, from the teardown's ranked recommendations

- [ ] Household change notifications — alert when someone adds/edits an event (rec #4)
- [ ] "Event ending soon" reminders for pickup travel time
- [ ] Two-way calendar editing — **a project, not a patch**: CalDAV write-back, conflict
      handling, a finger-usable event editor, text entry on a wall panel. Decide whether
      "phones create, wall displays" is actually the right division of labor first.
- [ ] Meal Categories modal exists but does not yet drive the persisted `mealTypes` list.
- [ ] "Start Cooking" mode — button deliberately left disabled with an honest title.

## 5. Known unverified / open

- **Nothing from 1.1.9.13-1.1.9.17 has ever been seen rendering in a browser.** Every claim is
  from curl against the standalone dev server. Codex's sandbox had no browser access, and the
  extension was unavailable. The backends are well tested; the UI is not. Expect layout and
  theme problems on first look, especially on the new Lists page, the Stars & Rewards section on
  Chores, and the Household momentum strip on the calendar page.
- Also never seen rendering, from the previous session: the calendar management section, the
  sync-log box appearance, theme-button responsiveness after re-entering Settings, and the event
  detail dialog.
- **Week-view event contrast** looked poor — pale blue blocks with near-white text. Never
  measured. Likely the first thing a user notices from across a room.
- `repository.yaml` / GitHub reports **84 Dependabot vulnerabilities** (3 critical, 36 high).
  Pre-existing, from a Node 16 / Alpine 3.15-era dependency tree. Not triaged.
- The add-on stores app-specific passwords **unencrypted** on disk.
- gitleaks findings in `.gitleaks-report.json` are **false positives** — two `curl-auth-header`
  hits in a historical `debug.html` that were the literals `YOUR_LONG_LIVED_TOKEN` and
  `SUPERVISOR_TOKEN`. No credential has ever been committed.

## 6. Process notes

- **Codex was reliable on 2026-09-12 — five for five** — reversing the previous session's
  experience. What changed:
  - `codex exec --sandbox workspace-write -c sandbox_workspace_write.network_access=true`.
    **Without `network_access=true` the sandbox blocks binding a local port**, so every attempt
    to smoke-test the dev server dies with `EPERM listen 0.0.0.0:8100` and the agent silently
    falls back to reading code instead of running it. This one flag is the difference between a
    verified task and a plausible-sounding one.
  - A **fresh session per task**, each seeded with a written constraints brief (the §2 list) —
    not a running conversation. Context stays small and no task inherits another's confusion.
  - Briefs that **demand evidence with real numbers** ("fire 20 concurrent POSTs and report how
    many landed"), not "make sure it works". Every genuine bug class here — lost writes, double
    awards, claim races — only shows up under that kind of check.
  - Background the dev server in a **detached subshell** `( ... &)` or the agent's shell call
    hangs. Kill it with `lsof -ti:PORT | xargs kill -9` afterwards.
- Still verify with `git diff` and your own curl rather than trusting the completion report. Doing
  so caught nothing false this session, but it is cheap.
- **Match edits by content, not indentation.** Several scripted edits failed because indentation
  was inferred from `sed`-piped output that had added leading spaces. Use regex anchored on
  distinctive code, and capture the existing indent.
- The user tests between releases and their feedback has found real bugs every time. Ship small,
  let them use it, then iterate.

---

## 7. Deployment status — READ THIS FIRST

**`main` is at 1.1.9.17. The add-on on the wall panel is still running 1.1.9.12.**

Five releases (1.1.9.13, .14, .15, .16, .17) are committed and pushed but **not deployed**. The
Supervisor `/store/addons/<slug>/update` call was blocked by a permission gate during the
session, so it was never run.

`/store/reload` has already been called, so the Supervisor sees the new version —
`/addons/<slug>/info` reported `version_latest: 1.1.9.13` at the time and will report .17 after
another reload. To finish:

```
/store/reload                              (websocket, supervisor/api)
/store/addons/01a45dd4_daylight_calendar/update
/addons/01a45dd4_daylight_calendar/info    (confirm version flipped)
```

Or simply press **Update** on the add-on in the HA UI.

**Deploy one version at a time if you can, and let the user look at it.** §6 of the original
handoff is right that their feedback has found a real bug every time, and 1.1.9.13-.17 is a
large amount of unseen UI to land in one jump. 1.1.9.13 in particular is a genuine bug fix —
it repairs routing controls that currently 404 on save in the deployed build.

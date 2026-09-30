# Daylight — Handoff & Roadmap

Written 2026-09-11, updated 2026-09-12. Purpose: let a fresh session continue without
re-deriving what took hours to find.

Repo `main` is at **1.1.9.22** and level with origin. The add-on runs **1.1.9.17** — the UI/UX
work (1.1.9.18-.22) is pushed but NOT deployed. See §7.

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
7. **Never inject CSS at runtime.** `public/js/calendar-styles.js` used to append a `<style>` block
   on load. It outranked `styles.css`, so the calendar could not be fixed by editing CSS, and its
   `.fc { display: block !important }` defeated FullCalendar's flex column — `.fc-view-harness`
   collapsed to 0px and the grid rendered **blank** with its cells and events present in the DOM.
   It also hardcoded `#fff` on the calendar surface, which paints white on all five non-light
   themes. The file is now a documented no-op. Style in `styles.css`, with `--md-*` tokens.
8. **The week view is `timeGridWeek`, and it must stay a time grid.** Events belong at their real
   time of day, spanning their real duration — that is the information a week view exists to
   carry. 1.1.9.18 switched it to `dayGridWeek` to stop the calendar overflowing, which removed
   the hour axis entirely and collapsed every event into a chip at the top of its column; the
   user reported it immediately. **Do not "fix" a layout overflow by dropping back to
   `dayGridWeek`.** The two goals are reconciled by slot *granularity*, not view type: hourly
   `slotDuration` makes the 06:00-24:00 window 18 rows instead of 36 so it fits any panel height,
   and `slotDuration` governs only gridlines and labels — event geometry stays exact (measured
   46.4px/hour; an 18:30-20:00 event lands +580px down and 69px tall).
   Known limit: an event starting before `slotMinTime` (06:00) is **not rendered** in week view.
9. **The wall panel must never scroll.** Calendar, Chores, Meals and Lists must fit at any
   viewport; only Settings may scroll. Content clipped by an ancestor's `overflow:hidden` is just
   as invisible as content below a fold — both are failures. See the harness in §3.

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

**Layout/contrast harness — run this before shipping any UI change.**
`daylight-calendar/scripts/check-layout.mjs` renders Calendar/Chores/Meals/Lists at 1920x1080,
1280x800, 1024x768 and 1080x1920 portrait and exits non-zero on: anything that scrolls, anything
clipped by an ancestor, `#chore-board` below 55% of its page, or event text below 4.5:1 contrast.
It also writes screenshots — **look at them**; a layout can pass every check and still look wrong
(that is how a per-character-wrapped label and a clipped primary button were both caught).

Playwright is deliberately **not** a project dependency (it must not reach the add-on image):
install it in a scratch dir and point the harness at any cached Chromium via
`PLAYWRIGHT_CHROMIUM`. See the header comment in the script.

`mock-data/` (committed) holds fixtures: 3 profiles, 8 events — two deliberately **unassigned**
so the show-by-default path is exercised — and a 7-day forecast.

**Warning:** in non-production the CalDAV service reads `daylight-calendar/data/
caldav_accounts.json`, which contains the user's **real Apple ID and app-specific password in
plaintext** (gitignored, never committed). Running the local server will attempt a real iCloud
login. Delete or stub that file before local dev if you don't want that.

---

### Host changes made 2026-09-25

- **Edge camera policy**: `HKLM\SOFTWARE\Policies\Microsoft\Edge\VideoCaptureAllowedUrls\1 =
  http://localhost:8099`, so the kiosk can use the webcam for face recognition without a permission
  prompt. It allows that one origin only.
- **Kiosk launcher hardened** (`C:\HAOS\start-daylight-display.ps1`, original kept as
  `.bak-20260925`). Relaunching Edge while a previous kiosk instance was still shutting down made the
  new one hand off to the dying process and exit, leaving the panel blank. The launcher now waits
  for old kiosk processes to exit, confirms Edge stayed up, and retries up to 3 times. Verified by
  force-killing and relaunching with no pause.
- **Local model: Ollama 0.34.4 + `qwen2.5vl:3b`** (3.2 GB) on the Windows side, set up in HA.
  - Chosen by benchmark on a real crumpled ALDI receipt (38 lines): Qwen2.5-VL 3B read 38/38 with
    compact one-line-per-item output in 229 s. Qwen3-VL 2B looped ("Paper Bags" x79, never
    finished); Tesseract -> Qwen3 1.7B/0.6B got 12/38 and 10/38, because Tesseract pairs prices with
    the wrong names where the paper curls. Ollama itself costs 27 MB idle; raw llama.cpp would only
    save disk (Ollama bundles ~2.7 GB of GPU libraries this laptop cannot use).
  - Runs from scheduled task `Ollama-Serve` with user env `OLLAMA_HOST=0.0.0.0:11434`. The task runs
    `C:\HAOS\ollama-serve.ps1`, a restart loop that logs to `C:\HAOS\ollama-serve.log` (rotated at
    5 MB). Triggers: at logon +30 s **and every 5 minutes** (`MultipleInstances IgnoreNew`, so a
    healthy loop just absorbs the tick). Added 2026-09-29 because `ollama serve` once **exited
    cleanly (code 0)** and the old restart-on-failure setting never brought it back — receipts
    silently stopped working for four days.
  - **Private link to the HA VM**: Hyper-V internal switch `HA-Link`, laptop `10.77.77.1/24`, HA VM
    `eth1` static `10.77.77.2/24` with **no gateway** (eth0 stays primary; HA's LAN/internet traffic
    is unchanged). This exists because the Default Switch re-subnets on every reboot, and because
    Windows' strong-host model drops VM traffic aimed at the laptop's Wi-Fi IP. `10.77.77.x` never
    changes.
  - **Firewall**: `Ollama - HA VM only (allow)` admits only `10.77.77.2`; `Ollama - everything else
    (block)` and `Ollama - IPv6 (block)` cover all other IPv4/IPv6. Block beats allow in Windows
    Firewall, so a stray "Allow access?" prompt can never expose the model to the LAN. Verified: LAN
    requests to 192.168.1.118:11434 get no response. (Windows rejects `::/0`; use the full range.)
  - **In HA**: Ollama integration at `http://10.77.77.1:11434`, AI Task entity
    `ai_task.receipt_reader_local` (num_ctx 8192, keep_alive 120 s so RAM is freed after use).
    Verified end to end: HA -> model -> answer in 12 s.
  - **Reboot-tested 2026-09-30** (after the voice add-ons, Edge policies and watchdog landed): host
    back in ~1 min with auto-logon; portproxy re-pointed at the VM's new NAT address (172.26.x ->
    172.24.x, as expected); HA-Link 10.77.77.1/.2 intact; Ollama listening and reached by HA 70 s
    after boot; kiosk Edge up with the new policies; add-on 200. `Ollama-Serve` showing
    `0x800710E0` afterwards is the 5-minute trigger being refused because the loop is already
    running (`IgnoreNew`) — expected, not a failure.

### Home Assistant changes made 2026-09-29/30

- **Local voice**: add-ons `core_whisper` (speech-to-text, `stt.faster_whisper`, model `auto`) and
  `core_piper` (text-to-speech, `tts.piper`, `en_US-lessac-medium`), both via the Wyoming
  integration. Measured: a 3-word phrase transcribes in ~0.2 s ("purple tiger seven" -> "Purple
  Tiger 7" — normalise digits before comparing); Piper returns an MP3 in ~1 s. `tts_get_url`
  returns a `url` with the VM's NAT address (HA's `internal_url` is unset) — use the `path` and
  fetch it through the Supervisor/core proxy instead.
- **School-bus automation** `automation.school_bus_nearby_alphaportal` (id
  `daylight_school_bus_nearby`): webhook trigger (local only, POST/PUT) -> fires
  `daylight_announce` with title "School bus", icon `directions_bus`, message from the JSON body
  or a default; 2-minute cooldown (`mode: single` + delay). The webhook id is a secret kept in
  `~/.daylight-pm/bus-webhook-id` — not in the repo. Verified: POST -> 200 -> event on the bus.
  The iPhone side is an iOS Shortcuts "Message" automation (sender = AlphaPortal, run immediately)
  that POSTs to `http://192.168.1.118:8123/api/webhook/<id>`; it only works while the phone is on
  home Wi-Fi until HA has remote access.
- **Edge autoplay**: `HKLM\SOFTWARE\Policies\Microsoft\Edge\AutoplayAllowlist\1 =
  http://localhost:8099` so the panel can speak announcements without a tap.

### Network limit: the HA VM cannot see the LAN's multicast (found 2026-09-29)

The laptop is on **Wi-Fi only** (both Ethernet ports — onboard I219-LM and the DELL S2340T
monitor's — are unplugged), so the VM sits on the NAT'd Default Switch. Outbound unicast to LAN IPs
works; **mDNS/SSDP discovery and IPv6 link-local do not**. Consequences: HomePods/Apple TVs cannot
be added (the `apple_tv` flow by IP returns `no_devices_found` even though the HomePod answers on
192.168.1.167:7000 from the LAN), and Matter/Thread devices cannot be commissioned. Fix: plug an
Ethernet cable into either port, create a Hyper-V **External** switch on that wired NIC (host keeps
Wi-Fi for management — no loss of SSH), and give the VM a second NIC on it. Do **not** build an
external switch on the Wi-Fi adapter remotely: if it fails the host drops off the network.

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

- **UI/UX pass — glanceable and adaptive (1.1.9.18-1.1.9.22).** The panel was showing an
  overloaded screen with a scrollbar; the week grid got 629px of 1080 and was cut off at 3pm.
  Five stacked bands are now two, the whole week is visible, and event contrast went from a
  measured **1.06:1 at 13.6px** (effectively invisible across a room) to **9.35:1 at 16px**.
  The Chores board went from 22% to 83-94% of its own page. Verified by the harness in §3:
  16/16 layout checks and 10/10 contrast checks at four viewports.

- **Pantry step 1 — receipts (1.1.9.29-.30).** Pantry tab: scan (phone camera via the HA app) ->
  touch crop -> upload -> one background worker sends it to the local model -> review -> confirm.
  Backend in `scripts/receipt-service.js` + `scripts/receipt-parser.js`; tests in
  `scripts/test-receipts.js <model-output.txt> <truth.json>` (fixtures live OUTSIDE the repo — real
  receipts carry card digits). Parser rules that real output forced: totals may arrive on one
  comma-separated line; weight lines arrive after the item row (prefer the `(N)` net line);
  quantities are 1 unless the receipt itself shows weight or multi-buy (the model's counts and units
  are unreliable — it writes ALDI tax codes as units); reconciliation vs the printed subtotal and
  ITEMS count is the safety net, and names a merged repeat with a one-tap fix. Photos are deleted on
  confirm/delete. Verified end to end on the live panel with a real ALDI receipt (244 s).
- **Not built yet:** pantry stock (step 2) and meals <-> pantry (step 3). Review rows are tall cards
  on phones; a compact layout for long receipts is a worthwhile follow-up.

- **Image hardening (1.1.9.31-.32, user-approved).** Base `*-base:3.23` (Alpine 3.23, Node 24),
  `nodejs npm` only, `npm ci --omit=dev --ignore-scripts`, no build step, no Chromium/Xorg/Openbox,
  no `privileged`, no devices, `init: false` (s6-overlay v3). The old execline `finish` script could
  not parse its own bash `if` blocks, so a crashed Node never halted the add-on — rewritten on the
  current HA template. `.dockerignore` is **force-added** (the repo's `.gitignore` ignores it) and
  keeps `data/` (real Apple credentials) and `.env*` (an HA token) out of local builds. Verified
  live: HA reports privileged `[]`, devices `[]`, full_access false, security rating 7; `/data`
  survived the base swap (games, lists, recipes intact). `npm audit --omit=dev`: 0.
- **School menu (Nutrislice), 1.1.9.33.** Generic for any Nutrislice district; defaults to CMS /
  Pineville ES, Breakfast + Lunch. `scripts/school-menu-service.js` caches per week under DATA_DIR
  and serves the last good copy (`stale: true`) when Nutrislice is unreachable. Calendar top-bar
  button -> modal; compact strip on Meals; Settings card with a school picker.
- **Parent access, 1.1.9.34.** One parent-check sheet gates Settings and every parent-only action;
  with no PIN, the first parent action creates one and resumes. `authorizeAdmin(state, req)` in
  index.js accepts the route's PIN field or an `X-Daylight-Admin` session token (5 min sliding,
  in memory, cleared on PIN change). Face unlock (`POST /api/admin/face-unlock`) takes 3 live
  descriptors and matches them **server-side against every enrolled profile**, then requires the
  winner to be in `adminProfileIds` — never filter to parents before matching, or a child who
  resembles a parent unlocks as them. Parents default to HA admins/owner via `config/auth/list`
  (works with the Supervisor token; live it resolves to the `admin` person). Recovery: a parent
  face can set a new PIN, or add-on option `reset_parent_pin` (one-shot). Settings gating is a
  household deterrent; the server checks are the real boundary. Port 8099 is forwarded on the
  host's **127.0.0.1 only**, so `/api/face-profiles/descriptors` is not reachable from the LAN.

### Still open, from the teardown's ranked recommendations

- [ ] Household change notifications — alert when someone adds/edits an event (rec #4)
- [ ] "Event ending soon" reminders for pickup travel time
- [ ] Two-way calendar editing — **a project, not a patch**: CalDAV write-back, conflict
      handling, a finger-usable event editor, text entry on a wall panel. Decide whether
      "phones create, wall displays" is actually the right division of labor first.
- [ ] Meal Categories modal exists but does not yet drive the persisted `mealTypes` list.
- [ ] "Start Cooking" mode — button deliberately left disabled with an honest title.

## 5. Known unverified / open

- **Calendar and Chores have now been seen rendering** (headless Chromium, four viewports) and
  pass the harness. **Meals, Lists and Settings have only been checked for overflow, never looked
  at** — their screenshots exist in a scratch dir but were not reviewed in detail. Expect rough
  edges there first.
- Nothing has been seen on the **real panel**. Its resolution is still unknown; the layout is
  fluid and verified at 1920x1080, 1280x800, 1024x768 and 1080x1920, but that is not the same as
  confirmed on the device.
- The default week view is `timeGridWeek` with hourly slots (the owner asked for the hour axis
  back after a `dayGridWeek` experiment). Constraint #7 in §2 keeps it that way.
- Also never seen rendering, from the previous session: the calendar management section, the
  sync-log box appearance, theme-button responsiveness after re-entering Settings, and the event
  detail dialog.
- Week-view event contrast is measured by the harness on every run (>= 4.5:1; currently ~13.6:1).
- `npm audit --omit=dev` reports **0** vulnerabilities in what ships (2026-09-25). Dev-only tooling
  (webpack etc.) still carries advisories; it no longer reaches the image.
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

**The owner has given standing authorisation to deploy every release** ("update it, always update
it, always"). Every commit on `main` is expected to be live on the panel shortly after.

Deploy (Supervisor API over the HA websocket, `supervisor/api`):

```
/store/reload
/store/addons/01a45dd4_daylight_calendar/update     (may answer unknown_error and still succeed)
/addons/01a45dd4_daylight_calendar/info             (confirm version flipped)
```

The wall panel reloads itself when `addon_version` changes, so no one has to touch it.
Verify after each deploy: every `/api/*` route used by the release answers 200 through ingress,
and data under `/data` is intact.

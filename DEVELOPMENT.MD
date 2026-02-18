# Daylight Calendar — Development Guide

## Quick Start (3 Options)

### Option 1: Docker Compose (Recommended — works with any editor)

Full HA + Supervisor environment with addon support. No VS Code required.

```bash
# Start everything (first run takes a few minutes to download HA image)
docker compose -f docker-compose.dev.yml up

# Tear down completely (removes all HA data — clean slate)
docker compose -f docker-compose.dev.yml down -v

# Rebuild from scratch
docker compose -f docker-compose.dev.yml down -v && docker compose -f docker-compose.dev.yml up
```

After bootstrap completes:
- **Home Assistant:** http://localhost:7123 (user: `dev`, password: `dev123`)
- **Addon dev server:** Start manually, then http://localhost:8099

To start the addon dev server once the container is running:
```bash
docker exec -it daylight-ha-dev bash
cd /mnt/supervisor/addons/local/daylight/daylight-calendar
npm run dev
```

---

### Option 2: VS Code DevContainer

If you use VS Code with the Dev Containers extension:
1. Open the project folder
2. Click "Reopen in Container" when prompted
3. Everything auto-bootstraps via `postStartCommand`
4. Run task "Start Addon Dev Server" from Terminal → Run Task

---

### Option 3: Standalone Dev (No Docker, No HA)

For fast frontend-only development using mock data:

```bash
cd daylight-calendar
npm install
STANDALONE_DEV=true npm run dev
```

Open http://localhost:8099 — calendar loads with mock data from `mock-data/`.

> **Note:** This mode uses hardcoded mock data (calendar events, weather).
> Real HA integrations won't work — this is for UI/styling work only.

---

## How the Bootstrap Works

The automated bootstrap (`bootstrap-dev.sh`) runs these steps:

1. **Start Supervisor** — runs `supervisor_run` to launch HA Supervisor + Core
2. **Wait for HA API** — polls `http://localhost:8123/api/` until it responds (up to 5 min)
3. **Run auth flow** — `auth-flow.js` handles:
   - Checks if onboarding is needed → creates dev user
   - Logs in → generates a Long-Lived Access Token via WebSocket
   - Writes token to `daylight-calendar/.env.local`
4. **Install deps** — runs `npm install` in `daylight-calendar/`

### Auth Flow

The `scripts/auth-flow.js` script is idempotent:
- If onboarding is already done → skips user creation
- If `.env.local` has a valid token → skips regeneration
- Use `node scripts/auth-flow.js --check` to just validate the current token

### Why the Official Addon Image?

Regular HA Docker images (`homeassistant/home-assistant:stable`) run **HA Core only** —
they do NOT include the Supervisor and **cannot load addons**.

The `ghcr.io/home-assistant/devcontainer:2-addons` image includes:
- HA Supervisor (manages addons)
- HA Core
- Docker-in-Docker (addons are Docker containers themselves)

This is the same image used by all official HA addon repositories.

---

## File Structure

```
daylight/
├── .devcontainer/
│   ├── devcontainer.json       # VS Code DevContainer config
│   └── bootstrap-dev.sh        # Automated setup script
├── docker-compose.dev.yml      # Docker Compose for any editor
├── daylight-calendar/
│   ├── index.js                # Backend server
│   ├── scripts/
│   │   └── auth-flow.js        # Automated HA auth + token gen
│   ├── mock-data/              # Mock data for standalone mode
│   │   ├── calendar.json
│   │   ├── weather.json
│   │   └── users.json
│   ├── .env.local              # Generated: HA API URL + token
│   └── public/                 # Frontend assets
└── .vscode/
    └── tasks.json              # VS Code tasks (optional)
```

## Troubleshooting

**Container won't start:** Ensure Docker Desktop is running and has enough resources (4GB+ RAM recommended).

**Auth flow fails:** Check if HA is actually up: `curl http://localhost:7123/api/`

**Port conflict on 7123:** Another service may be using it. Stop other HA instances or change the port in `docker-compose.dev.yml`.

**Addon not showing in HA:** The addon appears in HA → Settings → Add-ons → Local Add-ons after Supervisor discovers it. This may take 30-60 seconds after first start.
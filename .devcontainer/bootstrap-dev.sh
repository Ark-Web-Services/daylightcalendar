#!/bin/bash
# =============================================================================
# Daylight Calendar - Automated Dev Environment Bootstrap
# =============================================================================
# This script handles the complete dev environment lifecycle:
#   1. Starts supervisor_run in the foreground (it pulls + runs HA Supervisor)
#   2. A background watcher waits for HA to be ready, then runs auth flow
#
# supervisor_run is BLOCKING (runs `docker run hassio_supervisor`) so it
# must be the main foreground process. The auth/setup logic runs in background.
# =============================================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_step() { echo -e "\n${BLUE}━━━ $1 ━━━${NC}"; }
log_ok()   { echo -e "${GREEN}✅ $1${NC}"; }
log_warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_err()  { echo -e "${RED}❌ $1${NC}"; }

# ─────────────────────────────────────────────────────────────────────────────
# Ensure Node.js is available (devcontainer features don't apply in docker compose)
# ─────────────────────────────────────────────────────────────────────────────
if ! command -v node &> /dev/null; then
    log_step "Installing Node.js (not included in base image)"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
    apt-get install -y nodejs > /dev/null 2>&1
    log_ok "Node.js $(node --version) installed"
else
    log_ok "Node.js $(node --version) already available"
fi

HA_URL="http://localhost:8123"
ADDON_DIR="${WORKSPACE_DIRECTORY:-/mnt/supervisor/addons/local/daylight}/daylight-calendar"

# ─────────────────────────────────────────────────────────────────────────────
# Background setup function: runs AFTER HA is ready
# ─────────────────────────────────────────────────────────────────────────────
run_post_ha_setup() {
    log_step "Waiting for Home Assistant API (background)"

    MAX_RETRIES=120  # 10 minutes (first boot pulls images inside container)
    RETRY_DELAY=5
    RETRIES=0

    while [ $RETRIES -lt $MAX_RETRIES ]; do
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${HA_URL}/api/" 2>/dev/null || echo "000")

        if [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "200" ]; then
            log_ok "Home Assistant API is ready! (HTTP $HTTP_CODE)"
            break
        fi

        RETRIES=$((RETRIES + 1))
        # Print status every 10 retries to avoid flooding
        if [ $((RETRIES % 10)) -eq 0 ]; then
            echo "   ⏳ Still waiting for HA... ($RETRIES/$MAX_RETRIES) [HTTP: $HTTP_CODE]"
        fi
        sleep $RETRY_DELAY
    done

    if [ $RETRIES -eq $MAX_RETRIES ]; then
        log_err "Home Assistant API not reachable after $((MAX_RETRIES * RETRY_DELAY))s"
        log_warn "Supervisor may still be pulling images. Check: docker logs hassio_supervisor"
        return 1
    fi

    # ── Auth Flow ─────────────────────────────────────────────────────────
    log_step "Running automated onboarding & token generation"

    ENV_FILE="$ADDON_DIR/.env.local"
    if [ -f "$ENV_FILE" ] && grep -q "HASS_TOKEN=" "$ENV_FILE"; then
        EXISTING_TOKEN=$(grep "HASS_TOKEN=" "$ENV_FILE" | cut -d'=' -f2)
        TOKEN_CHECK=$(curl -s -o /dev/null -w "%{http_code}" \
            -H "Authorization: Bearer $EXISTING_TOKEN" \
            "${HA_URL}/api/" 2>/dev/null || echo "000")

        if [ "$TOKEN_CHECK" = "200" ]; then
            log_ok "Existing .env.local token is valid — skipping auth flow"
        else
            log_warn "Existing token is invalid (HTTP $TOKEN_CHECK) — regenerating"
            cd "$ADDON_DIR" && node scripts/auth-flow.js
        fi
    else
        log_warn "No .env.local found — running full auth flow"
        cd "$ADDON_DIR" && node scripts/auth-flow.js
    fi

    # ── Install Dependencies ──────────────────────────────────────────────
    log_step "Installing addon dependencies"

    cd "$ADDON_DIR"
    if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ]; then
        npm install
        log_ok "npm install complete"
    else
        log_ok "node_modules up to date — skipping npm install"
    fi

    # ── Done ──────────────────────────────────────────────────────────────
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}  🌅 Daylight Calendar Dev Environment Ready!${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "  Home Assistant:    ${BLUE}http://localhost:7123${NC}"
    echo -e "  Dev credentials:   ${YELLOW}dev / dev123${NC}"
    echo ""
    echo -e "  To start the addon dev server:"
    echo -e "    ${YELLOW}cd $ADDON_DIR && npm run dev${NC}"
    echo -e "  Then open:         ${BLUE}http://localhost:8099${NC}"
    echo ""
}

# ─────────────────────────────────────────────────────────────────────────────
# Main: Start supervisor in foreground, setup in background
# ─────────────────────────────────────────────────────────────────────────────
log_step "Starting Daylight Calendar Dev Environment"

# Check if supervisor_run is available
if ! command -v supervisor_run &> /dev/null; then
    log_err "supervisor_run command not found. Are you in the HA addon devcontainer?"
    exit 1
fi

# Start the post-HA setup in the background — it will wait for HA to be ready
run_post_ha_setup &
SETUP_PID=$!
echo "   Setup watcher launched (PID: $SETUP_PID)"

# Run supervisor_run in the FOREGROUND — this is a blocking call
# It starts Docker, pulls Supervisor image, then runs hassio_supervisor container
log_step "Starting Home Assistant Supervisor (foreground — this pulls images on first run)"
supervisor_run

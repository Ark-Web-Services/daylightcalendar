// Daylight Calendar v1.1.9.0
// A beautiful fullscreen calendar display for Home Assistant
// Copyright (c) 2024

// This is the entry point file, and we've restructured it to use async/await for ES modules like node-fetch

// Imports that work with CommonJS
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const axios = require('axios');
const WebSocket = require('ws'); // Added for HA WebSocket API
const { randomUUID, randomBytes, scryptSync, timingSafeEqual } = require('crypto');
const caldavService = require('./scripts/caldav-service');

// Main initialization function to handle async imports
async function initializeApp() {
  // Load environment variables from .env.local if not in production (SUPERVISOR_TOKEN is undefined)
  if (process.env.SUPERVISOR_TOKEN === undefined) {
    try {
      require('dotenv').config({ path: require('path').join(__dirname, '.env.local') });
      console.log("Loaded .env.local for development.");
    } catch (e) {
      console.warn("Could not load .env.local. Proceeding without it for development if SUPERVISOR_TOKEN is also missing.");
    }
  }

  // Dynamically import ESM modules
  const { default: fetch } = await import('node-fetch');
  const { Server } = await import('socket.io');

  // Make fetch globally available for other functions
  global.fetch = fetch;

  // Configuration
  let config;
  const localOptionsPath = path.join(__dirname, 'options.json');
  const supervisorOptionsPath = '/data/options.json';
  const isProduction = process.env.SUPERVISOR_TOKEN !== undefined;
  const isIngressMode = isProduction && process.env.INGRESS_PORT !== undefined;
  const DATA_DIR = isProduction ? '/data' : path.join(__dirname, 'data');

  if (isIngressMode) {
    console.log(`[INFO] Running in Home Assistant ingress mode on port ${process.env.INGRESS_PORT}`);
  }

  try {
    config = JSON.parse(fs.readFileSync(supervisorOptionsPath, 'utf8'));
    console.log(`Loaded configuration from ${supervisorOptionsPath}`);
  } catch (error) {
    console.warn(`Could not read ${supervisorOptionsPath}. This is normal if running locally or if HA Supervisor has not provided it yet.`);
    try {
      config = JSON.parse(fs.readFileSync(localOptionsPath, 'utf8'));
      console.log(`Loaded local fallback configuration from ${localOptionsPath}`);
    } catch (localError) {
      console.error(`Failed to load local fallback configuration from ${localOptionsPath}:`, localError);
      config = {
        theme: "light",
        show_weather: true,
        locale: "en-US",
        time_format: "12h",
        development_mode: false  // Default to false
      };
      console.log("Using hardcoded default configuration for debugging.");
    }
  }

  // Ensure development_mode is in config (default to false if not defined)
  config.development_mode = config.development_mode === true;

  let addonVersion = null;
  try {
    const addonManifest = fs.readFileSync(path.join(__dirname, 'config.yaml'), 'utf8');
    const versionMatch = addonManifest.match(/^version:\s*["']?([^"'\r\n]+)["']?\s*$/m);
    addonVersion = versionMatch ? versionMatch[1].trim() : null;
  } catch (error) {
    console.warn('[WARN] Could not read add-on version from config.yaml:', error.message);
  }

  // Standalone dev mode: runs without HA, uses mock data
  const isStandaloneDev = process.env.STANDALONE_DEV === 'true';
  if (isStandaloneDev) {
    console.log('[INFO] ╔══════════════════════════════════════════════════╗');
    console.log('[INFO] ║  STANDALONE DEV MODE — No HA connection needed  ║');
    console.log('[INFO] ║  Using mock data from mock-data/ directory      ║');
    console.log('[INFO] ╚══════════════════════════════════════════════════╝');
    config.development_mode = true;
  }

  if (config.development_mode) {
    console.log("[INFO] Running in DEVELOPMENT mode - debug features enabled");
  }

  // Use port 8100 for development to avoid conflict with the Home Assistant addon on 8099
  const PORT = process.env.PORT || process.env.INGRESS_PORT || (isProduction ? 8099 : 8100);

  // Get the ingress path if we're in ingress mode
  const ingressPath = process.env.INGRESS_PATH || '';
  if (isIngressMode && ingressPath) {
    console.log(`[INFO] Using ingress path: ${ingressPath}`);
  }

  const app = express();
  const server = http.createServer(app);

  // Configure Socket.io with CORS for ingress mode
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
      credentials: true
    },
    path: isIngressMode ? '/socket.io' : undefined
  });

  app.use(express.json());

  // Debug middleware to log all requests in development mode
  if (config.development_mode) {
    app.use((req, res, next) => {
      console.log(`[DEBUG] ${req.method} ${req.url}`);
      console.log(`[DEBUG] Headers:`, JSON.stringify(req.headers, null, 2));
      next();
    });
  }

  // Serve static files
  app.use(express.static(path.join(__dirname, 'public')));

  // Special handling for ingress mode
  if (isIngressMode) {
    // Make webfonts accessible through the ingress path
    app.use('/webfonts', express.static(path.join(__dirname, 'public/webfonts')));

    // Also serve webfonts on the base path for fallback
    app.use('/api/hassio_ingress/webfonts', express.static(path.join(__dirname, 'public/webfonts')));

    // Add CORS headers for all responses in ingress mode
    app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      next();
    });

    // Middleware to extract Home Assistant auth information from headers
    app.use((req, res, next) => {
      // Log ingress headers to help with debugging
      if (config.development_mode) {
        console.log('[DEBUG] Ingress headers:', {
          'x-ingress-path': req.get('x-ingress-path'),
          'x-hass-source': req.get('x-hass-source'),
          'x-forwarded-for': req.get('x-forwarded-for'),
          'x-forwarded-host': req.get('x-forwarded-host'),
          'x-forwarded-proto': req.get('x-forwarded-proto'),
          'authorization': req.get('authorization') ? 'Present' : 'Missing'
        });
      }

      // If there's a direct authorization header, extract it and save for API calls
      if (req.get('authorization')) {
        const authHeader = req.get('authorization');
        if (authHeader.startsWith('Bearer ')) {
          const token = authHeader.slice(7);
          console.log(`[INFO] Using provided authorization bearer token (${token.length} chars)`);
          // Store in environment for API calls
          process.env.HASS_TOKEN = token;
        }
      }

      next();
    });
  }

  // Home Assistant API connection setup
  // Try different API endpoints for add-on mode
  let hassApiUrl;
  if (isProduction) {
    // In production (add-on mode), try multiple possible endpoints
    hassApiUrl = process.env.HASSIO_API_URL || 'http://supervisor/core/api';
    console.log(`[INFO] Production mode - using HA API URL: ${hassApiUrl}`);
  } else {
    hassApiUrl = process.env.HASS_API_URL || 'http://localhost:8123/api';
    console.log(`[INFO] Development mode - using HA API URL: ${hassApiUrl}`);
  }

  /**
   * Helper function to make HA API calls using axios
   */
  /**
   * Helper function to make HA API calls using axios with robust retry logic
   */
  async function callHaApi(apiPath, fetchOptions = {}) {
    // Define all possible base URLs to try
    const primaryUrl = hassApiUrl;

    // Alternative URLs to try if the primary fails
    // Note: In add-on environment, 'supervisor' is the hostname for the supervisor proxy
    const alternativeBaseUrls = [
      'http://supervisor/core/api',          // Standard Core Proxy
      'http://supervisor/homeassistant/api', // Legacy Core Proxy
      'http://homeassistant:8123/api'        // Direct access (rarely works with supervisor token but worth a shot)
    ];

    // Filter out the primary URL from alternatives to avoid duplicates
    const candidates = [
      primaryUrl,
      ...alternativeBaseUrls.filter(u => u !== primaryUrl && u !== primaryUrl.replace(/\/$/, ''))
    ];

    // Method to use
    const method = fetchOptions.method || 'GET';
    const token = process.env.SUPERVISOR_TOKEN || process.env.HASS_TOKEN || '';

    // Request body
    const requestData = fetchOptions.body
      ? (typeof fetchOptions.body === 'string' ? fetchOptions.body : fetchOptions.body)
      : undefined;

    // Helper to attempt a request
    const attemptRequest = async (baseUrl, useLegacyHeader = false) => {
      const url = baseUrl + apiPath; // apiPath starts with /

      const headers = {
        'Content-Type': 'application/json',
        ...(fetchOptions.headers || {}),
      };

      // Set auth header
      if (token) {
        if (useLegacyHeader && isProduction) {
          headers['X-Supervisor-Token'] = token;
          headers['Authorization'] = undefined; // Clear conflicting header
        } else {
          headers['Authorization'] = `Bearer ${token}`;
          headers['X-Supervisor-Token'] = undefined;
        }
      }

      const axiosConfig = {
        method,
        url,
        headers,
        data: requestData,
        validateStatus: status => status < 500 // Resolve even on 4xx to handle auth errors manually
      };

      console.log(`[INFO] Trying HA API: ${method} ${url} (Legacy Header: ${useLegacyHeader})`);

      try {
        const response = await axios(axiosConfig);

        // If we got a 401/403, throw to trigger next attempt
        if (response.status === 401 || response.status === 403) {
          throw {
            response,
            message: `Request failed with status ${response.status}`,
            isAuthError: true
          };
        }

        return response.data;
      } catch (error) {
        throw error;
      }
    };

    // Retry loop
    let lastError = null;

    for (const baseUrl of candidates) {
      // Try with Bearer Token first (Standard)
      try {
        return await attemptRequest(baseUrl, false);
      } catch (error) {
        lastError = error;
        // Check if we should try legacy header on this same URL
        if (error.isAuthError && isProduction) {
          try {
            console.log(`[INFO] Auth failed with Bearer token, retrying with X-Supervisor-Token on ${baseUrl}`);
            return await attemptRequest(baseUrl, true);
          } catch (legacyError) {
            lastError = legacyError;
          }
        }
        // Continue to next URL
        console.warn(`[WARN] Failed to connect to ${baseUrl}${apiPath}: ${error.message}`);
      }
    }

    // If we get here, all attempts failed
    console.error(`[ERROR] All HA API attempts failed for ${apiPath}`);
    if (lastError && lastError.response) {
      console.error(`[ERROR] Final Status: ${lastError.response.status}`);
      console.error(`[ERROR] Final Response:`, lastError.response.data);
    }
    throw lastError || new Error('Failed to connect to Home Assistant API');
  }

  /**
   * Get or create a Home Assistant input helper for storing user preferences
   * @param {string} entityId - The entity ID (e.g., 'input_text.daylight_theme')
   * @param {string} defaultValue - Default value if entity doesn't exist
   * @param {string} entityType - Type of input helper ('input_text', 'input_select', 'input_boolean')
   * @returns {Promise<string>} - The current value of the entity
   */
  async function getOrCreateInputHelper(entityId, defaultValue, entityType = 'input_text') {
    try {
      // First, try to get the existing entity
      const existingEntity = await callHaApi(`/states/${entityId}`);
      if (existingEntity && existingEntity.state) {
        console.log(`[INFO] Found existing HA entity ${entityId}: ${existingEntity.state}`);
        return existingEntity.state;
      }
    } catch (error) {
      console.log(`[INFO] Entity ${entityId} not found, will create suggestion`);
    }

    // Entity doesn't exist, log instructions for manual creation
    console.log(`[INFO] HA Input Helper needed: ${entityId}`);
    console.log(`[INFO] Please create this in HA: Settings > Devices & Services > Helpers > Create Helper > ${entityType}`);
    console.log(`[INFO] Entity ID: ${entityId}, Default: ${defaultValue}`);

    // Return default value for now
    return defaultValue;
  }

  /**
   * Update a Home Assistant input helper value
   * @param {string} entityId - The entity ID
   * @param {string} value - New value to set
   * @param {string} service - HA service to call (e.g., 'input_text.set_value')
   */
  async function updateInputHelper(entityId, value, service = 'input_text.set_value') {
    try {
      const domain = entityId.split('.')[0];
      const serviceName = service.split('.')[1];

      const serviceData = {
        entity_id: entityId,
        value: value
      };

      await callHaApi(`/services/${domain}/${serviceName}`, {
        method: 'POST',
        body: JSON.stringify(serviceData)
      });

      console.log(`[INFO] Updated HA entity ${entityId} to: ${value}`);
      return true;
    } catch (error) {
      console.error(`[ERROR] Failed to update HA entity ${entityId}:`, error.message);
      return false;
    }
  }

  /**
   * Store complex data in HA using a sensor entity with JSON attributes
   * @param {string} entityId - The sensor entity ID (e.g., 'sensor.daylight_user_data')
   * @param {object} data - Data object to store as attributes
   */
  async function storeDataInHASensor(entityId, data) {
    try {
      // Use the set_state service to create/update a custom sensor
      const serviceData = {
        entity_id: entityId,
        state: 'active',
        attributes: {
          ...data,
          last_updated: new Date().toISOString(),
          managed_by: 'daylight_calendar'
        }
      };

      await callHaApi('/services/python_script/set_state', {
        method: 'POST',
        body: JSON.stringify(serviceData)
      });

      console.log(`[INFO] Stored data in HA sensor ${entityId}`);
      return true;
    } catch (error) {
      console.error(`[ERROR] Failed to store data in HA sensor ${entityId}:`, error.message);
      console.log(`[INFO] Alternative: Use HA REST API or MQTT to create custom entities`);
      return false;
    }
  }

  /**
   * Get data from a HA sensor entity
   * @param {string} entityId - The sensor entity ID
   * @returns {Promise<object>} - The entity attributes as data
   */
  async function getDataFromHASensor(entityId) {
    try {
      const entity = await callHaApi(`/states/${entityId}`);
      if (entity && entity.attributes) {
        console.log(`[INFO] Retrieved data from HA sensor ${entityId}`);
        return entity.attributes;
      }
      return null;
    } catch (error) {
      console.error(`[ERROR] Failed to get data from HA sensor ${entityId}:`, error.message);
      return null;
    }
  }

  /**
   * Get user theme preference from Home Assistant
   * @returns {Promise<string>} - Theme name ('light', 'dark', etc.)
   */
  async function getUserTheme() {
    return await getOrCreateInputHelper('input_select.daylight_theme', 'light', 'input_select');
  }

  /**
   * Set user theme preference in Home Assistant
   * @param {string} theme - Theme name to set
   */
  async function setUserTheme(theme) {
    return await updateInputHelper('input_select.daylight_theme', theme, 'input_select.select_option');
  }

  /**
   * Get display settings from Home Assistant
   * @returns {Promise<object>} - Display settings object
   */
  async function getDisplaySettings() {
    const defaultSettings = {
      autoNightMode: true,
      nightModeStart: "20:00",
      nightModeEnd: "07:00",
      screenBurnProtection: true,
      dimAfterMinutes: 10,
      displayClock: false
    };

    const data = await getDataFromHASensor('sensor.daylight_display_settings');
    return data || defaultSettings;
  }

  /**
   * Save display settings to Home Assistant
   * @param {object} settings - Display settings to save
   */
  async function saveDisplaySettings(settings) {
    return await storeDataInHASensor('sensor.daylight_display_settings', settings);
  }

  // Helper to read user mappings
  function readUserMappings() {
    const mappingFile = path.join(DATA_DIR, 'user_mappings.json');
    if (fs.existsSync(mappingFile)) {
      try {
        return JSON.parse(fs.readFileSync(mappingFile, 'utf8'));
      } catch (err) {
        console.error('Error reading user mappings:', err);
      }
    }
    return {};
  }

  function writeUserMappings(mappings) {
    const mappingFile = path.join(DATA_DIR, 'user_mappings.json');
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(mappingFile, JSON.stringify(mappings, null, 2));
  }

  function normalizeCalendarIds(value) {
    const values = Array.isArray(value) ? value : (value ? [value] : []);
    return [...new Set(values.filter(id => typeof id === 'string' && id.trim()))];
  }

  // Helpers to persist which connected calendars are hidden from the calendar view
  function readCalendarSettings() {
    const settingsFile = path.join(DATA_DIR, 'calendar_settings.json');
    if (fs.existsSync(settingsFile)) {
      try {
        const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
        const labels = Array.isArray(settings.labels)
          ? settings.labels.filter(label => label && typeof label.id === 'string' && typeof label.name === 'string')
          : [];
        const validLabelIds = new Set(labels.map(label => label.id));
        const calendarLabels = settings.calendarLabels && typeof settings.calendarLabels === 'object'
          ? Object.fromEntries(Object.entries(settings.calendarLabels).filter(([calendarId, labelId]) =>
            typeof calendarId === 'string' && validLabelIds.has(labelId)))
          : {};
        return {
          disabledCalendarIds: Array.isArray(settings.disabledCalendarIds)
            ? settings.disabledCalendarIds.filter(id => typeof id === 'string')
            : [],
          labels,
          calendarLabels
        };
      } catch (err) {
        console.error('Error reading calendar settings:', err);
      }
    }
    return { disabledCalendarIds: [], labels: [], calendarLabels: {} };
  }

  function saveCalendarSettings(settings) {
    const settingsFile = path.join(DATA_DIR, 'calendar_settings.json');
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      const normalized = {
        disabledCalendarIds: [...new Set(settings.disabledCalendarIds || [])],
        labels: Array.isArray(settings.labels) ? settings.labels : [],
        calendarLabels: settings.calendarLabels && typeof settings.calendarLabels === 'object'
          ? settings.calendarLabels
          : {}
      };
      fs.writeFileSync(settingsFile, JSON.stringify(normalized, null, 2));
      return normalized;
    } catch (err) {
      console.error('Error saving calendar settings:', err);
      throw err;
    }
  }

  // Chores themselves remain owned by Home Assistant. These files only hold
  // Daylight's household context and an auditable stars ledger, so they must
  // always live in DATA_DIR (which is /data inside the add-on).
  const DEFAULT_CHORE_SETTINGS = { defaultStarValue: 1, awardsRequireConfirmation: false };
  let householdStorageQueue = Promise.resolve();

  function withHouseholdStorageLock(operation) {
    const result = householdStorageQueue.then(operation, operation);
    householdStorageQueue = result.catch(() => {});
    return result;
  }

  function readJsonFile(fileName, fallback) {
    const filePath = path.join(DATA_DIR, fileName);
    try {
      if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      console.error(`Error reading ${fileName}:`, err);
    }
    return fallback;
  }

  function writeJsonFile(fileName, value) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, fileName), JSON.stringify(value, null, 2));
  }

  function readChoreSettings() {
    const settings = readJsonFile('chore_settings.json', {});
    return {
      defaultStarValue: Number.isInteger(settings.defaultStarValue) && settings.defaultStarValue > 0
        ? settings.defaultStarValue : DEFAULT_CHORE_SETTINGS.defaultStarValue,
      awardsRequireConfirmation: settings.awardsRequireConfirmation === true
    };
  }

  function readChoreMeta() {
    const meta = readJsonFile('chore_meta.json', {});
    return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
  }

  function normalizeChoreMeta(meta = {}, settings = readChoreSettings()) {
    const subtasks = Array.isArray(meta.subtasks) ? meta.subtasks
      .filter(item => item && typeof item.id === 'string' && typeof item.text === 'string')
      .map((item, index) => ({ id: item.id, text: item.text.trim(), checked: item.checked === true, position: Number.isInteger(item.position) ? item.position : index }))
      .filter(item => item.text) : [];
    return {
      assignedProfileIds: Array.isArray(meta.assignedProfileIds)
        ? [...new Set(meta.assignedProfileIds.filter(id => typeof id === 'string' && id.trim()))] : [],
      starValue: Number.isInteger(meta.starValue) && meta.starValue > 0
        ? meta.starValue : settings.defaultStarValue,
      upForGrabs: meta.upForGrabs === true,
      dueDate: typeof meta.dueDate === 'string' && meta.dueDate ? meta.dueDate : null,
      createdAt: typeof meta.createdAt === 'string' ? meta.createdAt : new Date().toISOString(),
      lastStatus: typeof meta.lastStatus === 'string' ? meta.lastStatus : null,
      completionKey: typeof meta.completionKey === 'string' ? meta.completionKey : null,
      subtasks
    };
  }

  function readStarsLedger() {
    const ledger = readJsonFile('stars.json', []);
    return Array.isArray(ledger) ? ledger : [];
  }

  function readRewards() {
    const rewards = readJsonFile('rewards.json', []);
    return Array.isArray(rewards) ? rewards : [];
  }

  function readRoutines() {
    const routines = readJsonFile('routines.json', []);
    return Array.isArray(routines) ? routines : [];
  }

  function readRoutineProgress() {
    const progress = readJsonFile('routine_progress.json', {});
    return progress && typeof progress === 'object' && !Array.isArray(progress) ? progress : {};
  }

  function getServerLocalDate(override) {
    // The optional date is deliberately available only in standalone mode for
    // deterministic fixture checks. Production always uses the add-on server's local date.
    if (isStandaloneDev && typeof override === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(override)) return override;
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 10);
  }

  const DEFAULT_SCREEN_TIME_SETTINGS = {
    enabled: true,
    requireChoresFirst: true,
    includeRoutines: false,
    defaultDailyMinutes: 60,
    warnAtMinutes: [5, 1],
    pinHash: null,
    pinSalt: null
  };
  const DEFAULT_GAMES = [
    { id: 'geometry-dash', title: 'Geometry Dash', url: 'https://geometrydashonline.github.io/', icon: 'sports_esports' },
    { id: 'hextris', title: 'Hextris', url: 'https://hextris.io/', icon: 'hexagon' },
    { id: 'clumsy-bird', title: 'Clumsy Bird', url: 'https://ellisonleao.github.io/clumsy-bird/', icon: 'flutter_dash' }
  ];
  const screenTimeHeartbeatTimeoutSeconds = Math.max(1, Number(process.env.SCREEN_TIME_HEARTBEAT_TIMEOUT_SECONDS) || 90);
  const screenTimePinLockSeconds = Math.max(1, Number(process.env.SCREEN_TIME_PIN_LOCK_SECONDS) || 60);

  function normalizeScreenTime(data = {}) {
    const settings = data.settings && typeof data.settings === 'object' ? data.settings : {};
    const profiles = data.profiles && typeof data.profiles === 'object' && !Array.isArray(data.profiles)
      ? data.profiles : {};
    const pinFailures = data.pinFailures && typeof data.pinFailures === 'object' ? data.pinFailures : {};
    return {
      settings: {
        enabled: settings.enabled !== false,
        requireChoresFirst: settings.requireChoresFirst !== false,
        includeRoutines: settings.includeRoutines === true,
        defaultDailyMinutes: isValidDailyMinutes(settings.defaultDailyMinutes)
          ? settings.defaultDailyMinutes : DEFAULT_SCREEN_TIME_SETTINGS.defaultDailyMinutes,
        warnAtMinutes: Array.isArray(settings.warnAtMinutes)
          ? settings.warnAtMinutes.filter(value => Number.isInteger(value) && value > 0)
          : [...DEFAULT_SCREEN_TIME_SETTINGS.warnAtMinutes],
        pinHash: typeof settings.pinHash === 'string' && /^[a-f0-9]{128}$/i.test(settings.pinHash) ? settings.pinHash : null,
        pinSalt: typeof settings.pinSalt === 'string' && /^[a-f0-9]{32}$/i.test(settings.pinSalt) ? settings.pinSalt : null
      },
      profiles: Object.fromEntries(Object.entries(profiles)
        .filter(([, value]) => value && isValidDailyMinutes(value.dailyMinutes))
        .map(([profileId, value]) => [profileId, { dailyMinutes: value.dailyMinutes }])),
      sessions: Array.isArray(data.sessions) ? data.sessions.filter(session => session && typeof session.id === 'string') : [],
      grants: Array.isArray(data.grants) ? data.grants.filter(grant => grant && typeof grant.id === 'string') : [],
      pinFailures: {
        count: Number.isInteger(pinFailures.count) && pinFailures.count > 0 ? pinFailures.count : 0,
        lockedUntil: typeof pinFailures.lockedUntil === 'string' ? pinFailures.lockedUntil : null
      }
    };
  }

  function isValidDailyMinutes(value) {
    return Number.isFinite(value) && value >= 0 && value <= 1440;
  }

  function readScreenTime() {
    return normalizeScreenTime(readJsonFile('screen_time.json', {}));
  }

  function publicScreenTimeSettings(settings) {
    return {
      enabled: settings.enabled,
      requireChoresFirst: settings.requireChoresFirst,
      includeRoutines: settings.includeRoutines,
      defaultDailyMinutes: settings.defaultDailyMinutes,
      warnAtMinutes: settings.warnAtMinutes,
      pinSet: Boolean(settings.pinHash && settings.pinSalt)
    };
  }

  function readGames() {
    const games = readJsonFile('games.json', null);
    return Array.isArray(games) ? games : null;
  }

  function ensureGamesLibrary() {
    const existing = readGames();
    if (existing) return existing;
    const createdAt = new Date().toISOString();
    const seeded = DEFAULT_GAMES.map(game => ({ ...game, createdAt }));
    writeJsonFile('games.json', seeded);
    return seeded;
  }

  function getLocalDayBounds(date) {
    const start = new Date(`${date}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { startMs: start.getTime(), endMs: end.getTime() };
  }

  function sessionSecondsOnDate(session, date, nowMs, excludedSessionId = null) {
    if (!session || session.id === excludedSessionId || session.metered === false) return 0;
    const startedMs = Date.parse(session.startedAt);
    const endedMs = session.endedAt ? Date.parse(session.endedAt) : nowMs;
    if (!Number.isFinite(startedMs) || !Number.isFinite(endedMs)) return 0;
    const { startMs, endMs } = getLocalDayBounds(date);
    return Math.max(0, Math.min(endedMs, nowMs, endMs) - Math.max(startedMs, startMs)) / 1000;
  }

  function screenTimeTotals(state, profileId, date, nowMs = Date.now(), excludedSessionId = null) {
    const allowanceMinutes = state.profiles[profileId]?.dailyMinutes ?? state.settings.defaultDailyMinutes;
    const grantedMinutes = state.grants.reduce((total, grant) =>
      grant.profileId === profileId && grant.date === date && Number.isFinite(grant.minutes)
        ? total + grant.minutes : total, 0);
    const usedSeconds = state.sessions.reduce((total, session) =>
      session.profileId === profileId
        ? total + sessionSecondsOnDate(session, date, nowMs, excludedSessionId) : total, 0);
    const remainingSecondsExact = Math.max(0, (allowanceMinutes + grantedMinutes) * 60 - usedSeconds);
    const remainingSeconds = Math.ceil(remainingSecondsExact);
    return {
      dailyMinutes: allowanceMinutes,
      usedMinutes: Math.round((usedSeconds / 60) * 1000) / 1000,
      grantedMinutes,
      remainingMinutes: Math.round((remainingSecondsExact / 60) * 1000) / 1000,
      remainingSeconds,
      remainingSecondsExact
    };
  }

  function activeScreenTimeSession(state) {
    return state.sessions.find(session => !session.endedAt) || null;
  }

  function getSessionExpiry(state, session, nowMs = Date.now()) {
    if (session.metered === false) return null;
    const date = getServerLocalDate();
    const totals = screenTimeTotals(state, session.profileId, date, nowMs, session.id);
    const { startMs } = getLocalDayBounds(date);
    const chargeStartMs = Math.max(Date.parse(session.startedAt), startMs);
    return new Date(chargeStartMs + totals.remainingSecondsExact * 1000).toISOString();
  }

  function enforceActiveScreenTimeSession(state, nowMs = Date.now()) {
    const session = activeScreenTimeSession(state);
    if (!session) return { changed: false, session: null, expiresAt: null };
    const lastHeartbeatMs = Date.parse(session.lastHeartbeatAt || session.startedAt);
    const expiresAt = getSessionExpiry(state, session, nowMs);
    const expiresMs = expiresAt ? Date.parse(expiresAt) : Infinity;
    const heartbeatStale = Number.isFinite(lastHeartbeatMs) &&
      nowMs - lastHeartbeatMs > screenTimeHeartbeatTimeoutSeconds * 1000;

    if (heartbeatStale) {
      if (expiresMs <= lastHeartbeatMs) {
        session.endedAt = new Date(expiresMs).toISOString();
        session.endReason = 'expired';
      } else {
        session.endedAt = new Date(lastHeartbeatMs).toISOString();
        session.endReason = 'abandoned';
      }
      return { changed: true, session: null, expiresAt: null, closedSession: session };
    }
    if (expiresMs <= nowMs) {
      session.endedAt = new Date(expiresMs).toISOString();
      session.endReason = 'expired';
      return { changed: true, session: null, expiresAt: null, closedSession: session };
    }
    return { changed: false, session, expiresAt };
  }

  function getScreenTimeBlocking(profileId, settings, chores, date) {
    if (!settings.requireChoresFirst) return [];
    const metaByUid = readChoreMeta();
    const choreSettings = readChoreSettings();
    const blocking = (chores || []).flatMap(chore => {
      const meta = normalizeChoreMeta(metaByUid[chore.uid], choreSettings);
      const unclaimed = meta.upForGrabs && meta.assignedProfileIds.length === 0;
      const isDue = !meta.dueDate || meta.dueDate <= date;
      return !unclaimed && meta.assignedProfileIds.includes(profileId) &&
        chore.status === 'needs_action' && isDue
        ? [{ type: 'chore', id: chore.uid, title: chore.summary || 'Untitled chore' }] : [];
    });
    if (!settings.includeRoutines) return blocking;
    const progressByDate = readRoutineProgress()[date] || {};
    readRoutines().filter(routine => routineIsDueToday(routine, date) &&
      routine.assignedProfileIds.includes(profileId)).forEach(routine => {
      const completedStepIds = progressByDate[routine.id]?.[profileId]?.completedStepIds || [];
      const complete = routine.steps.length > 0 && routine.steps.every(step => completedStepIds.includes(step.id));
      if (!complete) blocking.push({ type: 'routine', id: routine.id, title: routine.name || 'Untitled routine' });
    });
    return blocking;
  }

  function validatePin(state, pin, nowMs = Date.now()) {
    if (!state.settings.pinHash || !state.settings.pinSalt) {
      return { ok: false, status: 403, error: 'Set a parent PIN in Settings first' };
    }
    const lockedUntilMs = Date.parse(state.pinFailures.lockedUntil || '');
    if (Number.isFinite(lockedUntilMs) && lockedUntilMs > nowMs) {
      return {
        ok: false,
        status: 429,
        error: 'Too many incorrect PIN attempts. Try again shortly.',
        retryAfterSeconds: Math.ceil((lockedUntilMs - nowMs) / 1000)
      };
    }
    if (Number.isFinite(lockedUntilMs) && lockedUntilMs <= nowMs) {
      state.pinFailures = { count: 0, lockedUntil: null };
    }
    if (!/^\d{4,8}$/.test(String(pin || ''))) return recordPinFailure(state, nowMs);
    const expected = Buffer.from(state.settings.pinHash, 'hex');
    let supplied;
    try {
      supplied = scryptSync(String(pin), Buffer.from(state.settings.pinSalt, 'hex'), expected.length);
    } catch (error) {
      return { ok: false, status: 500, error: 'Parent PIN could not be checked' };
    }
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return recordPinFailure(state, nowMs);
    state.pinFailures = { count: 0, lockedUntil: null };
    return { ok: true };
  }

  function recordPinFailure(state, nowMs) {
    const count = state.pinFailures.count + 1;
    if (count >= 5) {
      state.pinFailures = {
        count,
        lockedUntil: new Date(nowMs + screenTimePinLockSeconds * 1000).toISOString()
      };
      return {
        ok: false,
        status: 429,
        error: 'Too many incorrect PIN attempts. Try again shortly.',
        retryAfterSeconds: screenTimePinLockSeconds
      };
    }
    state.pinFailures = { count, lockedUntil: null };
    return { ok: false, status: 403, error: 'Incorrect parent PIN' };
  }

  function validateGameInput(input = {}) {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title) return { error: 'Game title is required' };
    if (title.length > 100) return { error: 'Game title must be 100 characters or fewer' };
    let parsedUrl;
    try { parsedUrl = new URL(String(input.url || '')); } catch (error) { return { error: 'Enter a valid game URL' }; }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) return { error: 'Game URL must use http or https' };
    const icon = typeof input.icon === 'string' && /^[a-z0-9_]{1,40}$/.test(input.icon.trim())
      ? input.icon.trim() : 'sports_esports';
    return { game: { title, url: parsedUrl.toString(), icon } };
  }

  function normalizeRoutine(input = {}, existing = null) {
    const days = Array.isArray(input.schedule?.days) ? [...new Set(input.schedule.days.filter(day => Number.isInteger(day) && day >= 0 && day <= 6))] : [];
    const steps = Array.isArray(input.steps) ? input.steps
      .filter(step => step && typeof step.text === 'string' && step.text.trim())
      .map((step, index) => ({ id: typeof step.id === 'string' && step.id ? step.id : randomUUID(), text: step.text.trim(), position: Number.isInteger(step.position) ? step.position : index })) : [];
    return {
      id: existing?.id || (typeof input.id === 'string' && input.id ? input.id : randomUUID()),
      name: typeof input.name === 'string' ? input.name.trim() : '',
      icon: typeof input.icon === 'string' && input.icon.trim() ? input.icon.trim() : 'routine',
      assignedProfileIds: Array.isArray(input.assignedProfileIds) ? [...new Set(input.assignedProfileIds.filter(id => typeof id === 'string' && id.trim()))] : [],
      schedule: { days, timeOfDay: ['morning', 'afternoon', 'evening'].includes(input.schedule?.timeOfDay) ? input.schedule.timeOfDay : 'morning' },
      steps,
      starValue: Number.isInteger(input.starValue) && input.starValue > 0 ? input.starValue : 1,
      active: input.active !== false,
      createdAt: existing?.createdAt || new Date().toISOString()
    };
  }

  function validateRoutineInput(routine) {
    if (!routine.name) return 'Routine name is required';
    if (!routine.schedule.days.length) return 'Choose at least one day';
    if (!routine.steps.length) return 'Add at least one step';
    return null;
  }

  function routineIsDueToday(routine, date) {
    const day = new Date(`${date}T12:00:00`).getDay();
    return routine.active !== false && routine.schedule?.days?.includes(day);
  }

  function getRoutineTodayPayload(date) {
    const progressByDate = readRoutineProgress()[date] || {};
    return readRoutines().filter(routine => routineIsDueToday(routine, date)).map(routine => ({
      ...routine,
      profiles: routine.assignedProfileIds.map(profileId => {
        const completedStepIds = progressByDate[routine.id]?.[profileId]?.completedStepIds || [];
        return { profileId, completedStepIds, completed: routine.steps.length > 0 && routine.steps.every(step => completedStepIds.includes(step.id)) };
      })
    }));
  }

  function derivedBalance(ledger, profileId) {
    return ledger.reduce((total, entry) => {
      if (entry.profileId !== profileId || entry.status === 'pending' || entry.status === 'rejected') return total;
      return total + (Number.isInteger(entry.delta) ? entry.delta : 0);
    }, 0);
  }

  function makeLedgerEntry(data) {
    return {
      id: randomUUID(),
      profileId: data.profileId || null,
      delta: data.delta || 0,
      reason: data.reason || '',
      choreUid: data.choreUid || null,
      completionKey: data.completionKey || null,
      rewardId: data.rewardId || null,
      createdAt: new Date().toISOString(),
      ...(data.status ? { status: data.status } : {}),
      ...(data.pendingAwardId ? { pendingAwardId: data.pendingAwardId } : {})
    };
  }

  async function validateProfileIds(profileIds) {
    const users = await fetchHaUsers();
    const validIds = new Set(users.map(user => user.id));
    return profileIds.every(id => validIds.has(id));
  }

  async function processChoreCompletions(items) {
    return withHouseholdStorageLock(async () => {
      const settings = readChoreSettings();
      const metaByUid = readChoreMeta();
      const ledger = readStarsLedger();
      let metaChanged = false;
      let ledgerChanged = false;

      items.forEach(item => {
        if (!item.uid) return;
        const existing = metaByUid[item.uid];
        const meta = normalizeChoreMeta(existing, settings);
        const transitionedToComplete = meta.lastStatus === 'needs_action' && item.status === 'completed';

        if (transitionedToComplete) {
          const completedAt = item.completed_at || item.completedAt || new Date().toISOString();
          const completionKey = `${item.uid}:${completedAt}`;
          meta.completionKey = completionKey;
          meta.assignedProfileIds.forEach(profileId => {
            const alreadyRecorded = ledger.some(entry => entry.profileId === profileId &&
              entry.choreUid === item.uid && entry.completionKey === completionKey &&
              (entry.status === 'pending' || entry.reason === 'Chore completed'));
            if (alreadyRecorded) return;
            ledger.push(makeLedgerEntry({
              profileId,
              delta: meta.starValue,
              reason: 'Chore completed',
              choreUid: item.uid,
              completionKey,
              status: settings.awardsRequireConfirmation ? 'pending' : 'confirmed'
            }));
            ledgerChanged = true;
          });
        }

        if (!existing || meta.lastStatus !== item.status || meta.completionKey !== existing.completionKey) {
          meta.lastStatus = item.status;
          metaByUid[item.uid] = meta;
          metaChanged = true;
        }
      });

      if (metaChanged) writeJsonFile('chore_meta.json', metaByUid);
      if (ledgerChanged) writeJsonFile('stars.json', ledger);
      return { metaByUid, settings };
    });
  }

  // Meal planning is local add-on state, so it must live in DATA_DIR rather than
  // the application image. Keep malformed files from preventing the calendar
  // from starting; an empty plan is always a safe fallback.
  const DEFAULT_MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner'];

  function readRecipes() {
    const recipesFile = path.join(DATA_DIR, 'recipes.json');
    if (fs.existsSync(recipesFile)) {
      try {
        const recipes = JSON.parse(fs.readFileSync(recipesFile, 'utf8'));
        return Array.isArray(recipes) ? recipes : [];
      } catch (err) {
        console.error('Error reading recipes:', err);
      }
    }
    return [];
  }

  function saveRecipes(recipes) {
    const recipesFile = path.join(DATA_DIR, 'recipes.json');
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(recipesFile, JSON.stringify(recipes, null, 2));
      return recipes;
    } catch (err) {
      console.error('Error saving recipes:', err);
      throw err;
    }
  }

  // Lists are deliberately kept in one durable file alongside the other local
  // add-on state. Writes pass through one queue so two panels cannot both read
  // the same old file and overwrite one another's changes.
  const listsFile = path.join(DATA_DIR, 'lists.json');
  let listWriteQueue = Promise.resolve();

  function makeListId() {
    return `list_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function makeItemId() {
    return `item_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function makeDefaultGroceryList() {
    const now = new Date().toISOString();
    return {
      id: makeListId(),
      name: 'Grocery',
      type: 'grocery',
      icon: 'shopping_basket',
      items: [],
      createdAt: now,
      updatedAt: now
    };
  }

  function readLists() {
    if (!fs.existsSync(listsFile)) return [makeDefaultGroceryList()];
    try {
      const lists = JSON.parse(fs.readFileSync(listsFile, 'utf8'));
      return Array.isArray(lists) ? lists : [makeDefaultGroceryList()];
    } catch (err) {
      console.error('Error reading lists:', err);
      return [makeDefaultGroceryList()];
    }
  }

  function saveLists(lists) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(listsFile, JSON.stringify(lists, null, 2));
    return lists;
  }

  function withListWrite(mutator) {
    const write = listWriteQueue.then(() => {
      const lists = readLists();
      const result = mutator(lists);
      saveLists(lists);
      return result;
    });
    // Keep the queue usable after a failed disk write while still returning the
    // original failure to the request that caused it.
    listWriteQueue = write.catch(() => undefined);
    return write;
  }

  // Make a fresh installation useful before its first write.
  if (!fs.existsSync(listsFile)) saveLists([makeDefaultGroceryList()]);

  function readMealPlan() {
    const mealPlanFile = path.join(DATA_DIR, 'meal_plan.json');
    if (fs.existsSync(mealPlanFile)) {
      try {
        const mealPlan = JSON.parse(fs.readFileSync(mealPlanFile, 'utf8'));
        const mealTypes = Array.isArray(mealPlan.mealTypes)
          ? mealPlan.mealTypes.filter(type => typeof type === 'string' && type.trim())
          : [];
        return {
          meals: Array.isArray(mealPlan.meals) ? mealPlan.meals : [],
          mealTypes: mealTypes.length ? [...new Set(mealTypes)] : [...DEFAULT_MEAL_TYPES]
        };
      } catch (err) {
        console.error('Error reading meal plan:', err);
      }
    }
    return { meals: [], mealTypes: [...DEFAULT_MEAL_TYPES] };
  }

  function saveMealPlan(mealPlan) {
    const mealPlanFile = path.join(DATA_DIR, 'meal_plan.json');
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const normalized = {
        meals: Array.isArray(mealPlan.meals) ? mealPlan.meals : [],
        mealTypes: Array.isArray(mealPlan.mealTypes) && mealPlan.mealTypes.length
          ? [...new Set(mealPlan.mealTypes.filter(type => typeof type === 'string' && type.trim()))]
          : [...DEFAULT_MEAL_TYPES]
      };
      fs.writeFileSync(mealPlanFile, JSON.stringify(normalized, null, 2));
      return normalized;
    } catch (err) {
      console.error('Error saving meal plan:', err);
      throw err;
    }
  }

  function isIsoDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function normalizeRecipe(payload, existing = {}) {
    const ingredients = Array.isArray(payload.ingredients)
      ? payload.ingredients
        .filter(item => item && typeof item.name === 'string' && item.name.trim())
        .map(item => ({
          name: item.name.trim(),
          quantity: typeof item.quantity === 'string' || typeof item.quantity === 'number'
            ? String(item.quantity).trim()
            : ''
        }))
      : (Array.isArray(existing.ingredients) ? existing.ingredients : []);
    return {
      ...existing,
      name: typeof payload.name === 'string' ? payload.name.trim() : (existing.name || ''),
      description: typeof payload.description === 'string' ? payload.description.trim() : (existing.description || ''),
      ingredients,
      instructions: typeof payload.instructions === 'string' ? payload.instructions.trim() : (existing.instructions || ''),
      prepTime: typeof payload.prepTime === 'string' || typeof payload.prepTime === 'number'
        ? String(payload.prepTime).trim()
        : (existing.prepTime || ''),
      imageUrl: typeof payload.imageUrl === 'string' ? payload.imageUrl.trim() : (existing.imageUrl || '')
    };
  }

  function normalizeMeal(payload, mealPlan, existing = {}) {
    const date = typeof payload.date === 'string' ? payload.date : existing.date;
    const mealType = typeof payload.mealType === 'string' ? payload.mealType.trim() : existing.mealType;
    if (!isIsoDate(date)) return { error: 'date must be a valid YYYY-MM-DD value' };
    if (!mealType || !mealPlan.mealTypes.includes(mealType)) {
      return { error: 'mealType must be one of the configured meal types' };
    }
    const recipeId = payload.recipeId === null || payload.recipeId === ''
      ? null
      : (typeof payload.recipeId === 'string' ? payload.recipeId : (existing.recipeId || null));
    return {
      meal: {
        ...existing,
        date,
        mealType,
        description: typeof payload.description === 'string' ? payload.description.trim() : (existing.description || ''),
        cook: typeof payload.cook === 'string' ? payload.cook.trim() : (existing.cook || ''),
        recipeId
      }
    };
  }

  function clearLabelsForCalendars(calendarIds) {
    const normalizedIds = normalizeCalendarIds(calendarIds);
    if (normalizedIds.length === 0) return;
    const settings = readCalendarSettings();
    normalizedIds.forEach(calendarId => delete settings.calendarLabels[calendarId]);
    saveCalendarSettings(settings);
  }

  const MAX_CALENDAR_RANGE_DAYS = 62;

  function getCalendarRange(startValue, endValue) {
    const configuredDays = Number.parseInt(config.calendar_days_to_show, 10);
    const fallbackDays = Number.isFinite(configuredDays) && configuredDays > 0
      ? Math.min(configuredDays, MAX_CALENDAR_RANGE_DAYS)
      : 7;
    const fallbackStart = new Date();
    fallbackStart.setHours(0, 0, 0, 0);
    const fallbackEnd = new Date(fallbackStart.getTime() + fallbackDays * 24 * 60 * 60 * 1000);

    const requestedStart = new Date(startValue);
    const requestedEnd = new Date(endValue);
    if (!startValue || !endValue || Number.isNaN(requestedStart.getTime()) ||
      Number.isNaN(requestedEnd.getTime()) || requestedEnd <= requestedStart) {
      return { start: fallbackStart, end: fallbackEnd };
    }

    const maximumEnd = new Date(requestedStart.getTime() + MAX_CALENDAR_RANGE_DAYS * 24 * 60 * 60 * 1000);
    return {
      start: requestedStart,
      end: requestedEnd > maximumEnd ? maximumEnd : requestedEnd
    };
  }

  // Function to fetch calendar data (HA + CalDAV merged)

  // The palette extends the existing profile selector. Defaults are persisted so
  // identity colors remain stable and new profiles avoid colors already in use.
  const PROFILE_PALETTE = [
    '#4285f4', '#34a853', '#fbbc05', '#ea4335', '#9c27b0',
    '#009688', '#ff7043', '#7cb342', '#ec407a', '#5c6bc0'
  ];

  function getNextAvailableColor(existingColors) {
    const colorsInUse = new Set(
      [...existingColors].filter(Boolean).map(color => String(color).toLowerCase())
    );
    return PROFILE_PALETTE.find(color => !colorsInUse.has(color.toLowerCase())) ||
      PROFILE_PALETTE[colorsInUse.size % PROFILE_PALETTE.length];
  }

  function ensureProfileColors(persons, mappings) {
    const colorsInUse = new Set();
    let changed = false;

    persons.forEach(person => {
      const existing = mappings[person.id] || {};
      const normalizedColor = existing.color ? String(existing.color).toLowerCase() : null;
      if (!normalizedColor || colorsInUse.has(normalizedColor)) {
        const color = getNextAvailableColor(colorsInUse);
        mappings[person.id] = { ...existing, color };
        colorsInUse.add(color.toLowerCase());
        changed = true;
      } else {
        colorsInUse.add(normalizedColor);
      }
    });

    if (changed) writeUserMappings(mappings);
    return mappings;
  }

  async function fetchCalendarData(range = getCalendarRange()) {
    const calendarRange = getCalendarRange(range.start, range.end);
    let haEvents = [];
    let caldavEvents = [];

    // In standalone mode, load mock data mixed with real CalDAV data
    if (isStandaloneDev) {
      try {
        const mockPath = path.join(__dirname, 'mock-data', 'calendar.json');
        const mockData = JSON.parse(fs.readFileSync(mockPath, 'utf8'));
        console.log(`[MOCK] Loaded ${mockData.events.length} mock HA calendar events`);
        haEvents = mockData.events;
      } catch (e) {
        console.warn('[MOCK] Could not load mock calendar data:', e.message);
      }

      // Try to fetch REAL CalDAV events first
      try {
        caldavEvents = await caldavService.fetchAllEvents(calendarRange);
        console.log(`[INFO] (Standalone) Fetched ${caldavEvents.length} Real CalDAV events`);
      } catch (error) {
        console.error('[ERROR] Error fetching Real CalDAV events in standalone mode:', error.message);
        // Fallback to mock events ONLY if real fetch fails completely and we have no accounts?
        // Actually, let's just log it. If the user wants real CalDAV, they need to connect.
      }
    }

    // Fetch HA calendar events
    if (!isStandaloneDev && config.calendar_entity_id) {
      try {
        const startTime = encodeURIComponent(calendarRange.start.toISOString());
        const endTime = encodeURIComponent(calendarRange.end.toISOString());
        const apiPath = `/calendars/${config.calendar_entity_id}?start=${startTime}&end=${endTime}`;

        console.log("[INFO] Fetching calendar data from: " + hassApiUrl + apiPath);
        const data = await callHaApi(apiPath);
        haEvents = (data || []).map(e => ({
          ...e,
          source: 'ha',
          calendar_entity_id: config.calendar_entity_id
        }));
        console.log('[INFO] Successfully fetched HA calendar data.');
      } catch (error) {
        console.error('[ERROR] Error fetching HA calendar data:', error.message);
      }
    }

    // Fetch CalDAV events
    if (!isStandaloneDev) {
      try {
        caldavEvents = await caldavService.fetchAllEvents(calendarRange);
        console.log(`[INFO] Fetched ${caldavEvents.length} CalDAV events`);
      } catch (error) {
        console.error('[ERROR] Error fetching CalDAV events:', error.message);
      }
    }

    const mergedEvents = [...haEvents, ...caldavEvents];
    const userMappings = readUserMappings();
    const calendarSettings = readCalendarSettings();
    const caldavAccountNames = new Map(
      caldavService.getAccounts().map(account => [account.id, account.appleId])
    );

    let validUserIds = [];
    try {
      const haUsers = await fetchHaUsers();
      validUserIds = haUsers.map(u => u.id);
    } catch (err) {
      console.error('[ERROR] Could not fetch valid HA users for event mapping:', err.message);
    }

    // Attach destination identity while retaining userId for older frontend consumers.
    mergedEvents.forEach(e => {
      if (e.source === 'caldav') {
        const calEntityId = `caldav_${e.accountId}_${e.calendarUrl}`;
        e.calendar_entity_id = calEntityId; // Stamp entity ID for counts
      }

      const profileIds = validUserIds.filter(id => {
        const mapping = userMappings[id];
        return mapping && normalizeCalendarIds(mapping.calendar_entity_id).includes(e.calendar_entity_id);
      });
      const labelId = profileIds.length === 0
        ? calendarSettings.calendarLabels[e.calendar_entity_id]
        : null;
      const label = labelId
        ? calendarSettings.labels.find(candidate => candidate.id === labelId)
        : null;

      e.profileIds = profileIds;
      e.userId = profileIds[0] || null;
      e.labelId = label ? label.id : null;
      e.labelName = label ? label.name : null;
      e.labelColor = label ? label.color : null;
      e.destinationType = profileIds.length > 0 ? 'profiles' : (label ? 'label' : 'unassigned');
      e.sourceType = e.source;
      e.readOnly = e.source === 'caldav';
      e.sourceAccountName = e.source === 'caldav'
        ? (caldavAccountNames.get(e.accountId) || null)
        : 'Home Assistant';
    });

    const disabledCalendarIds = new Set(calendarSettings.disabledCalendarIds);
    return mergedEvents.filter(event => !disabledCalendarIds.has(event.calendar_entity_id));
  }

  // Function to fetch weather data
  async function fetchWeatherData() {
    // In standalone mode, return mock data
    if (isStandaloneDev) {
      try {
        const mockPath = path.join(__dirname, 'mock-data', 'weather.json');
        const mockData = JSON.parse(fs.readFileSync(mockPath, 'utf8'));
        console.log('[MOCK] Returning mock weather data');
        return mockData;
      } catch (e) {
        console.warn('[MOCK] Could not load mock weather data:', e.message);
        return createFallbackWeatherData('unavailable', 'Mock data not found');
      }
    }

    if (!config.show_weather) {
      console.log('[INFO] Weather display is disabled in configuration.');
      return null;
    }

    // Get the weather entity ID from config, checking both properties that might be used
    let weatherEntityId = "weather.forecast_home"; // Default fallback - updated to match config.yaml default
    if (config.weather_entity_id) {
      weatherEntityId = config.weather_entity_id;
    } else if (config.weather_entity) {
      weatherEntityId = config.weather_entity;
    }

    console.log(`[INFO] Using weather entity: ${weatherEntityId}`);

    try {
      // First, check if we have valid authentication
      const token = process.env.SUPERVISOR_TOKEN || process.env.HASS_TOKEN;
      if (!token) {
        console.error(`[ERROR] No authentication token available (SUPERVISOR_TOKEN or HASS_TOKEN). Weather data cannot be fetched.`);
        return createFallbackWeatherData('unavailable', 'No authentication token available');
      }

      // Log auth token availability (without exposing the actual token)
      console.log(`[INFO] Authentication token available: ${token ? 'Yes' : 'No'} (${token.length} chars)`);

      try {
        // Try to get the current weather state
        console.log(`[INFO] Attempting to fetch weather state from: ${hassApiUrl}/states/${weatherEntityId}`);
        const currentState = await callHaApi("/states/" + weatherEntityId);

        if (!currentState) {
          console.error(`[ERROR] Failed to fetch weather state for ${weatherEntityId} - response was empty`);
          return createFallbackWeatherData('unavailable', 'Failed to fetch weather data (empty response)');
        }

        console.log(`[INFO] Successfully fetched weather state for ${weatherEntityId}`);

        // Modern Home Assistant exposes forecasts through a response-producing service.
        let forecast = [];
        console.log(`[INFO] Fetching daily forecast via weather.get_forecasts for ${weatherEntityId}`);
        try {
          const serviceResponse = await callHaApi('/services/weather/get_forecasts?return_response', {
            method: 'POST',
            body: JSON.stringify({
              entity_id: weatherEntityId,
              type: 'daily'
            })
          });
          const responseData = serviceResponse?.service_response || serviceResponse;
          forecast = responseData?.[weatherEntityId]?.forecast || [];
          console.log(`[INFO] Successfully fetched ${forecast.length} daily forecast items via service call.`);
        } catch (serviceError) {
          console.warn(`[WARN] Failed to fetch daily forecast via service call: ${serviceError.message}`);
        }

        // Retain compatibility with older Home Assistant weather integrations.
        if (forecast.length === 0 && Array.isArray(currentState.attributes?.forecast)) {
          forecast = currentState.attributes.forecast;
          console.log(`[INFO] Using ${forecast.length} legacy forecast items from weather entity attributes.`);
        }

        // Return both current state and forecast
        return {
          current: currentState,
          forecast: forecast
        };
      } catch (error) {
        console.error(`[ERROR] Error fetching weather data:`, error.message);

        // Return error details without writing to file
        const errorDetails = {
          error: `Authentication error when fetching weather data: ${error.message}`,
          current: {
            state: "unavailable",
            attributes: {
              temperature: null,
              temperature_unit: "°C",
              forecast: []
            }
          },
          forecast: []
        };

        return errorDetails;
      }
    } catch (error) {
      console.error(`[ERROR] General error in fetchWeatherData:`, error.message);
      return createFallbackWeatherData('unavailable', error.message);
    }
  }

  // Standalone mode keeps an in-memory copy so the mock todo service can be
  // exercised without a Home Assistant instance. Runtime production chores are
  // always fetched from HA and are never copied into Daylight storage.
  let standaloneTodoItems = null;

  function getStandaloneTodoItems() {
    if (standaloneTodoItems) return standaloneTodoItems;
    try {
      const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'mock-data', 'chores.json'), 'utf8'));
      standaloneTodoItems = Array.isArray(fixture.items) ? fixture.items : [];
    } catch (error) {
      console.warn('[MOCK] Could not load mock chores:', error.message);
      standaloneTodoItems = [];
    }
    return standaloneTodoItems;
  }

  // Function to fetch todo items
  async function fetchTodoItems() {
    if (isStandaloneDev) {
      return { entityId: 'todo.daylight_mock', items: getStandaloneTodoItems() };
    }
    // 1. Determine which entity to use
    let todoEntityId = config.todo_entity_id;

    if (!todoEntityId) {
      console.log('[INFO] No todo_entity_id configured, searching for one...');
      try {
        const states = await callHaApi('/states');
        const todoEntity = states.find(entity => entity.entity_id.startsWith('todo.'));
        if (todoEntity) {
          todoEntityId = todoEntity.entity_id;
          console.log(`[INFO] Found todo entity: ${todoEntityId}`);
        } else {
          console.log('[WARN] No todo entities found in Home Assistant.');
          return { error: 'No todo entities found' };
        }
      } catch (error) {
        console.error('[ERROR] Failed to fetch states to find todo entity:', error.message);
        return { error: 'Failed to find todo entity' };
      }
    }

    // 2. Call todo.get_items service
    try {
      console.log(`[INFO] Fetching items for ${todoEntityId}`);
      // Note: As of HA 2023.7, REST API returns service response
      const response = await callHaApi('/services/todo/get_items', {
        method: 'POST',
        body: JSON.stringify({ entity_id: todoEntityId })
      });

      // Response format should be { "todo.entity_id": { "items": [...] } }
      if (response && response[todoEntityId]) {
        return {
          entityId: todoEntityId,
          items: response[todoEntityId].items || []
        };
      } else {
        console.warn('[WARN] Unexpected response format from todo.get_items:', JSON.stringify(response));
        return { entityId: todoEntityId, items: [] };
      }
    } catch (error) {
      console.error(`[ERROR] Failed to fetch todo items for ${todoEntityId}:`, error.message);
      return { error: error.message };
    }
  }

  // Helper function to create consistent fallback weather data
  function createFallbackWeatherData(state, errorMessage) {
    return {
      error: errorMessage,
      current: {
        state: state,
        attributes: {
          temperature: null,
          temperature_unit: "°C",
          forecast: []
        }
      },
      forecast: []
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HA WebSocket Client for Advanced APIs (Person/User Management)
  // ─────────────────────────────────────────────────────────────────────────────
  class HaWebSocketClient {
    constructor(url, token) {
      this.url = url.replace('http', 'ws') + '/websocket';
      this.token = token;
      this.ws = null;
      this.idCounter = 1;
      this.pendingCommands = new Map();
      this.isConnected = false;
      this.connectPromise = null;
    }

    async connect() {
      if (this.isConnected) return;
      if (this.connectPromise) return this.connectPromise;

      this.connectPromise = new Promise((resolve, reject) => {
        try {
          console.log(`[WS] Connecting to HA WebSocket: ${this.url}`);
          this.ws = new WebSocket(this.url);

          this.ws.on('open', () => {
            console.log('[WS] Connection opened, waiting for auth...');
          });

          this.ws.on('message', (data) => {
            const msg = JSON.parse(data);

            if (msg.type === 'auth_required') {
              console.log('[WS] Auth required, sending token...');
              this.ws.send(JSON.stringify({
                type: 'auth',
                access_token: this.token
              }));
            } else if (msg.type === 'auth_ok') {
              console.log('[WS] Auth successful!');
              this.isConnected = true;
              resolve();
            } else if (msg.type === 'auth_invalid') {
              console.error('[WS] Auth failed:', msg.message);
              this.isConnected = false;
              reject(new Error(msg.message));
            } else if (msg.type === 'result') {
              const handler = this.pendingCommands.get(msg.id);
              if (handler) {
                if (msg.success) handler.resolve(msg.result);
                else handler.reject(new Error(msg.error ? msg.error.message : 'Unknown error'));
                this.pendingCommands.delete(msg.id);
              }
            }
          });

          this.ws.on('error', (err) => {
            console.error('[WS] Error:', err.message);
            this.isConnected = false;
            this.connectPromise = null;
            reject(err);
          });

          this.ws.on('close', () => {
            console.log('[WS] Connection closed');
            this.isConnected = false;
            this.connectPromise = null;
          });

        } catch (err) {
          reject(err);
        }
      });

      return this.connectPromise;
    }

    async sendCommand(type, payload = {}) {
      if (!this.isConnected) await this.connect();

      return new Promise((resolve, reject) => {
        const id = this.idCounter++;
        this.pendingCommands.set(id, { resolve, reject });

        const command = { id, type, ...payload };
        console.log(`[WS] Sending command: ${type} (ID: ${id})`);
        this.ws.send(JSON.stringify(command));
      });
    }
  }

  // Initialize generic WS client
  let haWsClient = null;
  function getHaWsClient() {
    if (!haWsClient) {
      const token = process.env.SUPERVISOR_TOKEN || process.env.HASS_TOKEN;
      if (!hassApiUrl || !token) {
        console.error('[WS] Cannot init client: missing URL or Token');
        return null;
      }
      // WebSocket URL is base API URL without /api
      const baseUrl = hassApiUrl.replace(/\/api$/, '');
      haWsClient = new HaWebSocketClient(baseUrl + '/api', token);
    }
    return haWsClient;
  }

  // Helper to save user mappings (calendar/notify) locally
  async function saveUserMapping(userId, data) {
    const mappingFile = path.join(DATA_DIR, 'user_mappings.json');
    try {
      // Ensure data dir exists
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      let mappings = {};
      if (fs.existsSync(mappingFile)) {
        mappings = JSON.parse(fs.readFileSync(mappingFile, 'utf8'));
      }

      mappings[userId] = { ...mappings[userId], ...data };

      writeUserMappings(mappings);
      return mappings[userId];
    } catch (err) {
      console.error('Error saving user mapping:', err);
      throw err;
    }
  }

  // Helper to get user mappings
  function getUserMappings() {
    const mappingFile = path.join(DATA_DIR, 'user_mappings.json');
    try {
      if (fs.existsSync(mappingFile)) {
        return JSON.parse(fs.readFileSync(mappingFile, 'utf8'));
      }
    } catch (err) {
      console.error('Error reading user mappings:', err);
    }
    return {};
  }

  function getCalendarRouting(validProfileIds) {
    const routes = {};
    Object.entries(getUserMappings()).forEach(([profileId, mapping]) => {
      if (validProfileIds && !validProfileIds.has(profileId)) return;
      normalizeCalendarIds(mapping.calendar_entity_id).forEach(calendarId => {
        routes[calendarId] = routes[calendarId] || { profileIds: [], labelId: null };
        routes[calendarId].profileIds.push(profileId);
      });
    });

    const settings = readCalendarSettings();
    Object.entries(settings.calendarLabels).forEach(([calendarId, labelId]) => {
      routes[calendarId] = routes[calendarId] || { profileIds: [], labelId: null };
      if (routes[calendarId].profileIds.length === 0) routes[calendarId].labelId = labelId;
    });

    return { routes, labels: settings.labels };
  }

  // Helper to fetch HA Calendars + CalDAV Calendars
  async function fetchHaCalendars() {
    let haCalendars = [];
    let caldavCalendars = [];

    if (isStandaloneDev) {
      haCalendars = [
        { entity_id: 'calendar.civil_holidays', name: 'Holidays', source: 'ha', accountName: 'Home Assistant', readOnly: false },
        { entity_id: 'calendar.icloud_personal', name: 'iCloud Personal', source: 'ha', accountName: 'Home Assistant', readOnly: false },
        { entity_id: 'calendar.google_family', name: 'Google Family', source: 'ha', accountName: 'Home Assistant', readOnly: false },
        { entity_id: 'calendar.work_outlook', name: 'Work Outlook', source: 'ha', accountName: 'Home Assistant', readOnly: false }
      ];
      // Add mock CalDAV calendars
      const mockAccounts = caldavService.getMockAccounts();
      mockAccounts.forEach(acc => {
        (acc.calendars || []).forEach(cal => {
          caldavCalendars.push({
            entity_id: `caldav_${acc.id}_${cal.url}`,
            name: `🍎 ${cal.displayName}`,
            source: 'caldav',
            accountId: acc.id,
            accountName: acc.appleId,
            calendarUrl: cal.url,
            color: cal.color,
            readOnly: true
          });
        });
      });
    } else {
      try {
        const states = await callHaApi('/states');
        haCalendars = states
          .filter(entity => entity.entity_id.startsWith('calendar.'))
          .map(entity => ({
            entity_id: entity.entity_id,
            name: entity.attributes.friendly_name || entity.entity_id,
            source: 'ha',
            accountName: 'Home Assistant',
            readOnly: false
          }));
      } catch (err) {
        console.error('Failed to fetch HA calendars:', err);
      }

      // Add CalDAV calendars
      try {
        const accounts = caldavService.getAccounts();
        accounts.forEach(acc => {
          (acc.calendars || []).forEach(cal => {
            // Apple renames dead/legacy shared calendars with a warning sign.
            // Filter these out so users don't see duplicate, empty calendars in the dropdown.
            if (cal.displayName && (cal.displayName.includes('⚠️') || cal.displayName.includes('⚠'))) {
              return;
            }

            caldavCalendars.push({
              entity_id: `caldav_${acc.id}_${cal.url}`,
              name: `🍎 ${cal.displayName}`,
              source: 'caldav',
              accountId: acc.id,
              accountName: acc.appleId,
              calendarUrl: cal.url,
              color: cal.color,
              readOnly: true
            });
          });
        });
      } catch (err) {
        console.error('Failed to fetch CalDAV calendars:', err);
      }
    }

    return [...haCalendars, ...caldavCalendars];
  }

  // Helper to fetch HA Notify Services
  async function fetchHaNotifyServices() {
    if (isStandaloneDev) {
      return [
        { service: 'notify.mobile_app_iphone', name: 'iPhone' },
        { service: 'notify.mobile_app_ipad', name: 'iPad' }
      ];
    }

    try {
      const services = await callHaApi('/services');
      const notifyDomain = services.find(d => d.domain === 'notify');

      if (!notifyDomain || !notifyDomain.services) return [];

      // Return all notification services available to HA
      return Object.keys(notifyDomain.services)
        .map(serviceName => ({
          service: `notify.${serviceName}`,
          name: serviceName.replace(/_/g, ' ')
        }));
    } catch (err) {
      console.error('Failed to fetch HA notify services:', err);
      return [];
    }
  }

  // Helper: Fetch HA Users (Persons)
  async function fetchHaUsers() {
    // Standalone Mode Mock Data
    if (isStandaloneDev) {
      const mockPath = path.join(__dirname, 'mock-data', 'users.json');
      try {
        const data = JSON.parse(fs.readFileSync(mockPath, 'utf8'));
        let mappings = getUserMappings();
        mappings = ensureProfileColors(data.users, mappings);
        return data.users.map(u => ({
          id: u.id,
          name: u.name,
          user_id: u.id,
          picture: u.avatar,
          // Merge local mapping data
          calendar_entity_id: mappings[u.id]?.calendar_entity_id || null,
          notify_service: mappings[u.id]?.notify_service || null,
          color: mappings[u.id]?.color,
          icon: mappings[u.id]?.icon || 'person'
        }));
      } catch (e) { return []; }
    }

    const client = getHaWsClient();
    if (!client) return [];

    try {
      const result = await client.sendCommand('person/list');
      const persons = result.storage || [];
      let mappings = getUserMappings();
      mappings = ensureProfileColors(persons, mappings);

      return persons.map(person => ({
        id: person.id,
        name: person.name,
        picture: person.picture,
        user_id: person.user_id,
        // Merge local mapping data
        calendar_entity_id: mappings[person.id]?.calendar_entity_id || null,
        notify_service: mappings[person.id]?.notify_service || null,
        color: mappings[person.id]?.color,
        icon: mappings[person.id]?.icon || 'person'
      }));
    } catch (err) {
      console.error('[WS] Failed to fetch users:', err.message);
      return [];
    }
  }

  // Helper: Create HA User (Person)
  async function createHaUser(name) {
    if (isStandaloneDev) {
      console.log(`[MOCK] Created user: ${name}`);
      return { id: 'mock_' + Date.now(), name };
    }

    const client = getHaWsClient();
    if (!client) throw new Error('WS Client not available');

    // Create person
    return await client.sendCommand('person/create', { name });
  }

  // Socket.io connection handling
  io.on('connection', (socket) => {
    console.log('[INFO] Client connected to socket.io');

    // Function to send initial data to a newly connected client
    function sendInitialData(socket) {
      console.log('[INFO] Sending initial data to client');
      socket.emit('initial_data', {
        config: config,
        ingress_mode: isIngressMode,
        development_mode: config.development_mode,
        server_info: {
          port: PORT,
          isProduction,
          isIngressMode,
          hassApiUrl
        }
      });
    }

    // Send initial data to the client
    sendInitialData(socket);

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log('[INFO] Client disconnected from socket.io');
    });
  });

  // ROUTES SECTION

  // API: Get HA Calendars
  app.get('/api/ha/calendars', async (req, res) => {
    try {
      const calendars = await fetchHaCalendars();
      res.json(calendars);
    } catch (err) {
      console.error('Fetch HA calendars failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: Get persisted calendar visibility settings
  app.get('/api/calendar-settings', (req, res) => {
    res.json(readCalendarSettings());
  });

  // API: Enable or disable a connected calendar
  app.put('/api/calendar-settings', express.json(), (req, res) => {
    try {
      const { calendarId, enabled } = req.body;
      if (typeof calendarId !== 'string' || !calendarId.trim() || typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'calendarId and enabled are required' });
      }

      const settings = readCalendarSettings();
      const disabledCalendarIds = new Set(settings.disabledCalendarIds);
      if (enabled) {
        disabledCalendarIds.delete(calendarId);
      } else {
        disabledCalendarIds.add(calendarId);
      }

      const savedSettings = saveCalendarSettings({
        ...settings,
        disabledCalendarIds: [...disabledCalendarIds]
      });
      res.json({ calendarId, enabled, ...savedSettings });
    } catch (err) {
      console.error('Update calendar settings failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: Recipe book CRUD
  app.get('/api/recipes', (req, res) => {
    res.json(readRecipes());
  });

  app.post('/api/recipes', (req, res) => {
    try {
      const recipe = normalizeRecipe(req.body || {});
      if (!recipe.name) return res.status(400).json({ error: 'Recipe name is required' });
      recipe.id = `recipe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const recipes = readRecipes();
      recipes.push(recipe);
      saveRecipes(recipes);
      res.status(201).json(recipe);
    } catch (err) {
      console.error('Create recipe failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/recipes/:id', (req, res) => {
    try {
      const recipes = readRecipes();
      const index = recipes.findIndex(recipe => recipe.id === req.params.id);
      if (index === -1) return res.status(404).json({ error: 'Recipe not found' });
      const recipe = normalizeRecipe(req.body || {}, recipes[index]);
      if (!recipe.name) return res.status(400).json({ error: 'Recipe name is required' });
      recipes[index] = recipe;
      saveRecipes(recipes);
      res.json(recipe);
    } catch (err) {
      console.error('Update recipe failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/recipes/:id', (req, res) => {
    try {
      const recipes = readRecipes();
      const index = recipes.findIndex(recipe => recipe.id === req.params.id);
      if (index === -1) return res.status(404).json({ error: 'Recipe not found' });
      const [deleted] = recipes.splice(index, 1);
      saveRecipes(recipes);
      res.json(deleted);
    } catch (err) {
      console.error('Delete recipe failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: Household lists. Mutations use withListWrite so each request sees the
  // result of the previous request even when phones and the wall panel write at
  // the same time.
  app.get('/api/lists', (req, res) => {
    res.json(readLists());
  });

  app.post('/api/lists', async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) return res.status(400).json({ error: 'List name is required' });
    const type = ['grocery', 'todo', 'custom'].includes(req.body?.type) ? req.body.type : 'custom';
    try {
      const list = await withListWrite(lists => {
        const now = new Date().toISOString();
        const created = {
          id: makeListId(),
          name,
          type,
          icon: typeof req.body?.icon === 'string' && req.body.icon.trim() ? req.body.icon.trim() : 'checklist',
          items: [],
          createdAt: now,
          updatedAt: now
        };
        lists.push(created);
        return created;
      });
      res.status(201).json(list);
    } catch (err) {
      console.error('Create list failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/lists/:id', async (req, res) => {
    try {
      const list = await withListWrite(lists => {
        const found = lists.find(candidate => candidate.id === req.params.id);
        if (!found) return null;
        if (typeof req.body?.name === 'string') {
          const name = req.body.name.trim();
          if (!name) throw new Error('List name is required');
          found.name = name;
        }
        if (typeof req.body?.icon === 'string' && req.body.icon.trim()) found.icon = req.body.icon.trim();
        found.updatedAt = new Date().toISOString();
        return found;
      });
      if (!list) return res.status(404).json({ error: 'List not found' });
      res.json(list);
    } catch (err) {
      const status = err.message === 'List name is required' ? 400 : 500;
      if (status === 500) console.error('Update list failed:', err);
      res.status(status).json({ error: err.message });
    }
  });

  app.delete('/api/lists/:id', async (req, res) => {
    try {
      const deleted = await withListWrite(lists => {
        const index = lists.findIndex(candidate => candidate.id === req.params.id);
        return index === -1 ? null : lists.splice(index, 1)[0];
      });
      if (!deleted) return res.status(404).json({ error: 'List not found' });
      res.json(deleted);
    } catch (err) {
      console.error('Delete list failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/lists/:id/items', (req, res) => {
    const list = readLists().find(candidate => candidate.id === req.params.id);
    if (!list) return res.status(404).json({ error: 'List not found' });
    res.json(list.items || []);
  });

  app.post('/api/lists/:id/items', async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) return res.status(400).json({ error: 'Item text is required' });
    try {
      const result = await withListWrite(lists => {
        const list = lists.find(candidate => candidate.id === req.params.id);
        if (!list) return null;
        const item = {
          id: makeItemId(),
          text,
          quantity: typeof req.body?.quantity === 'string' || typeof req.body?.quantity === 'number'
            ? String(req.body.quantity).trim() : '',
          checked: false,
          checkedBy: null,
          checkedAt: null,
          position: list.items.length,
          addedAt: new Date().toISOString()
        };
        list.items.push(item);
        list.updatedAt = new Date().toISOString();
        return { list, item };
      });
      if (!result) return res.status(404).json({ error: 'List not found' });
      res.status(201).json(result.item);
    } catch (err) {
      console.error('Create list item failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/lists/:id/items/:itemId', async (req, res) => {
    try {
      const result = await withListWrite(lists => {
        const list = lists.find(candidate => candidate.id === req.params.id);
        if (!list) return null;
        const item = (list.items || []).find(candidate => candidate.id === req.params.itemId);
        if (!item) return { list, item: null };
        if (typeof req.body?.text === 'string') {
          const text = req.body.text.trim();
          if (!text) throw new Error('Item text is required');
          item.text = text;
        }
        if (typeof req.body?.quantity === 'string' || typeof req.body?.quantity === 'number') item.quantity = String(req.body.quantity).trim();
        if (typeof req.body?.position === 'number' && Number.isFinite(req.body.position)) item.position = req.body.position;
        if (typeof req.body?.checked === 'boolean') {
          item.checked = req.body.checked;
          item.checkedAt = item.checked ? new Date().toISOString() : null;
          item.checkedBy = item.checked ? (typeof req.body?.checkedBy === 'string' && req.body.checkedBy.trim() ? req.body.checkedBy.trim() : 'Household') : null;
        }
        list.updatedAt = new Date().toISOString();
        return { list, item };
      });
      if (!result) return res.status(404).json({ error: 'List not found' });
      if (!result.item) return res.status(404).json({ error: 'List item not found' });
      res.json(result.item);
    } catch (err) {
      const status = err.message === 'Item text is required' ? 400 : 500;
      if (status === 500) console.error('Update list item failed:', err);
      res.status(status).json({ error: err.message });
    }
  });

  app.delete('/api/lists/:id/items/:itemId', async (req, res) => {
    try {
      const result = await withListWrite(lists => {
        const list = lists.find(candidate => candidate.id === req.params.id);
        if (!list) return null;
        const index = (list.items || []).findIndex(candidate => candidate.id === req.params.itemId);
        if (index === -1) return { list, item: null };
        const item = list.items.splice(index, 1)[0];
        list.items.forEach((candidate, position) => { candidate.position = position; });
        list.updatedAt = new Date().toISOString();
        return { list, item };
      });
      if (!result) return res.status(404).json({ error: 'List not found' });
      if (!result.item) return res.status(404).json({ error: 'List item not found' });
      res.json(result.item);
    } catch (err) {
      console.error('Delete list item failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/lists/:id/items/reorder', async (req, res) => {
    if (!Array.isArray(req.body?.orderedIds)) return res.status(400).json({ error: 'orderedIds must be an array' });
    try {
      const list = await withListWrite(lists => {
        const found = lists.find(candidate => candidate.id === req.params.id);
        if (!found) return null;
        const ids = req.body.orderedIds;
        const byId = new Map((found.items || []).map(item => [item.id, item]));
        if (ids.length !== byId.size || ids.some(id => !byId.has(id)) || new Set(ids).size !== ids.length) {
          throw new Error('orderedIds must include every item exactly once');
        }
        found.items = ids.map((id, position) => ({ ...byId.get(id), position }));
        found.updatedAt = new Date().toISOString();
        return found;
      });
      if (!list) return res.status(404).json({ error: 'List not found' });
      res.json(list);
    } catch (err) {
      const status = err.message.includes('orderedIds') ? 400 : 500;
      if (status === 500) console.error('Reorder list items failed:', err);
      res.status(status).json({ error: err.message });
    }
  });

  app.delete('/api/lists/:id/checked', async (req, res) => {
    try {
      const list = await withListWrite(lists => {
        const found = lists.find(candidate => candidate.id === req.params.id);
        if (!found) return null;
        found.items = (found.items || []).filter(item => !item.checked).map((item, position) => ({ ...item, position }));
        found.updatedAt = new Date().toISOString();
        return found;
      });
      if (!list) return res.status(404).json({ error: 'List not found' });
      res.json(list);
    } catch (err) {
      console.error('Clear checked list items failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: Meal plan. Meal types are persisted alongside meals so the Categories
  // modal can manage them later without another storage migration.
  app.get('/api/meals', (req, res) => {
    const { start, end } = req.query;
    if ((start && !isIsoDate(start)) || (end && !isIsoDate(end))) {
      return res.status(400).json({ error: 'start and end must be YYYY-MM-DD values' });
    }
    if (start && end && start > end) return res.status(400).json({ error: 'start must not be after end' });
    const mealPlan = readMealPlan();
    const meals = mealPlan.meals.filter(meal =>
      typeof meal.date === 'string' && (!start || meal.date >= start) && (!end || meal.date <= end));
    res.json({ meals, mealTypes: mealPlan.mealTypes });
  });

  app.post('/api/meals', (req, res) => {
    try {
      const mealPlan = readMealPlan();
      const result = normalizeMeal(req.body || {}, mealPlan);
      if (result.error) return res.status(400).json({ error: result.error });
      const meal = { id: `meal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, ...result.meal };
      mealPlan.meals.push(meal);
      saveMealPlan(mealPlan);
      res.status(201).json(meal);
    } catch (err) {
      console.error('Create meal failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/meals/:id', (req, res) => {
    try {
      const mealPlan = readMealPlan();
      const index = mealPlan.meals.findIndex(meal => meal.id === req.params.id);
      if (index === -1) return res.status(404).json({ error: 'Meal not found' });
      const result = normalizeMeal(req.body || {}, mealPlan, mealPlan.meals[index]);
      if (result.error) return res.status(400).json({ error: result.error });
      mealPlan.meals[index] = result.meal;
      saveMealPlan(mealPlan);
      res.json(result.meal);
    } catch (err) {
      console.error('Update meal failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/meals/:id', (req, res) => {
    try {
      const mealPlan = readMealPlan();
      const index = mealPlan.meals.findIndex(meal => meal.id === req.params.id);
      if (index === -1) return res.status(404).json({ error: 'Meal not found' });
      const [deleted] = mealPlan.meals.splice(index, 1);
      saveMealPlan(mealPlan);
      res.json(deleted);
    } catch (err) {
      console.error('Delete meal failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: Read source-to-destination routing without changing legacy user mapping consumers.
  app.get('/api/calendar-routing', async (req, res) => {
    try {
      const users = await fetchHaUsers();
      res.json(getCalendarRouting(new Set(users.map(user => user.id))));
    } catch (err) {
      console.error('Fetch calendar routing failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: Create a non-person destination label with its own identity color.
  app.post('/api/calendar-labels', express.json(), (req, res) => {
    try {
      const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
      if (!name) return res.status(400).json({ error: 'Label name required' });

      const settings = readCalendarSettings();
      const duplicate = settings.labels.find(label => label.name.toLowerCase() === name.toLowerCase());
      if (duplicate) return res.status(409).json({ error: 'A label with that name already exists' });

      const mappings = getUserMappings();
      const color = getNextAvailableColor([
        ...Object.values(mappings).map(mapping => mapping && mapping.color),
        ...settings.labels.map(label => label.color)
      ]);
      const label = {
        id: `label_${Date.now().toString(36)}`,
        name: name.slice(0, 40),
        color
      };
      settings.labels.push(label);
      saveCalendarSettings(settings);
      res.json(label);
    } catch (err) {
      console.error('Create calendar label failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: Route one source calendar to one or more profiles, one label, or neither.
  app.put('/api/calendar-routing', express.json(), async (req, res) => {
    try {
      const calendarId = typeof req.body.calendarId === 'string' ? req.body.calendarId.trim() : '';
      const requestedProfileIds = Array.isArray(req.body.profileIds)
        ? [...new Set(req.body.profileIds.filter(id => typeof id === 'string' && id.trim()))]
        : [];
      const labelId = typeof req.body.labelId === 'string' && req.body.labelId.trim()
        ? req.body.labelId.trim()
        : null;
      if (!calendarId) return res.status(400).json({ error: 'calendarId required' });
      if (labelId && requestedProfileIds.length > 0) {
        return res.status(400).json({ error: 'Choose profiles or a label, not both' });
      }

      const users = await fetchHaUsers();
      const validProfileIds = new Set(users.map(user => user.id));
      if (requestedProfileIds.some(id => !validProfileIds.has(id))) {
        return res.status(400).json({ error: 'Unknown profile selected' });
      }

      const settings = readCalendarSettings();
      if (labelId && !settings.labels.some(label => label.id === labelId)) {
        return res.status(400).json({ error: 'Unknown label selected' });
      }

      const mappings = getUserMappings();
      const profileIdsToUpdate = new Set([...Object.keys(mappings), ...requestedProfileIds]);
      profileIdsToUpdate.forEach(profileId => {
        const mapping = mappings[profileId] || {};
        const calendarIds = normalizeCalendarIds(mapping.calendar_entity_id)
          .filter(id => id !== calendarId);
        if (requestedProfileIds.includes(profileId)) calendarIds.push(calendarId);
        mappings[profileId] = { ...mapping, calendar_entity_id: calendarIds };
      });
      writeUserMappings(mappings);

      if (labelId) settings.calendarLabels[calendarId] = labelId;
      else delete settings.calendarLabels[calendarId];
      saveCalendarSettings(settings);

      res.json({ calendarId, profileIds: requestedProfileIds, labelId });
    } catch (err) {
      console.error('Update calendar routing failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: Get HA Notify Services
  app.get('/api/ha/notify-services', async (req, res) => {
    try {
      const services = await fetchHaNotifyServices();
      res.json(services);
    } catch (err) {
      console.error('Fetch HA notify services failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: Get Users
  app.get('/api/users', async (req, res) => {
    try {
      const users = await fetchHaUsers();
      res.json(users);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // API: Create User
  app.post('/api/users', express.json(), async (req, res) => {
    try {
      const { name, calendar_entity_id, notify_service, color, icon } = req.body;
      if (!name) return res.status(400).json({ error: 'Name required' });

      // Persist colors for existing profiles before choosing the next free default.
      await fetchHaUsers();
      const newUser = await createHaUser(name);
      const mappings = getUserMappings();
      const profileColor = typeof color === 'string' && color.trim()
        ? color
        : getNextAvailableColor(Object.values(mappings).map(mapping => mapping && mapping.color));

      // Save local mapping
      await saveUserMapping(newUser.id, { calendar_entity_id, notify_service, color: profileColor, icon });
      clearLabelsForCalendars(calendar_entity_id);

      // Merge local data for response
      newUser.calendar_entity_id = calendar_entity_id;
      newUser.notify_service = notify_service;
      newUser.color = profileColor;
      newUser.icon = icon;

      res.json(newUser);
    } catch (err) {
      console.error('Create user failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: Update User (Local Mapping Only)
  app.put('/api/users/:id', express.json(), async (req, res) => {
    try {
      const { id } = req.params;
      const { calendar_entity_id, notify_service, color, icon } = req.body;

      await saveUserMapping(id, { calendar_entity_id, notify_service, color, icon });
      clearLabelsForCalendars(calendar_entity_id);

      res.json({ success: true, id, calendar_entity_id, notify_service, color, icon });
    } catch (err) {
      console.error('Update user failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── CalDAV API Routes ──────────────────────────────────────────────────

  // API: Connect Apple Calendar
  app.post('/api/caldav/connect', express.json(), async (req, res) => {
    try {
      const { appleId, appPassword, userId } = req.body;
      if (!appleId || !appPassword) {
        return res.status(400).json({ error: 'Apple ID and app-specific password are required' });
      }

      // if (isStandaloneDev) {
      //   // Mock connection in dev mode
      //   // const mockAccounts = caldavService.getMockAccounts();
      //   // return res.json(mockAccounts[0]);
      // }

      const account = await caldavService.connectAppleCalendar(appleId, appPassword, userId || null);
      res.json(account);
    } catch (err) {
      console.error('CalDAV connect failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: List Connected CalDAV Accounts
  app.get('/api/caldav/accounts', (req, res) => {
    try {
      // if (isStandaloneDev) {
      //   return res.json(caldavService.getMockAccounts());
      // }
      res.json(caldavService.getAccounts());
    } catch (err) {
      console.error('CalDAV list accounts failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: Remove CalDAV Account
  app.delete('/api/caldav/accounts/:id', (req, res) => {
    try {
      // if (isStandaloneDev) {
      //   return res.json({ success: true });
      // }
      caldavService.removeAccount(req.params.id);
      res.json({ success: true });
    } catch (err) {
      console.error('CalDAV remove account failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: Fetch Calendars for a CalDAV Account
  app.get('/api/caldav/calendars/:accountId', async (req, res) => {
    try {
      // if (isStandaloneDev) {
      //   const mockAccounts = caldavService.getMockAccounts();
      //   const acc = mockAccounts.find(a => a.id === req.params.accountId);
      //   return res.json(acc ? acc.calendars : []);
      // }
      const calendars = await caldavService.fetchCalendars(req.params.accountId);
      res.json(calendars);
    } catch (err) {
      console.error('CalDAV fetch calendars failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: Fetch CalDAV Events
  app.get('/api/caldav/events', async (req, res) => {
    try {
      // if (isStandaloneDev) {
      //   return res.json(caldavService.getMockEvents());
      // }
      const range = getCalendarRange(req.query.start, req.query.end);
      const events = await caldavService.fetchAllEvents(range);
      res.json(events);
    } catch (err) {
      console.error('CalDAV fetch events failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Basic routes
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // Make debug page available through multiple paths for backward compatibility
  // But only if development_mode is enabled or if accessed directly (not through ingress)
  app.get(['/debug.html', '/ingress', '/local_daylight_calendar/ingress'], (req, res) => {
    // For direct access (localhost:8099), allow debug.html regardless of development_mode
    // For ingress mode, only allow if development_mode is true
    if (!isIngressMode || config.development_mode) {
      console.log(`[INFO] Serving debug.html - isIngressMode: ${isIngressMode}, development_mode: ${config.development_mode}`);
      res.sendFile(path.join(__dirname, 'public', 'debug.html'));
    } else {
      console.log(`[INFO] Blocking debug.html in ingress mode with development_mode disabled`);
      // If in ingress mode and development_mode is false, redirect to the main page
      res.redirect('/');
    }
  });

  app.get('/api/config', (req, res) => {
    // Always include development_mode in the config
    const configResponse = {
      ...config,
      development_mode: config.development_mode,
      addon_version: addonVersion
    };
    res.json(configResponse);
  });

  // API endpoint to check token status
  app.get('/api/token-info', (req, res) => {
    const token = process.env.SUPERVISOR_TOKEN || process.env.HASS_TOKEN;
    const tokenType = process.env.SUPERVISOR_TOKEN ? 'supervisor' :
      process.env.HASS_TOKEN ? 'hass' : 'none';
    const fromEnvVar = process.env.SUPERVISOR_TOKEN ? 'SUPERVISOR_TOKEN' :
      process.env.HASS_TOKEN ? 'HASS_TOKEN' : null;

    // Basic response for all requests
    const response = {
      available: !!token,
      type: tokenType,
      length: token ? token.length : 0,
      first_chars: token ? `${token.substring(0, 5)}...` : '',
      from_env_var: fromEnvVar,
      hass_api_url: hassApiUrl,
      ingress_mode: isIngressMode,
      development_mode: config.development_mode,
      port: PORT,
      ingress_port: process.env.INGRESS_PORT
    };

    // Add more detailed information if requested and in development mode
    if (req.query.detailed === 'true' && (config.development_mode || !isProduction)) {
      // Create a masked version that reveals a bit more but still hides most of the token
      if (token) {
        const firstFive = token.substring(0, 5);
        const lastFive = token.substring(token.length - 5);
        const middleStars = '*'.repeat(Math.min(20, token.length - 10));
        response.masked_token = `${firstFive}${middleStars}${lastFive}`;
      }
    }

    res.json(response);
  });

  // API proxy for Home Assistant
  app.get('/api/ha-proxy', async (req, res) => {
    const endpoint = req.query.endpoint;
    if (!endpoint) {
      return res.status(400).json({ error: 'Missing endpoint parameter' });
    }

    try {
      // Remove leading /api if present since hassApiUrl already includes it
      let apiPath = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
      if (apiPath.startsWith('/api/')) {
        apiPath = apiPath.substring(4); // Remove '/api' prefix
      }
      const data = await callHaApi(apiPath);
      res.json({
        success: true,
        endpoint: apiPath,
        data: data
      });
    } catch (error) {
      console.error(`[ERROR] Error proxying request to HA API at ${endpoint}:`, error.message);
      res.status(500).json({
        success: false,
        endpoint: endpoint,
        error: error.message,
        response: error.response ? {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data
        } : null
      });
    }
  });

  // API endpoint for calendar data
  app.get('/api/calendar', async (req, res) => {
    try {
      const range = getCalendarRange(req.query.start, req.query.end);
      const calendarData = await fetchCalendarData(range);
      res.json(calendarData);
    } catch (error) {
      console.error('[ERROR] Error in /api/calendar endpoint:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // API endpoint for weather data
  app.get('/api/weather', async (req, res) => {
    try {
      const weatherData = await fetchWeatherData();
      if (weatherData && weatherData.current) {
        // Ensure forecast is always an array
        if (!Array.isArray(weatherData.forecast)) {
          weatherData.forecast = [];
        }

        // Ensure temperature exists
        if (!weatherData.current.attributes || typeof weatherData.current.attributes.temperature !== 'number') {
          weatherData.current.attributes = {
            ...(weatherData.current.attributes || {}),
            temperature: null,
            temperature_unit: "°C"
          };
        }

        res.json(weatherData);
      } else {
        // Return a structured error response that the client can handle
        res.json({
          error: 'Failed to fetch weather data',
          current: {
            state: "unavailable",
            attributes: { temperature: null, forecast: [] }
          },
          forecast: []
        });
      }
    } catch (error) {
      console.error('[ERROR] Error fetching weather data:', error.message);
      // Return a structured error response that won't crash the client
      res.json({
        error: error.message,
        current: {
          state: "error",
          attributes: { temperature: null, forecast: [] }
        },
        forecast: []
      });
    }
  });

  app.get('/api/combined-data', async (req, res) => {
    try {
      const range = getCalendarRange(req.query.start, req.query.end);
      const calendarData = await fetchCalendarData(range);
      const weatherData = await fetchWeatherData();
      res.json({
        calendarData: Array.isArray(calendarData) ? calendarData : [],
        weatherData: weatherData || {
          current: {
            state: "unavailable",
            attributes: { temperature: null, forecast: [] }
          },
          forecast: []
        }
      });
    } catch (error) {
      console.error('[ERROR] Error in /api/combined-data endpoint:', error.message);
      res.json({
        calendarData: [],
        weatherData: {
          current: {
            state: "error",
            attributes: { temperature: null, forecast: [] }
          },
          forecast: []
        }
      });
    }
  });

  // API Endpoints for Chores (Todo Lists)
  app.get('/api/chores', async (req, res) => {
    try {
      const result = await fetchTodoItems();
      if (result.error) {
        return res.status(500).json(result);
      }
      const { metaByUid } = await processChoreCompletions(result.items || []);
      const settings = readChoreSettings();
      res.json({
        ...result,
        items: (result.items || []).map(item => ({
          ...item,
          ...normalizeChoreMeta(metaByUid[item.uid], settings)
        }))
      });
    } catch (error) {
      console.error('[ERROR] Error in GET /api/chores:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/chores', async (req, res) => {
    const { item, entityId, assignedProfileIds = [], starValue, dueDate, upForGrabs } = req.body;
    if (!item) {
      return res.status(400).json({ error: 'Item title is required' });
    }
    if (!Array.isArray(assignedProfileIds) || !(await validateProfileIds(assignedProfileIds))) {
      return res.status(400).json({ error: 'One or more assigned profiles are unknown' });
    }
    if (starValue !== undefined && (!Number.isInteger(starValue) || starValue <= 0)) {
      return res.status(400).json({ error: 'Star value must be a positive integer' });
    }

    // Use provided entityId or find one
    let targetEntityId = entityId;
    if (!targetEntityId) {
      // Quick lookup if not provided
      const todoData = await fetchTodoItems();
      if (todoData.entityId) {
        targetEntityId = todoData.entityId;
      } else {
        return res.status(500).json({ error: 'No todo entity available' });
      }
    }

    try {
      const before = await fetchTodoItems();
      const existingUids = new Set((before.items || []).map(todo => todo.uid));
      if (isStandaloneDev) {
        getStandaloneTodoItems().push({
          uid: `mock_chore_${randomUUID()}`,
          summary: item,
          status: 'needs_action'
        });
      } else {
        await callHaApi('/services/todo/add_item', {
          method: 'POST',
          body: JSON.stringify({
            entity_id: targetEntityId,
            item: item
          })
        });
      }
      const after = await fetchTodoItems();
      const created = (after.items || []).find(todo => !existingUids.has(todo.uid) && todo.summary === item) ||
        (after.items || []).find(todo => !existingUids.has(todo.uid));
      let metadataSaved = false;
      if (created?.uid) {
        await withHouseholdStorageLock(async () => {
          const settings = readChoreSettings();
          const meta = readChoreMeta();
          meta[created.uid] = normalizeChoreMeta({
            assignedProfileIds,
            starValue,
            dueDate,
            upForGrabs: upForGrabs === true && assignedProfileIds.length === 0,
            createdAt: new Date().toISOString(),
            lastStatus: created.status || 'needs_action'
          }, settings);
          writeJsonFile('chore_meta.json', meta);
        });
        metadataSaved = true;
      }
      res.json({ success: true, uid: created?.uid || null, metadataSaved });
    } catch (error) {
      console.error('[ERROR] Error in POST /api/chores:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/chores/:uid/meta', async (req, res) => {
    const { uid } = req.params;
    const { assignedProfileIds = [], starValue, dueDate, upForGrabs } = req.body;
    if (!Array.isArray(assignedProfileIds) || !(await validateProfileIds(assignedProfileIds))) {
      return res.status(400).json({ error: 'One or more assigned profiles are unknown' });
    }
    if (starValue !== undefined && (!Number.isInteger(starValue) || starValue <= 0)) {
      return res.status(400).json({ error: 'Star value must be a positive integer' });
    }
    try {
      const saved = await withHouseholdStorageLock(async () => {
        const settings = readChoreSettings();
        const meta = readChoreMeta();
        meta[uid] = normalizeChoreMeta({ ...meta[uid], assignedProfileIds, starValue, dueDate, upForGrabs: upForGrabs === true && assignedProfileIds.length === 0 }, settings);
        writeJsonFile('chore_meta.json', meta);
        return meta[uid];
      });
      res.json(saved);
    } catch (error) {
      console.error('[ERROR] Error saving chore metadata:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/chores/:uid/claim', async (req, res) => {
    const { profileId } = req.body;
    if (!(await validateProfileIds([profileId]))) return res.status(400).json({ error: 'Unknown profile' });
    try {
      const claimed = await withHouseholdStorageLock(async () => {
        const users = await fetchHaUsers();
        const meta = readChoreMeta();
        const settings = readChoreSettings();
        const current = normalizeChoreMeta(meta[req.params.uid], settings);
        if (!current.upForGrabs || current.assignedProfileIds.length) {
          const owner = users.find(user => user.id === current.assignedProfileIds[0]);
          return { conflict: `Already claimed by ${owner?.name || 'another household member'}` };
        }
        current.assignedProfileIds = [profileId];
        current.upForGrabs = false;
        meta[req.params.uid] = current;
        writeJsonFile('chore_meta.json', meta);
        return { meta: current };
      });
      if (claimed.conflict) return res.status(409).json({ error: claimed.conflict });
      res.json(claimed.meta);
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  app.post('/api/chores/:uid/release', async (req, res) => {
    try {
      const released = await withHouseholdStorageLock(async () => {
        const meta = readChoreMeta();
        const settings = readChoreSettings();
        const current = normalizeChoreMeta(meta[req.params.uid], settings);
        current.assignedProfileIds = [];
        current.upForGrabs = true;
        meta[req.params.uid] = current;
        writeJsonFile('chore_meta.json', meta);
        return current;
      });
      res.json(released);
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  function findSubtask(meta, subtaskId) {
    return meta.subtasks.find(item => item.id === subtaskId);
  }

  app.post('/api/chores/:uid/subtasks', async (req, res) => {
    if (typeof req.body.text !== 'string' || !req.body.text.trim()) return res.status(400).json({ error: 'Subtask text is required' });
    const saved = await withHouseholdStorageLock(async () => {
      const meta = readChoreMeta(); const settings = readChoreSettings();
      const current = normalizeChoreMeta(meta[req.params.uid], settings);
      const subtask = { id: randomUUID(), text: req.body.text.trim(), checked: false, position: current.subtasks.length };
      current.subtasks.push(subtask); meta[req.params.uid] = current; writeJsonFile('chore_meta.json', meta); return subtask;
    });
    res.status(201).json(saved);
  });

  app.post('/api/chores/:uid/subtasks/:subtaskId/toggle', async (req, res) => {
    const saved = await withHouseholdStorageLock(async () => {
      const meta = readChoreMeta(); const settings = readChoreSettings(); const current = normalizeChoreMeta(meta[req.params.uid], settings);
      const subtask = findSubtask(current, req.params.subtaskId); if (!subtask) return null;
      subtask.checked = !subtask.checked; meta[req.params.uid] = current; writeJsonFile('chore_meta.json', meta); return { subtask, allDone: current.subtasks.length > 0 && current.subtasks.every(item => item.checked) };
    });
    if (!saved) return res.status(404).json({ error: 'Subtask not found' });
    res.json(saved);
  });

  app.put('/api/chores/:uid/subtasks/:subtaskId', async (req, res) => {
    if (typeof req.body.text !== 'string' || !req.body.text.trim()) return res.status(400).json({ error: 'Subtask text is required' });
    const saved = await withHouseholdStorageLock(async () => {
      const meta = readChoreMeta(); const settings = readChoreSettings(); const current = normalizeChoreMeta(meta[req.params.uid], settings);
      const subtask = findSubtask(current, req.params.subtaskId); if (!subtask) return null;
      subtask.text = req.body.text.trim(); meta[req.params.uid] = current; writeJsonFile('chore_meta.json', meta); return subtask;
    });
    if (!saved) return res.status(404).json({ error: 'Subtask not found' });
    res.json(saved);
  });

  app.post('/api/chores/:uid/subtasks/reorder', async (req, res) => {
    if (!Array.isArray(req.body.orderedIds)) return res.status(400).json({ error: 'orderedIds is required' });
    const saved = await withHouseholdStorageLock(async () => {
      const meta = readChoreMeta(); const settings = readChoreSettings(); const current = normalizeChoreMeta(meta[req.params.uid], settings);
      if (req.body.orderedIds.length !== current.subtasks.length || new Set(req.body.orderedIds).size !== current.subtasks.length || !current.subtasks.every(item => req.body.orderedIds.includes(item.id))) return { invalid: true };
      current.subtasks = req.body.orderedIds.map((id, position) => ({ ...findSubtask(current, id), position })); meta[req.params.uid] = current; writeJsonFile('chore_meta.json', meta); return current.subtasks;
    });
    if (saved.invalid) return res.status(400).json({ error: 'orderedIds must contain every subtask exactly once' });
    res.json(saved);
  });

  app.delete('/api/chores/:uid/subtasks/:subtaskId', async (req, res) => {
    const deleted = await withHouseholdStorageLock(async () => {
      const meta = readChoreMeta(); const settings = readChoreSettings(); const current = normalizeChoreMeta(meta[req.params.uid], settings);
      const index = current.subtasks.findIndex(item => item.id === req.params.subtaskId); if (index < 0) return false;
      current.subtasks.splice(index, 1); current.subtasks.forEach((item, position) => { item.position = position; }); meta[req.params.uid] = current; writeJsonFile('chore_meta.json', meta); return true;
    });
    if (!deleted) return res.status(404).json({ error: 'Subtask not found' });
    res.json({ success: true });
  });

  app.patch('/api/chores/:itemId', async (req, res) => {
    const { itemId } = req.params;
    const { status, item, entityId } = req.body; // status: 'completed' or 'needs_action'

    // Use provided entityId or find one
    let targetEntityId = entityId;
    if (!targetEntityId) {
      const todoData = await fetchTodoItems();
      if (todoData.entityId) {
        targetEntityId = todoData.entityId;
      } else {
        return res.status(500).json({ error: 'No todo entity available' });
      }
    }

    try {
      if (isStandaloneDev) {
        const todo = getStandaloneTodoItems().find(candidate => candidate.uid === itemId);
        if (!todo) return res.status(404).json({ error: 'Chore not found' });
        if (status) {
          todo.status = status;
          if (status === 'completed') todo.completed_at = new Date().toISOString();
          if (status === 'needs_action') delete todo.completed_at;
        }
        if (item && item !== itemId) todo.summary = item;
        return res.json({ success: true });
      }
      const payload = {
        entity_id: targetEntityId,
        item: item || itemId // Some todo integrations use UID, some use summary. HA service uses 'item' (summary) or 'uid'? 
        // Wait, todo.update_item takes 'item' which can be the summary or UID?
        // Actually, for todo.update_item, 'item' is the description/summary to identify it, OR 'uid'.
        // We should pass 'uid' if we have it, or 'item' if not.
        // Let's assume we pass the UID as 'item' if the integration supports it, or we rely on the frontend passing the right identifier.
        // Standard HA Todo Item has a 'uid'.
      };

      // If we have a status update
      if (status) {
        payload.status = status;
      }

      // If we are renaming
      if (item && item !== itemId) {
        payload.rename = item;
      }

      // IMPORTANT: The 'item' field in the service call is used to IDENTIFY the item to update.
      // It usually matches the 'uid' or 'summary'.
      // We will assume 'itemId' passed in URL is the UID.
      // But todo.update_item uses 'item' argument to select the item.
      payload.item = itemId;

      await callHaApi('/services/todo/update_item', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      res.json({ success: true });
    } catch (error) {
      console.error('[ERROR] Error in PATCH /api/chores:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/stars', async (req, res) => {
    try {
      const [users, snapshot] = await Promise.all([
        fetchHaUsers(),
        withHouseholdStorageLock(async () => ({ ledger: readStarsLedger() }))
      ]);
      const entries = snapshot.ledger.slice(-50).reverse();
      res.json({
        profiles: users.map(profile => ({ ...profile, balance: derivedBalance(snapshot.ledger, profile.id) })),
        entries,
        pendingAwards: snapshot.ledger.filter(entry => entry.status === 'pending').reverse()
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/chore-settings', (req, res) => res.json(readChoreSettings()));

  app.put('/api/chore-settings', async (req, res) => {
    const { defaultStarValue, awardsRequireConfirmation } = req.body;
    if (!Number.isInteger(defaultStarValue) || defaultStarValue <= 0) {
      return res.status(400).json({ error: 'Default star value must be a positive integer' });
    }
    if (typeof awardsRequireConfirmation !== 'boolean') {
      return res.status(400).json({ error: 'Awards confirmation setting must be true or false' });
    }
    try {
      const settings = await withHouseholdStorageLock(async () => {
        const next = { defaultStarValue, awardsRequireConfirmation };
        writeJsonFile('chore_settings.json', next);
        return next;
      });
      res.json(settings);
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  app.get('/api/stars/:profileId', async (req, res) => {
    try {
      const profileId = req.params.profileId;
      const users = await fetchHaUsers();
      const profile = users.find(user => user.id === profileId);
      if (!profile) return res.status(404).json({ error: 'Profile not found' });
      const ledger = await withHouseholdStorageLock(async () => readStarsLedger());
      res.json({ profile: { ...profile, balance: derivedBalance(ledger, profileId) }, entries: ledger.filter(entry => entry.profileId === profileId).reverse() });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/stars/adjust', async (req, res) => {
    const { profileId, delta, reason } = req.body;
    if (typeof reason !== 'string' || !reason.trim()) return res.status(400).json({ error: 'A reason is required for a star adjustment' });
    if (!Number.isInteger(delta) || delta === 0) return res.status(400).json({ error: 'Adjustment must be a non-zero integer' });
    if (!(await validateProfileIds([profileId]))) return res.status(400).json({ error: 'Unknown profile' });
    try {
      const entry = await withHouseholdStorageLock(async () => {
        const ledger = readStarsLedger();
        const next = makeLedgerEntry({ profileId, delta, reason: reason.trim(), status: 'confirmed' });
        ledger.push(next);
        writeJsonFile('stars.json', ledger);
        return next;
      });
      res.status(201).json(entry);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/stars/:entryId/confirm', async (req, res) => {
    try {
      const confirmed = await withHouseholdStorageLock(async () => {
        const ledger = readStarsLedger();
        const pending = ledger.find(entry => entry.id === req.params.entryId && entry.status === 'pending');
        if (!pending) return null;
        if (ledger.some(entry => entry.pendingAwardId === pending.id)) return { alreadyHandled: true };
        const next = makeLedgerEntry({ ...pending, status: 'confirmed', pendingAwardId: pending.id, reason: 'Confirmed chore award' });
        ledger.push(next);
        writeJsonFile('stars.json', ledger);
        return next;
      });
      if (!confirmed) return res.status(404).json({ error: 'Pending award not found' });
      res.json(confirmed);
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  app.post('/api/stars/:entryId/reject', async (req, res) => {
    try {
      const rejected = await withHouseholdStorageLock(async () => {
        const ledger = readStarsLedger();
        const pending = ledger.find(entry => entry.id === req.params.entryId && entry.status === 'pending');
        if (!pending) return null;
        if (ledger.some(entry => entry.pendingAwardId === pending.id)) return { alreadyHandled: true };
        const next = makeLedgerEntry({ ...pending, delta: 0, status: 'rejected', pendingAwardId: pending.id, reason: 'Rejected chore award' });
        ledger.push(next);
        writeJsonFile('stars.json', ledger);
        return next;
      });
      if (!rejected) return res.status(404).json({ error: 'Pending award not found' });
      res.json(rejected);
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  app.get('/api/rewards', (req, res) => res.json(readRewards()));

  function validateRewardInput(data) {
    if (typeof data.name !== 'string' || !data.name.trim()) return 'Reward name is required';
    if (!Number.isInteger(data.starCost) || data.starCost <= 0) return 'Star cost must be a positive integer';
    return null;
  }

  app.post('/api/rewards', async (req, res) => {
    const validationError = validateRewardInput(req.body);
    if (validationError) return res.status(400).json({ error: validationError });
    const reward = await withHouseholdStorageLock(async () => {
      const rewards = readRewards();
      const next = { id: randomUUID(), name: req.body.name.trim(), description: String(req.body.description || ''), starCost: req.body.starCost, icon: String(req.body.icon || 'card_giftcard'), imageUrl: String(req.body.imageUrl || ''), active: req.body.active !== false, createdAt: new Date().toISOString() };
      rewards.push(next); writeJsonFile('rewards.json', rewards); return next;
    });
    res.status(201).json(reward);
  });

  app.put('/api/rewards/:id', async (req, res) => {
    const validationError = validateRewardInput(req.body);
    if (validationError) return res.status(400).json({ error: validationError });
    const reward = await withHouseholdStorageLock(async () => {
      const rewards = readRewards(); const index = rewards.findIndex(candidate => candidate.id === req.params.id);
      if (index < 0) return null;
      rewards[index] = { ...rewards[index], name: req.body.name.trim(), description: String(req.body.description || ''), starCost: req.body.starCost, icon: String(req.body.icon || 'card_giftcard'), imageUrl: String(req.body.imageUrl || ''), active: req.body.active !== false };
      writeJsonFile('rewards.json', rewards); return rewards[index];
    });
    if (!reward) return res.status(404).json({ error: 'Reward not found' });
    res.json(reward);
  });

  app.delete('/api/rewards/:id', async (req, res) => {
    const removed = await withHouseholdStorageLock(async () => {
      const rewards = readRewards(); const index = rewards.findIndex(candidate => candidate.id === req.params.id);
      if (index < 0) return false;
      rewards.splice(index, 1); writeJsonFile('rewards.json', rewards); return true;
    });
    if (!removed) return res.status(404).json({ error: 'Reward not found' });
    res.json({ success: true });
  });

  app.post('/api/rewards/:id/redeem', async (req, res) => {
    const { profileId } = req.body;
    if (!(await validateProfileIds([profileId]))) return res.status(400).json({ error: 'Unknown profile' });
    try {
      const redemption = await withHouseholdStorageLock(async () => {
        const rewards = readRewards(); const reward = rewards.find(candidate => candidate.id === req.params.id && candidate.active !== false);
        if (!reward) return { error: 'Reward not found or inactive' };
        const ledger = readStarsLedger(); const balance = derivedBalance(ledger, profileId);
        if (balance < reward.starCost) return { error: `Not enough stars: ${reward.starCost - balance} more needed` };
        const entry = makeLedgerEntry({ profileId, delta: -reward.starCost, reason: `Redeemed: ${reward.name}`, rewardId: reward.id, status: 'confirmed' });
        ledger.push(entry); writeJsonFile('stars.json', ledger); return { entry, balance: balance - reward.starCost };
      });
      if (redemption.error) return res.status(400).json({ error: redemption.error });
      res.status(201).json(redemption);
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  app.get('/api/routines/today', (req, res) => {
    const date = getServerLocalDate(req.query.date);
    res.json({ date, routines: getRoutineTodayPayload(date) });
  });

  app.get('/api/routines', (req, res) => res.json(readRoutines()));

  app.post('/api/routines', async (req, res) => {
    const routine = normalizeRoutine(req.body);
    const validationError = validateRoutineInput(routine);
    if (validationError) return res.status(400).json({ error: validationError });
    if (!(await validateProfileIds(routine.assignedProfileIds))) return res.status(400).json({ error: 'One or more assigned profiles are unknown' });
    const saved = await withHouseholdStorageLock(async () => { const routines = readRoutines(); routines.push(routine); writeJsonFile('routines.json', routines); return routine; });
    res.status(201).json(saved);
  });

  app.put('/api/routines/:id', async (req, res) => {
    const existing = readRoutines().find(routine => routine.id === req.params.id);
    if (!existing) return res.status(404).json({ error: 'Routine not found' });
    const routine = normalizeRoutine(req.body, existing);
    const validationError = validateRoutineInput(routine);
    if (validationError) return res.status(400).json({ error: validationError });
    if (!(await validateProfileIds(routine.assignedProfileIds))) return res.status(400).json({ error: 'One or more assigned profiles are unknown' });
    const saved = await withHouseholdStorageLock(async () => { const routines = readRoutines(); const index = routines.findIndex(candidate => candidate.id === req.params.id); if (index < 0) return null; routines[index] = routine; writeJsonFile('routines.json', routines); return routine; });
    if (!saved) return res.status(404).json({ error: 'Routine not found' });
    res.json(saved);
  });

  app.delete('/api/routines/:id', async (req, res) => {
    const deleted = await withHouseholdStorageLock(async () => { const routines = readRoutines(); const index = routines.findIndex(routine => routine.id === req.params.id); if (index < 0) return false; routines.splice(index, 1); writeJsonFile('routines.json', routines); return true; });
    if (!deleted) return res.status(404).json({ error: 'Routine not found' });
    res.json({ success: true });
  });

  app.post('/api/routines/:id/steps/:stepId/toggle', async (req, res) => {
    const { profileId } = req.body;
    if (!(await validateProfileIds([profileId]))) return res.status(400).json({ error: 'Unknown profile' });
    const date = getServerLocalDate(req.query.date);
    const result = await withHouseholdStorageLock(async () => {
      const routines = readRoutines(); const routine = routines.find(candidate => candidate.id === req.params.id);
      if (!routine) return { error: 'Routine not found', status: 404 };
      if (!routineIsDueToday(routine, date)) return { error: 'Routine is not due today', status: 400 };
      if (!routine.assignedProfileIds.includes(profileId)) return { error: 'This routine is not assigned to that profile', status: 403 };
      if (!routine.steps.some(step => step.id === req.params.stepId)) return { error: 'Routine step not found', status: 404 };
      const progress = readRoutineProgress(); progress[date] = progress[date] || {}; progress[date][routine.id] = progress[date][routine.id] || {};
      const state = progress[date][routine.id][profileId] || { completedStepIds: [] };
      state.completedStepIds = Array.isArray(state.completedStepIds) ? state.completedStepIds : [];
      state.completedStepIds = state.completedStepIds.includes(req.params.stepId) ? state.completedStepIds.filter(id => id !== req.params.stepId) : [...state.completedStepIds, req.params.stepId];
      progress[date][routine.id][profileId] = state; writeJsonFile('routine_progress.json', progress);
      const completed = routine.steps.every(step => state.completedStepIds.includes(step.id));
      let award = null;
      if (completed) {
        const ledger = readStarsLedger(); const completionKey = `routine:${routine.id}:${profileId}:${date}`;
        if (!ledger.some(entry => entry.profileId === profileId && entry.completionKey === completionKey)) {
          award = makeLedgerEntry({ profileId, delta: routine.starValue, reason: `Routine completed: ${routine.name}`, completionKey, status: 'confirmed' });
          ledger.push(award); writeJsonFile('stars.json', ledger);
        }
      }
      return { completedStepIds: state.completedStepIds, completed, award, date };
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  });

  // Screen time is an append-only usage ledger. Every mutation shares the
  // household lock so simultaneous taps cannot create two active players or
  // replace a grant/session written by another display.
  app.get('/api/screen-time', async (req, res) => {
    try {
      const [users, todoResult] = await Promise.all([fetchHaUsers(), fetchTodoItems()]);
      if (todoResult.error) return res.status(500).json({ error: todoResult.error });
      const payload = await withHouseholdStorageLock(async () => {
        const state = readScreenTime();
        const nowMs = Date.now();
        const date = getServerLocalDate();
        const enforcement = enforceActiveScreenTimeSession(state, nowMs);
        if (enforcement.changed) writeJsonFile('screen_time.json', state);
        const active = enforcement.session;
        return {
          settings: publicScreenTimeSettings(state.settings),
          activeSession: active ? {
            ...active,
            expiresAt: enforcement.expiresAt,
            remainingSeconds: active.metered === false ? null :
              screenTimeTotals(state, active.profileId, date, nowMs).remainingSeconds
          } : null,
          profiles: users.map(user => {
            const totals = screenTimeTotals(state, user.id, date, nowMs);
            const blocking = state.settings.enabled
              ? getScreenTimeBlocking(user.id, state.settings, todoResult.items || [], date) : [];
            return {
              id: user.id,
              name: user.name,
              color: user.color,
              dailyMinutes: totals.dailyMinutes,
              usedMinutes: totals.usedMinutes,
              grantedMinutes: totals.grantedMinutes,
              remainingMinutes: totals.remainingMinutes,
              blocking,
              canStart: !active && (!state.settings.enabled ||
                (totals.remainingSeconds > 0 && blocking.length === 0))
            };
          })
        };
      });
      res.json(payload);
    } catch (error) {
      console.error('[ERROR] Failed to read screen time:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/screen-time/settings', async (req, res) => {
    const allowedBooleanKeys = ['enabled', 'requireChoresFirst', 'includeRoutines'];
    for (const key of allowedBooleanKeys) {
      if (req.body[key] !== undefined && typeof req.body[key] !== 'boolean') {
        return res.status(400).json({ error: `${key} must be true or false` });
      }
    }
    if (req.body.defaultDailyMinutes !== undefined && !isValidDailyMinutes(req.body.defaultDailyMinutes)) {
      return res.status(400).json({ error: 'Default daily minutes must be between 0 and 1440' });
    }
    const profileUpdates = req.body.profiles;
    if (profileUpdates !== undefined && (!profileUpdates || typeof profileUpdates !== 'object' || Array.isArray(profileUpdates))) {
      return res.status(400).json({ error: 'profiles must be an object keyed by profile id' });
    }
    const users = await fetchHaUsers();
    const validProfileIds = new Set(users.map(user => user.id));
    for (const [profileId, value] of Object.entries(profileUpdates || {})) {
      if (!validProfileIds.has(profileId)) return res.status(400).json({ error: `Unknown profile: ${profileId}` });
      if (!value || !isValidDailyMinutes(value.dailyMinutes)) {
        return res.status(400).json({ error: `Daily minutes for ${profileId} must be between 0 and 1440` });
      }
    }
    const result = await withHouseholdStorageLock(async () => {
      const state = readScreenTime();
      if (state.settings.pinHash) {
        const pinResult = validatePin(state, req.body.pin);
        if (!pinResult.ok) {
          writeJsonFile('screen_time.json', state);
          return pinResult;
        }
      }
      allowedBooleanKeys.forEach(key => {
        if (req.body[key] !== undefined) state.settings[key] = req.body[key];
      });
      if (req.body.defaultDailyMinutes !== undefined) {
        state.settings.defaultDailyMinutes = req.body.defaultDailyMinutes;
      }
      Object.entries(profileUpdates || {}).forEach(([profileId, value]) => {
        state.profiles[profileId] = { dailyMinutes: value.dailyMinutes };
      });
      writeJsonFile('screen_time.json', state);
      return { ok: true, settings: publicScreenTimeSettings(state.settings), profiles: state.profiles };
    });
    if (!result.ok) return res.status(result.status).json(result);
    res.json({ settings: result.settings, profiles: result.profiles });
  });

  app.put('/api/screen-time/pin', async (req, res) => {
    if (!/^\d{4,8}$/.test(String(req.body.newPin || ''))) {
      return res.status(400).json({ error: 'New PIN must be 4–8 digits' });
    }
    const result = await withHouseholdStorageLock(async () => {
      const state = readScreenTime();
      if (state.settings.pinHash) {
        const pinResult = validatePin(state, req.body.currentPin);
        if (!pinResult.ok) {
          writeJsonFile('screen_time.json', state);
          return pinResult;
        }
      }
      const salt = randomBytes(16);
      const hash = scryptSync(String(req.body.newPin), salt, 64);
      state.settings.pinSalt = salt.toString('hex');
      state.settings.pinHash = hash.toString('hex');
      state.pinFailures = { count: 0, lockedUntil: null };
      writeJsonFile('screen_time.json', state);
      return { ok: true };
    });
    if (!result.ok) return res.status(result.status).json(result);
    res.json({ success: true, pinSet: true });
  });

  app.post('/api/screen-time/grants', async (req, res) => {
    const { pin, profileId, minutes, reason } = req.body;
    if (!(await validateProfileIds([profileId]))) return res.status(400).json({ error: 'Unknown profile' });
    if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 1440) {
      return res.status(400).json({ error: 'Minutes must be a positive whole number no greater than 1440' });
    }
    if (typeof reason !== 'string' || !reason.trim()) return res.status(400).json({ error: 'A reason is required' });
    const result = await withHouseholdStorageLock(async () => {
      const state = readScreenTime();
      const pinResult = validatePin(state, pin);
      if (!pinResult.ok) {
        writeJsonFile('screen_time.json', state);
        return pinResult;
      }
      const grant = {
        id: randomUUID(),
        profileId,
        date: getServerLocalDate(),
        minutes,
        reason: reason.trim().slice(0, 160),
        createdAt: new Date().toISOString()
      };
      state.grants.push(grant);
      writeJsonFile('screen_time.json', state);
      return { ok: true, grant };
    });
    if (!result.ok) return res.status(result.status).json(result);
    res.status(201).json(result.grant);
  });

  app.post('/api/screen-time/sessions', async (req, res) => {
    const { profileId, gameId, pin } = req.body;
    const [users, todoResult] = await Promise.all([fetchHaUsers(), fetchTodoItems()]);
    if (!users.some(user => user.id === profileId)) return res.status(400).json({ error: 'Unknown profile' });
    if (todoResult.error) return res.status(500).json({ error: todoResult.error });
    const result = await withHouseholdStorageLock(async () => {
      const state = readScreenTime();
      const games = ensureGamesLibrary();
      if (!games.some(game => game.id === gameId)) return { ok: false, status: 404, error: 'Game not found' };
      const nowMs = Date.now();
      const enforcement = enforceActiveScreenTimeSession(state, nowMs);
      if (enforcement.changed) writeJsonFile('screen_time.json', state);
      if (enforcement.session) return { ok: false, status: 409, error: 'Another game session is already active' };
      const date = getServerLocalDate();
      const blocking = state.settings.enabled
        ? getScreenTimeBlocking(profileId, state.settings, todoResult.items || [], date) : [];
      if (blocking.length) {
        if (!pin) return { ok: false, status: 403, error: 'Finish assigned chores before playing', blocking };
        const pinResult = validatePin(state, pin);
        if (!pinResult.ok) {
          writeJsonFile('screen_time.json', state);
          return { ...pinResult, blocking };
        }
      }
      const totals = screenTimeTotals(state, profileId, date, nowMs);
      if (state.settings.enabled && totals.remainingSecondsExact <= 0) {
        return { ok: false, status: 403, error: 'No playtime remains today' };
      }
      const now = new Date(nowMs).toISOString();
      const session = {
        id: randomUUID(),
        profileId,
        gameId,
        startedAt: now,
        lastHeartbeatAt: now,
        endedAt: null,
        endReason: null,
        metered: state.settings.enabled
      };
      state.sessions.push(session);
      const expiresAt = getSessionExpiry(state, session, nowMs);
      writeJsonFile('screen_time.json', state);
      return {
        ok: true,
        session,
        expiresAt,
        remainingSeconds: session.metered === false ? null : totals.remainingSeconds
      };
    });
    if (!result.ok) {
      const body = { error: result.error };
      if (result.blocking) body.blocking = result.blocking;
      if (result.retryAfterSeconds) body.retryAfterSeconds = result.retryAfterSeconds;
      return res.status(result.status).json(body);
    }
    res.status(201).json({ ...result.session, expiresAt: result.expiresAt, remainingSeconds: result.remainingSeconds });
  });

  app.post('/api/screen-time/sessions/:id/heartbeat', async (req, res) => {
    const result = await withHouseholdStorageLock(async () => {
      const state = readScreenTime();
      const target = state.sessions.find(session => session.id === req.params.id);
      if (!target) return { ok: false, status: 404, error: 'Session not found' };
      const nowMs = Date.now();
      const enforcement = enforceActiveScreenTimeSession(state, nowMs);
      if (target.endedAt || enforcement.session?.id !== target.id) {
        if (enforcement.changed) writeJsonFile('screen_time.json', state);
        return { ok: false, status: 409, error: 'Session has ended', session: target };
      }
      target.lastHeartbeatAt = new Date(nowMs).toISOString();
      writeJsonFile('screen_time.json', state);
      const totals = screenTimeTotals(state, target.profileId, getServerLocalDate(), nowMs);
      return {
        ok: true,
        remainingSeconds: target.metered === false ? null : totals.remainingSeconds,
        expiresAt: getSessionExpiry(state, target, nowMs)
      };
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error, session: result.session });
    res.json({ remainingSeconds: result.remainingSeconds, expiresAt: result.expiresAt });
  });

  app.post('/api/screen-time/sessions/:id/stop', async (req, res) => {
    const result = await withHouseholdStorageLock(async () => {
      const state = readScreenTime();
      const target = state.sessions.find(session => session.id === req.params.id);
      if (!target) return null;
      if (!target.endedAt) {
        const enforcement = enforceActiveScreenTimeSession(state, Date.now());
        if (!target.endedAt) {
          target.endedAt = new Date().toISOString();
          target.endReason = typeof req.body.reason === 'string' && req.body.reason.trim()
            ? req.body.reason.trim().slice(0, 40) : 'stopped';
        }
        void enforcement;
        writeJsonFile('screen_time.json', state);
      }
      return target;
    });
    if (!result) return res.status(404).json({ error: 'Session not found' });
    res.json(result);
  });

  app.get('/api/games', async (req, res) => {
    try {
      const games = await withHouseholdStorageLock(async () => ensureGamesLibrary());
      res.json(games);
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  app.post('/api/games', async (req, res) => {
    const normalized = validateGameInput(req.body);
    if (normalized.error) return res.status(400).json({ error: normalized.error });
    const result = await withHouseholdStorageLock(async () => {
      const games = ensureGamesLibrary();
      if (games.some(game => game.url === normalized.game.url)) return { duplicate: true };
      const game = { id: randomUUID(), ...normalized.game, createdAt: new Date().toISOString() };
      games.push(game);
      writeJsonFile('games.json', games);
      return { game };
    });
    if (result.duplicate) return res.status(409).json({ error: 'That game is already in the library' });
    res.status(201).json(result.game);
  });

  app.delete('/api/games/:id', async (req, res) => {
    const result = await withHouseholdStorageLock(async () => {
      const state = readScreenTime();
      const pinResult = validatePin(state, req.body.pin);
      if (!pinResult.ok) {
        writeJsonFile('screen_time.json', state);
        return pinResult;
      }
      if (activeScreenTimeSession(state)?.gameId === req.params.id) {
        return { ok: false, status: 409, error: 'Close the active game before removing it' };
      }
      const games = ensureGamesLibrary();
      const index = games.findIndex(game => game.id === req.params.id);
      if (index < 0) return { ok: false, status: 404, error: 'Game not found' };
      const [game] = games.splice(index, 1);
      writeJsonFile('games.json', games);
      writeJsonFile('screen_time.json', state);
      return { ok: true, game };
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error, retryAfterSeconds: result.retryAfterSeconds });
    res.json(result.game);
  });

  // Enhanced diagnostics endpoint
  app.get('/api/diagnostics', (req, res) => {
    const clientPort = req.get('host')?.split(':')[1] || 'unknown';
    const clientHost = req.get('host')?.split(':')[0] || 'unknown';
    const originalUrl = req.originalUrl;
    const requestProtocol = req.protocol;
    const forwardedProto = req.get('x-forwarded-proto') || 'none';
    const forwardedHost = req.get('x-forwarded-host') || 'none';
    const forwardedFor = req.get('x-forwarded-for') || 'none';
    const userAgent = req.get('user-agent') || 'unknown';
    const baseUrl = `${requestProtocol}://${req.get('host')}`;

    // Check for Home Assistant ingress headers
    const ingressPath = req.get('x-ingress-path') || 'none';
    const hassSource = req.get('x-hass-source') || 'none';

    // Get information about the server
    const serverInfo = {
      port: PORT,
      isProduction,
      nodeEnv: process.env.NODE_ENV || 'development',
      hasSupervisorToken: !!process.env.SUPERVISOR_TOKEN,
      tokenLength: process.env.SUPERVISOR_TOKEN ? process.env.SUPERVISOR_TOKEN.length : 0,
      hasHassToken: !!process.env.HASS_TOKEN,
      hassApiUrl,
      uptime: process.uptime(),
      isIngressMode,
      ingressPath: process.env.INGRESS_PATH || '',
      ingressPort: process.env.INGRESS_PORT,
      development_mode: config.development_mode
    };

    // Debug page access control info
    const debugPageInfo = {
      debug_page_accessible: !isIngressMode || config.development_mode,
      reason: isIngressMode && !config.development_mode
        ? "Debug page is blocked in ingress mode when development_mode is disabled"
        : "Debug page is allowed (either in direct access mode or development_mode is enabled)"
    };

    // Check if we're dealing with Home Assistant ingress mode
    const isIngressRequest = ingressPath !== 'none' || hassSource === 'core.ingress';
    const detectedPortMismatch = clientPort !== String(PORT);

    res.json({
      success: true,
      message: "Diagnostic information for troubleshooting connection issues",
      client: {
        port: clientPort,
        host: clientHost,
        fullHost: req.get('host'),
        userAgent,
        ip: req.ip || req.connection.remoteAddress
      },
      request: {
        originalUrl,
        protocol: requestProtocol,
        baseUrl,
        url: req.url,
        path: req.path,
        query: req.query
      },
      headers: {
        all: req.headers,
        forwardedProto,
        forwardedHost,
        forwardedFor,
        ingressPath,
        hassSource
      },
      server: serverInfo,
      debugPage: debugPageInfo,
      portMismatch: detectedPortMismatch,
      ingressDetected: isIngressRequest,

    });
  });

  // Configuration override endpoint (development mode only)
  app.post('/api/config/override', (req, res) => {
    if (!config.development_mode) {
      return res.status(403).json({
        error: 'Configuration override is only available in development mode',
        current_mode: 'production',
        can_enable: isProduction ? false : true,
        how_to_enable: isProduction ?
          "Add 'development_mode': true to your addon configuration" :
          "Set development_mode to true in options.json"
      });
    }

    // Only allow overriding certain configuration values
    const allowedKeys = [
      'hassApiUrl',
      'weather_entity',
      'calendar_entity_id',
      'locale',
      'time_format'
    ];

    const updates = {};

    for (const key of allowedKeys) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    // Update the config object
    Object.assign(config, updates);

    // Return the updated config
    res.json({
      success: true,
      message: 'Configuration overridden for this session',
      config: config,
      note: 'These changes are temporary and will be lost on server restart'
    });
  });

  // Custom debug route for ingress testing
  app.get('/api/debug/ingress-test', (req, res) => {
    res.json({
      isIngressMode,
      ingressPort: process.env.INGRESS_PORT,
      ingressPath: process.env.INGRESS_PATH || '',
      requestPath: req.path,
      requestUrl: req.url,
      requestHeaders: req.headers,
      requestOrigin: req.get('origin') || 'none',
      requestHost: req.get('host') || 'none'
    });
  });

  // Test endpoint for API authentication
  app.get('/api/test-ha-auth', async (req, res) => {
    try {
      // Test with supervisor token
      let supervisorResult = null;
      let hassTokenResult = null;
      let directApiResult = null;

      // Test errors
      let supervisorError = null;
      let hassTokenError = null;
      let directApiError = null;

      // Get token information
      const supervisorToken = process.env.SUPERVISOR_TOKEN || '';
      const hassToken = process.env.HASS_TOKEN || '';

      // Test 1: Using supervisor token
      if (supervisorToken) {
        try {
          const response = await axios({
            method: 'GET',
            url: `${hassApiUrl}/config`,
            headers: {
              'Authorization': `Bearer ${supervisorToken}`,
              'Content-Type': 'application/json',
            }
          });
          supervisorResult = response.data;
        } catch (error) {
          supervisorError = {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data
          };
        }
      }

      // Test 2: Using HASS token
      if (hassToken) {
        try {
          const response = await axios({
            method: 'GET',
            url: `${hassApiUrl}/config`,
            headers: {
              'Authorization': `Bearer ${hassToken}`,
              'Content-Type': 'application/json',
            }
          });
          hassTokenResult = response.data;
        } catch (error) {
          hassTokenError = {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data
          };
        }
      }

      // Test 3: Using direct API call
      try {
        const apiData = await callHaApi('/config');
        directApiResult = apiData;
      } catch (error) {
        directApiError = {
          message: error.message,
          status: error.response?.status,
          data: error.response?.data
        };
      }

      res.json({
        success: true,
        tokens: {
          hasSupervisorToken: !!supervisorToken,
          supervisorTokenLength: supervisorToken.length,
          hasHassToken: !!hassToken,
          hassTokenLength: hassToken.length
        },
        results: {
          supervisorToken: supervisorResult ? { success: true, data: supervisorResult } : { success: false, error: supervisorError },
          hassToken: hassTokenResult ? { success: true, data: hassTokenResult } : { success: false, error: hassTokenError },
          directApi: directApiResult ? { success: true, data: directApiResult } : { success: false, error: directApiError }
        },
        hassApiUrl,
        isIngressMode,
        recommendedFix: !supervisorToken && !hassToken
          ? "No authentication tokens available. In production, ensure SUPERVISOR_TOKEN is provided. In development, set HASS_TOKEN in .env.local"
          : supervisorToken && supervisorError
            ? "Supervisor token is present but not working. Check that hassio_api: true is set in config.yaml"
            : hassToken && hassTokenError
              ? "HASS token is present but not working. Check that your token is valid and not expired"
              : "See detailed results for more information"
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        stack: config.development_mode ? error.stack : null
      });
    }
  });

  // Port configuration test endpoint
  app.get('/api/port-test', (req, res) => {
    const clientPort = req.get('host')?.split(':')[1] || 'unknown';
    const clientHost = req.get('host')?.split(':')[0] || 'unknown';
    const hasIngressHeaders = !!req.get('x-ingress-path') || req.get('x-hass-source') === 'core.ingress';

    res.json({
      success: true,
      server: {
        port: PORT,
        ingressPort: process.env.INGRESS_PORT || 'not set',
        expectedIngressPort: 8099,
        ingressPath: process.env.INGRESS_PATH || 'not set'
      },
      client: {
        host: clientHost,
        port: clientPort,
        fullHost: req.get('host') || 'unknown'
      },
      ingress: {
        detected: hasIngressHeaders,
        ingressPath: req.get('x-ingress-path') || 'none',
        hassSource: req.get('x-hass-source') || 'none'
      },
      portMismatch: clientPort !== String(PORT)
    });
  });

  // API endpoints for Home Assistant-based user data storage

  // Get user theme from HA
  app.get('/api/user/theme', async (req, res) => {
    try {
      const theme = await getUserTheme();
      res.json({ theme: theme });
    } catch (error) {
      console.error('[ERROR] Failed to get user theme:', error.message);
      res.status(500).json({ error: 'Failed to get theme from Home Assistant', theme: 'light' });
    }
  });

  // Set user theme in HA
  app.post('/api/user/theme', async (req, res) => {
    try {
      const { theme } = req.body;
      if (!theme) {
        return res.status(400).json({ error: 'Theme is required' });
      }

      const success = await setUserTheme(theme);
      if (success) {
        res.json({ success: true, theme: theme });
      } else {
        res.status(500).json({ error: 'Failed to save theme to Home Assistant' });
      }
    } catch (error) {
      console.error('[ERROR] Failed to set user theme:', error.message);
      res.status(500).json({ error: 'Failed to save theme to Home Assistant' });
    }
  });

  // Get display settings from HA
  app.get('/api/user/display-settings', async (req, res) => {
    try {
      const settings = await getDisplaySettings();
      res.json(settings);
    } catch (error) {
      console.error('[ERROR] Failed to get display settings:', error.message);
      res.status(500).json({
        error: 'Failed to get display settings from Home Assistant',
        // Return defaults
        autoNightMode: true,
        nightModeStart: "20:00",
        nightModeEnd: "07:00",
        screenBurnProtection: true,
        dimAfterMinutes: 10,
        displayClock: false
      });
    }
  });

  // Save display settings to HA
  app.post('/api/user/display-settings', async (req, res) => {
    try {
      const settings = req.body;
      const success = await saveDisplaySettings(settings);

      if (success) {
        res.json({ success: true, settings: settings });
      } else {
        res.status(500).json({ error: 'Failed to save display settings to Home Assistant' });
      }
    } catch (error) {
      console.error('[ERROR] Failed to save display settings:', error.message);
      res.status(500).json({ error: 'Failed to save display settings to Home Assistant' });
    }
  });

  // Get HA entity state (generic endpoint for any entity)
  app.get('/api/ha/entity/:entityId', async (req, res) => {
    try {
      const entityId = req.params.entityId;
      const entity = await callHaApi(`/states/${entityId}`);
      res.json({
        success: true,
        entity_id: entityId,
        state: entity.state,
        attributes: entity.attributes,
        last_changed: entity.last_changed,
        last_updated: entity.last_updated
      });
    } catch (error) {
      console.error(`[ERROR] Failed to get HA entity ${req.params.entityId}:`, error.message);
      res.status(404).json({
        success: false,
        error: 'Entity not found or HA API error',
        entity_id: req.params.entityId
      });
    }
  });

  // Call HA service (generic endpoint for calling any HA service)
  app.post('/api/ha/service/:domain/:service', async (req, res) => {
    try {
      const { domain, service } = req.params;
      const serviceData = req.body;

      await callHaApi(`/services/${domain}/${service}`, {
        method: 'POST',
        body: JSON.stringify(serviceData)
      });

      res.json({
        success: true,
        service: `${domain}.${service}`,
        data: serviceData
      });
    } catch (error) {
      console.error(`[ERROR] Failed to call HA service ${req.params.domain}.${req.params.service}:`, error.message);
      res.status(500).json({
        success: false,
        error: 'Failed to call Home Assistant service',
        service: `${req.params.domain}.${req.params.service}`
      });
    }
  });

  // Add diagnostic endpoint for troubleshooting add-on authentication
  app.get('/api/addon-diagnostics', async (req, res) => {
    try {
      const diagnostics = {
        environment: {
          isProduction: isProduction,
          isIngressMode: isIngressMode,
          port: PORT,
          hassApiUrl: hassApiUrl,
          ingressPath: process.env.INGRESS_PATH || 'undefined'
        },
        tokens: {
          SUPERVISOR_TOKEN: process.env.SUPERVISOR_TOKEN ? `Present (${process.env.SUPERVISOR_TOKEN.length} chars)` : 'Missing',
          HASS_TOKEN: process.env.HASS_TOKEN ? `Present (${process.env.HASS_TOKEN.length} chars)` : 'Missing',
          HASSIO_TOKEN: process.env.HASSIO_TOKEN ? `Present (${process.env.HASSIO_TOKEN.length} chars)` : 'Missing'
        },
        config: config
      };

      // Test basic HA connectivity
      try {
        const testResponse = await callHaApi('/config');
        diagnostics.haConnectivity = {
          status: 'success',
          location_name: testResponse.location_name || 'Unknown',
          version: testResponse.version || 'Unknown'
        };
      } catch (haError) {
        diagnostics.haConnectivity = {
          status: 'failed',
          error: haError.message,
          statusCode: haError.response?.status || 'Unknown'
        };
      }

      res.json(diagnostics);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to generate diagnostics',
        message: error.message
      });
    }
  });

  // API: Force Sync CalDAV Accounts
  app.post('/api/caldav/sync', express.json(), async (req, res) => {
    try {
      const caldavService = require('./scripts/caldav-service');
      const accounts = caldavService.getAccounts();
      const results = [];
      let totalEvents = 0;

      for (const account of accounts) {
        try {
          await caldavService.fetchCalendars(account.id);
        } catch (e) {
          results.push(`[ERROR] Account ${account.appleId}: Failed fetching calendar list - ${e.message}`);
        }
      }

      const allEvents = await caldavService.fetchAllEvents(getCalendarRange());
      const counts = allEvents.reduce((acc, ev) => {
        acc[ev.calendarName] = (acc[ev.calendarName] || 0) + 1;
        return acc;
      }, {});

      for (const [calName, count] of Object.entries(counts)) {
        results.push(`[SUCCESS] Synced ${count} events from "${calName}"`);
      }

      if (allEvents.length === 0) {
        results.push(`[WARNING] Synced 0 events across all calendars.`);
      }

      res.json({ success: true, logs: results, total: allEvents.length });
    } catch (err) {
      console.error('CalDAV Sync Error:', err);
      res.status(500).json({ success: false, error: err.message, logs: [`[FATAL] ${err.message}`] });
    }
  });

  // Start the server
  server.listen(PORT, () => {
    console.log("[INFO] Server running on port " + PORT);
    console.log("[INFO] Environment: " + (isProduction ? 'Production' : 'Development'));
    if (!isProduction) {
      console.log(`[INFO] ====== DEVELOPMENT MODE ======`);
      console.log(`[INFO] Access the application at: http://localhost:${PORT}`);
      console.log(`[INFO] This port (${PORT}) is different from the installed addon (8099) to avoid conflicts`);
      console.log(`[INFO] ================================`);
    }
    if (isIngressMode) {
      console.log("[INFO] Running in Home Assistant ingress mode");
    }

    console.log("[INFO] Development mode: " + (config.development_mode ? "ENABLED" : "DISABLED"));

    // In production mode with kiosk_mode enabled, start the web browser
    if (isProduction && config.kiosk_mode) {
      console.log('[INFO] Starting kiosk mode...');
      try {
        // Insert your browser startup code here if needed
      } catch (error) {
        console.error('[ERROR] Failed to start kiosk mode:', error);
      }
    }
  });

  return { app, server, io };
}

// Start the application
initializeApp()
  .then(() => {
    console.log("[INFO] Application initialized successfully");
  })
  .catch(error => {
    console.error('[FATAL] Failed to initialize application:', error);
    process.exit(1);
  });

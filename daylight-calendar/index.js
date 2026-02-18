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
  async function callHaApi(apiPath, fetchOptions = {}) {
    const url = hassApiUrl + apiPath; // apiPath should start with a slash
    const method = fetchOptions.method || 'GET';

    // Get the token with additional debugging
    const token = process.env.SUPERVISOR_TOKEN || process.env.HASS_TOKEN || '';
    const tokenType = process.env.SUPERVISOR_TOKEN ? 'SUPERVISOR_TOKEN' :
      process.env.HASS_TOKEN ? 'HASS_TOKEN' : 'NO TOKEN';

    // Create headers based on environment
    let headers = {
      'Content-Type': 'application/json',
      ...(fetchOptions.headers || {}),
    };

    // In production (add-on mode), use supervisor token with X-Supervisor-Token header
    if (isProduction && process.env.SUPERVISOR_TOKEN) {
      headers['X-Supervisor-Token'] = process.env.SUPERVISOR_TOKEN;
      console.log(`[INFO] Using supervisor token authentication`);
    } else if (token) {
      // In development or ingress mode, use Bearer token
      headers['Authorization'] = `Bearer ${token}`;
      console.log(`[INFO] Using Bearer token authentication`);
    } else {
      console.warn(`[WARN] No authentication token available!`);
    }

    // Create axios config
    const axiosConfig = {
      method: method,
      url: url,
      headers: headers
    };

    // Add data if present (axios uses 'data' instead of 'body')
    if (fetchOptions.body) {
      axiosConfig.data = typeof fetchOptions.body === 'string'
        ? fetchOptions.body
        : fetchOptions.body;
    }

    console.log(`[INFO] Fetching from HA API: ${method} ${url}`);
    console.log(`[INFO] Using token type: ${tokenType}, length: ${token.length}`);

    if (axiosConfig.data) {
      console.log(`[DEBUG] Request data: ${typeof axiosConfig.data === 'string' ? axiosConfig.data : JSON.stringify(axiosConfig.data)}`);
    }

    try {
      const response = await axios(axiosConfig);
      return response.data;
    } catch (error) {
      console.error(`[ERROR] Home Assistant API request to ${apiPath} failed:`, error.message);
      if (error.response) {
        console.error(`[ERROR] Status: ${error.response.status} ${error.response.statusText}`);
        console.error(`[ERROR] Response data:`, error.response.data);

        // If we get 401 with supervisor token, try different approaches
        if (error.response.status === 401 && isProduction) {
          console.log(`[INFO] 401 error in production - trying alternative authentication methods`);

          // Log current environment for debugging
          console.log(`[DEBUG] Environment variables:`, {
            SUPERVISOR_TOKEN: process.env.SUPERVISOR_TOKEN ? `${process.env.SUPERVISOR_TOKEN.substring(0, 10)}...` : 'undefined',
            HASSIO_TOKEN: process.env.HASSIO_TOKEN ? `${process.env.HASSIO_TOKEN.substring(0, 10)}...` : 'undefined',
            HOME_ASSISTANT_API: process.env.HOME_ASSISTANT_API || 'undefined'
          });

          // Try alternative API endpoints for add-ons
          const alternativeUrls = [
            'http://homeassistant:8123/api',
            'http://supervisor/core/api',
            'http://hassio/homeassistant/api'
          ];

          console.log(`[INFO] Will try alternative endpoints: ${alternativeUrls.join(', ')}`);
        }
      }
      throw error;
    }
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

  // Function to fetch calendar data
  async function fetchCalendarData() {
    // In standalone mode, return mock data
    if (isStandaloneDev) {
      try {
        const mockPath = path.join(__dirname, 'mock-data', 'calendar.json');
        const mockData = JSON.parse(fs.readFileSync(mockPath, 'utf8'));
        console.log(`[MOCK] Returning ${mockData.events.length} mock calendar events`);
        return mockData.events;
      } catch (e) {
        console.warn('[MOCK] Could not load mock calendar data:', e.message);
        return [];
      }
    }

    if (!config.calendar_entity_id) {
      console.log('[INFO] No calendar_entity_id configured, skipping calendar data fetch.');
      return [];
    }
    try {
      const now = new Date();
      const start_time = now.toISOString();
      const end_time = new Date(now.getTime() + (config.calendar_days_to_show || 7) * 24 * 60 * 60 * 1000).toISOString();
      const apiPath = "/calendars/" + config.calendar_entity_id + "?start=" + start_time + "&end=" + end_time;

      console.log("[INFO] Fetching calendar data from: " + hassApiUrl + apiPath);

      const data = await callHaApi(apiPath);
      console.log('[INFO] Successfully fetched calendar data.');
      return data || []; // Return empty array if data is null/undefined
    } catch (error) {
      console.error('[ERROR] Error fetching calendar data:', error.message);
      console.error("[ERROR] Calendar API Response Status: " + (error.status || 'N/A'));
      console.error("[ERROR] Calendar API Response Data: " + (error.data || 'N/A'));
      return []; // Return empty array on error
    }
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

        // Extract forecast from the entity's attributes
        const forecast = currentState.attributes?.forecast || [];

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

  // Function to fetch todo items
  async function fetchTodoItems() {
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
      development_mode: config.development_mode
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
      const calendarData = await fetchCalendarData();
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
      const calendarData = await fetchCalendarData();
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
      res.json(result);
    } catch (error) {
      console.error('[ERROR] Error in GET /api/chores:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/chores', async (req, res) => {
    const { item, entityId } = req.body;
    if (!item) {
      return res.status(400).json({ error: 'Item title is required' });
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
      await callHaApi('/services/todo/add_item', {
        method: 'POST',
        body: JSON.stringify({
          entity_id: targetEntityId,
          item: item
        })
      });
      res.json({ success: true });
    } catch (error) {
      console.error('[ERROR] Error in POST /api/chores:', error.message);
      res.status(500).json({ error: error.message });
    }
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
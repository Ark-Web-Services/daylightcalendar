// Daylight Calendar v1.1.8.7
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
        kiosk_mode: false,
        development_mode: false  // Default to false
      };
      console.log("Using hardcoded default configuration for debugging.");
    }
  }

  // Ensure development_mode is in config (default to false if not defined)
  config.development_mode = config.development_mode === true;

  // Force development mode in non-production environments
  if (!isProduction) {
    config.development_mode = true;
  }

  if (config.development_mode) {
    console.log("[INFO] Running in DEVELOPMENT mode - debug features enabled");
  }

  const DEV_PORT = 3001; // Port for backend during local development when using webpack-dev-server
  const PROD_PORT = process.env.PORT || 8099; // Original port logic for production/addon
  const INGRESS_PORT = process.env.INGRESS_PORT || 8099; // Port for Home Assistant ingress

  const PORT = isIngressMode ? INGRESS_PORT : isProduction ? PROD_PORT : DEV_PORT;

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
  }

  // Home Assistant API connection setup
  const hassApiUrl = isProduction
    ? 'http://supervisor/core/api'
    : process.env.HASS_API_URL || 'http://localhost:8123/api'; // Standard HA port

  // Data directories setup
  const dataDir = isProduction ? '/data' : path.join(__dirname, 'data');

  // Ensure data directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`Created data directory at ${dataDir}`);
  }

  // Helper function to get data file path
  const getDataPath = (filename) => {
    return path.join(dataDir, filename);
  };

  /**
   * Helper function to make HA API calls using axios
   */
  async function callHaApi(apiPath, fetchOptions = {}) {
    const url = hassApiUrl + apiPath; // apiPath should start with a slash
    const method = fetchOptions.method || 'GET';

    // Create axios config
    const axiosConfig = {
      method: method,
      url: url,
      headers: {
        Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN || process.env.HASS_TOKEN || ''}`,
        'Content-Type': 'application/json',
        ...(fetchOptions.headers || {}),
      }
    };

    // Add data if present (axios uses 'data' instead of 'body')
    if (fetchOptions.body) {
      axiosConfig.data = typeof fetchOptions.body === 'string'
        ? fetchOptions.body
        : fetchOptions.body;
    }

    console.log(`[INFO] Fetching from HA API: ${method} ${url}`);

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
      }
      throw error;
    }
  }

  // Function to fetch calendar data
  async function fetchCalendarData() {
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
      // First, try to get the current weather state
      console.log(`[INFO] Attempting to fetch weather state from: ${hassApiUrl}/states/${weatherEntityId}`);

      // Log auth token availability (without exposing the actual token)
      const hasToken = !!(process.env.SUPERVISOR_TOKEN || process.env.HASS_TOKEN);
      console.log(`[INFO] Authentication token available: ${hasToken ? 'Yes' : 'No'}`);

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
      console.error('[ERROR] Error fetching weather data:', error.message);

      // Check for specific error types
      if (error.response) {
        if (error.response.status === 401) {
          console.error('[ERROR] Authentication error (401) when fetching weather data. Check your token.');
          return createFallbackWeatherData('unavailable', 'Authentication error when fetching weather data');
        } else if (error.response.status === 404) {
          console.error(`[ERROR] Weather entity '${weatherEntityId}' not found (404). Check entity ID in configuration.`);
          return createFallbackWeatherData('unavailable', `Weather entity '${weatherEntityId}' not found`);
        }
      }

      return createFallbackWeatherData('error', error.message);
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

  // Initialize default data files
  function initializeDataFile(filename, defaultData) {
    const filePath = getDataPath(filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
      console.log(`Initialized ${filename} with default data`);
    }
  }

  // Initialize default data files only in dev mode or on first run
  if (config.development_mode) {
    // Default chores (dev only)
    initializeDataFile('chores.json', [
      {
        id: "dev-1",
        name: "Example Chore (Dev Only)",
        assigneeName: "Developer",
        dueDate: "2024-05-20",
        completed: false,
        rewardPoints: 10
      }
    ]);

    // Default users (dev only)
    initializeDataFile('users.json', [
      {
        id: "dev-1",
        name: "Developer",
        color: "#4285f4",
        icon: "fa-user"
      }
    ]);

    // Default meal categories (dev only)
    initializeDataFile('meal-categories.json', [
      {
        id: "dev-1",
        name: "Breakfast",
        color: "#4285f4",
        icon: "fa-coffee"
      },
      {
        id: "dev-2",
        name: "Lunch",
        color: "#34a853",
        icon: "fa-hamburger"
      },
      {
        id: "dev-3",
        name: "Dinner",
        color: "#fbbc05",
        icon: "fa-utensils"
      }
    ]);

    // Initialize empty meals
    initializeDataFile('meals.json', []);

    // Initialize empty grocery list
    initializeDataFile('grocery-list.json', []);

    // Initialize empty recipes
    initializeDataFile('recipes.json', []);

    // Initialize display settings with defaults
    initializeDataFile('display-settings.json', {
      autoNightMode: true,
      nightModeStart: "20:00",
      nightModeEnd: "07:00",
      screenBurnProtection: true,
      dimAfterMinutes: 10,
      displayClock: false
    });
  }
  // Always initialize critical files even in production, to prevent API errors
  else {
    // In production, initialize with empty arrays to prevent errors
    initializeDataFile('chores.json', []);
    initializeDataFile('users.json', []);
    initializeDataFile('meal-categories.json', []);
    initializeDataFile('meals.json', []);
    initializeDataFile('grocery-list.json', []);
    initializeDataFile('recipes.json', []);

    // Default display settings for production
    initializeDataFile('display-settings.json', {
      autoNightMode: true,
      nightModeStart: "20:00",
      nightModeEnd: "07:00",
      screenBurnProtection: true,
      dimAfterMinutes: 10,
      displayClock: false
    });
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
          hassApiUrl,
          dataDir
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

  // Helper function to write data to a file
  const writeDataFile = (filename, data, res, successCallback) => {
    const filePath = getDataPath(filename);
    fs.writeFile(filePath, JSON.stringify(data, null, 2), (err) => {
      if (err) {
        console.error(`[ERROR] Error writing ${filename}:`, err);
        return res.status(500).json({ error: `Failed to save ${filename.replace('.json', '')} data` });
      }
      successCallback();
    });
  };

  // Generic data file handler
  const handleDataFile = (filename) => {
    return (req, res) => {
      const filePath = getDataPath(filename);
      fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
          if (filename === 'chores.json' || filename === 'users.json' ||
              filename === 'meal-categories.json' || filename === 'meals.json' ||
              filename === 'recipes.json' || filename === 'grocery-list.json') {
            return res.json([]);
          }
          return res.status(500).json({ error: `Failed to load ${filename.replace('.json', '')} data` });
        }

        try {
          const jsonData = JSON.parse(data);

          // Ensure data that should be arrays is actually an array
          if ((filename === 'chores.json' || filename === 'users.json' ||
               filename === 'meal-categories.json' || filename === 'meals.json' ||
               filename === 'recipes.json' || filename === 'grocery-list.json') &&
              !Array.isArray(jsonData)) {
            console.warn(`[WARN] ${filename} did not contain an array as expected, returning empty array`);
            return res.json([]);
          }

          res.json(jsonData);
        } catch (parseError) {
          console.error(`[ERROR] Error parsing ${filename}:`, parseError);
          if (filename === 'chores.json' || filename === 'users.json' ||
              filename === 'meal-categories.json' || filename === 'meals.json' ||
              filename === 'recipes.json' || filename === 'grocery-list.json') {
            return res.json([]);
          }
          res.status(500).json({ error: `Failed to parse ${filename.replace('.json', '')} data` });
        }
      });
    };
  };

  // Data file routes
  app.get('/api/chores', handleDataFile('chores.json'));
  app.get('/api/users', handleDataFile('users.json'));
  app.get('/api/meal-categories', handleDataFile('meal-categories.json'));
  app.get('/api/meals', handleDataFile('meals.json'));
  app.get('/api/recipes', handleDataFile('recipes.json'));
  app.get('/api/grocery-list', handleDataFile('grocery-list.json'));
  app.get('/api/display-settings', handleDataFile('display-settings.json'));

  // POST endpoint to add a new chore
  app.post('/api/chores', (req, res) => {
    const filePath = getDataPath('chores.json');
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err && !fs.existsSync(path.dirname(filePath))) {
        // If directory doesn't exist, create it
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        data = '[]'; // Initialize with empty array
      } else if (err) {
        console.error('[ERROR] Error reading chores.json for POST:', err);
        return res.status(500).json({ error: 'Failed to read chores data' });
      }

      try {
        const chores = err ? [] : JSON.parse(data);
        const newChore = {
          id: Date.now().toString(),
          name: req.body.name,
          assigneeName: req.body.assigneeName,
          dueDate: req.body.dueDate,
          completed: false,
          rewardPoints: req.body.rewardPoints || 10 // Default to 10 points if not specified
        };
        chores.push(newChore);

        writeDataFile('chores.json', chores, res, () => {
          res.status(201).json(newChore);
        });
      } catch (parseErr) {
        console.error('[ERROR] Error parsing chores.json:', parseErr);
        res.status(500).json({ error: 'Invalid chores data format' });
      }
    });
  });

  // DELETE endpoint to remove a chore
  app.delete('/api/chores/:id', (req, res) => {
    const filePath = getDataPath('chores.json');
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) {
        console.error('[ERROR] Error reading chores.json for DELETE:', err);
        return res.status(500).json({ error: 'Failed to read chores data' });
      }
      try {
        let chores = JSON.parse(data);
        const originalLength = chores.length;
        chores = chores.filter(chore => chore.id !== req.params.id);

        if (chores.length === originalLength) {
          return res.status(404).json({ error: 'Chore not found' });
        }

        writeDataFile('chores.json', chores, res, () => {
          res.status(200).json({ message: 'Chore deleted successfully' });
        });
      } catch (err) {
        console.error('[ERROR] Error parsing chores.json:', err);
        res.status(500).json({ error: 'Invalid chores data format' });
      }
    });
  });

  // PATCH endpoint to update a chore
  app.patch('/api/chores/:id', (req, res) => {
    const filePath = getDataPath('chores.json');
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) {
        console.error('[ERROR] Error reading chores.json for PATCH:', err);
        return res.status(500).json({ error: 'Failed to read chores data' });
      }
      try {
        let chores = JSON.parse(data);
        const choreIndex = chores.findIndex(chore => chore.id === req.params.id);

        if (choreIndex === -1) {
          return res.status(404).json({ error: 'Chore not found' });
        }

        // Update the chore with the provided fields
        chores[choreIndex] = { ...chores[choreIndex], ...req.body };

        writeDataFile('chores.json', chores, res, () => {
          res.status(200).json(chores[choreIndex]);
        });
      } catch (err) {
        console.error('[ERROR] Error parsing chores.json:', err);
        res.status(500).json({ error: 'Invalid chores data format' });
      }
    });
  });

  // API proxy for Home Assistant
  app.get('/api/ha-proxy', async (req, res) => {
    const endpoint = req.query.endpoint;
    if (!endpoint) {
      return res.status(400).json({ error: 'Missing endpoint parameter' });
    }

    try {
      const apiPath = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
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

    // Get information about the server
    const serverInfo = {
      port: PORT,
      isProduction,
      nodeEnv: process.env.NODE_ENV || 'development',
      hasSupervisorToken: !!process.env.SUPERVISOR_TOKEN,
      hasHassToken: !!process.env.HASS_TOKEN,
      hassApiUrl,
      dataDir,
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
        forwardedFor
      },
      server: serverInfo,
      debugPage: debugPageInfo,
      portMismatch: clientPort !== String(PORT),
      suggestedFixes: [
        "If using Home Assistant ingress, check that the ingress port matches the container port (8099)",
        "Update the port configuration in webpack.config.js if developing locally",
        "Make sure proxy settings in webpack.config.js point to the correct backend URL",
        "Check Home Assistant addon configuration to ensure ports are correctly mapped"
      ]
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

  // Start the server
  server.listen(PORT, () => {
    console.log("[INFO] Server running on port " + PORT);
    console.log("[INFO] Environment: " + (isProduction ? 'Production' : 'Development'));
    if (!isProduction) {
      console.log(`[INFO] webpack-dev-server is expected to be running on http://localhost:8099 and proxying to this backend on ${PORT}`);
    }
    if (isIngressMode) {
      console.log("[INFO] Running in Home Assistant ingress mode");
    }
    console.log("[INFO] Data directory: " + dataDir);
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
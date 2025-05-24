// Daylight Calendar v1.1.7.1
// A beautiful fullscreen calendar display for Home Assistant
// Copyright (c) 2024

// Load environment variables from .env.local if not in production (SUPERVISOR_TOKEN is undefined)
if (process.env.SUPERVISOR_TOKEN === undefined) {
  try {
    require('dotenv').config({ path: require('path').join(__dirname, '.env.local') });
    console.log("Loaded .env.local for development.");
  } catch (e) {
    console.warn("Could not load .env.local. Proceeding without it for development if SUPERVISOR_TOKEN is also missing.");
  }
}

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const axios = require('axios');
const fs = require('fs');
const { exec } = require('child_process');
const fetch = require('node-fetch');

// Configuration
let config;
const localOptionsPath = path.join(__dirname, 'options.json');
const supervisorOptionsPath = '/data/options.json';
const isProduction = process.env.SUPERVISOR_TOKEN !== undefined;

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
    config = { theme: "light", show_weather: true, locale: "en-US", time_format: "12h", kiosk_mode: false };
    console.log("Using hardcoded default configuration for debugging.");
  }
}

const DEV_PORT = 3001; // Port for backend during local development when using webpack-dev-server
const PROD_PORT = process.env.PORT || 8099; // Original port logic for production/addon

const PORT = isProduction ? PROD_PORT : DEV_PORT;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Home Assistant API connection setup
const hassApiUrl = isProduction
  ? 'http://supervisor/core/api'
  : process.env.HASS_API_URL || 'http://localhost:7123/api'; // Ensure 7123 is default for dev if not set

// Recreate hassHeaders each time to ensure it has the latest token
const getHassHeaders = () => {
  console.log(`[DEBUG] SUPERVISOR_TOKEN exists: ${!!process.env.SUPERVISOR_TOKEN}`);
  console.log(`[DEBUG] HASS_TOKEN exists: ${!!process.env.HASS_TOKEN}`);
  console.log(`[DEBUG] HASS_TOKEN value length: ${process.env.HASS_TOKEN ? process.env.HASS_TOKEN.length : 0}`);
  console.log(`[DEBUG] HASS_TOKEN first characters: ${process.env.HASS_TOKEN ? process.env.HASS_TOKEN.substring(0, 20) : 'N/A'}`);

  const token = process.env.SUPERVISOR_TOKEN || process.env.HASS_TOKEN;
  console.log(`[DEBUG] Final token chosen: ${token ? (token.substring(0, 20) + '...') : 'MISSING TOKEN'}`);

  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
};

// For backward compatibility with existing code
const hassHeaders = getHassHeaders();

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

// Helper function to initialize data files with defaults if they don't exist
const initializeDataFile = (filename, defaultData) => {
  const filePath = getDataPath(filename);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
    console.log(`Initialized ${filename} with default data`);
  }
};

// Initialize default data files only in dev mode or on first run
if (!isProduction) {
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

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/config', (req, res) => {
  res.json(config);
});

// Generic data file handler function
const handleDataFile = (filename, fallbackFile) => {
  return (req, res) => {
    const filePath = getDataPath(filename);
    const fallbackPath = path.join(__dirname, 'public', fallbackFile || filename);

    // In production, always use the data directory file
    // In development, fallback to the public directory file if needed
    const resolvedPath = fs.existsSync(filePath) ? filePath :
                        (!isProduction && fs.existsSync(fallbackPath)) ? fallbackPath : filePath;

    fs.readFile(resolvedPath, 'utf8', (err, data) => {
      if (err) {
        console.error(`[ERROR] Error reading ${filename}:`, err);
        return res.status(500).json({ error: `Failed to load ${filename.replace('.json', '')} data` });
      }
      try {
        const jsonData = JSON.parse(data);
        res.json(jsonData);
      } catch (parseError) {
        console.error(`[ERROR] Error parsing ${filename}:`, parseError);
        res.status(500).json({ error: `Failed to parse ${filename.replace('.json', '')} data` });
      }
    });
  };
};

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

// GET endpoint for chores
app.get('/api/chores', handleDataFile('chores.json'));

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

// GET endpoint for users
app.get('/api/users', handleDataFile('users.json'));

// GET endpoint for meal categories
app.get('/api/meal-categories', handleDataFile('meal-categories.json'));

// GET endpoint for meals
app.get('/api/meals', handleDataFile('meals.json'));

// GET endpoint for recipes
app.get('/api/recipes', handleDataFile('recipes.json'));

// GET endpoint for a single recipe by ID
app.get('/api/recipes/:id', (req, res) => {
  const filePath = getDataPath('recipes.json');
  const fallbackPath = path.join(__dirname, 'public', 'recipes.json');

  const resolvedPath = fs.existsSync(filePath) ? filePath :
                      (!isProduction && fs.existsSync(fallbackPath)) ? fallbackPath : filePath;

  fs.readFile(resolvedPath, 'utf8', (err, data) => {
    if (err) {
      console.error(`[ERROR] Error reading recipes.json:`, err);
      return res.status(500).json({ error: 'Failed to load recipe data' });
    }

    try {
      const recipes = JSON.parse(data);
      const recipe = recipes.find(r => r.id === req.params.id);

      if (!recipe) {
        return res.status(404).json({ error: 'Recipe not found' });
      }

      res.json(recipe);
    } catch (parseError) {
      console.error(`[ERROR] Error parsing recipes.json:`, parseError);
      res.status(500).json({ error: 'Failed to parse recipe data' });
    }
  });
});

// GET endpoint for grocery list
app.get('/api/grocery-list', handleDataFile('grocery-list.json'));

// GET endpoint for display settings
app.get('/api/display-settings', (req, res) => {
  const filePath = getDataPath('display-settings.json');

  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      res.json(JSON.parse(data));
    } else {
      // Default settings if file doesn't exist
      const defaultSettings = {
        autoNightMode: true,
        nightModeStart: "20:00",
        nightModeEnd: "07:00",
        screenBurnProtection: true,
        dimAfterMinutes: 10,
        displayClock: false
      };

      // Create directory if it doesn't exist
      if (!fs.existsSync(path.dirname(filePath))) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
      }

      // Write default settings to file
      fs.writeFileSync(filePath, JSON.stringify(defaultSettings, null, 2));
      res.json(defaultSettings);
    }
  } catch (error) {
    console.error('[ERROR] Error processing display settings:', error);
    res.status(500).json({ error: 'Failed to process display settings' });
  }
});

// Update display settings
app.post('/api/display-settings', (req, res) => {
  const filePath = getDataPath('display-settings.json');

  try {
    // Create directory if it doesn't exist
    if (!fs.existsSync(path.dirname(filePath))) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }

    // Validate and sanitize settings
    const settings = {
      autoNightMode: !!req.body.autoNightMode,
      nightModeStart: req.body.nightModeStart || "20:00",
      nightModeEnd: req.body.nightModeEnd || "07:00",
      screenBurnProtection: !!req.body.screenBurnProtection,
      dimAfterMinutes: Math.max(1, Math.min(60, parseInt(req.body.dimAfterMinutes) || 10)),
      displayClock: !!req.body.displayClock
    };

    // Write settings to file
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));

    // Broadcast settings update to all clients
    io.emit('display_settings_update', settings);

    res.json(settings);
  } catch (error) {
    console.error('[ERROR] Error saving display settings:', error);
    res.status(500).json({ error: 'Failed to save display settings' });
  }
});

// Re-enable API routes with proper error handling that depend on Home Assistant
app.get('/api/calendar', async (req, res) => {
  try {
    // Use the existing fetchCalendarData function which uses callHaApi
    const calendarData = await fetchCalendarData();
    if (calendarData) {
      res.json(calendarData);
    } else {
      // fetchCalendarData already logs errors and returns [] or null on failure.
      // Send a generic error if it still comes back as null/undefined here.
      res.status(500).json({
        error: 'Failed to fetch calendar data using fetchCalendarData function',
        details: 'Check server logs for specific errors from callHaApi or fetchCalendarData.'
      });
    }
  } catch (error) {
    // This catch block is for unexpected errors specifically within this route handler itself.
    console.error('[ERROR] Unexpected error in /api/calendar route handler:', error.message);
    res.status(500).json({
      error: 'Unexpected internal server error in /api/calendar route',
      details: error.message
    });
  }
});

app.get('/api/weather', async (req, res) => {
  if (!config || !config.show_weather) {
    console.log('[INFO] Weather display is disabled in config.');
    return res.json({ enabled: false, note: "Weather display disabled in configuration." });
  }

  try {
    // Use the existing fetchWeatherData function which uses callHaApi
    const weatherData = await fetchWeatherData();

    if (weatherData && weatherData.current) { // Check if current weather data is present
      // Log the weather data structure to help with debugging
      console.log('[DEBUG] Weather data structure from fetchWeatherData:', JSON.stringify(weatherData, null, 2));

      // Ensure current weather data has the expected structure for temperature
      if (weatherData.current.attributes &&
          typeof weatherData.current.attributes.temperature === 'number') {
        console.log("[INFO] Weather temperature from fetchWeatherData: " + weatherData.current.attributes.temperature);
        // Format temperature with appropriate units
        const tempUnit = weatherData.current.attributes.temperature_unit || '°C';
        // Add formatted_temperature to the current object if desired, or handle in frontend
        weatherData.current.formatted_temperature = Math.round(weatherData.current.attributes.temperature) + tempUnit;
        res.json(weatherData); // Send the whole object { current: ..., forecast: ... }
      } else {
        console.warn('[WARN] Weather data (current) missing temperature attribute from fetchWeatherData');
        res.json({
          ...(weatherData || {}), // Send what we have
          current: {
            ...(weatherData ? weatherData.current : {}),
            formatted_temperature: 'N/A',
            _warning: 'Temperature data is missing or invalid in current conditions'
          }
        });
      }
    } else {
      console.error('[ERROR] Failed to fetch weather data using fetchWeatherData function or data was incomplete.');
      res.status(500).json({
        error: 'Failed to fetch weather data',
        details: 'fetchWeatherData function returned null or incomplete data. Check server logs.'
      });
    }
  } catch (error) {
    // This catch block is for unexpected errors specifically within this route handler itself.
    console.error('[ERROR] Unexpected error in /api/weather route handler:', error.message);
    res.status(500).json({
      error: 'Unexpected internal server error in /api/weather route',
      details: error.message
    });
  }
});

// Start the server
server.listen(PORT, () => {
  console.log("[INFO] Server running on port " + PORT);
  console.log("[INFO] Environment: " + (isProduction ? 'Production' : 'Development'));
  if (!isProduction) {
    console.log(`[INFO] webpack-dev-server is expected to be running on http://localhost:8099 and proxying to this backend on ${PORT}`);
  }
  console.log("[INFO] Data directory: " + dataDir);

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

/**
 * Helper function to make HA API calls using axios
 * @param {string} apiPath The API path (e.g., '/calendars', '/states/entity.id').
 * @param {object} fetchOptions Standard fetch options (method, body, etc.).
 * @returns {Promise<any>} The JSON response from the API.
 */
async function callHaApi(apiPath, fetchOptions = {}) {
  const url = hassApiUrl + apiPath; // apiPath should start with a slash
  const method = fetchOptions.method || 'GET';

  // Create axios config
  const axiosConfig = {
    method: method,
    url: url,
    headers: {
      ...getHassHeaders(), // Get fresh headers with token
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

    // Return the data directly (axios already parses JSON)
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
    console.log("[DEBUG] Using headers for calendar: " + JSON.stringify(getHassHeaders()));

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

  // IMPORTANT: Use the configured weather entity ID or fall back to "weather.home"
  const weatherEntityId = config.weather_entity_id || "weather.home";

  if (!weatherEntityId) {
    console.log('[INFO] No weather_entity_id configured, skipping weather data fetch.');
    return null;
  }

  try {
    console.log(`[INFO] Fetching weather data for entity: ${weatherEntityId}`);

    // First, try to get the current weather state
    const currentState = await callHaApi("/states/" + weatherEntityId);

    if (!currentState) {
      console.error(`[ERROR] Failed to fetch weather state for ${weatherEntityId}`);
      return null;
    }

    console.log(`[INFO] Successfully fetched weather state for ${weatherEntityId}`);

    // Extract forecast from the entity's attributes
    const forecast = currentState.attributes.forecast || [];

    // Return both current state and forecast
    return {
      current: currentState,
      forecast: forecast
    };
  } catch (error) {
    console.error('[ERROR] Error fetching weather data:', error.message);
    return null;
  }
}

// Function to send initial data to a newly connected client
// ... existing code ...

app.get('/api/combined-data', async (req, res) => {
  try {
    const calendarData = await fetchCalendarData();
    const weatherData = await fetchWeatherData();
    res.json({
      calendarData: calendarData || { error: "Could not fetch calendar data"}, // Provide some fallback
      weatherData: weatherData || { error: "Could not fetch weather data or entity not configured"} // Provide some fallback
    });
  } catch (error) { // This catch might be redundant if sub-functions handle errors and return null
    console.error('[ERROR] Error in /api/combined-data endpoint:', error.message);
    res.status(500).json({ error: 'Failed to fetch combined data from Home Assistant' });
  }
});
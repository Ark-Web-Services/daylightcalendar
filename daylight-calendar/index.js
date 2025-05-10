// Daylight Calendar v1.1.7
// A beautiful fullscreen calendar display for Home Assistant
// Copyright (c) 2024

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const axios = require('axios');
const fs = require('fs');
const { exec } = require('child_process');

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

const PORT = process.env.PORT || 8099;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Home Assistant API connection setup
const hassApiUrl = isProduction 
  ? 'http://supervisor/core/api' 
  : process.env.HASS_API_URL || 'http://localhost:8123/api';

const hassHeaders = {
  Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN || process.env.HASS_TOKEN}`,
  'Content-Type': 'application/json',
};

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
    console.log(`[INFO] Fetching calendar data from: ${hassApiUrl}/calendars`);
    const response = await axios.get(`${hassApiUrl}/calendars`, { 
      headers: hassHeaders,
      timeout: 10000 // 10 second timeout
    });
    
    if (response.status === 200) {
      res.json(response.data);
    } else {
      console.error(`[ERROR] Calendar API returned status: ${response.status}`);
      res.status(response.status).json({ 
        error: 'Failed to fetch calendar data', 
        statusCode: response.status
      });
    }
  } catch (error) {
    console.error('[ERROR] Error fetching calendar data:', error.message);
    
    if (error.response) {
      console.error('[ERROR] Calendar API Response Status:', error.response.status);
      console.error('[ERROR] Calendar API Response Data:', error.response.data);
      
      res.status(error.response.status).json({ 
        error: 'Failed to fetch calendar data', 
        details: error.response.data,
        statusCode: error.response.status
      });
    } else if (error.request) {
      console.error('[ERROR] No response received from calendar API');
      res.status(500).json({ 
        error: 'No response received from Home Assistant calendar API', 
        details: 'Request was made but no response was received'
      });
    } else {
      res.status(500).json({ 
        error: 'Failed to fetch calendar data', 
        details: error.message
      });
    }
  }
});

app.get('/api/weather', async (req, res) => {
  if (!config || !config.show_weather) {
    console.log('[INFO] Weather display is disabled in config.');
    return res.json({ enabled: false });
  }
  
  try {
    // Use configured entity or default to weather.forecast_home
    const weatherEntity = config.weather_entity || 'weather.forecast_home';
    console.log(`[INFO] Fetching weather data for entity: ${weatherEntity}`);
    
    const response = await axios.get(`${hassApiUrl}/states/${weatherEntity}`, { 
      headers: hassHeaders,
      timeout: 10000 // 10 second timeout
    });
    
    if (response.status === 200 && response.data) {
      // Ensure weather data has the expected structure
      const weatherData = response.data;
      
      // Log the weather data structure to help with debugging
      console.log('[DEBUG] Weather data structure:', JSON.stringify(weatherData, null, 2));
      
      // Check if we have valid temperature data
      if (weatherData.attributes && 
          typeof weatherData.attributes.temperature === 'number') {
        
        console.log(`[INFO] Weather temperature: ${weatherData.attributes.temperature}`);
        
        // Format temperature with appropriate units
        const tempUnit = weatherData.attributes.temperature_unit || '°C';
        weatherData.formatted_temperature = `${Math.round(weatherData.attributes.temperature)}${tempUnit}`;
        
        res.json(weatherData);
      } else {
        console.warn('[WARN] Weather data missing temperature attribute');
        res.json({
          ...weatherData,
          formatted_temperature: 'N/A',
          _warning: 'Temperature data is missing or invalid'
        });
      }
    } else {
      console.error(`[ERROR] Weather API returned unexpected status: ${response.status}`);
      res.status(response.status || 500).json({ 
        error: 'Failed to fetch weather data', 
        details: 'Received unexpected response'
      });
    }
  } catch (error) {
    console.error('[ERROR] Error fetching weather data:', error.message);
    
    if (error.response) {
      console.error('[ERROR] Weather API Response Status:', error.response.status);
      console.error('[ERROR] Weather API Response Data:', error.response.data);
      
      // If entity not found, provide more helpful message
      if (error.response.status === 404) {
        return res.status(404).json({ 
          error: 'Weather entity not found', 
          details: `The configured weather entity was not found. Check your Home Assistant configuration.`,
          statusCode: 404
        });
      }
      
      res.status(error.response.status).json({ 
        error: 'Failed to fetch weather data', 
        details: error.response.data,
        statusCode: error.response.status
      });
    } else if (error.request) {
      console.error('[ERROR] No response received from weather API');
      res.status(500).json({ 
        error: 'No response received from Home Assistant weather API', 
        details: 'Request was made but no response was received'
      });
    } else {
      res.status(500).json({ 
        error: 'Failed to fetch weather data', 
        details: error.message
      });
    }
  }
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${isProduction ? 'Production' : 'Development'}`);
  console.log(`Data directory: ${dataDir}`);
  
  // In production mode with kiosk_mode enabled, start the web browser
  if (isProduction && config.kiosk_mode) {
    console.log('Starting kiosk mode...');
    try {
      // Insert your browser startup code here if needed
    } catch (error) {
      console.error('Failed to start kiosk mode:', error);
    }
  }
});

io.on('connection', (socket) => {
  console.log('[DEBUG] Client connected (simplified for debugging)');
  // Temporarily comment out exec for kiosk mode
  /*
  socket.on('exit_kiosk', () => {
    console.log('[DEBUG] Received request to exit kiosk mode');
    if (config.kiosk_mode && process.env.DISPLAY) {
      exec('/usr/bin/exit-kiosk', (error) => {
        if (error) {
          console.error('[DEBUG] Failed to exit kiosk mode:', error);
        } else {
          console.log('[DEBUG] Kiosk mode exited successfully');
        }
      });
    }
  });
  */
  socket.on('disconnect', () => {
    console.log('[DEBUG] Client disconnected (simplified for debugging)');
  });
}); 
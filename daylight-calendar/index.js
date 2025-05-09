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

app.use(express.static(path.join(__dirname, 'public')));

// Home Assistant API connection - KEEP THESE VARS, but we won't call them initially
const hassApiUrl = process.env.SUPERVISOR_TOKEN 
  ? 'http://supervisor/core/api' 
  : 'http://localhost:8123/api'; // This localhost is likely wrong for local dev talking to actual HA

const hassHeaders = {
  Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN || process.env.HASS_TOKEN}`,
  'Content-Type': 'application/json',
};

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/config', (req, res) => {
  res.json(config); // Config should still load
});

app.get('/api/chores', (req, res) => {
  const choresFilePath = path.join(__dirname, 'public', 'chores.json');
  fs.readFile(choresFilePath, 'utf8', (err, data) => {
    if (err) {
      console.error('[DEBUG] Error reading chores.json:', err);
      return res.status(500).json({ error: 'Failed to load chores data' });
    }
    try {
      const chores = JSON.parse(data);
      res.json(chores);
    } catch (parseError) {
      console.error('[DEBUG] Error parsing chores.json:', parseError);
      res.status(500).json({ error: 'Failed to parse chores data' });
    }
  });
});

/* // Temporarily comment out other API routes that depend on hassApiUrl for startup
app.get('/api/calendar', async (req, res) => {
  try {
    const response = await axios.get(`${hassApiUrl}/calendars`, { headers: hassHeaders });
    res.json(response.data);
  } catch (error) {
    console.error('[DEBUG] Error fetching calendar data:', error.message);
    res.status(500).json({ error: 'Failed to fetch calendar data' });
  }
});

app.get('/api/weather', async (req, res) => {
  if (!config || !config.show_weather) { // Added null check for config
    return res.json({ enabled: false });
  }
  
  try {
    const response = await axios.get(`${hassApiUrl}/states/weather.forecast`, { headers: hassHeaders });
    res.json(response.data);
  } catch (error) {
    console.error('[DEBUG] Error fetching weather data:', error.message);
    res.status(500).json({ error: 'Failed to fetch weather data' });
  }
});
*/

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

server.listen(PORT, () => {
  console.log(`[DEBUG] Daylight Calendar server (simplified for debugging) running on port ${PORT}`);
  console.log('[DEBUG] If you see this, the basic server started!');
  console.log('[DEBUG] Current config loaded for debugging:', JSON.stringify(config));
});

// Temporarily comment out kiosk mode startup
/*
if (process.env.DISPLAY && config && config.kiosk_mode) { // Added null check for config
  // Start Chromium in kiosk mode
  const startBrowser = () => {
    exec('chromium-browser --kiosk --no-first-run --disable-infobars --disable-pinch --overscroll-history-navigation=0 --app=http://localhost:8099 &', 
      (error) => {
        if (error) {
          console.error('[DEBUG] Failed to start browser:', error);
        } else {
          console.log('[DEBUG] Kiosk mode started successfully');
        }
      }
    );
  };
  
  // Wait for server to start, then launch browser
  setTimeout(startBrowser, 5000);
}
*/ 
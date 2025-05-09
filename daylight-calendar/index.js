const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const axios = require('axios');
const fs = require('fs');
const { exec } = require('child_process');

// Configuration
let config;
const localOptionsPath = path.join(__dirname, 'options.json'); // Path to local options
const supervisorOptionsPath = '/data/options.json';

try {
  config = JSON.parse(fs.readFileSync(supervisorOptionsPath, 'utf8'));
  console.log(`Loaded configuration from ${supervisorOptionsPath}`);
} catch (error) {
  console.warn(`Could not read ${supervisorOptionsPath}. This is normal if running locally.`);
  try {
    config = JSON.parse(fs.readFileSync(localOptionsPath, 'utf8'));
    console.log(`Loaded local fallback configuration from ${localOptionsPath}`);
  } catch (localError) {
    console.error(`Failed to load local fallback configuration from ${localOptionsPath}:`, localError);
    // Set a very basic default config if even local options fail, to prevent crashes
    config = { 
      theme: "light", 
      show_weather: true, 
      locale: "en-US", 
      time_format: "12h", 
      kiosk_mode: false 
    };
    console.log("Using hardcoded default configuration.");
  }
}

// const config = JSON.parse(fs.readFileSync('/data/options.json', 'utf8')); // Old line
const PORT = process.env.PORT || 8099;

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Home Assistant API connection
const hassApiUrl = process.env.SUPERVISOR_TOKEN 
  ? 'http://supervisor/core/api' 
  : 'http://localhost:8123/api';

const hassHeaders = {
  Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN || process.env.HASS_TOKEN}`,
  'Content-Type': 'application/json',
};

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoints
app.get('/api/config', (req, res) => {
  res.json(config);
});

app.get('/api/calendar', async (req, res) => {
  try {
    const response = await axios.get(`${hassApiUrl}/calendars`, { headers: hassHeaders });
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching calendar data:', error.message);
    res.status(500).json({ error: 'Failed to fetch calendar data' });
  }
});

app.get('/api/weather', async (req, res) => {
  if (!config.show_weather) {
    return res.json({ enabled: false });
  }
  
  try {
    const response = await axios.get(`${hassApiUrl}/states/weather.forecast`, { headers: hassHeaders });
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching weather data:', error.message);
    res.status(500).json({ error: 'Failed to fetch weather data' });
  }
});

// Socket.io for real-time updates
io.on('connection', (socket) => {
  console.log('Client connected');
  
  // Handle exit kiosk mode request
  socket.on('exit_kiosk', () => {
    console.log('Received request to exit kiosk mode');
    if (config.kiosk_mode && process.env.DISPLAY) {
      exec('/usr/bin/exit-kiosk', (error) => {
        if (error) {
          console.error('Failed to exit kiosk mode:', error);
        } else {
          console.log('Kiosk mode exited successfully');
        }
      });
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Daylight Calendar server running on port ${PORT}`);
});

// Handle startup for kiosk mode
if (process.env.DISPLAY && config.kiosk_mode) {
  // Start Chromium in kiosk mode
  const startBrowser = () => {
    exec('chromium-browser --kiosk --no-first-run --disable-infobars --disable-pinch --overscroll-history-navigation=0 --app=http://localhost:8099 &', 
      (error) => {
        if (error) {
          console.error('Failed to start browser:', error);
        } else {
          console.log('Kiosk mode started successfully');
        }
      }
    );
  };
  
  // Wait for server to start, then launch browser
  setTimeout(startBrowser, 5000);
} 
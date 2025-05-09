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

app.use(express.json());
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

// POST endpoint to add a new chore
app.post('/api/chores', (req, res) => {
  const choresFilePath = path.join(__dirname, 'public', 'chores.json');
  fs.readFile(choresFilePath, 'utf8', (err, data) => {
    if (err) {
      console.error('[ERROR] Error reading chores.json for POST:', err);
      return res.status(500).json({ error: 'Failed to read chores data' });
    }
    try {
      const chores = JSON.parse(data);
      const newChore = {
        id: Date.now().toString(), // Generate a unique ID
        name: req.body.name,
        assigneeName: req.body.assigneeName,
        dueDate: req.body.dueDate,
        completed: false
      };
      chores.push(newChore);
      
      fs.writeFile(choresFilePath, JSON.stringify(chores, null, 2), (err) => {
        if (err) {
          console.error('[ERROR] Error writing chores.json:', err);
          return res.status(500).json({ error: 'Failed to save chore' });
        }
        res.status(201).json(newChore);
      });
    } catch (err) {
      console.error('[ERROR] Error parsing chores.json:', err);
      res.status(500).json({ error: 'Invalid chores data format' });
    }
  });
});

// DELETE endpoint to remove a chore
app.delete('/api/chores/:id', (req, res) => {
  const choresFilePath = path.join(__dirname, 'public', 'chores.json');
  fs.readFile(choresFilePath, 'utf8', (err, data) => {
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
      
      fs.writeFile(choresFilePath, JSON.stringify(chores, null, 2), (err) => {
        if (err) {
          console.error('[ERROR] Error writing chores.json:', err);
          return res.status(500).json({ error: 'Failed to delete chore' });
        }
        res.status(200).json({ message: 'Chore deleted successfully' });
      });
    } catch (err) {
      console.error('[ERROR] Error parsing chores.json:', err);
      res.status(500).json({ error: 'Invalid chores data format' });
    }
  });
});

// PATCH endpoint to update a chore (e.g., toggle completion)
app.patch('/api/chores/:id', (req, res) => {
  const choresFilePath = path.join(__dirname, 'public', 'chores.json');
  fs.readFile(choresFilePath, 'utf8', (err, data) => {
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
      
      fs.writeFile(choresFilePath, JSON.stringify(chores, null, 2), (err) => {
        if (err) {
          console.error('[ERROR] Error writing chores.json:', err);
          return res.status(500).json({ error: 'Failed to update chore' });
        }
        res.status(200).json(chores[choreIndex]);
      });
    } catch (err) {
      console.error('[ERROR] Error parsing chores.json:', err);
      res.status(500).json({ error: 'Invalid chores data format' });
    }
  });
});

// GET endpoint for users
app.get('/api/users', (req, res) => {
  const usersFilePath = path.join(__dirname, 'public', 'users.json');
  
  // Check if users.json exists, if not create it with default users
  if (!fs.existsSync(usersFilePath)) {
    const defaultUsers = [
      {
        id: "1",
        name: "Alex",
        color: "#4285f4",
        icon: "fa-user"
      },
      {
        id: "2",
        name: "Jordan",
        color: "#34a853",
        icon: "fa-user"
      },
      {
        id: "3",
        name: "Casey",
        color: "#fbbc05",
        icon: "fa-user"
      },
      {
        id: "4",
        name: "Taylor",
        color: "#ea4335",
        icon: "fa-user"
      }
    ];
    
    fs.writeFileSync(usersFilePath, JSON.stringify(defaultUsers, null, 2));
    return res.json(defaultUsers);
  }
  
  fs.readFile(usersFilePath, 'utf8', (err, data) => {
    if (err) {
      console.error('[ERROR] Error reading users.json:', err);
      return res.status(500).json({ error: 'Failed to read users data' });
    }
    try {
      const users = JSON.parse(data);
      res.json(users);
    } catch (err) {
      console.error('[ERROR] Error parsing users.json:', err);
      res.status(500).json({ error: 'Invalid users data format' });
    }
  });
});

// POST endpoint to add a new user
app.post('/api/users', (req, res) => {
  const usersFilePath = path.join(__dirname, 'public', 'users.json');
  fs.readFile(usersFilePath, 'utf8', (err, data) => {
    if (err) {
      console.error('[ERROR] Error reading users.json for POST:', err);
      return res.status(500).json({ error: 'Failed to read users data' });
    }
    try {
      const users = JSON.parse(data);
      const newUser = {
        id: Date.now().toString(),
        name: req.body.name,
        color: req.body.color || '#808080', // Default to gray if no color provided
        icon: req.body.icon || 'fa-user'
      };
      users.push(newUser);
      
      fs.writeFile(usersFilePath, JSON.stringify(users, null, 2), (err) => {
        if (err) {
          console.error('[ERROR] Error writing users.json:', err);
          return res.status(500).json({ error: 'Failed to save user' });
        }
        res.status(201).json(newUser);
      });
    } catch (err) {
      console.error('[ERROR] Error parsing users.json:', err);
      res.status(500).json({ error: 'Invalid users data format' });
    }
  });
});

// PATCH endpoint to update a user
app.patch('/api/users/:id', (req, res) => {
  const usersFilePath = path.join(__dirname, 'public', 'users.json');
  fs.readFile(usersFilePath, 'utf8', (err, data) => {
    if (err) {
      console.error('[ERROR] Error reading users.json for PATCH:', err);
      return res.status(500).json({ error: 'Failed to read users data' });
    }
    try {
      let users = JSON.parse(data);
      const userIndex = users.findIndex(user => user.id === req.params.id);
      
      if (userIndex === -1) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      // Update the user with the provided fields
      users[userIndex] = { ...users[userIndex], ...req.body };
      
      fs.writeFile(usersFilePath, JSON.stringify(users, null, 2), (err) => {
        if (err) {
          console.error('[ERROR] Error writing users.json:', err);
          return res.status(500).json({ error: 'Failed to update user' });
        }
        res.status(200).json(users[userIndex]);
      });
    } catch (err) {
      console.error('[ERROR] Error parsing users.json:', err);
      res.status(500).json({ error: 'Invalid users data format' });
    }
  });
});

// DELETE endpoint to remove a user
app.delete('/api/users/:id', (req, res) => {
  const usersFilePath = path.join(__dirname, 'public', 'users.json');
  fs.readFile(usersFilePath, 'utf8', (err, data) => {
    if (err) {
      console.error('[ERROR] Error reading users.json for DELETE:', err);
      return res.status(500).json({ error: 'Failed to read users data' });
    }
    try {
      let users = JSON.parse(data);
      const originalLength = users.length;
      users = users.filter(user => user.id !== req.params.id);
      
      if (users.length === originalLength) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      fs.writeFile(usersFilePath, JSON.stringify(users, null, 2), (err) => {
        if (err) {
          console.error('[ERROR] Error writing users.json:', err);
          return res.status(500).json({ error: 'Failed to delete user' });
        }
        res.status(200).json({ message: 'User deleted successfully' });
      });
    } catch (err) {
      console.error('[ERROR] Error parsing users.json:', err);
      res.status(500).json({ error: 'Invalid users data format' });
    }
  });
});

// GET endpoint for meal categories
app.get('/api/meal-categories', (req, res) => {
  const categoriesFilePath = path.join(__dirname, 'public', 'meal-categories.json');
  
  // Check if meal-categories.json exists, if not create it with default categories
  if (!fs.existsSync(categoriesFilePath)) {
    const defaultCategories = [
      {
        id: "1",
        name: "Breakfast",
        color: "#4285f4",
        icon: "fa-coffee"
      },
      {
        id: "2",
        name: "Lunch",
        color: "#34a853",
        icon: "fa-hamburger"
      },
      {
        id: "3",
        name: "Dinner",
        color: "#fbbc05",
        icon: "fa-utensils"
      }
    ];
    
    fs.writeFileSync(categoriesFilePath, JSON.stringify(defaultCategories, null, 2));
    return res.json(defaultCategories);
  }
  
  fs.readFile(categoriesFilePath, 'utf8', (err, data) => {
    if (err) {
      console.error('[ERROR] Error reading meal-categories.json:', err);
      return res.status(500).json({ error: 'Failed to read meal categories data' });
    }
    try {
      const categories = JSON.parse(data);
      res.json(categories);
    } catch (err) {
      console.error('[ERROR] Error parsing meal-categories.json:', err);
      res.status(500).json({ error: 'Invalid meal categories data format' });
    }
  });
});

// Re-enable API routes that depend on hassApiUrl
app.get('/api/calendar', async (req, res) => {
  try {
    // Ensure to use the correct hassApiUrl and hassHeaders defined earlier
    const response = await axios.get(`${hassApiUrl}/calendars`, { headers: hassHeaders });
    res.json(response.data);
  } catch (error) {
    console.error('[ERROR] Error fetching calendar data:', error.message);
    // Add more detailed error logging if possible
    if (error.response) {
      console.error('[ERROR] Calendar API Response Status:', error.response.status);
      console.error('[ERROR] Calendar API Response Data:', error.response.data);
    }
    res.status(500).json({ error: 'Failed to fetch calendar data' });
  }
});

app.get('/api/weather', async (req, res) => {
  if (!config || !config.show_weather) { // Null check for config is good
    console.log('[INFO] Weather display is disabled in config.');
    return res.json({ enabled: false });
  }
  
  try {
    // Ensure to use the correct hassApiUrl and hassHeaders
    const weatherEntity = config.weather_entity || 'weather.forecast_home'; // Use configured entity or a sensible default
    console.log(`[INFO] Fetching weather data for entity: ${weatherEntity}`);
    const response = await axios.get(`${hassApiUrl}/states/${weatherEntity}`, { headers: hassHeaders });
    res.json(response.data);
  } catch (error) {
    console.error('[ERROR] Error fetching weather data:', error.message);
    if (error.response) {
      console.error('[ERROR] Weather API Response Status:', error.response.status);
      console.error('[ERROR] Weather API Response Data:', error.response.data);
    }
    res.status(500).json({ error: 'Failed to fetch weather data' });
  }
});

app.get('/api/meals', (req, res) => {
  const mealsFilePath = path.join(__dirname, 'public', 'meals.json');
  fs.readFile(mealsFilePath, 'utf8', (err, data) => {
    if (err) {
      console.error('[ERROR] Error reading meals.json:', err);
      return res.status(500).json({ error: 'Failed to load meal data' });
    }
    try {
      const meals = JSON.parse(data);
      res.json(meals);
    } catch (parseError) {
      console.error('[ERROR] Error parsing meals.json:', parseError);
      res.status(500).json({ error: 'Failed to parse meal data' });
    }
  });
});

// GET endpoint for recipes
app.get('/api/recipes', (req, res) => {
  const recipesFilePath = path.join(__dirname, 'public', 'recipes.json');
  fs.readFile(recipesFilePath, 'utf8', (err, data) => {
    if (err) {
      console.error('[ERROR] Error reading recipes.json:', err);
      return res.status(500).json({ error: 'Failed to load recipes data' });
    }
    try {
      const recipes = JSON.parse(data);
      res.json(recipes);
    } catch (err) {
      console.error('[ERROR] Error parsing recipes.json:', err);
      res.status(500).json({ error: 'Invalid recipes data format' });
    }
  });
});

// GET a specific recipe by ID
app.get('/api/recipes/:id', (req, res) => {
  const recipeId = req.params.id;
  const recipesFilePath = path.join(__dirname, 'public', 'recipes.json');
  
  fs.readFile(recipesFilePath, 'utf8', (err, data) => {
    if (err) {
      console.error('[ERROR] Error reading recipes.json:', err);
      return res.status(500).json({ error: 'Failed to load recipe data' });
    }
    try {
      const recipes = JSON.parse(data);
      const recipe = recipes.find(r => r.id === recipeId);
      
      if (!recipe) {
        return res.status(404).json({ error: 'Recipe not found' });
      }
      
      res.json(recipe);
    } catch (parseError) {
      console.error('[ERROR] Error parsing recipes.json:', parseError);
      res.status(500).json({ error: 'Failed to parse recipe data' });
    }
  });
});

// GET endpoint for grocery list
app.get('/api/grocery-list', (req, res) => {
  const groceryListPath = path.join(__dirname, 'public', 'grocery-list.json');
  fs.readFile(groceryListPath, 'utf8', (err, data) => {
    if (err) {
      console.error('[ERROR] Error reading grocery-list.json:', err);
      return res.status(500).json({ error: 'Failed to load grocery list data' });
    }
    try {
      const groceryList = JSON.parse(data);
      res.json(groceryList);
    } catch (parseError) {
      console.error('[ERROR] Error parsing grocery-list.json:', parseError);
      res.status(500).json({ error: 'Failed to parse grocery list data' });
    }
  });
});

// POST to add an item to the grocery list
app.post('/api/grocery-list', (req, res) => {
  const { name, quantity } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Item name is required' });
  }
  
  const groceryListPath = path.join(__dirname, 'public', 'grocery-list.json');
  
  fs.readFile(groceryListPath, 'utf8', (err, data) => {
    if (err) {
      console.error('[ERROR] Error reading grocery-list.json:', err);
      return res.status(500).json({ error: 'Failed to load grocery list data' });
    }
    
    try {
      const groceryList = JSON.parse(data);
      
      // Create new item
      const newItem = {
        id: `g${Date.now()}`,
        name,
        quantity: quantity || '1',
        checked: false,
        added: new Date().toISOString().split('T')[0]
      };
      
      // Add item to list
      groceryList.items.push(newItem);
      groceryList.lastUpdated = new Date().toISOString().split('T')[0];
      
      // Write updated list back to file
      fs.writeFile(groceryListPath, JSON.stringify(groceryList, null, 2), writeErr => {
        if (writeErr) {
          console.error('[ERROR] Error writing grocery-list.json:', writeErr);
          return res.status(500).json({ error: 'Failed to update grocery list' });
        }
        
        res.status(201).json(newItem);
      });
    } catch (parseError) {
      console.error('[ERROR] Error parsing grocery-list.json:', parseError);
      res.status(500).json({ error: 'Failed to parse grocery list data' });
    }
  });
});

// PATCH to toggle item checked status
app.patch('/api/grocery-list/:id', (req, res) => {
  const itemId = req.params.id;
  const { checked } = req.body;
  
  if (checked === undefined) {
    return res.status(400).json({ error: 'Checked status is required' });
  }
  
  const groceryListPath = path.join(__dirname, 'public', 'grocery-list.json');
  
  fs.readFile(groceryListPath, 'utf8', (err, data) => {
    if (err) {
      console.error('[ERROR] Error reading grocery-list.json:', err);
      return res.status(500).json({ error: 'Failed to load grocery list data' });
    }
    
    try {
      const groceryList = JSON.parse(data);
      const itemIndex = groceryList.items.findIndex(item => item.id === itemId);
      
      if (itemIndex === -1) {
        return res.status(404).json({ error: 'Item not found' });
      }
      
      // Update the item
      groceryList.items[itemIndex].checked = checked;
      groceryList.lastUpdated = new Date().toISOString().split('T')[0];
      
      // Write updated list back to file
      fs.writeFile(groceryListPath, JSON.stringify(groceryList, null, 2), writeErr => {
        if (writeErr) {
          console.error('[ERROR] Error writing grocery-list.json:', writeErr);
          return res.status(500).json({ error: 'Failed to update grocery list' });
        }
        
        res.json(groceryList.items[itemIndex]);
      });
    } catch (parseError) {
      console.error('[ERROR] Error parsing grocery-list.json:', parseError);
      res.status(500).json({ error: 'Failed to parse grocery list data' });
    }
  });
});

// DELETE item from grocery list
app.delete('/api/grocery-list/:id', (req, res) => {
  const itemId = req.params.id;
  const groceryListPath = path.join(__dirname, 'public', 'grocery-list.json');
  
  fs.readFile(groceryListPath, 'utf8', (err, data) => {
    if (err) {
      console.error('[ERROR] Error reading grocery-list.json:', err);
      return res.status(500).json({ error: 'Failed to load grocery list data' });
    }
    
    try {
      const groceryList = JSON.parse(data);
      const itemIndex = groceryList.items.findIndex(item => item.id === itemId);
      
      if (itemIndex === -1) {
        return res.status(404).json({ error: 'Item not found' });
      }
      
      // Remove the item
      groceryList.items.splice(itemIndex, 1);
      groceryList.lastUpdated = new Date().toISOString().split('T')[0];
      
      // Write updated list back to file
      fs.writeFile(groceryListPath, JSON.stringify(groceryList, null, 2), writeErr => {
        if (writeErr) {
          console.error('[ERROR] Error writing grocery-list.json:', writeErr);
          return res.status(500).json({ error: 'Failed to update grocery list' });
        }
        
        res.status(204).send();
      });
    } catch (parseError) {
      console.error('[ERROR] Error parsing grocery-list.json:', parseError);
      res.status(500).json({ error: 'Failed to parse grocery list data' });
    }
  });
});

// POST endpoint to add a new meal category
app.post('/api/meal-categories', (req, res) => {
  const categoriesFilePath = path.join(__dirname, 'public', 'meal-categories.json');
  fs.readFile(categoriesFilePath, 'utf8', (err, data) => {
    if (err) {
      console.error('[ERROR] Error reading meal-categories.json for POST:', err);
      return res.status(500).json({ error: 'Failed to read meal categories data' });
    }
    try {
      const categories = JSON.parse(data);
      const newCategory = {
        id: Date.now().toString(),
        name: req.body.name,
        color: req.body.color || '#fbbc05',
        icon: req.body.icon || 'fa-utensils'
      };
      categories.push(newCategory);
      
      fs.writeFile(categoriesFilePath, JSON.stringify(categories, null, 2), (err) => {
        if (err) {
          console.error('[ERROR] Error writing meal-categories.json:', err);
          return res.status(500).json({ error: 'Failed to save category' });
        }
        res.status(201).json(newCategory);
      });
    } catch (err) {
      console.error('[ERROR] Error parsing meal-categories.json:', err);
      res.status(500).json({ error: 'Invalid meal categories data format' });
    }
  });
});

// API endpoint for rewards data
app.get('/api/rewards', (req, res) => {
  const rewardsFilePath = path.join(__dirname, 'public', 'rewards.json');
  fs.readFile(rewardsFilePath, 'utf8', (err, data) => {
    if (err) {
      console.error('[ERROR] Error reading rewards.json:', err);
      return res.status(500).json({ error: 'Failed to load rewards data' });
    }
    try {
      const rewards = JSON.parse(data);
      res.json(rewards);
    } catch (err) {
      console.error('[ERROR] Error parsing rewards.json:', err);
      res.status(500).json({ error: 'Invalid rewards data format' });
    }
  });
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
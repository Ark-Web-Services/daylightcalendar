/**
 * Page Loader Integration - Example of how to modify script.js to work with the new architecture
 *
 * This file shows how to modify the existing script.js to work with the page loader.
 * You would incorporate these changes into the main script.js file.
 */

// Listen for page loaded events
document.addEventListener('pageLoaded', (event) => {
  const pageName = event.detail.page;
  console.log(`Page loaded: ${pageName}`);

  // Call the appropriate initialization function based on the page loaded
  switch(pageName) {
    case 'calendar':
      initCalendarPage();
      break;
    case 'chores':
      initChoresPage();
      break;
    case 'meals':
      initMealsPage();
      break;
    case 'games':
      initGamesPage();
      break;
    case 'settings':
      initSettingsPage();
      break;
    case 'api-test':
      initApiTestPage();
      break;
  }
});

// Example initialization functions for each page
function initCalendarPage() {
  console.log('Initializing calendar page');
  // Initialize calendar-specific functionality

  // Example: Initialize the calendar
  if (typeof calendar === 'undefined' || calendar === null) {
    // Create calendar if it doesn't exist yet
    initializeCalendar();
  } else {
    // Or just refresh it
    calendar.render();
  }

  // Update weather display
  updateWeather();

  // Update clock
  updateClock();
}

function initChoresPage() {
  console.log('Initializing chores page');
  // Initialize chores-specific functionality

  // Example: Load chores data
  loadChores();

  // Setup event listeners for chore actions
  setupChoreEventListeners();
}

function initMealsPage() {
  console.log('Initializing meals page');
  // Initialize meals-specific functionality

  // Example: Load meal data
  loadMeals();

  // Setup event listeners for meal planning actions
  setupMealEventListeners();
}

function initGamesPage() {
  console.log('Initializing games page');
  // Initialize games-specific functionality

  // Example: Load games data
  loadGames();

  // Load user profiles for game time tracking
  loadUserProfiles();
}

function initSettingsPage() {
  console.log('Initializing settings page');
  // Initialize settings-specific functionality

  // Example: Initialize theme buttons
  const themeButtons = document.querySelectorAll('.theme-button');
  themeButtons.forEach(button => {
    // Set active state on current theme
    if (button.dataset.theme === getCurrentTheme()) {
      button.classList.add('active');
    }

    // Add click event listener
    button.addEventListener('click', handleThemeChange);
  });

  // Initialize other settings
  initializeNightModeSettings();
  initializeScreenProtectionSettings();

  // Load user profiles
  loadProfilesForSettings();

  // Initialize media testing
  initializeCameraTest();
  initializeMicrophoneTest();
}

function initApiTestPage() {
  console.log('Initializing API test page');
  // Nothing to do here as it loads an iframe
}

// Helper functions
function getCurrentTheme() {
  return document.body.className.replace('theme-', '') || 'light';
}

function handleThemeChange(e) {
  const theme = e.currentTarget.dataset.theme;
  document.body.className = `theme-${theme}`;

  // Set active state on this button and remove from others
  document.querySelectorAll('.theme-button').forEach(btn => {
    btn.classList.remove('active');
  });
  e.currentTarget.classList.add('active');

  // Save theme preference
  saveUserPreference('theme', theme);
}

// Example of a function to save user preferences
function saveUserPreference(key, value) {
  // In a real app, this would save to localStorage or the server
  console.log(`Saving preference: ${key} = ${value}`);

  // For demo purposes, save to localStorage
  localStorage.setItem(`preference_${key}`, value);
}
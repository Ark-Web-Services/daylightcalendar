/**
 * Script Bridge - Connects the page loader with existing script.js functionality
 * This file provides bridge functions that call into the original script.js functions
 */

// Store original function references
let _originalFetchAndDisplayChores;
let _originalFetchAndDisplayMeals;
let _originalInitializeCalendar;
let _originalShowModal;
let _originalHideModal;

// Modal handling functions
function showModal(modalId) {
  console.log(`Bridge: Showing modal ${modalId}`);

  // Use original function if available
  if (_originalShowModal) {
    return _originalShowModal(modalId);
  }

  // Simple implementation
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('show');
    return true;
  } else {
    console.error(`Modal with ID ${modalId} not found`);
    return false;
  }
}

function hideModal(modalId) {
  console.log(`Bridge: Hiding modal ${modalId}`);

  // Use original function if available
  if (_originalHideModal) {
    return _originalHideModal(modalId);
  }

  // Simple implementation
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('show');
    return true;
  } else {
    console.error(`Modal with ID ${modalId} not found`);
    return false;
  }
}

// Calendar initialization bridge
function initializeCalendar() {
  console.log("Bridge: Initializing calendar");

  // Use the original function if available
  if (_originalInitializeCalendar) {
    return _originalInitializeCalendar();
  }

  // If FullCalendar isn't initialized yet in script.js, initialize it here
  if (typeof calendar === 'undefined' || calendar === null) {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) {
      console.error("Calendar element not found");
      return;
    }

    // Check if FullCalendar is available
    if (typeof FullCalendar === 'undefined') {
      console.error("FullCalendar library not loaded");
      return;
    }

    try {
      // Initialize calendar with FullCalendar
      window.calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        headerToolbar: {
          left: 'prev,next today',
          center: 'title',
          right: 'dayGridMonth,timeGridWeek,timeGridDay'
        },
        events: [],
        eventClick: function(info) {
          console.log('Event clicked:', info.event.title);
        }
      });

      window.calendar.render();

      // Fetch events if that function exists
      if (typeof fetchCalendarEvents === 'function') {
        fetchCalendarEvents();
      }
    } catch (error) {
      console.error("Error initializing calendar:", error);
    }
  } else {
    // If calendar already exists, just render it again
    try {
      calendar.render();
    } catch (error) {
      console.error("Error rendering existing calendar:", error);
    }
  }

  // Update clock and weather if those functions exist
  if (typeof updateClock === 'function') updateClock();
  if (typeof updateWeather === 'function') updateWeather();
  if (typeof loadUserToggles === 'function') loadUserToggles();
}

// Chores initialization bridge
function fetchAndDisplayChores() {
  console.log("Bridge: Fetching and displaying chores");

  // Use the original function if available
  if (_originalFetchAndDisplayChores) {
    return _originalFetchAndDisplayChores();
  }

  // Implement a basic version if original not available
  const choreBoard = document.getElementById('chore-board');
  if (choreBoard) {
    // Create three basic lanes
    const lanes = ['To Do', 'In Progress', 'Done'];

    // Create lane HTML
    let lanesHtml = '';
    lanes.forEach(lane => {
      lanesHtml += `
        <div class="chore-lane">
          <div class="lane-header">${lane}</div>
          <div class="lane-body" data-lane="${lane.toLowerCase().replace(' ', '-')}">
            <!-- Chores will be added here -->
            <div class="lane-placeholder">No chores yet</div>
          </div>
        </div>
      `;
    });

    choreBoard.innerHTML = lanesHtml;
  }
}

// Meals initialization bridge
function fetchAndDisplayMeals() {
  console.log("Bridge: Fetching and displaying meals");

  // Use the original function if available
  if (_originalFetchAndDisplayMeals) {
    return _originalFetchAndDisplayMeals();
  }

  // Implement a basic version if original not available
  const mealWeekView = document.getElementById('meal-week-view');
  if (mealWeekView) {
    // Create a basic week view
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const mealTypes = ['Breakfast', 'Lunch', 'Dinner'];

    // Create week view HTML
    let weekHtml = '<div class="meal-week-table">';
    weekHtml += '<div class="meal-week-header"><div class="meal-cell meal-header-spacer"></div>';

    days.forEach(day => {
      weekHtml += `<div class="meal-day-header">${day}</div>`;
    });

    weekHtml += '</div>';

    mealTypes.forEach(mealType => {
      weekHtml += `<div class="meal-row">
        <div class="meal-type-header">${mealType}</div>`;

      days.forEach(day => {
        weekHtml += `<div class="meal-cell" data-day="${day.toLowerCase()}" data-type="${mealType.toLowerCase()}">
          <div class="empty-meal">+ Add Meal</div>
        </div>`;
      });

      weekHtml += '</div>';
    });

    weekHtml += '</div>';
    mealWeekView.innerHTML = weekHtml;
  }
}

// Button click handling
function setupButtonListeners() {
  console.log("Bridge: Setting up button listeners");

  // Add Chore button
  const addChoreButton = document.getElementById('add-chore-button');
  if (addChoreButton) {
    addChoreButton.addEventListener('click', function() {
      console.log("Bridge: Add chore button clicked");
      showModal('add-chore-modal');
    });
  }

  // Recipe Book button
  const recipeBookButton = document.getElementById('recipe-book-button');
  if (recipeBookButton) {
    recipeBookButton.addEventListener('click', function() {
      console.log("Bridge: Recipe book button clicked");
      showModal('recipe-book-modal');
      if (typeof loadRecipes === 'function') loadRecipes();
    });
  }

  // Add Meal button
  const addMealButton = document.getElementById('add-meal-button');
  if (addMealButton) {
    addMealButton.addEventListener('click', function() {
      console.log("Bridge: Add meal button clicked");
      showModal('add-meal-modal');
    });
  }

  // Grocery List button
  const groceryListButton = document.getElementById('grocery-list-button');
  if (groceryListButton) {
    groceryListButton.addEventListener('click', function() {
      console.log("Bridge: Grocery list button clicked");
      showModal('grocery-list-modal');
      if (typeof loadGroceryList === 'function') loadGroceryList();
    });
  }

  // Add Game button
  const addGameButton = document.getElementById('add-game-button');
  if (addGameButton) {
    addGameButton.addEventListener('click', function() {
      console.log("Bridge: Add game button clicked");
      showModal('add-game-modal');
    });
  }

  // Close buttons for all modals
  document.querySelectorAll('.modal-close, .modal-cancel').forEach(button => {
    button.addEventListener('click', function() {
      const modal = this.closest('.modal');
      if (modal) {
        modal.classList.remove('show');
      }
    });
  });
}

// Document ready function - called when script-bridge.js is loaded
document.addEventListener('DOMContentLoaded', function() {
  console.log("Script Bridge loaded and ready");

  // Backup original functions if they exist
  if (typeof window.fetchAndDisplayChores === 'function') {
    _originalFetchAndDisplayChores = window.fetchAndDisplayChores;
  }

  if (typeof window.fetchAndDisplayMeals === 'function') {
    _originalFetchAndDisplayMeals = window.fetchAndDisplayMeals;
  }

  if (typeof window.initializeCalendar === 'function') {
    _originalInitializeCalendar = window.initializeCalendar;
  }

  if (typeof window.showModal === 'function') {
    _originalShowModal = window.showModal;
  }

  if (typeof window.hideModal === 'function') {
    _originalHideModal = window.hideModal;
  }

  // Replace with our bridge functions
  window.initializeCalendar = initializeCalendar;
  window.fetchAndDisplayChores = fetchAndDisplayChores;
  window.fetchAndDisplayMeals = fetchAndDisplayMeals;
  window.showModal = showModal;
  window.hideModal = hideModal;

  // Set up button listeners
  setupButtonListeners();

  // Listen for page loaded events to re-initialize buttons
  document.addEventListener('pageLoaded', function(e) {
    console.log(`Bridge: Page ${e.detail.page} loaded, re-initializing buttons`);
    setTimeout(setupButtonListeners, 300);
  });
});
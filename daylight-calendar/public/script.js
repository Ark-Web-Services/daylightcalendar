/* Daylight Calendar - Main JavaScript */

console.log('[INFO] Initializing Daylight Calendar client...');

// Global variables
let inactivityTimer;
let dimmerCountdownTimer;
let dimmerCountdown = 30;
let weatherForecastData = [];
let calendar;

// Display settings (default values)
let displaySettings = {
  screenBurnProtection: true,
  dimAfterMinutes: 10,
  displayClock: false
};

// Initial setup
document.addEventListener('DOMContentLoaded', function() {
  console.log('[INFO] DOM Content Loaded');

  // Load configuration first
  fetch('/api/config')
    .then(response => response.json())
    .then(config => {
      window.appConfig = config;
      console.log('[INFO] Loaded configuration:', config);

      // Setup sidebar and UI
      initializeSidebar();
      initializeGlobalUI();

      // Setup turbo frame event listeners
      setupTurboFrameListeners();

      if (config.development_mode) {
        document.getElementById('debug-tab').style.display = 'block';
        console.log('[INFO] Debug mode enabled - showing debug tab');
      }
    })
    .catch(error => {
      console.error('[ERROR] Failed to load configuration:', error);
      // Continue with default config
      window.appConfig = {
        theme: 'light',
        show_weather: true,
        development_mode: false
      };
      initializeSidebar();
      initializeGlobalUI();
      setupTurboFrameListeners();
    });
});

// Setup Turbo frame event listeners
function setupTurboFrameListeners() {
  console.log('[DEBUG] Setting up Turbo frame event listeners...');

  // Listen for turbo frame loads
  document.addEventListener('turbo:frame-load', function(event) {
    const frame = event.target;
    console.log('[DEBUG] Turbo frame loaded:', frame.id);

    // Re-setup modals for any new content
    setupModals();

    switch(frame.id) {
      case 'calendar-content':
        console.log('[DEBUG] Initializing calendar content...');
        initializeCalendarPage();
        break;
      case 'chores-content':
        console.log('[DEBUG] Initializing chores content...');
        initializeChoresPage();
        break;
      case 'meals-content':
        console.log('[DEBUG] Initializing meals content...');
        initializeMealsPage();
        break;
      case 'games-content':
        console.log('[DEBUG] Initializing games content...');
        initializeGamesPage();
        break;
      case 'settings-content':
        console.log('[DEBUG] Initializing settings content...');
        initializeSettingsPage();
        break;
      case 'api-test-content':
        console.log('[DEBUG] Initializing debug content...');
        initializeDebugPage();
        break;
      default:
        console.log('[DEBUG] Unknown frame loaded:', frame.id);
    }
  });

  // Also listen for regular frame loads in case turbo events don't fire
  document.addEventListener('DOMContentLoaded', function() {
    console.log('[DEBUG] DOM fully loaded, checking for existing frames...');

    // Check if any frames are already loaded
    const frames = ['calendar-content', 'chores-content', 'meals-content', 'games-content', 'settings-content', 'api-test-content'];
    frames.forEach(frameId => {
      const frame = document.getElementById(frameId);
      if (frame && frame.style.display !== 'none') {
        console.log('[DEBUG] Found existing frame:', frameId);
        // Re-setup modals for existing content
        setupModals();
        // Initialize the frame content
        switch(frameId) {
          case 'calendar-content':
            initializeCalendarPage();
            break;
          case 'chores-content':
            initializeChoresPage();
            break;
          case 'meals-content':
            initializeMealsPage();
            break;
          case 'games-content':
            initializeGamesPage();
            break;
          case 'settings-content':
            initializeSettingsPage();
            break;
          case 'api-test-content':
            initializeDebugPage();
            break;
        }
      }
    });
  });
}

// Initialize calendar page
function initializeCalendarPage() {
  console.log('[INFO] Initializing calendar page...');

  // Wait for elements to be available in the DOM
  setTimeout(() => {
    // Update time and weather first
    updateTime();

    // Setup calendar with delay to ensure DOM is ready
    setTimeout(() => {
      setupCalendar();

      // Fetch data after calendar is set up
      setTimeout(() => {
        fetchWeather();
        fetchCalendarEvents();
        loadUserToggles();
      }, 200);
    }, 100);

    console.log('[INFO] Calendar page initialized');
  }, 100);
}

// Initialize chores page
function initializeChoresPage() {
  console.log('[INFO] Initializing chores page...');

  // Wait for elements to be available
  setTimeout(() => {
    console.log('[DEBUG] Looking for chores page elements...');

    // Setup chore page buttons
    const jumpToTodayBtn = document.getElementById('jump-to-today');
    const toggleCompletedBtn = document.getElementById('toggle-completed');
    const addChoreBtn = document.getElementById('add-chore-button');
    const addChoreModal = document.getElementById('add-chore-modal');
    const addChoreForm = document.getElementById('add-chore-form');

    console.log('[DEBUG] Chores elements found:', {
      jumpToTodayBtn: !!jumpToTodayBtn,
      toggleCompletedBtn: !!toggleCompletedBtn,
      addChoreBtn: !!addChoreBtn,
      addChoreModal: !!addChoreModal,
      addChoreForm: !!addChoreForm
    });

    if (jumpToTodayBtn) {
      jumpToTodayBtn.addEventListener('click', () => {
        console.log('[INFO] Jump to today clicked');
        // Scroll to today's section or highlight today
      });
      console.log('[DEBUG] Jump to today button listener added');
    }

    if (toggleCompletedBtn) {
      toggleCompletedBtn.addEventListener('click', () => {
        console.log('[INFO] Toggle completed chores clicked');
        const icon = toggleCompletedBtn.querySelector('i');
        if (icon.textContent === 'visibility_off') {
          icon.textContent = 'visibility';
          toggleCompletedBtn.innerHTML = '<i class="material-icons">visibility</i> Show Completed';
        } else {
          icon.textContent = 'visibility_off';
          toggleCompletedBtn.innerHTML = '<i class="material-icons">visibility_off</i> Hide Completed';
        }
      });
      console.log('[DEBUG] Toggle completed button listener added');
    }

    if (addChoreBtn && addChoreModal) {
      addChoreBtn.addEventListener('click', () => {
        console.log('[INFO] Add chore button clicked');
        addChoreModal.classList.add('show');
      });
      console.log('[DEBUG] Add chore button listener added');
    }

    if (addChoreForm) {
      addChoreForm.addEventListener('submit', (e) => {
        e.preventDefault();
        console.log('[INFO] Add chore form submitted');
        const formData = new FormData(addChoreForm);
        console.log('[INFO] Chore data:', Object.fromEntries(formData));
        addChoreModal.classList.remove('show');
        addChoreForm.reset();
      });
      console.log('[DEBUG] Add chore form listener added');
    }

    fetchAndDisplayChores();
  }, 100);
}

function initializeMealsPage() {
  console.log('[INFO] Initializing meals page...');

  setTimeout(() => {
    // Setup meal page buttons
    const prevWeekBtn = document.getElementById('prev-week');
    const nextWeekBtn = document.getElementById('next-week');
    const recipeBookBtn = document.getElementById('recipe-book-button');
    const groceryListBtn = document.getElementById('grocery-list-button');
    const addMealBtn = document.getElementById('add-meal-button');
    const mealCategoriesBtn = document.getElementById('meal-categories-button');

    // Modals
    const recipeBookModal = document.getElementById('recipe-book-modal');
    const groceryListModal = document.getElementById('grocery-list-modal');
    const addMealModal = document.getElementById('add-meal-modal');
    const mealCategoriesModal = document.getElementById('meal-categories-modal');

    if (prevWeekBtn) {
      prevWeekBtn.addEventListener('click', () => {
        console.log('[INFO] Previous week clicked');
        // Navigate to previous week
      });
    }

    if (nextWeekBtn) {
      nextWeekBtn.addEventListener('click', () => {
        console.log('[INFO] Next week clicked');
        // Navigate to next week
      });
    }

    if (recipeBookBtn && recipeBookModal) {
      recipeBookBtn.addEventListener('click', () => {
        console.log('[INFO] Recipe book button clicked');
        recipeBookModal.classList.add('show');
      });
    }

    if (groceryListBtn && groceryListModal) {
      groceryListBtn.addEventListener('click', () => {
        console.log('[INFO] Grocery list button clicked');
        groceryListModal.classList.add('show');
      });
    }

    if (addMealBtn && addMealModal) {
      addMealBtn.addEventListener('click', () => {
        console.log('[INFO] Add meal button clicked');
        addMealModal.classList.add('show');
      });
    }

    if (mealCategoriesBtn && mealCategoriesModal) {
      mealCategoriesBtn.addEventListener('click', () => {
        console.log('[INFO] Meal categories button clicked');
        mealCategoriesModal.classList.add('show');
      });
    }

    // Setup form submissions
    const addMealForm = document.getElementById('add-meal-form');
    const addGroceryForm = document.getElementById('add-grocery-item-form');

    if (addMealForm) {
      addMealForm.addEventListener('submit', (e) => {
        e.preventDefault();
        console.log('[INFO] Add meal form submitted');
        const formData = new FormData(addMealForm);
        console.log('[INFO] Meal data:', Object.fromEntries(formData));
        addMealModal.classList.remove('show');
        addMealForm.reset();
      });
    }

    if (addGroceryForm) {
      addGroceryForm.addEventListener('submit', (e) => {
        e.preventDefault();
        console.log('[INFO] Add grocery item form submitted');
        const formData = new FormData(addGroceryForm);
        console.log('[INFO] Grocery item data:', Object.fromEntries(formData));
        addGroceryForm.reset();
      });
    }

    fetchAndDisplayMeals();
  }, 100);
}

function initializeGamesPage() {
  console.log('[INFO] Initializing games page...');

  setTimeout(() => {
    // Setup game page buttons
    const addGameBtn = document.getElementById('add-game-button');
    const addGameModal = document.getElementById('add-game-modal');
    const addGameForm = document.getElementById('add-game-form');
    const gameFocusModal = document.getElementById('game-focus-modal');
    const gameIframe = document.getElementById('game-iframe');

    if (addGameBtn && addGameModal) {
      addGameBtn.addEventListener('click', () => {
        console.log('[INFO] Add game button clicked');
        addGameModal.classList.add('show');
      });
    }

    if (addGameForm) {
      addGameForm.addEventListener('submit', (e) => {
        e.preventDefault();
        console.log('[INFO] Add game form submitted');
        const formData = new FormData(addGameForm);
        console.log('[INFO] Game data:', Object.fromEntries(formData));
        addGameModal.classList.remove('show');
        addGameForm.reset();
      });
    }

    // Setup game item clicks
    const gameItems = document.querySelectorAll('.game-item');
    gameItems.forEach(item => {
      item.addEventListener('click', () => {
        const gameUrl = item.dataset.gameUrl;
        const gameTitle = item.querySelector('.game-title').textContent;

        console.log('[INFO] Game clicked:', gameTitle, gameUrl);

        if (gameFocusModal && gameIframe) {
          document.getElementById('game-modal-title').textContent = gameTitle;
          gameIframe.src = gameUrl;
          gameFocusModal.classList.add('show');
        }
      });
    });

    // Setup profile selection
    const profileList = document.getElementById('profile-list');
    if (profileList) {
      // Add some default profiles for demo
      profileList.innerHTML = `
        <div class="profile-item" data-profile="alex">
          <div class="profile-avatar" style="background-color: #4285f4;">A</div>
          <div class="profile-name">Alex</div>
          <div class="profile-playtime">30 min remaining</div>
        </div>
        <div class="profile-item" data-profile="jordan">
          <div class="profile-avatar" style="background-color: #34a853;">J</div>
          <div class="profile-name">Jordan</div>
          <div class="profile-playtime">45 min remaining</div>
        </div>
      `;

      // Setup profile clicks
      profileList.addEventListener('click', (e) => {
        const profileItem = e.target.closest('.profile-item');
        if (profileItem) {
          document.querySelectorAll('.profile-item').forEach(p => p.classList.remove('selected'));
          profileItem.classList.add('selected');
          console.log('[INFO] Profile selected:', profileItem.dataset.profile);
        }
      });
    }
  }, 100);
}

function initializeSettingsPage() {
  console.log('[INFO] Initializing settings page...');

  // Setup display settings event listeners only when settings page is loaded
  setTimeout(() => {
    console.log('[DEBUG] Settings page timeout reached, setting up elements...');

    const screenBurnProtection = document.getElementById('screen-burn-protection');
    const dimAfterMinutes = document.getElementById('dim-after-minutes');
    const displayClock = document.getElementById('display-clock');

    console.log('[DEBUG] Settings elements found:', {
      screenBurnProtection: !!screenBurnProtection,
      dimAfterMinutes: !!dimAfterMinutes,
      displayClock: !!displayClock
    });

    if (screenBurnProtection) {
      screenBurnProtection.addEventListener('change', function(e) {
        displaySettings.screenBurnProtection = e.target.checked;
        console.log('[INFO] Screen burn protection:', e.target.checked);
        if (displaySettings.screenBurnProtection) {
          resetInactivityTimer();
        } else {
          if (inactivityTimer) {
            clearTimeout(inactivityTimer);
          }
          wakeScreen();
        }
      });
      console.log('[DEBUG] Screen burn protection listener added');
    }

    if (dimAfterMinutes) {
      dimAfterMinutes.addEventListener('change', function(e) {
        displaySettings.dimAfterMinutes = parseInt(e.target.value, 10);
        console.log('[INFO] Dim after minutes:', displaySettings.dimAfterMinutes);
        resetInactivityTimer();
      });
      console.log('[DEBUG] Dim after minutes listener added');
    }

    if (displayClock) {
      displayClock.addEventListener('change', function(e) {
        displaySettings.displayClock = e.target.checked;
        console.log('[INFO] Display clock:', e.target.checked);
        const clockDisplay = document.getElementById('clock-display');
        if (displaySettings.displayClock && clockDisplay) {
          clockDisplay.classList.add('active');
        } else if (clockDisplay) {
          clockDisplay.classList.remove('active');
        }
      });
      console.log('[DEBUG] Display clock listener added');
    }

    // Setup theme buttons
    const themeButtons = document.querySelectorAll('.theme-button');
    console.log('[DEBUG] Found theme buttons:', themeButtons.length);
    themeButtons.forEach((button, index) => {
      console.log('[DEBUG] Setting up theme button', index, 'with theme:', button.dataset.theme);
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const theme = button.dataset.theme;
        console.log('[INFO] Theme selected:', theme);

        // Remove active class from all theme buttons
        themeButtons.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');

        // Apply theme (this could update CSS variables or classes)
        document.documentElement.setAttribute('data-theme', theme);

        // Also apply to body for broader compatibility
        document.body.setAttribute('data-theme', theme);
        document.body.className = document.body.className.replace(/theme-\w+/g, '') + ` theme-${theme}`;

        console.log('[DEBUG] Theme applied to document and body:', theme);
      });
    });
    console.log('[DEBUG] All theme button listeners added');

    // Setup camera/microphone test buttons
    const startCameraBtn = document.getElementById('start-camera');
    const stopCameraBtn = document.getElementById('stop-camera');
    const startMicBtn = document.getElementById('start-microphone');
    const stopMicBtn = document.getElementById('stop-microphone');
    const cameraVideo = document.getElementById('camera-test');

    console.log('[DEBUG] Media test elements found:', {
      startCameraBtn: !!startCameraBtn,
      stopCameraBtn: !!stopCameraBtn,
      startMicBtn: !!startMicBtn,
      stopMicBtn: !!stopMicBtn,
      cameraVideo: !!cameraVideo
    });

    if (startCameraBtn && stopCameraBtn && cameraVideo) {
      startCameraBtn.addEventListener('click', async () => {
        try {
          console.log('[INFO] Starting camera test');
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          cameraVideo.srcObject = stream;
          startCameraBtn.disabled = true;
          stopCameraBtn.disabled = false;
        } catch (error) {
          console.error('[ERROR] Camera access failed:', error);
          alert('Camera access failed: ' + error.message);
        }
      });

      stopCameraBtn.addEventListener('click', () => {
        console.log('[INFO] Stopping camera test');
        const stream = cameraVideo.srcObject;
        if (stream) {
          stream.getTracks().forEach(track => track.stop());
          cameraVideo.srcObject = null;
        }
        startCameraBtn.disabled = false;
        stopCameraBtn.disabled = true;
      });
      console.log('[DEBUG] Camera button listeners added');
    }

    if (startMicBtn && stopMicBtn) {
      let micStream = null;
      let audioContext = null;
      let analyser = null;
      let micLevelInterval = null;

      startMicBtn.addEventListener('click', async () => {
        try {
          console.log('[INFO] Starting microphone test');
          micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

          audioContext = new (window.AudioContext || window.webkitAudioContext)();
          analyser = audioContext.createAnalyser();
          const microphone = audioContext.createMediaStreamSource(micStream);
          microphone.connect(analyser);

          analyser.fftSize = 256;
          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);

          const micLevelBar = document.getElementById('mic-level-bar');

          micLevelInterval = setInterval(() => {
            analyser.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b) / bufferLength;
            const percentage = (average / 255) * 100;
            if (micLevelBar) {
              micLevelBar.style.width = percentage + '%';
            }
          }, 100);

          startMicBtn.disabled = true;
          stopMicBtn.disabled = false;
        } catch (error) {
          console.error('[ERROR] Microphone access failed:', error);
          alert('Microphone access failed: ' + error.message);
        }
      });

      stopMicBtn.addEventListener('click', () => {
        console.log('[INFO] Stopping microphone test');
        if (micStream) {
          micStream.getTracks().forEach(track => track.stop());
          micStream = null;
        }
        if (audioContext) {
          audioContext.close();
          audioContext = null;
        }
        if (micLevelInterval) {
          clearInterval(micLevelInterval);
          micLevelInterval = null;
        }

        const micLevelBar = document.getElementById('mic-level-bar');
        if (micLevelBar) {
          micLevelBar.style.width = '0%';
        }

        startMicBtn.disabled = false;
        stopMicBtn.disabled = true;
      });
      console.log('[DEBUG] Microphone button listeners added');
    }

    // Setup add profile button
    const addProfileBtn = document.getElementById('add-profile-button');
    if (addProfileBtn) {
      addProfileBtn.addEventListener('click', () => {
        console.log('[INFO] Add profile button clicked');
        const profileName = prompt('Enter profile name:');
        if (profileName) {
          console.log('[INFO] Adding profile:', profileName);
          // This would normally add the profile to the system
        }
      });
      console.log('[DEBUG] Add profile button listener added');
    }

    // Re-setup modals for settings page
    setupModals();
    console.log('[DEBUG] Modals re-setup for settings page');

    loadProfilesForSettings();
    fetchDisplaySettings();

    console.log('[DEBUG] Settings page initialization complete');
  }, 100);
}

function initializeDebugPage() {
  console.log('[INFO] Debug page loaded in iframe');
  // Debug page is an iframe, so no special initialization needed
}

// Initialize sidebar and global UI
function initializeSidebar() {
  // Handle sidebar toggle
  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebar-logo');
  const app = document.getElementById('app');

  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', function() {
      app.classList.toggle('sidebar-collapsed');

      // If we have a calendar instance, update its size after sidebar animation completes
      setTimeout(() => {
        if (typeof calendar !== 'undefined' && calendar && calendar.updateSize) {
          calendar.updateSize();
        }
      }, 300); // Match transition-speed CSS variable
    });
  }

  // Setup tab navigation
  const tabItems = document.querySelectorAll('.tab-item');
  const tabContents = document.querySelectorAll('.tab-content');

  tabItems.forEach(item => {
    item.addEventListener('click', () => {
      const target = item.dataset.tabTarget;

      // Remove active classes
      tabItems.forEach(tab => tab.classList.remove('active-tab'));
      tabContents.forEach(content => {
        content.classList.remove('active-content');
        content.style.display = 'none';
      });

      // Add active classes
      item.classList.add('active-tab');
      const contentFrame = document.getElementById(target);
      if (contentFrame) {
        contentFrame.classList.add('active-content');
        contentFrame.style.display = 'block';
      }
    });
  });
}

function initializeGlobalUI() {
  // Initialize display settings
  const screenDimmer = document.getElementById('screen-dimmer');
  const clockDisplay = document.getElementById('clock-display');
  const dimmerDismiss = document.getElementById('dimmer-dismiss');

  // Setup dimmer dismiss button
  if (dimmerDismiss) {
    dimmerDismiss.addEventListener('click', wakeScreen);
  }

  // Setup event listeners for screen burn protection
  document.addEventListener('mousemove', resetInactivityTimer);
  document.addEventListener('mousedown', resetInactivityTimer);
  document.addEventListener('keypress', resetInactivityTimer);
  document.addEventListener('touchstart', resetInactivityTimer);
  document.addEventListener('scroll', resetInactivityTimer);

  // Setup modal management
  setupModals();

  // Start the clock
  updateClock();
  setInterval(updateClock, 1000);
}

function updateClock() {
  const clockDisplay = document.getElementById('clock-display');
  if (clockDisplay) {
    clockDisplay.textContent = moment().format('h:mm A');
  }
}

function setupModals() {
  // Set up modal close buttons (re-run for all modals each time)
  document.querySelectorAll('.modal-close, .modal-cancel').forEach(button => {
    // Remove existing listeners to prevent duplicates
    button.removeEventListener('click', handleModalClose);
    button.addEventListener('click', handleModalClose);
  });

  // Set up escape key handler for modals
  document.removeEventListener('keydown', handleEscapeKey);
  document.addEventListener('keydown', handleEscapeKey);

  // Set up click outside modal to close
  document.querySelectorAll('.modal').forEach(modal => {
    modal.removeEventListener('click', handleModalBackdropClick);
    modal.addEventListener('click', handleModalBackdropClick);
  });
}

function handleModalClose(event) {
  const modal = event.target.closest('.modal');
  if (modal) {
    closeModal(modal);
  }
}

function handleEscapeKey(event) {
  if (event.key === 'Escape') {
    const openModal = document.querySelector('.modal.show');
    if (openModal) {
      closeModal(openModal);
    }
  }
}

function handleModalBackdropClick(event) {
  // Only close if clicking the modal backdrop, not the modal content
  if (event.target.classList.contains('modal')) {
    closeModal(event.target);
  }
}

function closeModal(modal) {
  modal.classList.remove('show');

  // If this is the game modal, clear the iframe src when closing
  if (modal.id === 'game-focus-modal') {
    const gameIframe = document.getElementById('game-iframe');
    if (gameIframe) {
      gameIframe.src = '';
    }
  }
}

function setupCalendar() {
  const calendarEl = document.getElementById('calendar');
  if (!calendarEl) {
    console.error('[ERROR] Calendar element not found, retrying in 500ms...');
    // Retry after a delay
    setTimeout(() => {
      setupCalendar();
    }, 500);
    return;
  }

  // Only initialize if not already initialized
  if (calendar) {
    console.log('[DEBUG] Calendar already initialized, updating size');
    calendar.updateSize();
    return;
  }

  console.log('[DEBUG] Setting up FullCalendar...');

  // Check if FullCalendar is available
  if (typeof FullCalendar === 'undefined') {
    console.error('[ERROR] FullCalendar library not loaded, retrying in 1000ms...');
    setTimeout(() => {
      setupCalendar();
    }, 1000);
    return;
  }

  try {
    calendar = new FullCalendar.Calendar(calendarEl, {
      initialView: 'timeGridWeek',
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'timeGridWeek,timeGridDay'
      },
      slotMinTime: '06:00:00',
      slotMaxTime: '24:00:00',
      allDaySlot: true,
      height: 'auto',
      aspectRatio: 1.35,
      events: '/api/calendar',
      eventClick: function(info) {
        console.log('[DEBUG] Event clicked:', info.event);
      },
      eventDidMount: function(info) {
        // Add weather icons if available
        updateEventWeather(info);
      },
      loading: function(isLoading) {
        console.log('[DEBUG] Calendar loading:', isLoading);
      },
      eventDisplay: 'block',
      dayMaxEvents: false,
      moreLinkClick: 'popover',
      nowIndicator: true,
      scrollTime: '08:00:00',
      eventTimeFormat: {
        hour: 'numeric',
        minute: '2-digit',
        omitZeroMinute: false,
        meridiem: 'short'
      }
    });

    calendar.render();
    console.log('[DEBUG] FullCalendar rendered successfully');

    // Force a resize after render to ensure proper sizing
    setTimeout(() => {
      if (calendar) {
        calendar.updateSize();
        console.log('[DEBUG] Calendar size updated after render');
      }
    }, 100);

  } catch (error) {
    console.error('[ERROR] Failed to initialize FullCalendar:', error);
    // Reset calendar variable so it can be retried
    calendar = null;

    // Show error message in calendar container
    calendarEl.innerHTML = `
      <div style="padding: 20px; text-align: center; color: var(--md-error);">
        <h3>Calendar Error</h3>
        <p>Failed to initialize calendar: ${error.message}</p>
        <button onclick="setupCalendar()" class="btn btn-primary">Retry</button>
      </div>
    `;
  }
}

// Screen dimming functionality
function resetInactivityTimer() {
  // Clear existing timer
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
  }

  // If screen burn protection is enabled, set new timer
  if (displaySettings.screenBurnProtection) {
    const dimAfterMs = displaySettings.dimAfterMinutes * 60 * 1000;
    inactivityTimer = setTimeout(dimScreen, dimAfterMs);
  }

  // If screen is dimmed, wake it up
  const screenDimmer = document.getElementById('screen-dimmer');
  if (screenDimmer && screenDimmer.classList.contains('active')) {
    wakeScreen();
  }
}

function dimScreen() {
  // Only proceed if screen burn protection is enabled
  if (!displaySettings.screenBurnProtection) return;

  const screenDimmer = document.getElementById('screen-dimmer');
  screenDimmer.classList.add('active');
  console.log('[INFO] Screen dimmed to prevent burn-in');

  // Start countdown
  dimmerCountdown = 30;
  updateDimmerCountdown();
  dimmerCountdownTimer = setInterval(updateDimmerCountdown, 1000);
}

function updateDimmerCountdown() {
  if (dimmerCountdown <= 0) {
    clearInterval(dimmerCountdownTimer);
    wakeScreen();
    return;
  }

  const dimmerCountdownEl = document.getElementById('dimmer-countdown');
  if (dimmerCountdownEl) {
    dimmerCountdownEl.textContent = dimmerCountdown;
  }
  dimmerCountdown--;
}

function wakeScreen() {
  const screenDimmer = document.getElementById('screen-dimmer');
  screenDimmer.classList.remove('active');
  if (dimmerCountdownTimer) {
    clearInterval(dimmerCountdownTimer);
  }
  resetInactivityTimer();
}

// Fetch display settings
async function fetchDisplaySettings() {
  try {
    const response = await fetch('/api/display-settings');
    if (!response.ok) throw new Error(`Failed to load display settings: ${response.status}`);

    const settings = await response.json();
    displaySettings = { ...displaySettings, ...settings };

    console.log('[INFO] Loaded display settings:', displaySettings);

    // Apply display clock setting
    const clockDisplay = document.getElementById('clock-display');
    if (displaySettings.displayClock && clockDisplay) {
      clockDisplay.classList.add('active');
    }

    // Initialize screen burn protection
    if (displaySettings.screenBurnProtection) {
      resetInactivityTimer();
    }

    // Update UI to match settings if elements exist
    const settingsElements = {
      'screen-burn-protection': displaySettings.screenBurnProtection,
      'dim-after-minutes': displaySettings.dimAfterMinutes,
      'display-clock': displaySettings.displayClock
    };

    Object.entries(settingsElements).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element) {
        if (element.type === 'checkbox') {
          element.checked = value;
        } else {
          element.value = value;
        }
      }
    });

  } catch (error) {
    console.error('[ERROR] Failed to load display settings:', error);
    // Continue with default settings
  }
}

// Update time display
function updateTime() {
  const now = new Date();

  // Format time based on configuration
  let timeFormat = 'h:mm A';
  if (window.appConfig && window.appConfig.time_format === '24h') {
    timeFormat = 'HH:mm';
  }

  const timeStr = moment(now).format(timeFormat);
  const dateStr = moment(now).format('dddd, MMMM D, Y');

  const currentTime = document.getElementById('current-time');
  const currentDate = document.getElementById('current-date');

  if (currentTime) {
    currentTime.textContent = timeStr;
  }

  if (currentDate) {
    currentDate.textContent = dateStr;
  }
}

// Fetch weather data
function fetchWeather() {
  if (!window.appConfig || !window.appConfig.show_weather) {
    const weatherContainer = document.getElementById('weather-container');
    if (weatherContainer) {
      weatherContainer.style.display = 'none';
    }
    return;
  }

  // Ensure weather container is potentially visible if weather is shown
  const weatherContainerElement = document.getElementById('weather-container');
  if (weatherContainerElement) {
    weatherContainerElement.style.display = 'flex';
    // Add loading indicator
    weatherContainerElement.innerHTML = '<div class="loading"><i class="material-icons spin">refresh</i> Loading weather...</div>';
  }

  fetch('/api/weather')
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    })
    .then(apiResponse => {
      console.log('[DEBUG] Weather data received from /api/weather:', JSON.stringify(apiResponse, null, 2));

      if (apiResponse.enabled === false) {
        console.log('[INFO] Weather display is disabled by API.');
        if (weatherContainerElement) {
          weatherContainerElement.style.display = 'none';
        }
        return;
      }

      if (apiResponse.error) {
        console.error('[ERROR] API returned an error for weather:', apiResponse.error);
        displayWeatherError(apiResponse.error);
        return;
      }

      let haStateObject = null;
      let forecastArrayFromAPI = [];

      console.log('[DEBUG] Checking apiResponse.current:', apiResponse.current);
      if (apiResponse.current && typeof apiResponse.current === 'object') {
        haStateObject = apiResponse.current;
        console.log('[DEBUG] Using apiResponse.current as haStateObject:', JSON.stringify(haStateObject, null, 2));

        // Check if current state is error or unavailable
        if (haStateObject.state === 'unavailable' || haStateObject.state === 'error') {
          displayWeatherError(`Weather data ${haStateObject.state}: ${apiResponse.error || 'Service unavailable'}`);
          return;
        }

        if (apiResponse.forecast && Array.isArray(apiResponse.forecast)) {
          forecastArrayFromAPI = apiResponse.forecast;
        } else if (haStateObject.attributes && haStateObject.attributes.forecast && Array.isArray(haStateObject.attributes.forecast)) {
          forecastArrayFromAPI = haStateObject.attributes.forecast;
        }
      } else if (apiResponse.attributes && apiResponse.state) {
        // Fallback for when apiResponse itself is the HA state object
        console.warn('[WARN] Weather API returned HA state object directly (i.e., apiResponse is the state object).');
        haStateObject = apiResponse;
        console.log('[DEBUG] Using apiResponse itself as haStateObject:', JSON.stringify(haStateObject, null, 2));
        if (haStateObject.attributes && haStateObject.attributes.forecast && Array.isArray(haStateObject.attributes.forecast)) {
          forecastArrayFromAPI = haStateObject.attributes.forecast;
        }
      } else {
        console.error('[ERROR] Could not determine the Home Assistant state object from the API response structure.', JSON.stringify(apiResponse, null, 2));
        displayWeatherError('Unexpected weather data format.');
        return;
      }

      if (!haStateObject || typeof haStateObject.attributes !== 'object') {
        console.error('[ERROR] haStateObject is invalid or missing attributes. haStateObject:', JSON.stringify(haStateObject, null, 2));
        displayWeatherError('Weather data format error (no attributes).');
        return;
      }

      const attributes = haStateObject.attributes || {};

      // Get temperature with better handling of null/undefined cases
      const tempValue = attributes.temperature !== undefined ? attributes.temperature : null;
      // Only round the temperature if it's a number
      const temp = tempValue !== null ? Math.round(tempValue) : '-';
      const condition = attributes.condition || haStateObject.state || 'unknown';

      console.log('[DEBUG] Current weather interpreted:', { temp, condition });

      window.currentWeather = { temp, condition };

      if (forecastArrayFromAPI.length === 0 && attributes.forecast && Array.isArray(attributes.forecast)) {
        forecastArrayFromAPI = attributes.forecast;
      }

      weatherForecastData = preprocessWeatherData(forecastArrayFromAPI || []);
      console.log('[DEBUG] Processed weather forecast data:', weatherForecastData);

      updateCurrentWeatherDisplay(temp, condition);
    })
    .catch(error => {
      console.error('[ERROR] Error fetching or processing weather data:', error.message, error.stack);
      displayWeatherError('Failed to load weather.');
    });
}

// Helper function to display errors in the weather container
function displayWeatherError(message) {
  const weatherContainer = document.getElementById('weather-container');
  if (weatherContainer) {
    // Clear any previous content (like loading indicators or old data)
    weatherContainer.innerHTML = `
      <div class="weather-error">
        <div class="temp">--°</div>
        <div class="condition"><i class="material-icons">error</i></div>
        <div class="error-message">${message}</div>
      </div>
    `;
    weatherContainer.style.display = 'flex'; // Ensure it's visible
  }
  // Clear any existing weather icons from calendar and global stores
  weatherForecastData = [];
  window.currentWeather = null;
}

// Process weather data to ensure consistent format
function preprocessWeatherData(forecastData) {
  if (!forecastData || !Array.isArray(forecastData) || forecastData.length === 0) {
    console.log('[DEBUG] No forecast data to process');
    return [];
  }

  console.log('[DEBUG] Processing forecast data:', forecastData);

  return forecastData.map(entry => {
    if (!entry) return null;

    // Create a standardized forecast entry
    return {
      datetime: entry.datetime || entry.date || null,
      condition: entry.condition || entry.state || 'unknown',
      temperature: entry.temperature || entry.temp || 0,
      templow: entry.templow || entry.min_temp || 0,
      humidity: entry.humidity || 0,
      precipitation: entry.precipitation || 0
    };
  }).filter(entry => entry && entry.datetime); // Filter out invalid entries
}

// Update the current weather display in the top-right corner
function updateCurrentWeatherDisplay(temp, condition) {
  console.log('[DEBUG] Updating current weather display:', temp, condition);

  const weatherContainer = document.getElementById('weather-container');

  if (!weatherContainer) {
    console.error('[ERROR] Weather container not found in DOM');
    return;
  }

  // Clear any previous content (like error messages or loading indicators)
  weatherContainer.innerHTML = '';

  // Create structure elements if they don't exist
  const tempDiv = document.createElement('div');
  tempDiv.className = 'temp';
  weatherContainer.appendChild(tempDiv);

  const conditionDiv = document.createElement('div');
  conditionDiv.className = 'condition';
  weatherContainer.appendChild(conditionDiv);

  const conditionIcon = document.createElement('i');
  conditionIcon.className = 'material-icons';
  conditionDiv.appendChild(conditionIcon);

  // Update temperature - handle non-numeric values
  if (temp === null || temp === undefined || temp === '-') {
    tempDiv.textContent = '--°';
  } else {
    tempDiv.textContent = `${temp}°`;
  }
  console.log('[DEBUG] Updated temperature display to:', tempDiv.textContent);

  // Map Home Assistant weather condition to Material Icons
  const iconMap = {
    'clear-night': 'nights_stay',
    'cloudy': 'cloud',
    'fog': 'foggy',
    'hail': 'grain',
    'lightning': 'flash_on',
    'lightning-rainy': 'thunderstorm',
    'partlycloudy': 'cloud_queue',
    'pouring': 'wb_cloudy',
    'rainy': 'water_drop',
    'snowy': 'ac_unit',
    'snowy-rainy': 'snowing',
    'sunny': 'wb_sunny',
    'windy': 'air',
    'windy-variant': 'air',
    'exceptional': 'warning',
    'unavailable': 'help',
    'error': 'error'
  };

  // Update weather icon
  conditionIcon.textContent = iconMap[condition] || 'cloud';
  console.log('[DEBUG] Updated weather icon to:', iconMap[condition] || 'cloud');
}

// Stub functions to prevent errors
function fetchCalendarEvents() {
  console.log('[INFO] fetchCalendarEvents called - fetching calendar events');

  // Simulate fetching calendar events
  if (calendar) {
    // Add some sample events for demonstration
    const sampleEvents = [
      {
        id: '1',
        title: 'Team Meeting',
        start: moment().startOf('day').add(9, 'hours').toDate(),
        end: moment().startOf('day').add(10, 'hours').toDate(),
        backgroundColor: '#4285f4'
      },
      {
        id: '2',
        title: 'Lunch Break',
        start: moment().startOf('day').add(12, 'hours').toDate(),
        end: moment().startOf('day').add(13, 'hours').toDate(),
        backgroundColor: '#34a853'
      },
      {
        id: '3',
        title: 'Project Review',
        start: moment().startOf('day').add(1, 'day').add(14, 'hours').toDate(),
        end: moment().startOf('day').add(1, 'day').add(15, 'hours').toDate(),
        backgroundColor: '#ea4335'
      }
    ];

    // Add events to calendar
    sampleEvents.forEach(event => {
      calendar.addEvent(event);
    });

    console.log('[INFO] Added sample calendar events');
  }
}

function loadUserToggles() {
  console.log('[INFO] loadUserToggles called - loading user toggles');

  // Setup calendar view toggles if they exist
  const calendarContainer = document.querySelector('#calendar-content');
  if (calendarContainer) {
    // Add any calendar-specific toggle buttons or settings
    console.log('[INFO] Calendar toggles loaded');
  }
}

function fetchAndDisplayChores() {
  console.log('[INFO] fetchAndDisplayChores called - fetching and displaying chores');

  const choreBoard = document.getElementById('chore-board');
  if (choreBoard) {
    // Create kanban board lanes
    const lanes = [
      { id: 'todo', title: 'To Do', color: '#6c757d' },
      { id: 'in-progress', title: 'In Progress', color: '#ffc107' },
      { id: 'done', title: 'Done', color: '#28a745' }
    ];

    // Sample chores
    const sampleChores = [
      { id: '1', title: 'Take out trash', assignee: 'Alex', lane: 'todo', dueDate: moment().add(1, 'day').format('YYYY-MM-DD') },
      { id: '2', title: 'Do laundry', assignee: 'Jordan', lane: 'in-progress', dueDate: moment().format('YYYY-MM-DD') },
      { id: '3', title: 'Clean kitchen', assignee: 'Casey', lane: 'done', dueDate: moment().subtract(1, 'day').format('YYYY-MM-DD') }
    ];

    let boardHTML = '';
    lanes.forEach(lane => {
      const laneChores = sampleChores.filter(chore => chore.lane === lane.id);

      boardHTML += `
        <div class="kanban-lane" data-lane="${lane.id}">
          <div class="lane-header" style="background-color: ${lane.color};">
            <h3>${lane.title}</h3>
            <span class="lane-count">${laneChores.length}</span>
          </div>
          <div class="lane-content">
            ${laneChores.map(chore => `
              <div class="chore-card" data-chore-id="${chore.id}">
                <div class="chore-title">${chore.title}</div>
                <div class="chore-meta">
                  <span class="chore-assignee">${chore.assignee}</span>
                  <span class="chore-due">Due: ${moment(chore.dueDate).format('MMM D')}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    });

    choreBoard.innerHTML = boardHTML;
    console.log('[INFO] Chore board populated with sample data');
  }
}

function fetchAndDisplayMeals() {
  console.log('[INFO] fetchAndDisplayMeals called - fetching and displaying meals');

  const mealWeekView = document.getElementById('meal-week-view');
  if (mealWeekView) {
    // Create week view for meals
    const days = [];
    for (let i = 0; i < 7; i++) {
      days.push(moment().startOf('week').add(i, 'days'));
    }

    const mealTypes = ['Breakfast', 'Lunch', 'Dinner'];

    // Sample meals
    const sampleMeals = [
      { day: 0, type: 'Breakfast', description: 'Pancakes', cook: 'Alex' },
      { day: 0, type: 'Dinner', description: 'Spaghetti & Meatballs', cook: 'Jordan' },
      { day: 1, type: 'Lunch', description: 'Caesar Salad', cook: 'Casey' },
      { day: 2, type: 'Dinner', description: 'Grilled Chicken', cook: 'Taylor' }
    ];

    let weekHTML = `
      <div class="meal-week-header">
        <div class="week-navigation">
          <h3>Week of ${moment().startOf('week').format('MMMM D, YYYY')}</h3>
        </div>
      </div>
      <div class="meal-week-grid">
        <div class="meal-grid-header">
          <div class="meal-time-column"></div>
          ${days.map(day => `
            <div class="meal-day-header">
              <div class="day-name">${day.format('ddd')}</div>
              <div class="day-date">${day.format('M/D')}</div>
            </div>
          `).join('')}
        </div>
    `;

    mealTypes.forEach(mealType => {
      weekHTML += `
        <div class="meal-row">
          <div class="meal-time-label">${mealType}</div>
          ${days.map((day, dayIndex) => {
            const meal = sampleMeals.find(m => m.day === dayIndex && m.type === mealType);
            return `
              <div class="meal-slot" data-day="${dayIndex}" data-meal-type="${mealType}">
                ${meal ? `
                  <div class="meal-item">
                    <div class="meal-description">${meal.description}</div>
                    <div class="meal-cook">${meal.cook}</div>
                  </div>
                ` : `
                  <div class="meal-empty">
                    <i class="material-icons">add</i>
                  </div>
                `}
              </div>
            `;
          }).join('')}
        </div>
      `;
    });

    weekHTML += '</div>';
    mealWeekView.innerHTML = weekHTML;

    // Add click handlers for empty meal slots
    mealWeekView.addEventListener('click', (e) => {
      const mealSlot = e.target.closest('.meal-slot');
      if (mealSlot && mealSlot.querySelector('.meal-empty')) {
        const day = mealSlot.dataset.day;
        const mealType = mealSlot.dataset.mealType;
        console.log('[INFO] Clicked empty meal slot:', day, mealType);

        // Open add meal modal with pre-filled data
        const addMealModal = document.getElementById('add-meal-modal');
        const mealTypeSelect = document.getElementById('mealType');
        const mealDateInput = document.getElementById('mealDate');

        if (addMealModal && mealTypeSelect && mealDateInput) {
          // Populate meal types
          mealTypeSelect.innerHTML = mealTypes.map(type =>
            `<option value="${type}" ${type === mealType ? 'selected' : ''}>${type}</option>`
          ).join('');

          mealDateInput.value = moment().startOf('week').add(parseInt(day), 'days').format('YYYY-MM-DD');
          addMealModal.classList.add('show');
        }
      }
    });

    console.log('[INFO] Meal week view populated with sample data');
  }
}

function loadProfilesForSettings() {
  console.log('[INFO] loadProfilesForSettings called - loading user profiles');

  const profileListSettings = document.getElementById('profile-list-settings');
  if (profileListSettings) {
    // Sample profiles for settings
    const profiles = [
      { id: 'alex', name: 'Alex', color: '#4285f4', playtime: 30 },
      { id: 'jordan', name: 'Jordan', color: '#34a853', playtime: 45 },
      { id: 'casey', name: 'Casey', color: '#fbbc05', playtime: 20 },
      { id: 'taylor', name: 'Taylor', color: '#ea4335', playtime: 35 }
    ];

    profileListSettings.innerHTML = profiles.map(profile => `
      <div class="profile-settings-item" data-profile-id="${profile.id}">
        <div class="profile-avatar" style="background-color: ${profile.color};">
          ${profile.name.charAt(0)}
        </div>
        <div class="profile-details">
          <div class="profile-name">${profile.name}</div>
          <div class="profile-playtime">Daily playtime: ${profile.playtime} minutes</div>
        </div>
        <div class="profile-actions">
          <button class="btn btn-sm btn-secondary edit-profile" data-profile-id="${profile.id}">
            <i class="material-icons">edit</i>
          </button>
          <button class="btn btn-sm btn-danger delete-profile" data-profile-id="${profile.id}">
            <i class="material-icons">delete</i>
          </button>
        </div>
      </div>
    `).join('');

    // Add event listeners for profile actions
    profileListSettings.addEventListener('click', (e) => {
      if (e.target.closest('.edit-profile')) {
        const profileId = e.target.closest('.edit-profile').dataset.profileId;
        console.log('[INFO] Edit profile clicked:', profileId);
        // This would open an edit profile modal
      }

      if (e.target.closest('.delete-profile')) {
        const profileId = e.target.closest('.delete-profile').dataset.profileId;
        if (confirm('Are you sure you want to delete this profile?')) {
          console.log('[INFO] Delete profile confirmed:', profileId);
          // This would delete the profile
        }
      }
    });

    console.log('[INFO] Profiles loaded in settings');
  }
}

function updateEventWeather(info) {
  // Add weather icons to calendar events if weather data is available
  console.log('[DEBUG] updateEventWeather called for event:', info.event.title);

  if (weatherForecastData && weatherForecastData.length > 0) {
    const eventDate = moment(info.event.start);
    const weatherForDay = weatherForecastData.find(w =>
      moment(w.datetime).isSame(eventDate, 'day')
    );

    if (weatherForDay) {
      const iconMap = {
        'clear-night': 'nights_stay',
        'cloudy': 'cloud',
        'partlycloudy': 'cloud_queue',
        'sunny': 'wb_sunny',
        'rainy': 'water_drop'
      };

      const weatherIcon = iconMap[weatherForDay.condition] || 'cloud';

      // Add weather icon to event element
      const eventEl = info.el;
      const weatherSpan = document.createElement('span');
      weatherSpan.className = 'event-weather-icon material-icons';
      weatherSpan.textContent = weatherIcon;
      weatherSpan.style.fontSize = '12px';
      weatherSpan.style.marginLeft = '4px';

      const titleEl = eventEl.querySelector('.fc-event-title');
      if (titleEl) {
        titleEl.appendChild(weatherSpan);
      }
    }
  }
}


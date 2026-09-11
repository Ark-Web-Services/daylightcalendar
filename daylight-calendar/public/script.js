/* Daylight Calendar - Main JavaScript */

console.log('[INFO] Initializing Daylight Calendar client...');

// Global variables
let inactivityTimer;
let dimmerCountdownTimer;
let dimmerCountdown = 30;
let weatherForecastData = [];
let calendar;
let allCalendarUsers = [];
let activeCalendarUsers = new Set();

// Display settings (default values)
let displaySettings = {
  screenBurnProtection: true,
  dimAfterMinutes: 10,
  displayClock: false
};

// Initial setup
document.addEventListener('DOMContentLoaded', function () {
  console.log('[INFO] DOM Content Loaded');

  // Load configuration first
  fetch('api/config')
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
  document.addEventListener('turbo:frame-load', function (event) {
    const frame = event.target;
    console.log('[DEBUG] Turbo frame loaded:', frame.id);

    // Re-setup modals for any new content
    setupModals();

    switch (frame.id) {
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
  document.addEventListener('DOMContentLoaded', function () {
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
        switch (frameId) {
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
      addChoreForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        console.log('[INFO] Add chore form submitted');
        const formData = new FormData(addChoreForm);
        const choreData = Object.fromEntries(formData);

        try {
          const response = await fetch('api/chores', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              item: choreData.choreName
            })
          });

          if (response.ok) {
            console.log('[INFO] Chore added successfully');
            addChoreModal.classList.remove('show');
            addChoreForm.reset();
            fetchAndDisplayChores(); // Refresh list
          } else {
            console.error('[ERROR] Failed to add chore');
            alert('Failed to add chore. Please try again.');
          }
        } catch (error) {
          console.error('[ERROR] Error adding chore:', error);
          alert('Error adding chore: ' + error.message);
        }
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
      screenBurnProtection.addEventListener('change', function (e) {
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
      dimAfterMinutes.addEventListener('change', function (e) {
        displaySettings.dimAfterMinutes = parseInt(e.target.value, 10);
        console.log('[INFO] Dim after minutes:', displaySettings.dimAfterMinutes);
        resetInactivityTimer();
      });
      console.log('[DEBUG] Dim after minutes listener added');
    }

    if (displayClock) {
      displayClock.addEventListener('change', function (e) {
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

    // Validates if settings page elements exist before attaching listeners
    const addUserBtn = document.getElementById('add-user-btn');
    if (addUserBtn) {
      const modal = document.getElementById('add-user-modal');
      const form = document.getElementById('add-user-form');

      addUserBtn.addEventListener('click', () => {
        modal.classList.add('show');
        populateUserDropdowns();
        const input = document.getElementById('new-user-name');
        if (input) input.focus();
      });

      if (form && typeof handleCreateUser === 'function') {
        form.addEventListener('submit', handleCreateUser);
      }

      // Initial fetch
      if (typeof fetchUsers === 'function') {
        fetchUsers();
      }
    }

    // Initialize CalDAV settings (accounts list, connect button, edit form)
    if (typeof initializeCalDAVSettings === 'function') {
      initializeCalDAVSettings();
    }

    // Re-setup modals for settings page (generic closers)
    setupModals();
    setupColorAndIconSelectors();
    console.log('[DEBUG] Modals re-setup for settings page');

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
    sidebarToggle.addEventListener('click', function () {
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

        // Force FullCalendar to recalculate its dimensions now that container is visible
        if (target === 'calendar-page' && typeof calendar !== 'undefined' && calendar) {
          setTimeout(() => {
            calendar.updateSize();
          }, 50);
        }
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

function setupColorAndIconSelectors() {
  document.querySelectorAll('.color-selector').forEach(selector => {
    const input = selector.parentElement.querySelector('input[type="hidden"]');
    if (!input) return;
    const btns = selector.querySelectorAll('.color-option');
    btns.forEach(btn => {
      btn.onclick = (e) => {
        e.preventDefault();
        btns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        input.value = btn.dataset.color;
      };
    });
  });

  document.querySelectorAll('.icon-selector').forEach(selector => {
    const input = selector.parentElement.querySelector('input[type="hidden"]');
    if (!input) return;
    const btns = selector.querySelectorAll('.icon-option');
    btns.forEach(btn => {
      btn.onclick = (e) => {
        e.preventDefault();
        btns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        input.value = btn.dataset.icon;
      };
    });
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
      events: function (fetchInfo, successCallback, failureCallback) {
        const url = `/api/calendar?start=${fetchInfo.startStr}&end=${fetchInfo.endStr}`;
        fetch(url)
          .then(res => {
            if (!res.ok) throw new Error('Network response was not ok');
            return res.json();
          })
          .then(events => {
            const filtered = events.filter(e => {
              // Strictly hide events that aren't mapped to a user profile
              if (!e.userId) return false;
              return activeCalendarUsers.has(e.userId);
            });

            // Color code events according to the user's color
            filtered.forEach(e => {
              if (e.userId) {
                const user = allCalendarUsers.find(u => u.id === e.userId);
                if (user && user.color) {
                  e.backgroundColor = user.color;
                  e.borderColor = user.color;
                }
              }
            });

            successCallback(filtered);
          })
          .catch(err => {
            console.error('[ERROR] Failed to fetch calendar events:', err);
            failureCallback(err);
          });
      },
      eventClick: function (info) {
        console.log('[DEBUG] Event clicked:', info.event);
      },
      eventDidMount: function (info) {
        // Add weather icons if available
        updateEventWeather(info);
      },
      loading: function (isLoading) {
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

    // Watch for window resizes and fix smuishing issues automatically
    window.addEventListener('resize', () => {
      if (calendar) {
        calendar.updateSize();
      }
    });

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
    const response = await fetch('api/user/display-settings');
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

  fetch('api/weather')
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

        // Check if the entity is simply missing from Home Assistant
        if (haStateObject.message === 'Entity not found.') {
          displayWeatherError(`Setup Weather Integration in HA`);
          return;
        }

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

  // Events are loaded directly by FullCalendar via the events URL configuration:
  // events: 'api/calendar'

  if (calendar) {
    calendar.refetchEvents();
    console.log('[INFO] Triggered calendar event refetch');
  }
}

async function loadUserToggles() {
  console.log('[INFO] loadUserToggles called - loading user toggles');

  const userTogglesContainer = document.getElementById('user-toggles');
  if (!userTogglesContainer) return;

  try {
    const res = await fetch('api/users');
    if (!res.ok) throw new Error('Failed to load users');

    allCalendarUsers = await res.json();

    // Automatically enable all users initially if none are set
    if (activeCalendarUsers.size === 0 && allCalendarUsers.length > 0) {
      allCalendarUsers.forEach(u => activeCalendarUsers.add(u.id));
    }

    userTogglesContainer.innerHTML = '';

    if (allCalendarUsers.length === 0) {
      userTogglesContainer.innerHTML = '<span class="no-users-msg" style="font-size: 0.9em; opacity: 0.7;">No users found</span>';
      return;
    }

    allCalendarUsers.forEach(user => {
      const btn = document.createElement('button');
      const isActive = activeCalendarUsers.has(user.id);

      btn.className = 'user-toggle ' + (isActive ? 'active' : '');
      btn.innerHTML = `<i class="material-icons">${user.icon || 'person'}</i>`;
      btn.title = user.name;
      btn.style.backgroundColor = isActive ? user.color : 'transparent';
      btn.style.color = isActive ? '#fff' : user.color;
      btn.style.borderColor = user.color || '#ccc';

      btn.addEventListener('click', () => {
        if (activeCalendarUsers.has(user.id)) {
          activeCalendarUsers.delete(user.id);
          btn.classList.remove('active');
          btn.style.backgroundColor = 'transparent';
          btn.style.color = user.color;
        } else {
          activeCalendarUsers.add(user.id);
          btn.classList.add('active');
          btn.style.backgroundColor = user.color;
          btn.style.color = '#fff';
        }

        // Trigger calendar refetch to apply filters
        if (calendar) {
          calendar.refetchEvents();
        }
      });

      userTogglesContainer.appendChild(btn);
    });
  } catch (err) {
    console.error('[ERROR] Error loading user toggles:', err);
  }
}

async function fetchAndDisplayChores() {
  console.log('[INFO] fetchAndDisplayChores called - fetching and displaying chores');

  const choreBoard = document.getElementById('chore-board');
  if (!choreBoard) return;

  try {
    const response = await fetch('api/chores');
    if (!response.ok) throw new Error('Failed to fetch chores');

    const data = await response.json();
    const chores = data.items || [];
    const entityId = data.entityId;

    // Create kanban board lanes
    // HA Todo items have status: 'needs_action' or 'completed'
    const lanes = [
      { id: 'needs_action', title: 'To Do', color: '#6c757d' },
      { id: 'completed', title: 'Done', color: '#28a745' }
    ];

    let boardHTML = '';
    lanes.forEach(lane => {
      const laneChores = chores.filter(chore => chore.status === lane.id);

      boardHTML += `
        <div class="kanban-lane" data-lane="${lane.id}">
          <div class="lane-header" style="background-color: ${lane.color};">
            <h3>${lane.title}</h3>
            <span class="lane-count">${laneChores.length}</span>
          </div>
          <div class="lane-content">
            ${laneChores.map(chore => `
              <div class="chore-card" data-chore-id="${chore.uid || chore.summary}" data-status="${chore.status}">
                <div class="chore-header">
                  <div class="chore-title">${chore.summary}</div>
                  <button class="chore-toggle-btn" onclick="toggleChoreStatus('${chore.uid || chore.summary}', '${chore.status}', '${entityId}')">
                    <i class="material-icons">${chore.status === 'completed' ? 'check_box' : 'check_box_outline_blank'}</i>
                  </button>
                </div>
                <div class="chore-meta">
                  ${chore.due ? `<span class="chore-due">Due: ${moment(chore.due).format('MMM D')}</span>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    });

    choreBoard.innerHTML = boardHTML;
    console.log('[INFO] Chore board populated with real data');

    // Add global function for toggle if not exists
    if (!window.toggleChoreStatus) {
      window.toggleChoreStatus = async function (itemId, currentStatus, entityId) {
        const newStatus = currentStatus === 'completed' ? 'needs_action' : 'completed';
        console.log(`[INFO] Toggling chore ${itemId} to ${newStatus}`);

        // Optimistic update
        const card = document.querySelector(`.chore-card[data-chore-id="${itemId}"]`);
        if (card) {
          card.style.opacity = '0.5';
        }

        try {
          const response = await fetch(`api/chores/${itemId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: newStatus,
              entityId: entityId
            })
          });

          if (response.ok) {
            fetchAndDisplayChores(); // Refresh to move card
          } else {
            console.error('Failed to update chore');
            if (card) card.style.opacity = '1';
          }
        } catch (error) {
          console.error('Error updating chore:', error);
          if (card) card.style.opacity = '1';
        }
      };
    }

  } catch (error) {
    console.error('[ERROR] Error fetching chores:', error);
    choreBoard.innerHTML = `<div class="error-message">Failed to load chores: ${error.message}</div>`;
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

async function loadCurrentHAUser() {
  console.log('[INFO] Loading current Home Assistant user');

  const currentUserSpan = document.getElementById('current-ha-user');
  if (currentUserSpan) {
    try {
      // Try to get current HA user info
      const response = await fetch('api/ha-proxy?endpoint=/api/config');
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data) {
          const haConfig = data.data;
          currentUserSpan.textContent = `Connected to: ${haConfig.location_name || 'Home Assistant'}`;
          currentUserSpan.style.color = '#4caf50';
        } else {
          currentUserSpan.textContent = 'Unable to connect to Home Assistant';
          currentUserSpan.style.color = '#f44336';
        }
      } else {
        currentUserSpan.textContent = 'Home Assistant connection error';
        currentUserSpan.style.color = '#f44336';
      }
    } catch (error) {
      console.error('[ERROR] Failed to load HA user info:', error);
      currentUserSpan.textContent = 'Error loading user info';
      currentUserSpan.style.color = '#f44336';
    }
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


// ── USER MANAGEMENT (SETTINGS PAGE) ──────────────────────────────────────

async function populateUserDropdowns() {
  const calendarSelect = document.getElementById('new-user-calendar');
  const notifySelect = document.getElementById('new-user-notify');

  if (!calendarSelect || !notifySelect) return;

  try {
    // parallel fetch
    const [calResp, evResp, notifyResp] = await Promise.all([
      fetch('api/ha/calendars'),
      fetch('api/calendar'),
      fetch('api/ha/notify-services')
    ]);

    let eventCounts = {};
    if (evResp.ok) {
      const allEvents = await evResp.json();
      eventCounts = allEvents.reduce((acc, ev) => {
        if (ev.calendar_entity_id) {
          acc[ev.calendar_entity_id] = (acc[ev.calendar_entity_id] || 0) + 1;
        }
        return acc;
      }, {});
    }

    if (calResp.ok) {
      const calendars = await calResp.json();
      calendarSelect.innerHTML = calendars.map(c => {
        const count = eventCounts[c.entity_id] || 0;
        return `
          <label style="display:flex; align-items:center; margin-bottom: 6px; cursor: pointer; color: #fff; font-size: 14px;">
            <input type="checkbox" value="${c.entity_id}" class="cal-checkbox" style="margin-right: 8px;">
            <span style="flex-grow: 1;">${c.name}</span>
            <span style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 12px; font-size: 11px;">${count}</span>
          </label>
        `;
      }).join('') || '<div style="color: #a1b2c3;">No calendars found</div>';
    }

    if (notifyResp.ok) {
      const services = await notifyResp.json();
      notifySelect.innerHTML = '<option value="">-- None --</option>' +
        services.map(s => `<option value="${s.service}">${s.name}</option>`).join('');
    }
  } catch (err) {
    console.error('Failed to populate dropdowns', err);
  }
}

async function populateEditDropdowns(currentCalendar, currentNotify) {
  const calendarSelect = document.getElementById('edit-user-calendar');
  const notifySelect = document.getElementById('edit-user-notify');

  if (!calendarSelect || !notifySelect) return;

  try {
    const [calResp, evResp, notifyResp] = await Promise.all([
      fetch('api/ha/calendars'),
      fetch('api/calendar'),
      fetch('api/ha/notify-services')
    ]);

    let eventCounts = {};
    if (evResp.ok) {
      const allEvents = await evResp.json();
      eventCounts = allEvents.reduce((acc, ev) => {
        if (ev.calendar_entity_id) {
          acc[ev.calendar_entity_id] = (acc[ev.calendar_entity_id] || 0) + 1;
        }
        return acc;
      }, {});
    }

    if (calResp.ok) {
      const calendars = await calResp.json();
      const currentCals = (currentCalendar || '').split(',');
      calendarSelect.innerHTML = calendars.map(c => {
        const count = eventCounts[c.entity_id] || 0;
        const isChecked = currentCals.includes(c.entity_id) ? 'checked' : '';
        return `
          <label style="display:flex; align-items:center; margin-bottom: 6px; cursor: pointer; color: #fff; font-size: 14px;">
            <input type="checkbox" value="${c.entity_id}" class="cal-checkbox" style="margin-right: 8px;" ${isChecked}>
            <span style="flex-grow: 1;">${c.name}</span>
            <span style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 12px; font-size: 11px;">${count}</span>
          </label>
        `;
      }).join('') || '<div style="color: #a1b2c3;">No calendars found</div>';
    }

    if (notifyResp.ok) {
      const services = await notifyResp.json();
      notifySelect.innerHTML = '<option value="">-- None --</option>' +
        services.map(s =>
          `<option value="${s.service}" ${s.service === currentNotify ? 'selected' : ''}>${s.name}</option>`
        ).join('');
    }
  } catch (err) {
    console.error('Failed to populate edit dropdowns', err);
  }
}

async function fetchUsers() {
  const listContainer = document.getElementById('user-list');
  if (!listContainer) return;

  try {
    const resp = await fetch('api/users');
    if (!resp.ok) throw new Error('Failed to fetch users');
    const users = await resp.json();

    if (users.length === 0) {
      listContainer.innerHTML = '<div class="no-users">No users found.</div>';
      return;
    }

    let html = '';
    users.forEach(user => {
      const initials = user.name ? user.name.substring(0, 2).toUpperCase() : '??';
      const avatarUrl = user.picture || user.entity_picture;

      let avatarHtml;
      if (avatarUrl) {
        avatarHtml = `<img src="${avatarUrl}" alt="${user.name}" class="user-avatar-img">`;
      } else {
        avatarHtml = `<div class="user-avatar-placeholder">${initials}</div>`;
      }

      const calLabel = user.calendar_entity_id
        ? `<span class="user-calendar-label"><i class="material-icons" style="font-size:14px;vertical-align:middle;">event</i> ${user.calendar_entity_id}</span>`
        : '<span class="user-calendar-label" style="opacity:0.5;">No calendar linked</span>';

      html += `
        <div class="user-item" data-user-id="${user.id}" data-user-name="${user.name || ''}" data-calendar="${user.calendar_entity_id || ''}" data-notify="${user.notify_service || ''}" style="cursor:pointer;" onclick="openEditUserModal('${user.id}', '${(user.name || '').replace(/'/g, "\\'")}', '${user.calendar_entity_id || ''}', '${user.notify_service || ''}', '${user.color || '#4285f4'}', '${user.icon || 'person'}')">
          <div class="user-avatar">
            ${avatarHtml}
          </div>
          <div class="user-info">
            <div class="user-name">${user.name || 'Unknown'}</div>
            <div class="user-details">${calLabel}</div>
          </div>
          <div class="user-edit-icon">
            <i class="material-icons">edit</i>
          </div>
        </div>
      `;
    });
    listContainer.innerHTML = html;

  } catch (err) {
    console.error('Error fetching users:', err);
    listContainer.innerHTML = '<div class="error-users">Failed to load users</div>';
  }
}

function openEditUserModal(userId, userName, currentCalendar, currentNotify, currentColor, currentIcon) {
  const modal = document.getElementById('edit-user-modal');
  if (!modal) return;

  document.getElementById('edit-user-id').value = userId;
  document.getElementById('edit-user-display-name').textContent = userName;

  const colorInput = document.getElementById('edit-user-color');
  if (colorInput) {
    colorInput.value = currentColor || '#4285f4';
    document.querySelectorAll('#edit-user-color-selector .color-option').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.color === colorInput.value);
    });
  }

  const iconInput = document.getElementById('edit-user-icon');
  if (iconInput) {
    iconInput.value = currentIcon || 'person';
    document.querySelectorAll('#edit-user-icon-selector .icon-option').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.icon === iconInput.value);
    });
  }

  populateEditDropdowns(currentCalendar, currentNotify);

  modal.classList.add('show');
}

async function handleUpdateUser(e) {
  e.preventDefault();
  const userId = document.getElementById('edit-user-id').value;
  const calendarEntityId = Array.from(
    document.querySelectorAll('#edit-user-calendar .cal-checkbox:checked')
  ).map(cb => cb.value);
  const notifyService = document.getElementById('edit-user-notify').value || null;
  const color = document.getElementById('edit-user-color')?.value || '#4285f4';
  const icon = document.getElementById('edit-user-icon')?.value || 'person';

  const btn = e.target.querySelector('button[type="submit"]');
  const originalText = btn.textContent;
  btn.textContent = 'Saving...';
  btn.disabled = true;

  try {
    const resp = await fetch(`api/users/${userId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        calendar_entity_id: calendarEntityId,
        notify_service: notifyService,
        color: color,
        icon: icon
      })
    });

    if (!resp.ok) {
      const errData = await resp.json();
      throw new Error(errData.error || 'Update failed');
    }

    document.getElementById('edit-user-modal').classList.remove('show');
    fetchUsers(); // Refresh list
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

async function handleCreateUser(e) {
  e.preventDefault();
  const nameInput = document.getElementById('new-user-name');
  const name = nameInput.value.trim();
  if (!name) return;

  const btn = e.target.querySelector('button[type="submit"]');
  const originalText = btn.textContent;
  btn.textContent = 'Creating...';
  btn.disabled = true;

  try {
    const resp = await fetch('api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        calendar_entity_id: Array.from(
          document.querySelectorAll('#new-user-calendar .cal-checkbox:checked')
        ).map(cb => cb.value),
        notify_service: document.getElementById('new-user-notify').value || null,
        color: document.getElementById('new-user-color')?.value || '#4285f4',
        icon: document.getElementById('new-user-icon')?.value || 'person'
      })
    });

    if (!resp.ok) {
      const errData = await resp.json();
      throw new Error(errData.error || 'Creation failed');
    }

    // Success
    document.getElementById('add-user-modal').classList.remove('show');
    nameInput.value = '';
    fetchUsers(); // Refresh list
    alert(`User "${name}" created successfully!`);

  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

// ── CALDAV ACCOUNT MANAGEMENT ────────────────────────────────────────────

async function fetchCalDAVAccounts() {
  const container = document.getElementById('caldav-accounts-list');
  if (!container) return;

  try {
    const resp = await fetch('api/caldav/accounts');
    if (!resp.ok) throw new Error('Failed to fetch accounts');
    const accounts = await resp.json();

    if (accounts.length === 0) {
      container.innerHTML = '<div class="no-accounts" style="padding: 10px; opacity: 0.6;">No calendar accounts connected yet.</div>';
      return;
    }

    let html = '';
    accounts.forEach(acc => {
      const calCount = (acc.calendars || []).length;
      html += `
        <div class="caldav-account-item" data-account-id="${acc.id}">
          <div class="caldav-account-info">
            <div class="caldav-account-icon">🍎</div>
            <div class="caldav-account-details">
              <div class="caldav-account-email">${acc.appleId}</div>
              <div class="caldav-account-meta">${calCount} calendar${calCount !== 1 ? 's' : ''} · Connected ${new Date(acc.connectedAt).toLocaleDateString()}</div>
            </div>
          </div>
          <button class="btn btn-small btn-danger caldav-disconnect-btn" onclick="disconnectCalDAVAccount('${acc.id}')">
            <i class="material-icons" style="font-size:16px;">link_off</i> Disconnect
          </button>
        </div>
      `;
    });
    container.innerHTML = html;
  } catch (err) {
    console.error('Error fetching CalDAV accounts:', err);
    container.innerHTML = '<div class="error-accounts">Failed to load accounts</div>';
  }
}

async function connectAppleCalendar() {
  const appleIdInput = document.getElementById('caldav-apple-id');
  const passwordInput = document.getElementById('caldav-app-password');
  const statusEl = document.getElementById('caldav-connect-status');
  const connectBtn = document.getElementById('caldav-connect-btn');

  const appleId = appleIdInput.value.trim();
  const appPassword = passwordInput.value.trim();
  const userId = document.getElementById('caldav-user-select').value;

  if (!appleId || !appPassword || !userId) {
    statusEl.textContent = 'Please enter Apple ID, app-specific password, and select a user.';
    statusEl.className = 'caldav-connect-status error';
    statusEl.style.display = 'block';
    return;
  }

  connectBtn.disabled = true;
  connectBtn.innerHTML = '<i class="material-icons">hourglass_empty</i> Connecting...';
  statusEl.textContent = 'Connecting to Apple Calendar...';
  statusEl.className = 'caldav-connect-status info';
  statusEl.style.display = 'block';

  try {
    const resp = await fetch('api/caldav/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appleId, appPassword, userId })
    });

    if (!resp.ok) {
      const errData = await resp.json();
      throw new Error(errData.error || 'Connection failed');
    }

    const account = await resp.json();
    const calCount = (account.calendars || []).length;

    statusEl.textContent = `✓ Connected! Found ${calCount} calendar${calCount !== 1 ? 's' : ''}.`;
    statusEl.className = 'caldav-connect-status success';

    // Clear inputs
    appleIdInput.value = '';
    passwordInput.value = '';

    // Refresh accounts list
    fetchCalDAVAccounts();

    // Hide success message after 3 seconds
    setTimeout(() => {
      statusEl.style.display = 'none';
    }, 3000);

  } catch (err) {
    statusEl.textContent = `✗ ${err.message}`;
    statusEl.className = 'caldav-connect-status error';
  } finally {
    connectBtn.disabled = false;
    connectBtn.innerHTML = '<i class="material-icons">link</i> Connect Apple Calendar';
  }
}

async function disconnectCalDAVAccount(accountId) {
  if (!confirm('Disconnect this calendar account? Events from this account will no longer appear.')) {
    return;
  }

  try {
    const resp = await fetch(`api/caldav/accounts/${accountId}`, {
      method: 'DELETE'
    });

    if (!resp.ok) {
      const errData = await resp.json();
      throw new Error(errData.error || 'Failed to disconnect');
    }

    fetchCalDAVAccounts(); // Refresh
  } catch (err) {
    alert('Error disconnecting: ' + err.message);
  }
}

// ── SETTINGS PAGE CALDAV INITIALIZATION ──────────────────────────────────

function initializeCalDAVSettings() {
  // Load connected accounts
  fetchCalDAVAccounts();

  // Wire up connect button
  const connectBtn = document.getElementById('caldav-connect-btn');
  if (connectBtn) {
    connectBtn.addEventListener('click', connectAppleCalendar);
  }

  // Wire up sync button
  const syncBtn = document.getElementById('caldav-sync-btn');
  if (syncBtn) {
    syncBtn.addEventListener('click', handleCalDAVSync);
  }

  // Wire up edit user form
  const editForm = document.getElementById('edit-user-form');
  if (editForm) {
    editForm.addEventListener('submit', handleUpdateUser);
  }

  // Populate user dropdown for CalDAV
  populateCalDAVUserDropdown();
}

async function handleCalDAVSync() {
  const syncBtn = document.getElementById('caldav-sync-btn');
  const logsEl = document.getElementById('caldav-sync-logs');

  if (!syncBtn || !logsEl) return;

  logsEl.style.display = 'block';
  logsEl.textContent = 'Initiating manual CalDAV synchronization...\nFetching accounts and contacting iCloud servers...';
  syncBtn.disabled = true;
  syncBtn.innerHTML = '<i class="material-icons rotating">sync</i> Syncing...';

  try {
    const res = await fetch('api/caldav/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await res.json();

    if (data.success) {
      logsEl.textContent += '\n\n' + data.logs.join('\n');
      logsEl.textContent += `\n\n[DONE] Synchronization complete. ${data.total} total events currently stored. Refreshing calendar...`;
      if (calendar) calendar.refetchEvents();
    } else {
      logsEl.textContent += '\n\n[ERROR] Sync failed: ' + (data.error || 'Unknown error');
      if (data.logs) {
        logsEl.textContent += '\n' + data.logs.join('\n');
      }
    }
  } catch (err) {
    logsEl.textContent += '\n\n[FATAL ERROR] ' + err.message;
  } finally {
    syncBtn.disabled = false;
    syncBtn.innerHTML = '<i class="material-icons" style="font-size: 18px;">sync</i> Sync Now';
  }
}

async function populateCalDAVUserDropdown() {
  const select = document.getElementById('caldav-user-select');
  if (!select) return;

  try {
    const resp = await fetch('api/users');
    if (!resp.ok) throw new Error('Failed to fetch users');
    const users = await resp.json();

    if (users.length === 0) {
      select.innerHTML = '<option value="">No users found</option>';
      return;
    }

    select.innerHTML = '<option value="">-- Select User (Required) --</option>' +
      users.map(u => `<option value="${u.id}">${u.name}</option>`).join('');

  } catch (err) {
    console.error('Failed to populate CalDAV user dropdown:', err);
    select.innerHTML = '<option value="">Error loading users</option>';
  }
}

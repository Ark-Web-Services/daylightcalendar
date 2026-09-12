/* Daylight Calendar - Main JavaScript */

console.log('[INFO] Initializing Daylight Calendar client...');

// Global variables
let inactivityTimer;
let dimmerCountdownTimer;
let dimmerCountdown = 30;
let weatherForecastData = [];
let weatherTemperatureUnit = '°';
let weatherPrecipitationUnit = '';
let activeWeatherPopover = null;
let calendar;
let allCalendarUsers = [];
let settingsProfileCache = [];
let activeCalendarUsers = new Set();
let calendarUserFiltersReady = false;
const supportedThemes = ['light', 'dark', 'pastel', 'forest', 'ocean', 'sunset'];
let selectedTheme = 'light';
let automaticThemeTimer = null;
const initializedFrameContent = new WeakMap();

// Display settings (default values)
let displaySettings = {
  autoNightMode: true,
  nightModeStart: '20:00',
  nightModeEnd: '07:00',
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
  document.removeEventListener('turbo:frame-load', handleTurboFrameLoad);
  document.addEventListener('turbo:frame-load', handleTurboFrameLoad);

  // Config is fetched after DOMContentLoaded, so some eager Turbo frames may
  // already have completed before this listener exists. Initialize them now.
  document.querySelectorAll('turbo-frame[complete]').forEach(initializeLoadedFrame);
}

function handleTurboFrameLoad(event) {
  initializeLoadedFrame(event.target);
}

function initializeLoadedFrame(frame) {
  if (!frame?.id) return;
  const contentMarker = frame.firstElementChild;
  if (contentMarker && initializedFrameContent.get(frame) === contentMarker) return;
  if (contentMarker) initializedFrameContent.set(frame, contentMarker);
  console.log('[DEBUG] Initializing loaded frame:', frame.id);
  setupModals();

  switch (frame.id) {
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
    default:
      console.log('[DEBUG] Unknown frame loaded:', frame.id);
  }
}

// Initialize calendar page
function initializeCalendarPage() {
  console.log('[INFO] Initializing calendar page...');

  // Wait for elements to be available in the DOM
  setTimeout(async () => {
    // Update time and weather first
    updateTime();
    fetchWeather();

    // People load independently; events remain visible until their filters are ready.
    loadUserToggles().then(() => {
      if (calendar) calendar.refetchEvents();
    });
    const hasCalendars = await refreshCalendarAvailability();
    if (hasCalendars) {
      setupCalendar();
    }

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

    populateChoreAssignees();
    fetchAndDisplayChores();
  }, 100);
}

async function populateChoreAssignees() {
  const select = document.getElementById('assigneeName');
  if (!select) return;

  const unassignedOption = document.createElement('option');
  unassignedOption.value = '';
  unassignedOption.textContent = 'Unassigned';
  select.replaceChildren(unassignedOption);
  select.disabled = true;

  try {
    const response = await fetch('api/users');
    if (!response.ok) throw new Error('Failed to load users');
    const users = await response.json();

    users.forEach(user => {
      const option = document.createElement('option');
      const color = getValidCalendarColor(user.color);
      option.value = user.name || user.id;
      option.textContent = user.name || 'Unnamed user';
      option.dataset.color = color;
      option.style.color = color;
      select.appendChild(option);
    });

    select.onchange = () => {
      const selectedColor = select.selectedOptions[0]?.dataset.color;
      select.style.borderColor = selectedColor || '';
    };
  } catch (error) {
    console.error('[ERROR] Failed to populate chore assignees:', error);
    const unavailableOption = document.createElement('option');
    unavailableOption.disabled = true;
    unavailableOption.textContent = 'People unavailable';
    select.appendChild(unavailableOption);
  } finally {
    select.disabled = false;
  }
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
      prevWeekBtn.onclick = () => {
        console.log('[INFO] Previous week clicked');
        // Navigate to previous week
      };
    }

    if (nextWeekBtn) {
      nextWeekBtn.onclick = () => {
        console.log('[INFO] Next week clicked');
        // Navigate to next week
      };
    }

    if (recipeBookBtn && recipeBookModal) {
      recipeBookBtn.onclick = () => {
        console.log('[INFO] Recipe book button clicked');
        recipeBookModal.classList.add('show');
      };
    }

    if (groceryListBtn && groceryListModal) {
      groceryListBtn.onclick = () => {
        console.log('[INFO] Grocery list button clicked');
        groceryListModal.classList.add('show');
      };
    }

    if (addMealBtn && addMealModal) {
      addMealBtn.onclick = () => {
        console.log('[INFO] Add meal button clicked');
        addMealModal.classList.add('show');
      };
    }

    if (mealCategoriesBtn && mealCategoriesModal) {
      mealCategoriesBtn.onclick = () => {
        console.log('[INFO] Meal categories button clicked');
        mealCategoriesModal.classList.add('show');
      };
    }

    // Setup form submissions
    const addMealForm = document.getElementById('add-meal-form');
    const addGroceryForm = document.getElementById('add-grocery-item-form');

    if (addMealForm) {
      addMealForm.onsubmit = (e) => {
        e.preventDefault();
        console.log('[INFO] Add meal form submitted');
        const formData = new FormData(addMealForm);
        console.log('[INFO] Meal data:', Object.fromEntries(formData));
        addMealModal.classList.remove('show');
        addMealForm.reset();
      };
    }

    if (addGroceryForm) {
      addGroceryForm.onsubmit = (e) => {
        e.preventDefault();
        console.log('[INFO] Add grocery item form submitted');
        const formData = new FormData(addGroceryForm);
        console.log('[INFO] Grocery item data:', Object.fromEntries(formData));
        addGroceryForm.reset();
      };
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
      profileList.onclick = (e) => {
        const profileItem = e.target.closest('.profile-item');
        if (profileItem) {
          document.querySelectorAll('.profile-item').forEach(p => p.classList.remove('selected'));
          profileItem.classList.add('selected');
          console.log('[INFO] Profile selected:', profileItem.dataset.profile);
        }
      };
      loadGameProfiles(profileList);
    }
  }, 100);
}

async function loadGameProfiles(profileList = document.getElementById('profile-list')) {
  if (!profileList) return;
  profileList.innerHTML = '<div class="profile-list-state"><i class="material-icons spin" aria-hidden="true">refresh</i> Loading people…</div>';

  try {
    const response = await fetch('api/users');
    if (!response.ok) throw new Error('Failed to load users');
    const users = await response.json();
    profileList.innerHTML = '';

    if (!Array.isArray(users) || users.length === 0) {
      profileList.innerHTML = `
        <div class="profile-list-empty">
          <i class="material-icons" aria-hidden="true">person_off</i>
          <div>
            <strong>No people yet</strong>
            <span>Add a household member in Settings to choose a game profile.</span>
          </div>
          <button type="button" class="btn btn-secondary" id="open-user-settings">Open Settings</button>
        </div>
      `;
      document.getElementById('open-user-settings')?.addEventListener('click', openUserManagementSettings);
      return;
    }

    users.forEach(user => {
      const profile = document.createElement('button');
      profile.type = 'button';
      profile.className = 'profile-item';
      profile.dataset.profile = user.id;
      profile.style.setProperty('--profile-color', getValidCalendarColor(user.color));

      const avatar = document.createElement('span');
      avatar.className = 'profile-avatar';
      avatar.textContent = getProfileInitials(user.name);

      const name = document.createElement('span');
      name.className = 'profile-name';
      name.textContent = user.name || 'Unnamed user';

      profile.append(avatar, name);
      profileList.appendChild(profile);
    });
  } catch (error) {
    console.error('[ERROR] Failed to load game profiles:', error);
    profileList.innerHTML = `
      <div class="profile-list-empty">
        <i class="material-icons" aria-hidden="true">error_outline</i>
        <div>
          <strong>People could not be loaded</strong>
          <span>Check the Home Assistant connection and try again.</span>
        </div>
        <button type="button" class="btn btn-secondary" id="retry-game-profiles">Retry</button>
      </div>
    `;
    document.getElementById('retry-game-profiles')?.addEventListener('click', () => loadGameProfiles(profileList));
  }
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

    // Global delegated settings handlers survive Turbo replacing this frame.
    syncDisplaySettingsControls();
    syncThemeControls();

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
        setSuggestedNewProfileColor(settingsProfileCache);
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

    if (typeof loadCalendarManagement === 'function') {
      loadCalendarManagement();
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

  // Sidebar collapse is owned solely by js/sidebar-fix.js. This used to bind a

  // second listener to the same element toggling a different class on #app, so

  // after a reload the two states disagreed and expanding never restored.

  void sidebarToggle;

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

        // Refresh availability and size after returning from calendar settings
        if (target === 'calendar-content') {
          setTimeout(async () => {
            const hasCalendars = await refreshCalendarAvailability();
            if (!hasCalendars) return;

            if (calendar) {
              calendar.updateSize();
              calendar.refetchEvents();
            } else {
              setupCalendar();
            }
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

  // These listeners live on the stable document, so Turbo frame swaps cannot
  // orphan them or create duplicate handlers when Settings is reopened.
  document.removeEventListener('click', handleDelegatedUiClick);
  document.addEventListener('click', handleDelegatedUiClick);
  document.removeEventListener('change', handleDelegatedSettingsChange);
  document.addEventListener('change', handleDelegatedSettingsChange);

  initializeThemeState();
  fetchDisplaySettings();
  if (!automaticThemeTimer) {
    automaticThemeTimer = setInterval(applyAutomaticTheme, 60 * 1000);
  }

  // Start the clock
  updateClock();
  setInterval(updateClock, 1000);
}

function handleDelegatedUiClick(event) {
  const themeButton = event.target.closest('.theme-button[data-theme]');
  if (themeButton) {
    event.preventDefault();
    selectTheme(themeButton.dataset.theme, true);
    return;
  }

  if (activeWeatherPopover && !activeWeatherPopover.contains(event.target)) {
    closeDailyWeatherPopover();
  }
}

function handleDelegatedSettingsChange(event) {
  const { target } = event;
  if (!target?.id) return;

  if (target.id === 'auto-night-mode') {
    displaySettings.autoNightMode = target.checked;
    persistDisplaySettings();
    applyAutomaticTheme();
    return;
  }

  if (target.id === 'night-mode-start' || target.id === 'night-mode-end') {
    const key = target.id === 'night-mode-start' ? 'nightModeStart' : 'nightModeEnd';
    displaySettings[key] = target.value;
    persistDisplaySettings();
    applyAutomaticTheme();
    return;
  }

  if (target.id === 'screen-burn-protection') {
    displaySettings.screenBurnProtection = target.checked;
    if (target.checked) {
      resetInactivityTimer();
    } else {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      wakeScreen();
    }
    persistDisplaySettings();
    return;
  }

  if (target.id === 'dim-after-minutes') {
    displaySettings.dimAfterMinutes = parseInt(target.value, 10);
    resetInactivityTimer();
    persistDisplaySettings();
    return;
  }

  if (target.id === 'display-clock') {
    displaySettings.displayClock = target.checked;
    document.getElementById('clock-display')?.classList.toggle('active', target.checked);
    persistDisplaySettings();
  }
}

async function initializeThemeState() {
  let storedTheme;
  try {
    storedTheme = localStorage.getItem('daylight-theme');
  } catch (error) {
    console.warn('[WARN] Could not read local theme:', error);
  }

  selectedTheme = supportedThemes.includes(storedTheme)
    ? storedTheme
    : (supportedThemes.includes(window.appConfig?.theme) ? window.appConfig.theme : 'light');
  applyAutomaticTheme();

  try {
    const response = await fetch('api/user/theme');
    if (!response.ok) throw new Error(`Failed to load theme: ${response.status}`);
    const data = await response.json();
    if (!supportedThemes.includes(storedTheme) && supportedThemes.includes(data.theme)) {
      selectedTheme = data.theme;
      localStorage.setItem('daylight-theme', selectedTheme);
      applyAutomaticTheme();
    }
  } catch (error) {
    console.warn('[WARN] Using locally stored theme:', error);
  }
}

async function selectTheme(theme, explicitSelection = false) {
  if (!supportedThemes.includes(theme)) return;
  selectedTheme = theme;

  try {
    localStorage.setItem('daylight-theme', theme);
  } catch (error) {
    console.warn('[WARN] Could not persist theme locally:', error);
  }

  if (explicitSelection) {
    // A direct tap is an override. Auto mode can be turned back on separately.
    displaySettings.autoNightMode = false;
    persistDisplaySettings();
  }

  applyAutomaticTheme();
  syncDisplaySettingsControls();
  syncThemeControls();

  try {
    const response = await fetch('api/user/theme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme })
    });
    if (!response.ok) throw new Error(`Failed to save theme: ${response.status}`);
  } catch (error) {
    console.warn('[WARN] Theme remains saved on this display only:', error);
  }
}

function applyAutomaticTheme() {
  let resolvedTheme = selectedTheme;
  if (displaySettings.autoNightMode && selectedTheme !== 'dark') {
    const isNight = isTimeWithinRange(
      moment().format('HH:mm'),
      displaySettings.nightModeStart,
      displaySettings.nightModeEnd
    );
    if (isNight) {
      resolvedTheme = selectedTheme === 'light' ? 'dark' : `${selectedTheme}-dark`;
    }
  }
  applyThemeClass(resolvedTheme);
}

function isTimeWithinRange(current, start = '20:00', end = '07:00') {
  if (start === end) return true;
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
}

function applyThemeClass(theme) {
  const themeClasses = [
    ...supportedThemes.map(item => `theme-${item}`),
    'theme-pastel-dark',
    'theme-forest-dark',
    'theme-ocean-dark',
    'theme-sunset-dark'
  ];

  [document.documentElement, document.body, document.getElementById('app')]
    .filter(Boolean)
    .forEach(element => {
      element.classList.remove(...themeClasses);
      element.classList.add(`theme-${theme}`);
      element.dataset.theme = theme;
    });
  syncThemeControls();
}

function syncThemeControls() {
  document.querySelectorAll('.theme-button[data-theme]').forEach(button => {
    const isActive = button.dataset.theme === selectedTheme;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

function syncDisplaySettingsControls() {
  const settingsElements = {
    'auto-night-mode': displaySettings.autoNightMode,
    'night-mode-start': displaySettings.nightModeStart,
    'night-mode-end': displaySettings.nightModeEnd,
    'screen-burn-protection': displaySettings.screenBurnProtection,
    'dim-after-minutes': displaySettings.dimAfterMinutes,
    'display-clock': displaySettings.displayClock
  };

  Object.entries(settingsElements).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (!element) return;
    if (element.type === 'checkbox') element.checked = Boolean(value);
    else element.value = value;
  });
}

async function persistDisplaySettings() {
  try {
    localStorage.setItem('daylight-display-settings', JSON.stringify(displaySettings));
  } catch (error) {
    console.warn('[WARN] Could not persist display settings locally:', error);
  }

  try {
    const response = await fetch('api/user/display-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(displaySettings)
    });
    if (!response.ok) throw new Error(`Failed to save display settings: ${response.status}`);
  } catch (error) {
    console.warn('[WARN] Display settings remain saved on this display only:', error);
  }
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
        btns.forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
        input.value = btn.dataset.color;
        if (input.id === 'new-user-color') input.dataset.defaultColor = 'false';
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
    if (activeWeatherPopover) {
      closeDailyWeatherPopover();
      return;
    }
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
      initialView: getStoredCalendarView(),
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'timeGridDay,timeGridWeek,dayGridMonth'
      },
      buttonText: {
        day: 'Day',
        week: 'Week',
        month: 'Month'
      },
      slotMinTime: '06:00:00',
      slotMaxTime: '24:00:00',
      allDaySlot: true,
      height: 'auto',
      aspectRatio: 1.35,
      loading: function (isLoading) {
        const el = document.getElementById('calendar');
        if (el) el.classList.toggle('calendar-loading', !!isLoading);
      },
      events: function (fetchInfo, successCallback, failureCallback) {
        const url = `api/calendar?start=${fetchInfo.startStr}&end=${fetchInfo.endStr}`;
        fetch(url)
          .then(res => {
            if (!res.ok) throw new Error('Network response was not ok');
            return res.json();
          })
          .then(events => {
            const filtered = events.filter(e => {
              // Labels and unassigned sources stay visible; profile toggles filter people only.
              const profileIds = Array.isArray(e.profileIds) ? e.profileIds : (e.userId ? [e.userId] : []);
              if (profileIds.length === 0 || !calendarUserFiltersReady) return true;
              return profileIds.some(profileId => activeCalendarUsers.has(profileId));
            });

            const neutralColor = getNeutralCalendarColor();

            // The same destination identity determines color in day, week, and month views.
            filtered.forEach(e => {
              const profileIds = Array.isArray(e.profileIds) ? e.profileIds : (e.userId ? [e.userId] : []);
              if (profileIds.length > 0) {
                const user = allCalendarUsers.find(u => u.id === profileIds[0]);
                if (user && user.color) {
                  e.backgroundColor = user.color;
                  e.borderColor = user.color;
                }
                if (profileIds.length > 1) {
                  e.classNames = [...(e.classNames || []), 'calendar-event-multi-profile'];
                }
              } else if (e.labelId && e.labelColor) {
                const labelColor = getValidCalendarColor(e.labelColor, neutralColor);
                e.backgroundColor = labelColor;
                e.borderColor = labelColor;
                e.classNames = [...(e.classNames || []), 'calendar-event-label'];
              } else {
                e.backgroundColor = neutralColor;
                e.borderColor = neutralColor;
                e.classNames = [...(e.classNames || []), 'calendar-event-unassigned'];
              }
              e.textColor = getReadableCalendarTextColor(e.backgroundColor);
            });

            successCallback(filtered);
            updateNextEventPanel(filtered);
          })
          .catch(err => {
            console.error('[ERROR] Failed to fetch calendar events:', err);
            failureCallback(err);
          });
      },
      eventClick: function (info) {
        showEventDetails(info.event);
        info.jsEvent.preventDefault();
      },
      dayCellDidMount: function (info) {
        if (info.view.type === 'dayGridMonth') {
          renderDailyWeatherButton(info.el, info.date, false);
        }
      },
      dayHeaderDidMount: function (info) {
        if (info.view.type !== 'dayGridMonth') {
          renderDailyWeatherButton(info.el, info.date, true);
        }
      },
      datesSet: function (info) {
        closeDailyWeatherPopover();
        if (info.view.type === 'timeGridWeek' || info.view.type === 'dayGridMonth') {
          try {
            localStorage.setItem('daylight-calendar-view', info.view.type);
          } catch (error) {
            console.warn('[WARN] Could not persist calendar view:', error);
          }
        }
        requestAnimationFrame(refreshDailyWeatherIcons);
      },
      loading: function (isLoading) {
        console.log('[DEBUG] Calendar loading:', isLoading);
      },
      eventDisplay: 'block',
      dayMaxEvents: 3,
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

    startCalendarAutoRefresh();
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

function getStoredCalendarView() {
  try {
    const storedView = localStorage.getItem('daylight-calendar-view');
    if (['timeGridDay', 'timeGridWeek', 'dayGridMonth'].includes(storedView)) return storedView;
  } catch (error) {
    console.warn('[WARN] Could not read saved calendar view:', error);
  }
  return 'timeGridWeek';
}

function getNeutralCalendarColor() {
  return getComputedStyle(document.documentElement)
    .getPropertyValue('--md-on-surface-variant')
    .trim() || '#5f6368';
}

function getValidCalendarColor(color, fallback = getNeutralCalendarColor()) {
  return typeof color === 'string' && window.CSS && CSS.supports('color', color)
    ? color
    : fallback;
}

function parseColorChannels(color) {
  const value = String(color || '').trim();
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    return [0, 2, 4].map(offset => parseInt(hex[1].slice(offset, offset + 2), 16));
  }
  const rgb = value.match(/^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

function relativeLuminance(color) {
  const channels = parseColorChannels(color);
  if (!channels) return null;
  const linear = channels.map(channel => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function getReadableCalendarTextColor(backgroundColor) {
  const styles = getComputedStyle(document.documentElement);
  const surface = styles.getPropertyValue('--md-surface').trim();
  const onSurface = styles.getPropertyValue('--md-on-surface').trim();
  const backgroundLum = relativeLuminance(backgroundColor);
  const surfaceLum = relativeLuminance(surface);
  const onSurfaceLum = relativeLuminance(onSurface);
  if ([backgroundLum, surfaceLum, onSurfaceLum].some(value => value === null)) {
    return 'var(--md-on-surface)';
  }
  const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return contrast(backgroundLum, surfaceLum) > contrast(backgroundLum, onSurfaceLum)
    ? 'var(--md-surface)'
    : 'var(--md-on-surface)';
}

function openCalendarConnectionSettings() {
  const settingsTab = document.querySelector('.tab-item[data-tab-target="settings-content"]');
  if (settingsTab) {
    settingsTab.click();
  }

  setTimeout(() => {
    const connectionSettings = document.getElementById('calendar-connection-settings');
    if (connectionSettings) {
      connectionSettings.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    const appleIdInput = document.getElementById('caldav-apple-id');
    if (appleIdInput) appleIdInput.focus({ preventScroll: true });
  }, 200);
}

function openUserManagementSettings() {
  const settingsTab = document.querySelector('.tab-item[data-tab-target="settings-content"]');
  if (settingsTab) settingsTab.click();

  setTimeout(() => {
    const userSettings = document.getElementById('user-management-settings');
    if (userSettings) {
      userSettings.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 200);
}

async function refreshCalendarAvailability() {
  const calendarEl = document.getElementById('calendar');
  if (!calendarEl) return false;

  try {
    const response = await fetch('api/ha/calendars');
    if (!response.ok) throw new Error('Failed to load connected calendars');
    const calendars = await response.json();
    const hasCalendars = Array.isArray(calendars) && calendars.length > 0;
    const calendarFrame = calendarEl.closest('#calendar-content');
    const toolbar = calendarFrame ? calendarFrame.querySelector('.calendar-toolbar') : null;
    const footer = calendarFrame ? calendarFrame.querySelector('footer') : null;

    if (!hasCalendars) {
      if (calendar) {
        calendar.destroy();
        calendar = null;
      }

      if (toolbar) toolbar.hidden = true;
      if (footer) footer.hidden = true;
      calendarEl.classList.add('calendar-empty-container');
      calendarEl.innerHTML = `
        <div class="calendar-empty-state">
          <i class="material-icons" aria-hidden="true">event_busy</i>
          <h2>No calendars connected</h2>
          <p>Connect a calendar in Settings to start seeing events here.</p>
          <button type="button" class="btn btn-primary" id="open-calendar-settings">
            <i class="material-icons" aria-hidden="true">settings</i>
            Open Settings
          </button>
        </div>
      `;
      document.getElementById('open-calendar-settings')
        ?.addEventListener('click', openCalendarConnectionSettings);
      return false;
    }

    if (toolbar) toolbar.hidden = false;
    if (footer) footer.hidden = false;
    if (calendarEl.classList.contains('calendar-empty-container')) {
      calendarEl.classList.remove('calendar-empty-container');
      calendarEl.innerHTML = '';
    }
    return true;
  } catch (err) {
    console.error('[ERROR] Failed to check calendar availability:', err);
    return true;
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
  let localSettings = {};
  try {
    localSettings = JSON.parse(localStorage.getItem('daylight-display-settings') || '{}');
    displaySettings = { ...displaySettings, ...localSettings };
  } catch (error) {
    console.warn('[WARN] Could not read local display settings:', error);
  }

  try {
    const response = await fetch('api/user/display-settings');
    if (!response.ok) throw new Error(`Failed to load display settings: ${response.status}`);

    const settings = await response.json();
    // Per-display storage takes precedence when Home Assistant helpers are
    // unavailable or have not yet caught up with the latest wall-display tap.
    displaySettings = { ...displaySettings, ...settings, ...localSettings };

    console.log('[INFO] Loaded display settings:', displaySettings);
  } catch (error) {
    console.error('[ERROR] Failed to load display settings:', error);
  }

  document.getElementById('clock-display')
    ?.classList.toggle('active', Boolean(displaySettings.displayClock));
  if (displaySettings.screenBurnProtection) resetInactivityTimer();
  syncDisplaySettingsControls();
  applyAutomaticTheme();
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
      weatherTemperatureUnit = attributes.temperature_unit || '°';
      weatherPrecipitationUnit = attributes.precipitation_unit || '';
      console.log('[DEBUG] Processed weather forecast data:', weatherForecastData);

      updateCurrentWeatherDisplay(temp, condition);
      refreshDailyWeatherIcons();
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
  refreshDailyWeatherIcons();
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
      temperature: entry.temperature ?? entry.temp ?? null,
      templow: entry.templow ?? entry.min_temp ?? null,
      humidity: entry.humidity ?? null,
      precipitation: entry.precipitation ?? null,
      precipitationProbability: entry.precipitation_probability ?? null
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

  conditionIcon.textContent = getWeatherMaterialIcon(condition);
  console.log('[DEBUG] Updated weather icon to:', conditionIcon.textContent);
}

function getWeatherMaterialIcon(condition) {
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
  return iconMap[condition] || 'cloud';
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
    calendarUserFiltersReady = true;

    userTogglesContainer.innerHTML = '';

    const calendarUsers = userTogglesContainer.closest('.calendar-users');
    const toggleLabel = calendarUsers ? calendarUsers.querySelector('.users-toggle-label') : null;
    if (toggleLabel) toggleLabel.textContent = 'Profiles:';

    let unassignedNote = calendarUsers ? calendarUsers.querySelector('.unassigned-filter-note') : null;
    if (calendarUsers && !unassignedNote) {
      unassignedNote = document.createElement('span');
      unassignedNote.className = 'unassigned-filter-note';
      unassignedNote.innerHTML = '<i class="material-icons" aria-hidden="true">visibility</i> Labels and unassigned events stay visible';
      calendarUsers.appendChild(unassignedNote);
    }

    if (allCalendarUsers.length === 0) {
      userTogglesContainer.innerHTML = '<span class="no-users-msg">No people filters</span>';
      return;
    }

    allCalendarUsers.forEach(user => {
      const btn = document.createElement('button');
      const isActive = activeCalendarUsers.has(user.id);

      btn.type = 'button';
      btn.className = 'user-toggle ' + (isActive ? 'active' : '');
      btn.innerHTML =
          `<span class="user-toggle-initials">${escapeHtml(getProfileInitials(user.name))}</span>` +
          `<span class="user-toggle-name">${escapeHtml(user.name || 'Unnamed')}</span>`;
      btn.setAttribute('aria-pressed', String(isActive));
      btn.setAttribute('aria-label', `${isActive ? 'Hide' : 'Show'} events for ${user.name || 'unnamed profile'}`);
      btn.style.setProperty('--profile-color', getValidCalendarColor(user.color));

      btn.addEventListener('click', () => {
        if (activeCalendarUsers.has(user.id)) {
          activeCalendarUsers.delete(user.id);
          btn.classList.remove('active');
          btn.setAttribute('aria-pressed', 'false');
          btn.setAttribute('aria-label', `Show events for ${user.name || 'unnamed profile'}`);
        } else {
          activeCalendarUsers.add(user.id);
          btn.classList.add('active');
          btn.setAttribute('aria-pressed', 'true');
          btn.setAttribute('aria-label', `Hide events for ${user.name || 'unnamed profile'}`);
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

async function fetchAndDisplayMeals() {
  console.log('[INFO] fetchAndDisplayMeals called - fetching and displaying meals');

  const mealWeekView = document.getElementById('meal-week-view');
  if (mealWeekView) {
    let users = [];
    try {
      const response = await fetch('api/users');
      if (!response.ok) throw new Error('Failed to load users');
      const userData = await response.json();
      users = Array.isArray(userData) ? userData : [];
    } catch (error) {
      console.warn('[WARN] Could not load users for meal assignments:', error);
    }

    // Create week view for meals
    const days = [];
    for (let i = 0; i < 7; i++) {
      days.push(moment().startOf('week').add(i, 'days'));
    }

    const mealTypes = ['Breakfast', 'Lunch', 'Dinner'];

    const assignedCook = index => users.length > 0
      ? users[index % users.length]
      : { name: 'Unassigned', color: getNeutralCalendarColor() };

    // Sample meal content uses real household names when people exist.
    const sampleMeals = [
      { day: 0, type: 'Breakfast', description: 'Pancakes', cook: assignedCook(0) },
      { day: 0, type: 'Dinner', description: 'Spaghetti & Meatballs', cook: assignedCook(1) },
      { day: 1, type: 'Lunch', description: 'Caesar Salad', cook: assignedCook(2) },
      { day: 2, type: 'Dinner', description: 'Grilled Chicken', cook: assignedCook(3) }
    ];

    let weekHTML = `
      <div class="meal-week-header">
        <p class="meal-week-eyebrow">This week</p>
        <h2>Week of ${moment().startOf('week').format('MMMM D, YYYY')}</h2>
      </div>
      <div class="meal-day-grid">
    `;

    days.forEach((day, dayIndex) => {
      weekHTML += `
        <article class="meal-day-card${day.isSame(moment(), 'day') ? ' is-today' : ''}">
          <header class="meal-day-heading">
            <span class="meal-day-name">${day.format('dddd')}</span>
            <span class="meal-day-date">${day.format('MMM D')}</span>
          </header>
          <div class="meal-day-periods">
            ${mealTypes.map(mealType => {
        const meal = sampleMeals.find(item => item.day === dayIndex && item.type === mealType);
        if (meal) {
          const cookName = escapeHtml(meal.cook.name || 'Unassigned');
          const cookColor = getValidCalendarColor(meal.cook.color, getNeutralCalendarColor());
          return `
              <div class="meal-period">
                <span class="meal-period-label">${mealType}</span>
                <div class="meal-slot has-meal" data-day="${dayIndex}" data-meal-type="${mealType}">
                  <span class="meal-description">${meal.description}</span>
                  <span class="meal-cook"><span class="meal-cook-dot" style="background-color: ${cookColor}"></span>${cookName}</span>
                </div>
              </div>
          `;
        }
        return `
              <div class="meal-period">
                <span class="meal-period-label">${mealType}</span>
                <button type="button" class="meal-slot meal-empty" data-day="${dayIndex}" data-meal-type="${mealType}" aria-label="Add ${mealType.toLowerCase()} for ${day.format('dddd')}">
                  <i class="material-icons" aria-hidden="true">add</i>
                  <span>Add meal</span>
                </button>
              </div>
        `;
      }).join('')}
          </div>
        </article>
      `;
    });

    weekHTML += '</div>';
    mealWeekView.innerHTML = weekHTML;

    // Add click handlers for empty meal slots
    mealWeekView.onclick = (e) => {
      const mealSlot = e.target.closest('.meal-slot');
      if (mealSlot && mealSlot.classList.contains('meal-empty')) {
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
    };

    console.log('[INFO] Meal week view populated with sample data');
  }
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
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

function getForecastDateKey(value) {
  if (typeof value === 'string') {
    const datePrefix = value.match(/^\d{4}-\d{2}-\d{2}/);
    if (datePrefix) return datePrefix[0];
  }
  return moment(value).format('YYYY-MM-DD');
}

function getForecastForDate(date) {
  const dateKey = getForecastDateKey(date);
  return weatherForecastData.find(entry => getForecastDateKey(entry.datetime) === dateKey) || null;
}

function renderDailyWeatherButton(container, date, inHeader) {
  if (!container) return;
  container.querySelector('.day-weather-button')?.remove();

  const forecast = getForecastForDate(date);
  if (!forecast) return;

  container.classList.add('day-weather-host');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `day-weather-button${inHeader ? ' day-weather-button-header' : ''}`;
  button.dataset.forecastDate = getForecastDateKey(date);
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', `Weather for ${moment(date).format('dddd, MMMM D')}: ${formatWeatherCondition(forecast.condition)}. Tap for details.`);

  const icon = document.createElement('i');
  icon.className = 'material-icons';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = getWeatherMaterialIcon(forecast.condition);
  button.appendChild(icon);
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    toggleDailyWeatherPopover(button, forecast, date);
  });
  container.appendChild(button);
}

function refreshDailyWeatherIcons() {
  const calendarEl = document.getElementById('calendar');
  if (!calendarEl) return;

  calendarEl.querySelectorAll('.day-weather-button').forEach(button => button.remove());
  if (!weatherForecastData.length || !calendar) return;

  const selector = calendar.view.type === 'dayGridMonth'
    ? '.fc-daygrid-day[data-date]'
    : '.fc-col-header-cell[data-date]';

  calendarEl.querySelectorAll(selector).forEach(cell => {
    renderDailyWeatherButton(cell, cell.dataset.date, calendar.view.type !== 'dayGridMonth');
  });
}

function formatWeatherCondition(condition) {
  return String(condition || 'Unknown')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase());
}

function formatForecastTemperature(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${Math.round(Number(value))}${weatherTemperatureUnit}`;
}

function closeDailyWeatherPopover() {
  if (!activeWeatherPopover) return;
  const trigger = document.querySelector(`[data-forecast-date="${activeWeatherPopover.dataset.forecastDate}"][aria-expanded="true"]`);
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
  activeWeatherPopover.remove();
  activeWeatherPopover = null;
}

function toggleDailyWeatherPopover(button, forecast, date) {
  const dateKey = getForecastDateKey(date);
  if (activeWeatherPopover?.dataset.forecastDate === dateKey) {
    closeDailyWeatherPopover();
    return;
  }

  closeDailyWeatherPopover();
  button.setAttribute('aria-expanded', 'true');

  const panel = document.createElement('section');
  panel.className = 'day-weather-popover';
  panel.dataset.forecastDate = dateKey;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', `Weather details for ${moment(date).format('dddd, MMMM D')}`);

  const heading = document.createElement('div');
  heading.className = 'day-weather-popover-heading';

  const title = document.createElement('strong');
  title.textContent = moment(date).format('dddd, MMM D');

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'day-weather-popover-close';
  closeButton.setAttribute('aria-label', 'Close weather details');
  closeButton.innerHTML = '<i class="material-icons" aria-hidden="true">close</i>';
  closeButton.addEventListener('click', closeDailyWeatherPopover);
  heading.append(title, closeButton);

  const condition = document.createElement('div');
  condition.className = 'day-weather-condition';
  condition.innerHTML = `<i class="material-icons" aria-hidden="true">${getWeatherMaterialIcon(forecast.condition)}</i>`;
  const conditionText = document.createElement('span');
  conditionText.textContent = formatWeatherCondition(forecast.condition);
  condition.appendChild(conditionText);

  const temperatures = document.createElement('div');
  temperatures.className = 'day-weather-temperatures';
  temperatures.textContent = `High ${formatForecastTemperature(forecast.temperature)} · Low ${formatForecastTemperature(forecast.templow)}`;

  const precipitation = document.createElement('div');
  precipitation.className = 'day-weather-precipitation';
  if (forecast.precipitationProbability !== null) {
    precipitation.textContent = `${Math.round(Number(forecast.precipitationProbability))}% chance of precipitation`;
  } else if (forecast.precipitation !== null) {
    const unit = weatherPrecipitationUnit ? ` ${weatherPrecipitationUnit}` : '';
    precipitation.textContent = `${forecast.precipitation}${unit} precipitation`;
  } else {
    precipitation.textContent = 'Precipitation unavailable';
  }

  panel.append(heading, condition, temperatures, precipitation);
  document.body.appendChild(panel);
  activeWeatherPopover = panel;

  const triggerRect = button.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const viewportPadding = 12;
  const left = Math.min(
    Math.max(viewportPadding, triggerRect.left),
    window.innerWidth - panelRect.width - viewportPadding
  );
  const fitsBelow = triggerRect.bottom + panelRect.height + viewportPadding <= window.innerHeight;
  const top = fitsBelow
    ? triggerRect.bottom + 6
    : Math.max(viewportPadding, triggerRect.top - panelRect.height - 6);
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
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
          <label class="calendar-checkbox-option">
            <input type="checkbox" value="${c.entity_id}" class="cal-checkbox">
            <span class="calendar-checkbox-name">${c.name}</span>
            ${c.readOnly ? '<span class="calendar-read-only-badge">Read-only</span>' : ''}
            <span class="calendar-event-count">${count}</span>
          </label>
        `;
      }).join('') || '<div class="calendar-checkbox-empty">No calendars found</div>';
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
          <label class="calendar-checkbox-option">
            <input type="checkbox" value="${c.entity_id}" class="cal-checkbox" ${isChecked}>
            <span class="calendar-checkbox-name">${c.name}</span>
            ${c.readOnly ? '<span class="calendar-read-only-badge">Read-only</span>' : ''}
            <span class="calendar-event-count">${count}</span>
          </label>
        `;
      }).join('') || '<div class="calendar-checkbox-empty">No calendars found</div>';
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

function setSuggestedNewProfileColor(profiles) {
  const colorInput = document.getElementById('new-user-color');
  const colorButtons = [...document.querySelectorAll('#new-user-color-selector .color-option')];
  if (!colorInput || colorButtons.length === 0) return;

  const usedColors = new Set((profiles || []).map(profile => String(profile.color || '').toLowerCase()));
  const suggested = colorButtons.find(button => !usedColors.has(String(button.dataset.color).toLowerCase()));
  colorInput.value = suggested ? suggested.dataset.color : '';
  colorInput.dataset.defaultColor = 'true';
  colorButtons.forEach(button => {
    const isActive = button === suggested;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

async function fetchUsers() {
  const listContainer = document.getElementById('user-list');
  if (!listContainer) return;

  try {
    const resp = await fetch('api/users');
    if (!resp.ok) throw new Error('Failed to fetch users');
    const users = await resp.json();
    settingsProfileCache = Array.isArray(users) ? users : [];

    if (users.length === 0) {
      listContainer.innerHTML = '<div class="no-users">No profiles yet.</div>';
      return;
    }

    listContainer.innerHTML = '';
    users.forEach(user => {
      const calendarIds = Array.isArray(user.calendar_entity_id)
        ? user.calendar_entity_id
        : (user.calendar_entity_id ? [user.calendar_entity_id] : []);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'user-item';
      row.style.setProperty('--profile-color', getValidCalendarColor(user.color));

      const avatar = document.createElement('span');
      avatar.className = 'user-avatar-placeholder';
      avatar.textContent = getProfileInitials(user.name);
      avatar.setAttribute('aria-hidden', 'true');

      const info = document.createElement('span');
      info.className = 'user-info';
      const name = document.createElement('span');
      name.className = 'user-name';
      name.textContent = user.name || 'Unnamed profile';
      const details = document.createElement('span');
      details.className = 'user-details';
      details.textContent = calendarIds.length > 0
        ? `${calendarIds.length} routed calendar${calendarIds.length === 1 ? '' : 's'}`
        : 'No calendars routed';
      info.append(name, details);

      const edit = document.createElement('span');
      edit.className = 'user-edit-icon';
      edit.innerHTML = '<i class="material-icons" aria-hidden="true">edit</i>';
      row.setAttribute('aria-label', `Edit ${user.name || 'unnamed profile'}`);
      row.addEventListener('click', () => openEditUserModal(
        user.id,
        user.name || '',
        calendarIds.join(','),
        user.notify_service || '',
        user.color,
        user.icon || 'person'
      ));
      row.append(avatar, info, edit);
      listContainer.appendChild(row);
    });

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
    loadCalendarManagement();
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
        color: document.getElementById('new-user-color')?.dataset.defaultColor === 'true'
          ? null
          : (document.getElementById('new-user-color')?.value || null),
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
    loadCalendarManagement();
    alert(`Profile "${name}" created successfully!`);

  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

// ── CALENDAR VISIBILITY MANAGEMENT ───────────────────────────────────────

function updateCalendarManagementSummary() {
  const summary = document.getElementById('calendar-management-summary');
  const toggles = [...document.querySelectorAll('#calendar-management-list .calendar-visibility-toggle')];
  if (!summary || toggles.length === 0) return;

  const enabledCount = toggles.filter(toggle => toggle.checked).length;
  summary.textContent = `${enabledCount} of ${toggles.length} shown`;
}

async function updateCalendarVisibility(calendarId, enabled, toggle, row, status) {
  toggle.disabled = true;
  status.textContent = 'Saving…';
  status.classList.remove('error');

  try {
    const response = await fetch('api/calendar-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calendarId, enabled })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to save calendar visibility');
    }

    row.classList.toggle('is-disabled', !enabled);
    status.textContent = enabled ? 'Shown' : 'Hidden';
    toggle.setAttribute('aria-checked', String(enabled));
    updateCalendarManagementSummary();
    if (calendar) calendar.refetchEvents();
  } catch (err) {
    console.error('[ERROR] Failed to update calendar visibility:', err);
    toggle.checked = !enabled;
    status.textContent = 'Could not save — try again';
    status.classList.add('error');
  } finally {
    toggle.disabled = false;
  }
}

function renderCalendarManagementEmptyState(container, summary) {
  summary.textContent = 'No calendars';
  container.innerHTML = `
    <div class="calendar-management-empty">
      <i class="material-icons" aria-hidden="true">event_busy</i>
      <div>
        <h4>No calendars connected</h4>
        <p>Connect Apple Calendar below, or add a calendar integration in Home Assistant.</p>
      </div>
      <button type="button" class="btn btn-primary" id="connect-first-calendar">Connect a calendar</button>
    </div>
  `;
  document.getElementById('connect-first-calendar')
    ?.addEventListener('click', openCalendarConnectionSettings);
}

function renderCalendarRoutingPreview(preview, calendarItem, profileIds, labelId, profiles, labels) {
  preview.innerHTML = '';
  const icon = document.createElement('i');
  icon.className = 'material-icons';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = 'visibility';
  preview.appendChild(icon);

  const sentence = document.createElement('span');
  const calendarName = calendarItem.name || calendarItem.entity_id;
  const selectedProfiles = profiles.filter(profile => profileIds.includes(profile.id));
  const selectedLabel = labels.find(label => label.id === labelId);

  if (selectedProfiles.length === 1) {
    sentence.append(`Events from ${calendarName} will appear in `);
    const profile = selectedProfiles[0];
    const identity = document.createElement('strong');
    identity.className = 'routing-preview-identity';
    identity.style.setProperty('--identity-color', getValidCalendarColor(profile.color));
    identity.textContent = `${profile.name || 'Unnamed profile'}'s color`;
    sentence.append(identity, '.');
  } else if (selectedProfiles.length > 1) {
    sentence.append(`Events from ${calendarName} will be shared with `);
    selectedProfiles.forEach((profile, index) => {
      if (index > 0) sentence.append(index === selectedProfiles.length - 1 ? ' and ' : ', ');
      const identity = document.createElement('strong');
      identity.className = 'routing-preview-identity';
      identity.style.setProperty('--identity-color', getValidCalendarColor(profile.color));
      identity.textContent = profile.name || 'Unnamed profile';
      sentence.appendChild(identity);
    });
    sentence.append(` and use ${selectedProfiles[0].name || 'the first profile'}'s color.`);
  } else if (selectedLabel) {
    sentence.append(`Events from ${calendarName} will appear in the `);
    const identity = document.createElement('strong');
    identity.className = 'routing-preview-identity';
    identity.style.setProperty('--identity-color', getValidCalendarColor(selectedLabel.color));
    identity.textContent = selectedLabel.name;
    sentence.append(identity, ' label color.');
  } else {
    sentence.textContent = `Events from ${calendarName} will use the neutral unassigned style.`;
  }
  preview.appendChild(sentence);
}

function setupCalendarLabelForm() {
  const form = document.getElementById('calendar-label-form');
  const input = document.getElementById('calendar-label-name');
  const status = document.getElementById('calendar-label-status');
  if (!form || !input || !status) return;

  form.onsubmit = async event => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) {
      status.textContent = 'Enter a label name.';
      status.classList.add('error');
      return;
    }

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    status.textContent = 'Adding…';
    status.classList.remove('error');
    try {
      const response = await fetch('api/calendar-labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not add label');
      input.value = '';
      status.textContent = `${result.name} is ready to assign.`;
      await loadCalendarManagement();
    } catch (error) {
      status.textContent = error.message;
      status.classList.add('error');
    } finally {
      button.disabled = false;
    }
  };
}

function renderCalendarManagementRow(calendarItem, route, profiles, labels, isEnabled) {
  const row = document.createElement('article');
  row.className = `calendar-management-item${isEnabled ? '' : ' is-disabled'}`;

  const swatch = document.createElement('span');
  swatch.className = 'calendar-color-swatch';
  swatch.style.backgroundColor = getValidCalendarColor(calendarItem.color);
  swatch.setAttribute('aria-hidden', 'true');

  const details = document.createElement('div');
  details.className = 'calendar-management-details';
  const name = document.createElement('div');
  name.className = 'calendar-management-name';
  name.textContent = calendarItem.name || calendarItem.entity_id;
  const meta = document.createElement('div');
  meta.className = 'calendar-management-meta';
  const source = document.createElement('span');
  source.className = `calendar-source-badge calendar-source-${calendarItem.source === 'caldav' ? 'icloud' : 'ha'}`;
  source.textContent = calendarItem.source === 'caldav' ? 'iCloud / CalDAV' : 'Home Assistant';
  const account = document.createElement('span');
  account.className = 'calendar-source-account';
  account.textContent = calendarItem.accountName || (calendarItem.source === 'caldav' ? 'Connected iCloud account' : 'Home Assistant');
  meta.append(source, account);
  if (calendarItem.readOnly) {
    const readOnly = document.createElement('span');
    readOnly.className = 'calendar-read-only-badge';
    readOnly.textContent = 'Read-only';
    meta.appendChild(readOnly);
  }
  details.append(name, meta);

  const control = document.createElement('label');
  control.className = 'calendar-visibility-control';
  const visibilityStatus = document.createElement('span');
  visibilityStatus.className = 'calendar-visibility-status';
  visibilityStatus.textContent = isEnabled ? 'Shown' : 'Hidden';
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.className = 'calendar-visibility-toggle';
  toggle.checked = isEnabled;
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-checked', String(isEnabled));
  toggle.setAttribute('aria-label', `Show ${calendarItem.name || calendarItem.entity_id} on the calendar`);
  const track = document.createElement('span');
  track.className = 'calendar-toggle-track';
  track.setAttribute('aria-hidden', 'true');
  toggle.addEventListener('change', () => {
    updateCalendarVisibility(calendarItem.entity_id, toggle.checked, toggle, row, visibilityStatus);
  });
  control.append(visibilityStatus, toggle, track);

  const routing = document.createElement('div');
  routing.className = 'calendar-routing-controls';
  const routeHeading = document.createElement('div');
  routeHeading.className = 'calendar-routing-heading';
  routeHeading.textContent = 'Destination';
  const profileOptions = document.createElement('div');
  profileOptions.className = 'calendar-profile-options';
  profileOptions.setAttribute('aria-label', 'Route to profiles');
  let selectedProfileIds = [...new Set(route.profileIds || [])].filter(id => profiles.some(profile => profile.id === id));
  let selectedLabelId = route.labelId && labels.some(label => label.id === route.labelId) ? route.labelId : null;
  let savedProfileIds = [...selectedProfileIds];
  let savedLabelId = selectedLabelId;

  const labelControl = document.createElement('label');
  labelControl.className = 'calendar-label-control';
  const labelText = document.createElement('span');
  labelText.textContent = 'Or non-person label';
  const labelSelect = document.createElement('select');
  labelSelect.setAttribute('aria-label', `Non-person label for ${calendarItem.name || calendarItem.entity_id}`);
  const noLabelOption = document.createElement('option');
  noLabelOption.value = '';
  noLabelOption.textContent = 'None';
  labelSelect.appendChild(noLabelOption);
  labels.forEach(label => {
    const option = document.createElement('option');
    option.value = label.id;
    option.textContent = label.name;
    option.selected = label.id === selectedLabelId;
    labelSelect.appendChild(option);
  });
  labelControl.append(labelText, labelSelect);

  const preview = document.createElement('p');
  preview.className = 'calendar-routing-preview';
  preview.setAttribute('aria-live', 'polite');
  const actions = document.createElement('div');
  actions.className = 'calendar-routing-actions';
  const routeStatus = document.createElement('span');
  routeStatus.className = 'calendar-routing-status';
  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn-primary calendar-routing-save';
  saveButton.textContent = 'Save routing';
  saveButton.disabled = true;
  actions.append(routeStatus, saveButton);

  const profileButtons = profiles.map(profile => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'calendar-profile-option';
    button.style.setProperty('--profile-color', getValidCalendarColor(profile.color));
    button.innerHTML = `<span class="calendar-profile-initials">${escapeHtml(getProfileInitials(profile.name))}</span><span>${escapeHtml(profile.name || 'Unnamed')}</span>`;
    button.setAttribute('aria-pressed', String(selectedProfileIds.includes(profile.id)));
    button.addEventListener('click', () => {
      if (selectedProfileIds.includes(profile.id)) {
        selectedProfileIds = selectedProfileIds.filter(id => id !== profile.id);
      } else {
        selectedProfileIds.push(profile.id);
        selectedLabelId = null;
        labelSelect.value = '';
      }
      button.setAttribute('aria-pressed', String(selectedProfileIds.includes(profile.id)));
      updateRouteState();
    });
    profileOptions.appendChild(button);
    return button;
  });
  if (profiles.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'calendar-profile-options-empty';
    empty.textContent = 'Add a profile below to route person-owned events.';
    profileOptions.appendChild(empty);
  }

  function updateRouteState() {
    const sameProfiles = [...selectedProfileIds].sort().join('|') === [...savedProfileIds].sort().join('|');
    const isDirty = !sameProfiles || selectedLabelId !== savedLabelId;
    saveButton.disabled = !isDirty;
    routeStatus.textContent = isDirty ? 'Previewing unsaved routing' : 'Routing saved';
    routeStatus.classList.toggle('is-dirty', isDirty);
    renderCalendarRoutingPreview(preview, calendarItem, selectedProfileIds, selectedLabelId, profiles, labels);
  }

  labelSelect.addEventListener('change', () => {
    selectedLabelId = labelSelect.value || null;
    if (selectedLabelId) {
      selectedProfileIds = [];
      profileButtons.forEach(button => button.setAttribute('aria-pressed', 'false'));
    }
    updateRouteState();
  });

  saveButton.addEventListener('click', async () => {
    saveButton.disabled = true;
    routeStatus.textContent = 'Saving…';
    routeStatus.classList.remove('error');
    try {
      const response = await fetch('api/calendar-routing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calendarId: calendarItem.entity_id,
          profileIds: selectedProfileIds,
          labelId: selectedLabelId
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not save routing');
      savedProfileIds = [...selectedProfileIds];
      savedLabelId = selectedLabelId;
      updateRouteState();
      if (calendar) calendar.refetchEvents();
      fetchUsers();
    } catch (error) {
      routeStatus.textContent = `${error.message} — try again`;
      routeStatus.classList.add('error');
      saveButton.disabled = false;
    }
  });

  routing.append(routeHeading, profileOptions, labelControl, preview, actions);
  row.append(swatch, details, control, routing);
  updateRouteState();
  return row;
}

async function loadCalendarManagement() {
  const container = document.getElementById('calendar-management-list');
  const summary = document.getElementById('calendar-management-summary');
  if (!container || !summary) return;
  setupCalendarLabelForm();

  container.innerHTML = `
    <div class="calendar-management-loading">
      <i class="material-icons spin" aria-hidden="true">refresh</i>
      Loading calendars…
    </div>
  `;
  summary.textContent = 'Loading…';

  try {
    const [calendarsResponse, settingsResponse, routingResponse, profilesResponse] = await Promise.all([
      fetch('api/ha/calendars'),
      fetch('api/calendar-settings'),
      fetch('api/calendar-routing'),
      fetch('api/users')
    ]);
    if (![calendarsResponse, settingsResponse, routingResponse, profilesResponse].every(response => response.ok)) {
      throw new Error('Failed to load calendar routing');
    }

    const calendars = await calendarsResponse.json();
    const settings = await settingsResponse.json();
    const routingData = await routingResponse.json();
    const profiles = await profilesResponse.json();
    settingsProfileCache = Array.isArray(profiles) ? profiles : [];
    if (!Array.isArray(calendars) || calendars.length === 0) {
      renderCalendarManagementEmptyState(container, summary);
      return;
    }

    const disabledCalendarIds = new Set(settings.disabledCalendarIds || []);
    const routes = routingData.routes || {};
    const labels = Array.isArray(routingData.labels) ? routingData.labels : [];
    container.innerHTML = '';
    calendars.forEach(calendarItem => {
      container.appendChild(renderCalendarManagementRow(
        calendarItem,
        routes[calendarItem.entity_id] || { profileIds: [], labelId: null },
        settingsProfileCache,
        labels,
        !disabledCalendarIds.has(calendarItem.entity_id)
      ));
    });
    updateCalendarManagementSummary();
  } catch (err) {
    console.error('[ERROR] Failed to load calendar management:', err);
    summary.textContent = 'Unavailable';
    container.innerHTML = `
      <div class="calendar-management-error">
        <i class="material-icons" aria-hidden="true">error_outline</i>
        <span>Calendar routing could not be loaded.</span>
        <button type="button" class="btn btn-secondary" id="retry-calendar-management">Retry</button>
      </div>
    `;
    document.getElementById('retry-calendar-management')
      ?.addEventListener('click', loadCalendarManagement);
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

  if (!appleId || !appPassword) {
    statusEl.textContent = 'Please enter your Apple ID and app-specific password.';
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
      body: JSON.stringify({ appleId, appPassword })
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
    loadCalendarManagement();
    refreshCalendarAvailability();

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
    loadCalendarManagement();
    refreshCalendarAvailability();
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

// Populates the "Next Event" footer. #next-event-info previously had no JS writing
// to it at all, so it always read "No upcoming events" no matter what was scheduled.
function updateNextEventPanel(events) {
  const el = document.getElementById('next-event-info');
  if (!el) return;

  const now = new Date();
  const upcoming = (events || [])
    .map(e => ({ ev: e, when: new Date(e.start) }))
    .filter(x => !isNaN(x.when) && x.when >= now)
    .sort((a, b) => a.when - b.when)[0];

  if (!upcoming) {
    el.textContent = 'No upcoming events';
    return;
  }

  const { ev, when } = upcoming;
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayDiff = Math.round((new Date(when.getFullYear(), when.getMonth(), when.getDate()) - midnight) / 86400000);
  const dayLabel = dayDiff === 0 ? 'Today'
    : dayDiff === 1 ? 'Tomorrow'
    : when.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

  const timeLabel = ev.allDay
    ? 'all day'
    : when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  el.textContent = `${ev.title} — ${dayLabel}, ${timeLabel}`;
}

// ── Automatic refresh ────────────────────────────────────────────────────
// This runs on a wall-mounted display nobody touches for days. Nothing refetched
// events on a timer, so the board stayed stale until someone interacted with it.
const CALENDAR_REFRESH_MS = 5 * 60 * 1000;
let calendarRefreshTimer = null;
let calendarVisibilityHooked = false;

function refreshCalendarData() {
  try {
    if (typeof calendar !== 'undefined' && calendar) calendar.refetchEvents();
    if (typeof fetchWeather === 'function') fetchWeather();
  } catch (err) {
    console.warn('[WARN] Auto-refresh failed:', err);
  }
}

function startCalendarAutoRefresh() {
  // The page loader re-enters pages, so guard against stacking timers.
  stopCalendarAutoRefresh();

  if (document.visibilityState !== 'hidden') {
    calendarRefreshTimer = setInterval(refreshCalendarData, CALENDAR_REFRESH_MS);
  }

  if (!calendarVisibilityHooked) {
    calendarVisibilityHooked = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        stopCalendarAutoRefresh();
      } else {
        refreshCalendarData();
        if (!calendarRefreshTimer) {
          calendarRefreshTimer = setInterval(refreshCalendarData, CALENDAR_REFRESH_MS);
        }
      }
    });
  }
}

function stopCalendarAutoRefresh() {
  if (calendarRefreshTimer) {
    clearInterval(calendarRefreshTimer);
    calendarRefreshTimer = null;
  }
}

// ── Event details ────────────────────────────────────────────────────────
// eventClick previously only console.logged, so tapping an event on the
// touchscreen appeared to do nothing.
function formatEventWhen(ev) {
  const start = ev.start;
  const end = ev.end;
  if (!start) return '';

  const dayFmt = { weekday: 'long', month: 'long', day: 'numeric' };
  const timeFmt = { hour: 'numeric', minute: '2-digit' };

  if (ev.allDay) {
    // FullCalendar's all-day end is exclusive; step back a day for display.
    const lastDay = end ? new Date(end.getTime() - 86400000) : start;
    const sameDay = lastDay.toDateString() === start.toDateString();
    return sameDay
      ? `${start.toLocaleDateString(undefined, dayFmt)} · All day`
      : `${start.toLocaleDateString(undefined, dayFmt)} – ${lastDay.toLocaleDateString(undefined, dayFmt)} · All day`;
  }

  const startStr = `${start.toLocaleDateString(undefined, dayFmt)}, ${start.toLocaleTimeString(undefined, timeFmt)}`;
  if (!end) return startStr;
  return end.toDateString() === start.toDateString()
    ? `${startStr} – ${end.toLocaleTimeString(undefined, timeFmt)}`
    : `${startStr} – ${end.toLocaleDateString(undefined, dayFmt)}, ${end.toLocaleTimeString(undefined, timeFmt)}`;
}

function showEventDetails(ev) {
  const modal = document.getElementById('event-detail-modal');
  if (!modal || !ev) return;

  const props = ev.extendedProps || {};
  const set = (id, value, isHideable) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (isHideable) {
      if (value) { el.textContent = value; el.hidden = false; }
      else { el.textContent = ''; el.hidden = true; }
    } else {
      el.textContent = value || '';
    }
  };

  set('event-detail-title', ev.title || 'Event');
  set('event-detail-when', formatEventWhen(ev));
  set('event-detail-location', props.location, true);
  set('event-detail-description', props.description, true);
  set(
    'event-detail-access',
    props.readOnly ? 'Read-only sync · Edit this event in Apple Calendar.' : '',
    true
  );

  const meta = document.getElementById('event-detail-meta');
  if (meta) {
    const chips = [];
    const profileIds = Array.isArray(props.profileIds) ? props.profileIds : (props.userId ? [props.userId] : []);
    const owners = typeof allCalendarUsers !== 'undefined'
      ? profileIds.map(profileId => (allCalendarUsers || []).find(user => user.id === profileId)).filter(Boolean)
      : [];
    if (owners.length > 0) {
      owners.forEach(owner => {
        chips.push(`<span class="event-detail-chip" style="--chip-color:${getValidCalendarColor(owner.color)}">${escapeHtml(owner.name)}</span>`);
      });
    } else if (props.labelId && props.labelName) {
      chips.push(`<span class="event-detail-chip" style="--chip-color:${getValidCalendarColor(props.labelColor)}">${escapeHtml(props.labelName)}</span>`);
    } else {
      chips.push('<span class="event-detail-chip event-detail-chip-muted">Unassigned</span>');
    }
    const calName = props.calendarName || props.calendar_entity_id;
    if (calName) chips.push(`<span class="event-detail-chip event-detail-chip-muted">${escapeHtml(String(calName))}</span>`);
    const sourceName = (props.sourceType || props.source) === 'caldav'
      ? `iCloud / CalDAV${props.sourceAccountName ? ` · ${props.sourceAccountName}` : ''}`
      : 'Home Assistant';
    chips.push(`<span class="event-detail-chip event-detail-chip-muted">${escapeHtml(sourceName)}</span>`);
    if (props.readOnly) chips.push('<span class="event-detail-chip event-detail-chip-readonly">Read-only</span>');
    meta.innerHTML = chips.join('');
  }

  modal.classList.add('show');
}

function hideEventDetails() {
  const modal = document.getElementById('event-detail-modal');
  if (modal) modal.classList.remove('show');
}

document.addEventListener('click', (e) => {
  if (e.target.closest('#event-detail-close')) { hideEventDetails(); return; }
  const modal = document.getElementById('event-detail-modal');
  if (modal && e.target === modal) hideEventDetails();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideEventDetails();
});

// Initials for a profile chip: "Morgan Lee" -> "ML", "Sam" -> "S".
function getProfileInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

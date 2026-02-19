/**
 * Page Loader - Handles dynamic loading of page content
 * This file is part of the refactoring effort to separate the monolithic index.html
 * into separate page files for better maintainability.
 */

class PageLoader {
  constructor() {
    this.pageCache = {};
    this.loadedScripts = {};
    this.initTabHandlers();
    // Load the initial active tab content
    this.loadInitialContent();
  }

  /**
   * Load content for the initially active tab
   */
  async loadInitialContent() {
    console.log("PageLoader: Loading initial content");
    const activeTab = document.querySelector('.tab-item.active-tab');
    if (activeTab) {
      const targetId = activeTab.dataset.tabTarget;
      const container = document.getElementById(targetId);
      if (container) {
        const pageName = targetId.replace('-content', '');
        console.log(`PageLoader: Initial active tab is ${pageName}`);
        await this.loadPageContent(pageName, container);
        this.triggerPageLoadedEvent(pageName);
      } else {
        console.error(`PageLoader: Container not found for ${targetId}`);
      }
    } else {
      console.error("PageLoader: No active tab found");
    }
  }

  /**
   * Initialize tab navigation handlers
   */
  initTabHandlers() {
    console.log("PageLoader: Initializing tab handlers");
    const tabItems = document.querySelectorAll('.tab-item');
    const tabContents = document.querySelectorAll('.tab-content');

    tabItems.forEach(item => {
      item.addEventListener('click', async () => {
        console.log(`Tab clicked: ${item.dataset.tabTarget}`);
        const target = item.dataset.tabTarget;
        const pageName = target.replace('-content', '');

        // Remove active class from all tabs and content
        tabItems.forEach(tab => tab.classList.remove('active-tab'));
        tabContents.forEach(content => {
          content.classList.remove('active-content');
          content.style.display = 'none';
        });

        // Add active class to clicked tab
        item.classList.add('active-tab');

        // Get content container
        const contentContainer = document.getElementById(target);
        if (contentContainer) {
          try {
            // Load content if needed
            await this.loadPageContent(pageName, contentContainer);

            // Show the content
            contentContainer.classList.add('active-content');

            // Set different display style based on tab type
            if (target === 'settings-content') {
              contentContainer.style.display = 'flex';

              // Force settings content to be visible after a small delay (helps with rendering)
              setTimeout(() => {
                contentContainer.style.visibility = 'visible';
                contentContainer.style.opacity = '1';
              }, 50);
            } else {
              contentContainer.style.display = 'block';
            }

            // Trigger post-load events
            this.triggerPageLoadedEvent(pageName);
          } catch (error) {
            console.error(`Error handling tab click for ${pageName}:`, error);
            contentContainer.innerHTML = `<div class="error-message">Error loading content: ${error.message}</div>`;
            contentContainer.style.display = 'block';
          }
        } else {
          console.error(`Content container not found for ${target}`);
        }
      });
    });
  }

  /**
   * Load page content from separate HTML files
   * @param {string} pageName - The name of the page to load (without -content suffix)
   * @param {HTMLElement} container - The container to load the content into
   * @returns {Promise<void>}
   */
  async loadPageContent(pageName, container) {
    try {
      // Check if content is already loaded
      if (container.dataset.loaded === 'true' && container.children.length > 0) {
        console.log(`Page ${pageName} already loaded, skipping fetch`);
        this.initializePageFunctionality(pageName);
        return;
      }

      // Try to get content from cache first
      let content = this.pageCache[pageName];

      // If not in cache, fetch it
      if (!content) {
        console.log(`Loading page content for: ${pageName}`);
        const response = await fetch(`pages/${pageName}.html`);

        if (!response.ok) {
          throw new Error(`Failed to load ${pageName}.html: ${response.status}`);
        }

        content = await response.text();
        this.pageCache[pageName] = content;
      }

      // Set the HTML content
      container.innerHTML = content;
      container.dataset.loaded = 'true';

      console.log(`Page ${pageName} loaded successfully`);

      // Initialize the page's functionality based on its type
      await this.initializePageFunctionality(pageName);
    } catch (error) {
      console.error(`Error loading page ${pageName}:`, error);
      container.innerHTML = `<div class="error-message">Failed to load content: ${error.message}</div>`;
      throw error;
    }
  }

  /**
   * Initialize functionality specific to each page type
   * @param {string} pageName - The name of the page to initialize
   */
  async initializePageFunctionality(pageName) {
    console.log(`Initializing functionality for ${pageName} page`);

    return new Promise((resolve) => {
      // This calls existing initialization functions from script.js
      switch(pageName) {
        case 'calendar':
          console.log("Initializing calendar functionality...");
          setTimeout(() => {
            try {
              // First ensure the updateTime function is called
              if (typeof updateTime === 'function') {
                updateTime();
              } else {
                console.warn("updateTime function not found, using fallback");
                // Fallback time update
                const now = new Date();
                const timeStr = now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                const dateStr = now.toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                });

                const timeEl = document.getElementById('current-time');
                const dateEl = document.getElementById('current-date');
                if (timeEl) timeEl.textContent = timeStr;
                if (dateEl) dateEl.textContent = dateStr;

                // Update every second
                setInterval(() => {
                  const now = new Date();
                  const timeStr = now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                  if (timeEl) timeEl.textContent = timeStr;
                }, 1000);
              }

              // Initialize calendar if FullCalendar is available
              const calendarEl = document.getElementById('calendar');
              if (calendarEl && typeof FullCalendar !== 'undefined') {
                // Check if calendar already exists
                if (!window.calendar) {
                  console.log("Creating new FullCalendar instance");
                  window.calendar = new FullCalendar.Calendar(calendarEl, {
                    initialView: 'dayGridMonth',
                    headerToolbar: {
                      left: '',
                      center: 'title',
                      right: 'prev,next'
                    },
                    height: '100%',
                    dayMaxEvents: true,
                    eventTimeFormat: {
                      hour: 'numeric',
                      minute: '2-digit',
                      meridiem: 'short'
                    }
                  });

                  window.calendar.render();
                  console.log("Calendar rendered successfully");

                  // Fetch calendar events if function exists
                  if (typeof fetchCalendarEvents === 'function') {
                    fetchCalendarEvents();
                  }

                  // Load user toggles if function exists
                  if (typeof loadUserToggles === 'function') {
                    loadUserToggles();
                  }
                } else {
                  console.log("Calendar already exists, just rendering");
                  window.calendar.render();
                }
              } else {
                console.error("Calendar element or FullCalendar library not found");
              }

              // Fetch weather if function exists
              if (typeof fetchWeather === 'function') {
                fetchWeather();
              }

            } catch (error) {
              console.error("Error initializing calendar:", error);
            }
            resolve();
          }, 100);
          break;

        case 'chores':
          if (typeof fetchAndDisplayChores === 'function') {
            console.log("Initializing chores functionality...");
            setTimeout(() => {
              try {
                fetchAndDisplayChores();
                this.attachChoreEventListeners();
              } catch (error) {
                console.error("Error initializing chores:", error);
              }
              resolve();
            }, 100);
          } else {
            console.warn("fetchAndDisplayChores function not found");
            resolve();
          }
          break;

        case 'meals':
          if (typeof fetchAndDisplayMeals === 'function') {
            console.log("Initializing meals functionality...");
            setTimeout(() => {
              try {
                fetchAndDisplayMeals();
                this.attachMealEventListeners();
              } catch (error) {
                console.error("Error initializing meals:", error);
              }
              resolve();
            }, 100);
          } else {
            console.warn("fetchAndDisplayMeals function not found");
            resolve();
          }
          break;

        case 'games':
          console.log("Initializing games functionality...");
          setTimeout(() => {
            try {
              this.attachGameEventListeners();
            } catch (error) {
              console.error("Error initializing games:", error);
            }
            resolve();
          }, 100);
          break;

        case 'settings':
          console.log("Initializing settings functionality...");
          setTimeout(async () => {
            try {
              await this.attachSettingsEventListeners();
            } catch (error) {
              console.error("Error initializing settings:", error);
            }
            resolve();
          }, 100);
          break;

        case 'api-test':
          console.log("Initializing API test functionality...");
          resolve();
          break;

        default:
          console.log(`No specific initialization for ${pageName}`);
          resolve();
          break;
      }
    });
  }

  /**
   * Attach event listeners for chores page
   */
  attachChoreEventListeners() {
    console.log("Attaching chore event listeners");

    // Find the most specific add chore button in the loaded page first, then fall back to the global one
    const choreContentArea = document.getElementById('chores-content');
    const addChoreButton = choreContentArea.querySelector('#add-chore-button') || document.getElementById('add-chore-button');

    if (addChoreButton) {
      // Remove existing listeners by cloning
      const oldButton = addChoreButton;
      const newButton = oldButton.cloneNode(true);
      if (oldButton.parentNode) {
        oldButton.parentNode.replaceChild(newButton, oldButton);
      }

      newButton.addEventListener('click', () => {
        // Try to find modal in the current page content first, then fall back to the global one
        const pageSpecificModal = choreContentArea.querySelector('#add-chore-modal');
        const modal = pageSpecificModal || document.getElementById('add-chore-modal');

        if (modal) {
          console.log("Opening add chore modal");
          modal.classList.add('show');
        } else {
          console.warn("Add chore modal not found");
        }
      });
    } else {
      console.warn("Add chore button not found");
    }

    // Close modal buttons - handle both in-page and global modals
    document.querySelectorAll('.modal-close, .modal-cancel').forEach(button => {
      button.addEventListener('click', () => {
        const modal = button.closest('.modal');
        if (modal) {
          modal.classList.remove('show');
        }
      });
    });
  }

  /**
   * Attach event listeners for meals page
   */
  attachMealEventListeners() {
    console.log("Attaching meal event listeners");
    const mealsContentArea = document.getElementById('meals-content');

    // Recipe book button
    const recipeBookButton = mealsContentArea.querySelector('#recipe-book-button') || document.getElementById('recipe-book-button');
    if (recipeBookButton) {
      // Remove existing listeners by cloning
      const oldButton = recipeBookButton;
      const newButton = oldButton.cloneNode(true);
      if (oldButton.parentNode) {
        oldButton.parentNode.replaceChild(newButton, oldButton);
      }

      newButton.addEventListener('click', () => {
        console.log("Recipe book button clicked");
        const pageSpecificModal = mealsContentArea.querySelector('#recipe-book-modal');
        const modal = pageSpecificModal || document.getElementById('recipe-book-modal');

        if (modal) {
          modal.classList.add('show');
          if (typeof loadRecipes === 'function') loadRecipes();
        } else {
          console.warn("Recipe book modal not found");
        }
      });
    } else {
      console.warn("Recipe book button not found");
    }

    // Add meal button
    const addMealButton = mealsContentArea.querySelector('#add-meal-button') || document.getElementById('add-meal-button');
    if (addMealButton) {
      // Remove existing listeners by cloning
      const oldButton = addMealButton;
      const newButton = oldButton.cloneNode(true);
      if (oldButton.parentNode) {
        oldButton.parentNode.replaceChild(newButton, oldButton);
      }

      newButton.addEventListener('click', () => {
        console.log("Add meal button clicked");
        const pageSpecificModal = mealsContentArea.querySelector('#add-meal-modal');
        const modal = pageSpecificModal || document.getElementById('add-meal-modal');

        if (modal) modal.classList.add('show');
        else console.warn("Add meal modal not found");
      });
    } else {
      console.warn("Add meal button not found");
    }

    // Grocery list button
    const groceryListButton = mealsContentArea.querySelector('#grocery-list-button') || document.getElementById('grocery-list-button');
    if (groceryListButton) {
      // Remove existing listeners by cloning
      const oldButton = groceryListButton;
      const newButton = oldButton.cloneNode(true);
      if (oldButton.parentNode) {
        oldButton.parentNode.replaceChild(newButton, oldButton);
      }

      newButton.addEventListener('click', () => {
        console.log("Grocery list button clicked");
        const pageSpecificModal = mealsContentArea.querySelector('#grocery-list-modal');
        const modal = pageSpecificModal || document.getElementById('grocery-list-modal');

        if (modal) {
          modal.classList.add('show');
          if (typeof loadGroceryList === 'function') loadGroceryList();
        } else {
          console.warn("Grocery list modal not found");
        }
      });
    } else {
      console.warn("Grocery list button not found");
    }

    // Close modal buttons
    document.querySelectorAll('.modal-close, .modal-cancel').forEach(button => {
      button.addEventListener('click', () => {
        const modal = button.closest('.modal');
        if (modal) {
          modal.classList.remove('show');
        }
      });
    });
  }

  /**
   * Attach event listeners for games page
   */
  attachGameEventListeners() {
    console.log("Attaching game event listeners");
    const gamesContentArea = document.getElementById('games-content');

    // Game items
    gamesContentArea.querySelectorAll('.game-item').forEach(gameItem => {
      // Remove existing listeners by cloning
      const oldItem = gameItem;
      const newItem = oldItem.cloneNode(true);
      if (oldItem.parentNode) {
        oldItem.parentNode.replaceChild(newItem, oldItem);
      }

      newItem.addEventListener('click', () => {
        const gameUrl = newItem.dataset.gameUrl;
        const gameTitle = newItem.querySelector('.game-title').textContent;
        console.log(`Game clicked: ${gameTitle}`);

        // Try page-specific modal first, then fall back to global one
        const pageSpecificModal = gamesContentArea.querySelector('#game-focus-modal');
        const modal = pageSpecificModal || document.getElementById('game-focus-modal');

        // Prefer iframe in the same modal as we're using
        const iframe = modal ? modal.querySelector('#game-iframe') : document.getElementById('game-iframe');
        const title = modal ? modal.querySelector('#game-modal-title, h3') : document.getElementById('game-modal-title');

        if (modal && iframe) {
          if (title) title.textContent = gameTitle;
          iframe.src = gameUrl;
          modal.classList.add('show');
        } else {
          console.warn("Game focus modal, iframe, or title not found");
        }
      });
    });

    // Add game button
    const addGameButton = gamesContentArea.querySelector('#add-game-button') || document.getElementById('add-game-button');
    if (addGameButton) {
      // Remove existing listeners by cloning
      const oldButton = addGameButton;
      const newButton = oldButton.cloneNode(true);
      if (oldButton.parentNode) {
        oldButton.parentNode.replaceChild(newButton, oldButton);
      }

      newButton.addEventListener('click', () => {
        console.log("Add game button clicked");
        const pageSpecificModal = gamesContentArea.querySelector('#add-game-modal');
        const modal = pageSpecificModal || document.getElementById('add-game-modal');

        if (modal) modal.classList.add('show');
        else console.warn("Add game modal not found");
      });
    } else {
      console.warn("Add game button not found");
    }

    // Close modal buttons
    document.querySelectorAll('.modal-close, .modal-cancel').forEach(button => {
      button.addEventListener('click', () => {
        console.log("Modal close button clicked");
        const modal = button.closest('.modal');
        if (modal) {
          modal.classList.remove('show');

          // If game modal, clear iframe src
          if (modal.id === 'game-focus-modal') {
            const iframe = modal.querySelector('#game-iframe') || document.getElementById('game-iframe');
            if (iframe) iframe.src = '';
          }
        }
      });
    });
  }

  /**
   * Attach event listeners for settings page
   */
  async attachSettingsEventListeners() {
    console.log("Attaching settings event listeners");

    // First, try to load the saved theme from Home Assistant, then localStorage
    try {
      // First try to get theme from Home Assistant
      const haResponse = await fetch('api/user/theme');
      if (haResponse.ok) {
        const haData = await haResponse.json();
        if (haData.theme) {
          console.log(`Loading saved theme from Home Assistant: ${haData.theme}`);
          document.body.className = `theme-${haData.theme}`;
        }
      } else {
        // Fallback to localStorage if HA is not available
        console.log('Home Assistant theme not available, trying localStorage...');
        const savedTheme = localStorage.getItem('daylight-theme');
        if (savedTheme) {
          console.log(`Loading saved theme from localStorage: ${savedTheme}`);
          document.body.className = `theme-${savedTheme}`;
        }
      }
    } catch (error) {
      console.warn("Could not load theme from Home Assistant, trying localStorage fallback:", error);
      // Fallback to localStorage
      try {
        const savedTheme = localStorage.getItem('daylight-theme');
        if (savedTheme) {
          console.log(`Loading saved theme from localStorage: ${savedTheme}`);
          document.body.className = `theme-${savedTheme}`;
        }
      } catch (localError) {
        console.warn("Could not load theme from localStorage either:", localError);
      }
    }

    // Theme buttons
    document.querySelectorAll('.theme-button').forEach(button => {
      // Set active state on current theme
      const currentTheme = document.body.className.replace('theme-', '') || 'light';
      console.log(`Current theme: ${currentTheme}, Button theme: ${button.dataset.theme}`);

      if (button.dataset.theme === currentTheme) {
        button.classList.add('active');
      }

            button.addEventListener('click', async (e) => {
        const theme = e.currentTarget.dataset.theme;
        console.log(`Theme button clicked: ${theme}`);
        document.body.className = `theme-${theme}`;

        // Update active button
        document.querySelectorAll('.theme-button').forEach(btn => {
          btn.classList.remove('active');
        });
        e.currentTarget.classList.add('active');

        // Save theme to Home Assistant instead of localStorage
        try {
          const response = await fetch('api/user/theme', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ theme: theme })
          });

          if (response.ok) {
            console.log(`Theme ${theme} saved to Home Assistant`);
          } else {
            console.warn(`Failed to save theme to Home Assistant, falling back to localStorage`);
            localStorage.setItem('daylight-theme', theme);
          }
        } catch (error) {
          console.warn("Could not save theme to Home Assistant, using localStorage fallback:", error);
          localStorage.setItem('daylight-theme', theme);
        }
      });
    });

    // Media testing buttons
    const startCameraBtn = document.getElementById('start-camera');
    const stopCameraBtn = document.getElementById('stop-camera');
    const startMicBtn = document.getElementById('start-microphone');
    const stopMicBtn = document.getElementById('stop-microphone');

    if (startCameraBtn && stopCameraBtn) {
      startCameraBtn.addEventListener('click', () => {
        console.log("Start camera button clicked");
        const cameraTest = document.getElementById('camera-test');
        if (cameraTest) {
          navigator.mediaDevices.getUserMedia({ video: true })
            .then(stream => {
              cameraTest.srcObject = stream;
              startCameraBtn.disabled = true;
              stopCameraBtn.disabled = false;
            })
            .catch(err => console.error('Error accessing camera:', err));
        } else {
          console.warn("Camera test element not found");
        }
      });

      stopCameraBtn.addEventListener('click', () => {
        console.log("Stop camera button clicked");
        const cameraTest = document.getElementById('camera-test');
        if (cameraTest && cameraTest.srcObject) {
          const tracks = cameraTest.srcObject.getTracks();
          tracks.forEach(track => track.stop());
          cameraTest.srcObject = null;
          startCameraBtn.disabled = false;
          stopCameraBtn.disabled = true;
        }
      });
    } else {
      console.warn("Camera control buttons not found");
    }

    if (startMicBtn && stopMicBtn) {
      startMicBtn.addEventListener('click', () => {
        console.log("Start microphone button clicked");
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then(stream => {
            window.micStream = stream;
            startMicBtn.disabled = true;
            stopMicBtn.disabled = false;
            this.startMicLevelMonitor();
          })
          .catch(err => console.error('Error accessing microphone:', err));
      });

      stopMicBtn.addEventListener('click', () => {
        console.log("Stop microphone button clicked");
        if (window.micStream) {
          const tracks = window.micStream.getTracks();
          tracks.forEach(track => track.stop());
          window.micStream = null;
          startMicBtn.disabled = false;
          stopMicBtn.disabled = true;
          this.stopMicLevelMonitor();
        }
      });
    } else {
      console.warn("Microphone control buttons not found");
    }
  }

  /**
   * Start monitoring microphone input level
   */
  startMicLevelMonitor() {
    if (!window.micStream) return;

    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      const microphone = audioContext.createMediaStreamSource(window.micStream);
      microphone.connect(analyser);

      analyser.fftSize = 256;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const levelBar = document.getElementById('mic-level-bar');

      function updateMicLevel() {
        if (!window.micStream) return;

        analyser.getByteFrequencyData(dataArray);
        let average = 0;
        dataArray.forEach(value => average += value);
        average /= bufferLength;

        // Update level bar
        if (levelBar) {
          levelBar.style.width = `${average}%`;
        }

        window.micLevelRequestId = requestAnimationFrame(updateMicLevel);
      }

      window.micLevelRequestId = requestAnimationFrame(updateMicLevel);
    } catch (error) {
      console.error("Error starting microphone level monitor:", error);
    }
  }

  /**
   * Stop monitoring microphone input level
   */
  stopMicLevelMonitor() {
    if (window.micLevelRequestId) {
      cancelAnimationFrame(window.micLevelRequestId);
      window.micLevelRequestId = null;
    }

    const levelBar = document.getElementById('mic-level-bar');
    if (levelBar) {
      levelBar.style.width = '0%';
    }
  }

  /**
   * Trigger custom event when a page is loaded
   * @param {string} pageName - The name of the page that was loaded
   */
  triggerPageLoadedEvent(pageName) {
    const event = new CustomEvent('pageLoaded', {
      detail: { page: pageName }
    });
    document.dispatchEvent(event);
    console.log(`Triggered pageLoaded event for ${pageName}`);
  }

  /**
   * Preload all pages in the background
   * @returns {Promise<void>}
   */
  async preloadAllPages() {
    const pages = ['calendar', 'chores', 'meals', 'games', 'settings'];

    for (const page of pages) {
      try {
        if (!this.pageCache[page]) {
          const response = await fetch(`pages/${page}.html`);
          if (response.ok) {
            const content = await response.text();
            this.pageCache[page] = content;
            console.log(`Preloaded ${page}.html`);
          }
        }
      } catch (error) {
        console.error(`Error preloading ${page}.html:`, error);
      }
    }
  }
}

// Initialize page loader when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  console.log("PageLoader: DOM content loaded, initializing page loader");

  // Load saved theme from localStorage
  try {
    const savedTheme = localStorage.getItem('daylight-theme');
    if (savedTheme) {
      console.log(`Loading saved theme from localStorage: ${savedTheme}`);
      document.body.className = `theme-${savedTheme}`;
    }
  } catch (error) {
    console.warn("Could not load theme from localStorage:", error);
  }

  window.pageLoader = new PageLoader();

  // Optional: Preload all pages after a delay
  setTimeout(() => {
    window.pageLoader.preloadAllPages();
  }, 2000);
});
document.addEventListener('DOMContentLoaded', async function() {
  console.log('[INFO] Initializing Daylight Calendar client...');

  // Fetch configuration from the server
  try {
    const configResponse = await fetch('/api/config');
    if (!configResponse.ok) throw new Error(`Failed to load config: ${configResponse.status}`);
    window.appConfig = await configResponse.json();
    console.log('[INFO] Loaded configuration:', window.appConfig);

    // Show/hide debug tab based on development mode
    const debugTab = document.getElementById('debug-tab');
    if (debugTab) {
      if (window.appConfig.development_mode) {
        debugTab.style.display = 'flex';
        console.log('[INFO] Debug mode enabled - showing debug tab');
      } else {
        debugTab.style.display = 'none';
        console.log('[INFO] Debug mode disabled - hiding debug tab');
      }
    }
  } catch (error) {
    console.error('[ERROR] Loading configuration:', error);
    window.appConfig = { theme: 'light' }; // Default fallback
  }

  // Initialize appConfig with default values to avoid reference errors elsewhere
  window.appConfig = window.appConfig || {
    theme: 'light',
    show_weather: true,
    locale: 'en-US',
    time_format: '12h',
    allow_dummy_weather: false // Ensure dummy weather is off by default and VERY EARLY
  };

  // Global variable to store weather forecast data - MOVED EARLIER
  let weatherForecastData = [];
  // window.currentWeather is implicitly global or should be declared if not.
  // It is currently assigned as window.currentWeather in fetchWeather, which is fine.

  // Connect to socket.io server
  const socket = io();

  // Configuration
  // Removed local appConfig variable, will use window.appConfig

  // Handle sidebar toggle
  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebar-logo');
  const app = document.getElementById('app');

  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', function() {
      app.classList.toggle('sidebar-collapsed');

      // If we have a calendar instance, update its size after sidebar animation completes
      setTimeout(() => {
        if (typeof calendar !== 'undefined' && calendar.updateSize) {
          calendar.updateSize();
        }
      }, 300); // Match transition-speed CSS variable
    });
  }

  // Modal management
  const openModal = (modalId) => {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('show');
    }
  };

  const closeModal = (modalId) => {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('show');
    }
  };

  // Set up modal close buttons
  document.querySelectorAll('.modal-close, .modal-cancel').forEach(button => {
    button.addEventListener('click', () => {
      const modal = button.closest('.modal');
      modal.classList.remove('show');

      // If this is the game modal, clear the iframe src when closing
      if (modal.id === 'game-focus-modal') {
        document.getElementById('game-iframe').src = '';
      }
    });
  });

  // Add chore button
  const addChoreButton = document.getElementById('add-chore-button');
  if (addChoreButton) {
    addChoreButton.addEventListener('click', () => {
      openModal('add-chore-modal');
    });
  }

  // Meal categories button
  const mealCategoriesButton = document.getElementById('meal-categories-button');
  if (mealCategoriesButton) {
    mealCategoriesButton.addEventListener('click', () => {
      openModal('meal-categories-modal');
    });
  }

  // Add meal button event listener
  const addMealButton = document.getElementById('add-meal-button');
  if (addMealButton) {
    addMealButton.addEventListener('click', () => {
      // Populate the meal type dropdown before opening modal
      populateMealTypeDropdown();
      openModal('add-meal-modal');
    });
  }

  // Function to populate meal type dropdown
  async function populateMealTypeDropdown() {
    const mealTypeSelect = document.getElementById('mealType');
    if (!mealTypeSelect) return;

    try {
      // Clear existing options
      mealTypeSelect.innerHTML = '';

      // Fetch categories from API
      const response = await fetch('/api/meal-categories');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const categories = await response.json();

      // Add options for each category
      categories.forEach(category => {
        const option = document.createElement('option');
        option.value = category.name.toLowerCase();
        option.textContent = category.name;
        mealTypeSelect.appendChild(option);
      });

      // Set a default selection if available
      if (mealTypeSelect.options.length > 0) {
        mealTypeSelect.selectedIndex = 0;
      }
    } catch (error) {
      console.error('Error populating meal types:', error);
      // Add default meal types as fallback
      ['Breakfast', 'Lunch', 'Dinner'].forEach(type => {
        const option = document.createElement('option');
        option.value = type.toLowerCase();
        option.textContent = type;
        mealTypeSelect.appendChild(option);
      });
    }
  }

  // Toggle completed chores button
  const toggleCompletedButton = document.getElementById('toggle-completed');
  let hideCompleted = false;
  if (toggleCompletedButton) {
    toggleCompletedButton.addEventListener('click', () => {
      hideCompleted = !hideCompleted;
      const icon = toggleCompletedButton.querySelector('i');

      if (hideCompleted) {
        toggleCompletedButton.innerHTML = '<i class="fas fa-eye"></i> Show Completed';
        document.querySelectorAll('.kanban-item.completed').forEach(item => {
          item.style.display = 'none';
        });
      } else {
        toggleCompletedButton.innerHTML = '<i class="fas fa-eye-slash"></i> Hide Completed';
        document.querySelectorAll('.kanban-item.completed').forEach(item => {
          item.style.display = 'block';
        });
      }
    });
  }

  // Jump to today button
  const jumpToTodayButton = document.getElementById('jump-to-today');
  if (jumpToTodayButton) {
    jumpToTodayButton.addEventListener('click', () => {
      // This would depend on how we represent dates in the UI
      // For now, we'll just log it
      console.log('Jump to today clicked');
      // We'd need to highlight today's items or scroll to them
    });
  }

  // Meal week navigation
  let currentWeekStart = moment().startOf('week');

  const updateMealWeekDates = () => {
    const dayHeaders = document.querySelectorAll('.day-header');
    dayHeaders.forEach((header, index) => {
      const date = moment(currentWeekStart).add(index, 'days');
      header.textContent = date.format('ddd, MMM D');

      if (date.isSame(moment(), 'day')) {
        header.classList.add('today');
      } else {
        header.classList.remove('today');
      }
    });

    // Mark today's cells
    document.querySelectorAll('.meal-cell').forEach(cell => {
      const dayIndex = parseInt(cell.dataset.day);
      const date = moment(currentWeekStart).add(dayIndex, 'days');

      if (date.isSame(moment(), 'day')) {
        cell.classList.add('today');
      } else {
        cell.classList.remove('today');
      }
    });

    // Refresh meal data for the current week
    fetchAndDisplayMeals();
  };

  const prevWeekButton = document.getElementById('prev-week');
  if (prevWeekButton) {
    prevWeekButton.addEventListener('click', () => {
      currentWeekStart = moment(currentWeekStart).subtract(1, 'week');
      updateMealWeekDates();
    });
  }

  const nextWeekButton = document.getElementById('next-week');
  if (nextWeekButton) {
    nextWeekButton.addEventListener('click', () => {
      currentWeekStart = moment(currentWeekStart).add(1, 'week');
      updateMealWeekDates();
    });
  }

  // Fetch configuration
  fetch('/api/config')
    .then(response => response.json())
    .then(config => {
      window.appConfig = { ...window.appConfig, ...config };
      window.appConfig.allow_dummy_weather = false; // Force dummy weather off
      updateTheme(window.appConfig.theme);
      updateTime();
      if (window.appConfig.show_weather) {
        fetchWeather();
      } else {
        document.getElementById('weather-container').style.display = 'none';
      }
    })
    .catch(error => {
      console.error('Error loading configuration:', error);
      window.appConfig.allow_dummy_weather = false; // Ensure dummy weather is off on error
      // Use defaults if config fails
      updateTheme(window.appConfig.theme);
      updateTime();
      if (window.appConfig.show_weather) {
        fetchWeather();
      } else {
        document.getElementById('weather-container').style.display = 'none';
      }
    });

  // Initialize calendar
  const calendarEl = document.getElementById('calendar');
  const calendar = new FullCalendar.Calendar(calendarEl, {
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
    },
    eventClick: function(info) {
      // Show event details
      const event = info.event;
      const startTime = event.start ? moment(event.start).format('h:mm A') : '';
      const endTime = event.end ? moment(event.end).format('h:mm A') : '';
      let timeStr = startTime;
      if (endTime) {
        timeStr += ` - ${endTime}`;
      }

      const eventInfo = `${event.title} ${timeStr ? '(' + timeStr + ')' : ''}`;
      document.getElementById('next-event-info').textContent = eventInfo;
    },
    dayCellDidMount: function(info) {
      // Add weather icons to calendar days
      const date = info.date;
      const dateKey = moment(date).format('YYYY-MM-DD');
      const dayTop = info.el.querySelector('.fc-daygrid-day-top');

      // 1. Immediately clear any existing weather icon from this cell
      if (dayTop) {
        const existingIcon = dayTop.querySelector('.day-weather-icon');
        if (existingIcon) {
          existingIcon.remove();
        }
      }

      // Get weather for this date using our global function
      let weatherForDay = getWeatherForDate(dateKey);

      // 2. Strictly enforce allow_dummy_weather if data is fallback AND allow_dummy_weather is false
      if (weatherForDay && weatherForDay._isFallback === true && window.appConfig && window.appConfig.allow_dummy_weather === false) {
        console.log(`[DEBUG] dayCellDidMount: Nullifying fallback weather for ${dateKey} because allow_dummy_weather is false.`);
        weatherForDay = null;
      }

      // 3. Only continue if we have real (or explicitly allowed dummy) weather data
      if (weatherForDay) {
        // console.log(`[DEBUG] Adding weather to calendar cell: ${dateKey}`, weatherForDay); // Can be verbose

        const weatherIconDiv = document.createElement('div');
        weatherIconDiv.className = `day-weather-icon weather-${weatherForDay.condition}`;
        weatherIconDiv.title = `${weatherForDay.temp}°${weatherForDay._isFallback ? ' (Estimated)' : ''}`;

        const iconMap = {
          'clear-night': '<i class="fas fa-moon"></i>',
          'cloudy': '<i class="fas fa-cloud"></i>',
          'fog': '<i class="fas fa-smog"></i>',
          'hail': '<i class="fas fa-cloud-meatball"></i>',
          'lightning': '<i class="fas fa-bolt"></i>',
          'lightning-rainy': '<i class="fas fa-bolt"></i>',
          'partlycloudy': '<i class="fas fa-cloud-sun"></i>',
          'pouring': '<i class="fas fa-cloud-showers-heavy"></i>',
          'rainy': '<i class="fas fa-cloud-rain"></i>',
          'snowy': '<i class="fas fa-snowflake"></i>',
          'snowy-rainy': '<i class="fas fa-cloud-sleet"></i>',
          'sunny': '<i class="fas fa-sun"></i>',
          'windy': '<i class="fas fa-wind"></i>',
          'windy-variant': '<i class="fas fa-wind"></i>',
          'exceptional': '<i class="fas fa-exclamation-triangle"></i>'
        };

        weatherIconDiv.innerHTML = iconMap[weatherForDay.condition] || iconMap['cloudy'];

        if (dayTop) {
          dayTop.appendChild(weatherIconDiv);
        } else {
          console.error(`[ERROR] Could not find .fc-daygrid-day-top for date ${dateKey} to append weather icon.`);
        }
      } else {
        // console.log(`[INFO] No weather data available for calendar cell ${dateKey}`); // Can be verbose
      }
    }
  });

  calendar.render();

  // Fetch calendar events
  function fetchCalendarEvents() {
    fetch('/api/calendar')
      .then(response => response.json())
      .then(calendars => {
        // Clear existing events
        calendar.removeAllEvents();

        // Add events from all calendars
        let allEvents = [];
        calendars.forEach(cal => {
          if (cal.events) {
            allEvents = allEvents.concat(cal.events.map(event => ({
              title: event.summary,
              start: event.start.dateTime || event.start.date,
              end: event.end.dateTime || event.end.date,
              allDay: !event.start.dateTime,
              backgroundColor: cal.backgroundColor || '#4285f4'
            })));
          }
        });

        // Add events to calendar
        calendar.addEventSource(allEvents);

        // Update next event
        updateNextEvent(allEvents);
      })
      .catch(error => {
        console.error('Error fetching calendar events:', error);
      });
  }

  // Load user toggles in calendar toolbar
  function loadUserToggles() {
    const userToggles = document.getElementById('user-toggles');
    if (!userToggles) return;

    fetch('/api/users')
      .then(response => response.json())
      .then(users => {
        userToggles.innerHTML = '';

        users.forEach(user => {
          const toggle = document.createElement('div');
          toggle.className = 'user-toggle active';
          toggle.dataset.user = user.name;
          toggle.style.backgroundColor = user.color;

          if (user.icon) {
            toggle.innerHTML = `<i class="fas ${user.icon}"></i>`;
          } else {
            toggle.textContent = user.name.charAt(0);
          }

          toggle.addEventListener('click', () => {
            toggle.classList.toggle('active');
            toggle.classList.toggle('inactive');

            // In a real app, this would filter calendar events
            // For now, we'll just show a message
            console.log(`Toggle ${user.name}'s events: ${toggle.classList.contains('active') ? 'shown' : 'hidden'}`);
          });

          userToggles.appendChild(toggle);
        });
      })
      .catch(error => {
        console.error('Error loading user toggles:', error);
        userToggles.innerHTML = '<div class="error">Failed to load users</div>';
      });
  }

  // Update next event in footer
  function updateNextEvent(events) {
    if (!events || events.length === 0) {
      document.getElementById('next-event-info').textContent = 'No upcoming events';
      return;
    }

    const now = new Date();

    // Find next event
    const upcomingEvents = events
      .filter(event => new Date(event.start) > now)
      .sort((a, b) => new Date(a.start) - new Date(b.start));

    if (upcomingEvents.length === 0) {
      document.getElementById('next-event-info').textContent = 'No upcoming events';
      return;
    }

    const nextEvent = upcomingEvents[0];
    const startTime = moment(nextEvent.start).format('ddd, MMM D, h:mm A');
    document.getElementById('next-event-info').textContent = `${nextEvent.title} (${startTime})`;
  }

  // Update time display
  function updateTime() {
    const now = new Date();

    // Format time based on configuration
    let timeFormat = 'h:mm A';
    if (window.appConfig.time_format === '24h') { // Use window.appConfig
      timeFormat = 'HH:mm';
    }

    const timeStr = moment(now).format(timeFormat);
    const dateStr = moment(now).format('dddd, MMMM D, Y');

    document.getElementById('current-time').textContent = timeStr;
    document.getElementById('current-date').textContent = dateStr;

    setTimeout(updateTime, 1000);
  }

  // Fetch weather data
  function fetchWeather() {
    if (!window.appConfig.show_weather) {
      document.getElementById('weather-container').style.display = 'none';
      return;
    }

    // Ensure weather container is potentially visible if weather is shown
    const weatherContainerElement = document.getElementById('weather-container');
    if (weatherContainerElement) {
        weatherContainerElement.style.display = 'flex';
        // Add loading indicator
        weatherContainerElement.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Loading weather...</div>';
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
          // Clear weather data
          weatherForecastData = [];
          window.currentWeather = null;
          updateCalendarWeather();
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
        updateCalendarWeather();
        // Also update day weather after calendar is updated
        setTimeout(updateCalendarDayWeather, 100);
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
          <div class="condition"><i class="fas fa-exclamation-circle"></i></div>
          <div class="error-message">${message}</div>
        </div>
      `;
      weatherContainer.style.display = 'flex'; // Ensure it's visible
    }
    // Clear any existing weather icons from calendar and global stores
    weatherForecastData = [];
    window.currentWeather = null;
    updateCalendarWeather(); // This will remove icons if data is cleared
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

    const tempEl = document.querySelector('.weather .temp');
    const conditionEl = document.querySelector('.weather .condition i');
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
    conditionDiv.appendChild(conditionIcon);

    // Create/update condition text element
    const conditionText = document.createElement('div');
    conditionText.className = 'condition-text';
    weatherContainer.appendChild(conditionText);

    // Update temperature
    // Update temperature - handle non-numeric values
    if (temp === null || temp === undefined || temp === '-') {
      tempDiv.textContent = '--°';
    } else {
      tempDiv.textContent = `${temp}°`;
    }
    console.log('[DEBUG] Updated temperature display to:', tempDiv.textContent);

    // Map Home Assistant weather condition to Font Awesome icon
    const iconMap = {
      'clear-night': 'fa-moon',
      'cloudy': 'fa-cloud',
      'fog': 'fa-smog',
      'hail': 'fa-cloud-meatball',
      'lightning': 'fa-bolt',
      'lightning-rainy': 'fa-bolt',
      'partlycloudy': 'fa-cloud-sun',
      'pouring': 'fa-cloud-showers-heavy',
      'rainy': 'fa-cloud-rain',
      'snowy': 'fa-snowflake',
      'snowy-rainy': 'fa-cloud-sleet',
      'sunny': 'fa-sun',
      'windy': 'fa-wind',
      'windy-variant': 'fa-wind',
      'exceptional': 'fa-exclamation-triangle',
      'unavailable': 'fa-question-circle',
      'error': 'fa-exclamation-circle'
    };

    // Update weather icon
    const iconClass = iconMap[condition] || 'fa-cloud';
    conditionIcon.className = `fas ${iconClass}`;
    console.log('[DEBUG] Updated weather icon to:', iconClass);

    // Format the condition name to be more readable
    const readableCondition = condition.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    conditionText.textContent = readableCondition;

    // Add last updated timestamp
    const lastUpdated = document.createElement('div');
    lastUpdated.className = 'last-updated';
    lastUpdated.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
    weatherContainer.appendChild(lastUpdated);
  }

  // Update weather icons on the calendar
  function updateCalendarWeather() {
    console.log('[DEBUG] Updating calendar weather icons. First, removing all existing day-weather-icons globally.');

    // Force removal of all existing weather icons first
    document.querySelectorAll('.fc-daygrid-day .day-weather-icon').forEach(icon => icon.remove());

    console.log('[DEBUG] Attempting to refetch events and re-render calendar.');
    if (calendar) {
        try {
            // calendar.refetchEvents(); // Not using events for weather, but can sometimes help refresh things.
            calendar.render(); // Re-render the calendar view
            console.log('[DEBUG] Calendar.render() called.');
        } catch (e) {
            console.error('[ERROR] Error during calendar.render in updateCalendarWeather:', e);
        }
    } else {
        console.warn('[WARN] Calendar object not found in updateCalendarWeather.');
    }
  }

  // Function to update weather icons on calendar days through direct DOM manipulation
  function updateCalendarDayWeather() {
    console.log('[DEBUG] Updating calendar day weather via DOM');

    // Find all day cells in the calendar
    const dayCells = document.querySelectorAll('.fc-daygrid-day');

    if (dayCells.length === 0) {
      console.log('[DEBUG] No day cells found in calendar');
      return;
    }

    console.log(`[DEBUG] Found ${dayCells.length} day cells`);

    dayCells.forEach(cell => {
      // Get the date for this cell from its data-date attribute
      const dateAttr = cell.getAttribute('data-date');
      if (!dateAttr) return;

      // ALWAYS remove any existing weather icon first from this specific cell
      let existingIcon = cell.querySelector('.day-weather-icon');
      if (existingIcon) {
        existingIcon.remove();
        console.log(`[DEBUG] Removed existing weather icon from cell ${dateAttr}`);
      }

      console.log(`[DEBUG] Processing cell for date: ${dateAttr}`);

      // Get weather for this date
      const weatherForDay = getWeatherForDate(dateAttr);

      // Find any existing weather icon
      let weatherIcon = cell.querySelector('.day-weather-icon');

      // If we have real weather data
      if (weatherForDay) {
        console.log(`[DEBUG] Weather for ${dateAttr}:`, weatherForDay);

        // Create weather icon if it doesn't exist
        if (!weatherIcon) {
          weatherIcon = document.createElement('div');
          weatherIcon.className = 'day-weather-icon';
          const dayTop = cell.querySelector('.fc-daygrid-day-top');
          if (dayTop) {
            dayTop.appendChild(weatherIcon);
          }
        }

        // Update the weather icon class
        weatherIcon.className = `day-weather-icon weather-${weatherForDay.condition}`;

        // Map Home Assistant weather condition to Font Awesome icon HTML
        const iconMap = {
          'clear-night': '<i class="fas fa-moon"></i>',
          'cloudy': '<i class="fas fa-cloud"></i>',
          'fog': '<i class="fas fa-smog"></i>',
          'hail': '<i class="fas fa-cloud-meatball"></i>',
          'lightning': '<i class="fas fa-bolt"></i>',
          'lightning-rainy': '<i class="fas fa-bolt"></i>',
          'partlycloudy': '<i class="fas fa-cloud-sun"></i>',
          'pouring': '<i class="fas fa-cloud-showers-heavy"></i>',
          'rainy': '<i class="fas fa-cloud-rain"></i>',
          'snowy': '<i class="fas fa-snowflake"></i>',
          'snowy-rainy': '<i class="fas fa-cloud-sleet"></i>',
          'sunny': '<i class="fas fa-sun"></i>',
          'windy': '<i class="fas fa-wind"></i>',
          'windy-variant': '<i class="fas fa-wind"></i>',
          'exceptional': '<i class="fas fa-exclamation-triangle"></i>'
        };

        // Set the icon HTML and temperature tooltip
        weatherIcon.innerHTML = iconMap[weatherForDay.condition] || iconMap['cloudy'];
        weatherIcon.title = `${weatherForDay.temp}°`;
      } else {
        // If we don't have real data, remove any existing weather icon
        if (weatherIcon) {
          weatherIcon.remove();
        }
      }
    });
  }

  // Function to get weather for a specific date
  function getWeatherForDate(dateKey) {
    // Check if it's today's date and we have current weather data
    const today = new Date().toISOString().split('T')[0];
    const targetDateString = new Date(dateKey).toISOString().split('T')[0];

    if (targetDateString === today && window.currentWeather) {
      console.log(`[DEBUG] Using current weather for today (${today})`);
      return {
        temp: window.currentWeather.temp,
        condition: window.currentWeather.condition
      };
    }

    // Try to find a matching forecast entry for this date
    if (weatherForecastData && weatherForecastData.length > 0) {
      // Convert dateKey (YYYY-MM-DD) to match datetime format in forecast
      console.log(`[DEBUG] Looking for weather forecast for date: ${targetDateString}`);
      console.log(`[DEBUG] Available forecast dates: ${JSON.stringify(weatherForecastData.map(f => {
        if (!f || !f.datetime) return 'invalid';
        return new Date(f.datetime).toISOString().split('T')[0];
      }))}`);

      // Find forecast entry for this date
      const forecastEntry = weatherForecastData.find(entry => {
        if (!entry || !entry.datetime) {
          console.log(`[DEBUG] Skipping invalid forecast entry: ${JSON.stringify(entry)}`);
          return false;
        }

        const forecastDate = new Date(entry.datetime);
        const forecastDateString = forecastDate.toISOString().split('T')[0];

        console.log(`[DEBUG] Comparing target date ${targetDateString} with forecast date: ${forecastDateString}`);
        return forecastDateString === targetDateString;
      });

      if (forecastEntry) {
        console.log(`[DEBUG] Found forecast for ${targetDateString}:`, forecastEntry);
        return {
          temp: forecastEntry.temperature,
          condition: forecastEntry.condition
        };
      }

      console.log(`[DEBUG] No forecast found for ${targetDateString}`);
    } else {
      console.log(`[DEBUG] No forecast data available: ${JSON.stringify(weatherForecastData)}`);
    }


    // Return null if we don't have data and dummy data is not allowed
    return null;
  }

  // Update theme
  function updateTheme(theme) {
    const app = document.getElementById('app');
    app.className = `theme-${theme}`;
  }

  // Initial data load
  fetchAndDisplayChores();
  fetchAndDisplayMeals(); // Call to fetch meals
  loadUserToggles(); // Load user toggles

  // Set up periodic refresh
  setInterval(fetchCalendarEvents, 5 * 60 * 1000); // Refresh every 5 minutes
  setInterval(fetchWeather, 15 * 60 * 1000); // Refresh weather every 15 minutes

  // Listen for socket events
  socket.on('calendar_update', () => {
    fetchCalendarEvents();
  });

  socket.on('weather_update', () => {
    fetchWeather();
  });

  socket.on('config_update', () => {
    fetch('/api/config')
      .then(response => response.json())
      .then(config => {
        window.appConfig = { ...window.appConfig, ...config };
        window.appConfig.allow_dummy_weather = false; // Force dummy weather off
        updateTheme(window.appConfig.theme);
        if (window.appConfig.show_weather) {
          fetchWeather();
          document.getElementById('weather-container').style.display = 'flex';
        } else {
          document.getElementById('weather-container').style.display = 'none';
        }
      });
  });

  // Handle keyboard shortcut to exit kiosk mode (ESC key)
  document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
      socket.emit('exit_kiosk');
    }
  });

  // Tab switching logic
  const tabItems = document.querySelectorAll('.tab-item');
  const tabContents = document.querySelectorAll('.tab-content');

  tabItems.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.dataset.tabTarget;
      const targetContent = document.getElementById(targetId);

      // Remove active state from all tabs and content
      tabItems.forEach(t => t.classList.remove('active-tab'));
      tabContents.forEach(c => c.classList.remove('active-content'));

      // Set active state for clicked tab and corresponding content
      tab.classList.add('active-tab');
      if (targetContent) {
        targetContent.classList.add('active-content');
      }

      // Special handling for calendar rendering when its tab becomes active
      if (targetId === 'calendar-content') {
        // Re-render or resize FullCalendar if it was hidden, as it might not calculate its size correctly when initially hidden.
        // Using a slight delay can sometimes help ensure the container is fully visible.
        setTimeout(() => {
          if (calendar) { // calendar is the FullCalendar instance
            calendar.render(); // Or calendar.updateSize(); depending on FullCalendar version and needs.
          }
        }, 0);
      }
    });
  });

  // Function to fetch and display chores in kanban format
  async function fetchAndDisplayChores() {
    try {
      const response = await fetch('/api/chores');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const chores = await response.json();
      const choreBoard = document.getElementById('chore-board');

      if (!choreBoard) {
        console.error('Chore board container not found!');
        return;
      }

      choreBoard.innerHTML = ''; // Clear previous content

      // Group chores by assignee
      const choresByAssignee = {};

      // First, collect all unique assignees
      const assignees = [...new Set(chores.map(chore =>
        chore.assigneeName ? chore.assigneeName : 'Unassigned'))];

      // Create a lane for each assignee
      assignees.forEach(assignee => {
        const assigneeChores = chores.filter(chore =>
          (chore.assigneeName ? chore.assigneeName : 'Unassigned') === assignee);

        const laneId = assignee.toLowerCase().replace(/\s+/g, '-');
        const lane = document.createElement('div');
        lane.className = `kanban-lane lane-${laneId}`;

        const laneHeader = document.createElement('div');
        laneHeader.className = 'kanban-lane-header';

        const laneTitle = document.createElement('div');
        laneTitle.className = 'lane-title';

        // Determine icon based on assignee
        let icon = 'fa-user';
        if (assignee === 'Unassigned') {
          icon = 'fa-user-slash';
        }

        laneTitle.innerHTML = `
          <i class="fas ${icon}"></i>
          <span>${assignee}</span>
        `;

        const laneCount = document.createElement('div');
        laneCount.className = 'lane-count';
        laneCount.textContent = assigneeChores.length;

        laneHeader.appendChild(laneTitle);
        laneHeader.appendChild(laneCount);

        const items = document.createElement('div');
        items.className = 'kanban-items';

        // Add chores to this lane
        assigneeChores.forEach(chore => {
          const item = document.createElement('div');
          item.className = chore.completed ? 'kanban-item completed' : 'kanban-item';
          item.dataset.id = chore.id;

          // If we want to hide completed items
          if (hideCompleted && chore.completed) {
            item.style.display = 'none';
          }

          const title = document.createElement('div');
          title.className = 'item-title';
          title.textContent = chore.name;

          const itemMeta = document.createElement('div');
          itemMeta.className = 'item-meta';

          let dueHtml = '';
          if (chore.dueDate) {
            const dueDate = moment(chore.dueDate);
            const isOverdue = !chore.completed && dueDate.isBefore(moment(), 'day');
            const dueClass = isOverdue ? 'overdue' : '';

            dueHtml = `
              <div class="item-due ${dueClass}">
                <i class="fas fa-calendar-day"></i>
                <span>${dueDate.format('MMM D, YYYY')}</span>
              </div>
            `;
          }

          const statusHtml = `
            <div class="item-status">
              ${chore.completed ?
                '<span class="status-badge done">Done</span>' :
                '<span class="status-badge pending">Pending</span>'}
            </div>
          `;

          itemMeta.innerHTML = dueHtml + statusHtml;

          const itemActions = document.createElement('div');
          itemActions.className = 'item-actions';

          itemActions.innerHTML = `
            <button class="toggle-status-btn" data-id="${chore.id}">
              <i class="fas ${chore.completed ? 'fa-undo' : 'fa-check'}"></i>
            </button>
            <button class="delete-btn" data-id="${chore.id}">
              <i class="fas fa-trash-alt"></i>
            </button>
          `;

          item.appendChild(title);
          item.appendChild(itemMeta);
          item.appendChild(itemActions);
          items.appendChild(item);
        });

        lane.appendChild(laneHeader);
        lane.appendChild(items);
        choreBoard.appendChild(lane);
      });

      // Add event listeners for chore actions
      document.querySelectorAll('.toggle-status-btn').forEach(button => {
        button.addEventListener('click', (e) => {
          e.stopPropagation();
          const choreId = button.dataset.id;
          const choreItem = button.closest('.kanban-item');
          const isCompleted = choreItem.classList.contains('completed');

          // In a real app, you'd update the status on the server
          // For now, we just toggle the UI
          if (isCompleted) {
            choreItem.classList.remove('completed');
            button.innerHTML = '<i class="fas fa-check"></i>';
            choreItem.querySelector('.status-badge').textContent = 'Pending';
            choreItem.querySelector('.status-badge').className = 'status-badge pending';
          } else {
            choreItem.classList.add('completed');
            button.innerHTML = '<i class="fas fa-undo"></i>';
            choreItem.querySelector('.status-badge').textContent = 'Done';
            choreItem.querySelector('.status-badge').className = 'status-badge done';

            if (hideCompleted) {
              choreItem.style.display = 'none';
            }
          }
        });
      });

      document.querySelectorAll('.delete-btn').forEach(button => {
        button.addEventListener('click', async (e) => {
          e.stopPropagation();
          const choreId = button.dataset.id;

          if (confirm('Are you sure you want to delete this chore?')) {
            try {
              const response = await fetch(`/api/chores/${choreId}`, {
                method: 'DELETE',
              });

              if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
              }

              // Refresh the board
              fetchAndDisplayChores();
            } catch (error) {
              console.error('Error deleting chore:', error);
              alert('Failed to delete chore: ' + error.message);
            }
          }
        });
      });

    } catch (error) {
      console.error('Error fetching or displaying chores:', error);
      const choreBoard = document.getElementById('chore-board');
      if (choreBoard) {
        choreBoard.innerHTML = '<p class="error-message">Could not load chores. Please try again.</p>';
      }
    }
  }

  // Event listener for adding a new chore
  const addChoreForm = document.getElementById('add-chore-form');
  if (addChoreForm) {
    addChoreForm.addEventListener('submit', async function(event) {
      event.preventDefault();
      const choreName = event.target.choreName.value;
      const assigneeName = event.target.assigneeName.value;
      const dueDate = event.target.dueDate.value;

      if (!choreName) {
        alert('Chore name is required.');
        return;
      }

      try {
        const response = await fetch('/api/chores', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: choreName, assigneeName, dueDate }),
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        // Close the modal
        closeModal('add-chore-modal');

        // Refresh the chore board
        fetchAndDisplayChores();

        // Clear the form
        event.target.reset();
      } catch (error) {
        console.error('Error adding chore:', error);
        alert(`Failed to add chore: ${error.message}`);
      }
    });
  }

  // Function to fetch and display meals in the weekly grid
  async function fetchAndDisplayMeals() {
    try {
      // First, ensure meal type rows exist
      await createMealPlanRows();

      const response = await fetch('/api/meals');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const mealDays = await response.json();

      // Clear all meal cells
      document.querySelectorAll('.meal-cell').forEach(cell => {
        cell.innerHTML = '';
        cell.classList.remove('has-meal');
      });

      // Fill in meals for the current week
      mealDays.forEach(day => {
        const mealDate = moment(day.date);

        // Check if this meal is in the current week we're viewing
        if (mealDate.isBetween(currentWeekStart, moment(currentWeekStart).add(6, 'days'), null, '[]')) {
          // Calculate which day of the week this is (0-6)
          const dayOfWeek = mealDate.day() - 1; // -1 because our grid starts with Monday(0)
          const adjustedDay = dayOfWeek < 0 ? 6 : dayOfWeek; // Adjust for Sunday

          // Add each meal to the appropriate cell
          day.meals.forEach(meal => {
            const mealType = meal.type.toLowerCase();
            const cell = document.querySelector(`.meal-cell[data-day="${adjustedDay}"][data-type="${mealType}"]`);

            if (cell) {
              cell.innerHTML = `
                <div class="meal-name">${meal.description}</div>
              `;
              cell.classList.add('has-meal');
            }
          });
        }
      });

      // Add click handler for meal cells to add new meals
      document.querySelectorAll('.meal-cell').forEach(cell => {
        cell.addEventListener('click', () => {
          const day = parseInt(cell.dataset.day);
          const type = cell.dataset.type;
          const date = moment(currentWeekStart).add(day, 'days').format('YYYY-MM-DD');

          // Open the add meal modal
          const addMealModal = document.getElementById('add-meal-modal');
          if (addMealModal) {
            // Set the meal date in the form
            document.getElementById('mealDate').value = date;

            // Select the correct meal type
            const mealTypeSelect = document.getElementById('mealType');
            if (mealTypeSelect) {
              for (let i = 0; i < mealTypeSelect.options.length; i++) {
                if (mealTypeSelect.options[i].value.toLowerCase() === type) {
                  mealTypeSelect.selectedIndex = i;
                  break;
                }
              }
            }

            // Open the modal
            addMealModal.classList.add('show');
          }
        });
      });

    } catch (error) {
      console.error('Error fetching or displaying meal plan:', error);
      alert('Failed to load meal plan: ' + error.message);
    }
  }

  // Function to create meal plan rows for each meal type
  async function createMealPlanRows() {
    const mealPlanGrid = document.getElementById('meal-plan-grid');
    if (!mealPlanGrid) return;

    let mealTypes = ['breakfast', 'lunch', 'dinner']; // Default fallback

    try {
      // Fetch meal categories from API
      const response = await fetch('/api/meal-categories');
      if (response.ok) {
        const categories = await response.json();
        if (categories && categories.length > 0) {
          mealTypes = categories.map(cat => cat.name.toLowerCase());
        }
      }
    } catch (error) {
      console.error('Error fetching meal categories for rows:', error);
      // Continue with default types
    }

    // Remove existing meal rows (not the header)
    const existingRows = mealPlanGrid.querySelectorAll('.meal-plan-row');
    existingRows.forEach(row => row.remove());

    // Create a row for each meal type
    mealTypes.forEach(type => {
      const row = document.createElement('div');
      row.className = 'meal-plan-row';
      row.dataset.mealType = type;

      // Add type header cell
      const typeCell = document.createElement('div');
      typeCell.className = 'meal-plan-cell meal-type-cell';
      typeCell.innerHTML = `
        <i class="fas fa-utensils"></i>
        <span>${type.charAt(0).toUpperCase() + type.slice(1)}</span>
      `;
      row.appendChild(typeCell);

      // Add a cell for each day of the week
      for (let day = 0; day < 7; day++) {
        const dayCell = document.createElement('div');
        dayCell.className = 'meal-plan-cell meal-cell';
        dayCell.dataset.day = day;
        dayCell.dataset.type = type;

        // Mark today's cell
        const dayDate = moment(currentWeekStart).add(day, 'days');
        if (dayDate.isSame(moment(), 'day')) {
          dayCell.classList.add('today');
        }

        row.appendChild(dayCell);
      }

      mealPlanGrid.appendChild(row);
    });
  }

  // Meal category management
  document.querySelectorAll('.category-edit').forEach(button => {
    button.addEventListener('click', () => {
      const categoryItem = button.closest('.category-item');
      const categoryName = categoryItem.querySelector('.category-name span').textContent;

      const newName = prompt('Edit category name:', categoryName);
      if (newName && newName !== categoryName) {
        categoryItem.querySelector('.category-name span').textContent = newName;
        // In a real app, you would save this to the server
      }
    });
  });

  document.getElementById('add-category')?.addEventListener('click', () => {
    const newName = prompt('Enter new category name:');
    if (newName) {
      const categoriesContainer = document.getElementById('meal-categories-container');
      const newCategory = document.createElement('div');
      newCategory.className = 'category-item';
      newCategory.innerHTML = `
        <div class="category-name">
          <span>${newName}</span>
          <button class="category-edit"><i class="fas fa-pencil-alt"></i></button>
        </div>
      `;

      categoriesContainer.appendChild(newCategory);

      // Add event listener to the new edit button
      newCategory.querySelector('.category-edit').addEventListener('click', () => {
        const categoryName = newCategory.querySelector('.category-name span').textContent;
        const updatedName = prompt('Edit category name:', categoryName);
        if (updatedName && updatedName !== categoryName) {
          newCategory.querySelector('.category-name span').textContent = updatedName;
        }
      });
    }
  });

  // Handle game item clicks
  document.querySelectorAll('.game-item').forEach(gameItem => {
    gameItem.addEventListener('click', () => {
      const gameUrl = gameItem.dataset.gameUrl;
      const gameTitle = gameItem.querySelector('.game-title').textContent;

      // Set the iframe source and modal title
      document.getElementById('game-iframe').src = gameUrl;
      document.getElementById('game-modal-title').textContent = gameTitle;

      // Open the modal
      openModal('game-focus-modal');
    });
  });

  // Recipe Book Button
  const recipeBookButton = document.getElementById('recipe-book-button');
  if (recipeBookButton) {
    recipeBookButton.addEventListener('click', () => {
      loadRecipes(); // Load recipes when opening the modal
      openModal('recipe-book-modal');
    });
  }

  // Add Recipe Button
  const addRecipeButton = document.getElementById('add-recipe-button');
  if (addRecipeButton) {
    addRecipeButton.addEventListener('click', () => {
      // Close the recipe book modal
      closeModal('recipe-book-modal');

      // Open the add recipe modal
      openModal('add-recipe-modal');
    });
  }

  // Add event listener for recipe edit functionality
  document.querySelectorAll('.edit-recipe-btn').forEach(button => {
    button.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent recipe selection
      const recipeId = e.target.closest('.recipe-list-item').dataset.recipeId;
      editRecipe(recipeId);
    });
  });

  // Function to edit a recipe
  function editRecipe(recipeId) {
    // Find the recipe in the loaded recipes
    const recipeItem = document.querySelector(`.recipe-list-item[data-recipe-id="${recipeId}"]`);
    if (!recipeItem) return;

    // Get recipe details
    const recipeName = recipeItem.querySelector('.recipe-list-item-name').textContent;
    const recipeType = recipeItem.querySelector('.recipe-list-item-type').textContent;

    // Get full recipe details - this would typically fetch from the server
    fetch(`/api/recipes/${recipeId}`)
      .then(response => response.json())
      .then(recipe => {
        // Close the recipe book modal
        closeModal('recipe-book-modal');

        // Open and populate the add/edit recipe modal
        const editModal = document.getElementById('add-recipe-modal');
        if (editModal) {
          // Populate form with recipe data
          const form = editModal.querySelector('form');
          if (form) {
            form.reset();
            form.querySelector('#recipe-id').value = recipe.id;
            form.querySelector('#recipe-name').value = recipe.name;
            form.querySelector('#recipe-type').value = recipe.type;
            form.querySelector('#recipe-description').value = recipe.description;
            form.querySelector('#recipe-instructions').value = recipe.instructions;

            // Populate ingredients
            const ingredientsList = form.querySelector('#recipe-ingredients-list');
            if (ingredientsList) {
              ingredientsList.innerHTML = '';
              recipe.ingredients.forEach(ingredient => {
                addIngredientInput(ingredient);
              });
            }

            // Change submit button text to "Update Recipe"
            const submitButton = form.querySelector('button[type="submit"]');
            if (submitButton) {
              submitButton.innerHTML = '<i class="fas fa-save"></i> Update Recipe';
            }

            // Change modal title
            const modalTitle = editModal.querySelector('.modal-header h3');
            if (modalTitle) {
              modalTitle.textContent = 'Edit Recipe';
            }
          }

          openModal('add-recipe-modal');
        }
      })
      .catch(error => {
        console.error('Error loading recipe for editing:', error);
        alert('Failed to load recipe details');
      });
  }

  // Function to add ingredient input fields to the add/edit recipe form
  function addIngredientInput(ingredient = { name: '', amount: '', available: false }) {
    const ingredientsList = document.getElementById('recipe-ingredients-list');
    if (!ingredientsList) return;

    const ingredientItem = document.createElement('div');
    ingredientItem.className = 'ingredient-input-row';

    ingredientItem.innerHTML = `
      <div class="form-row">
        <div class="form-group">
          <input type="text" class="ingredient-name" placeholder="Ingredient name" value="${ingredient.name}" required>
        </div>
        <div class="form-group">
          <input type="text" class="ingredient-amount" placeholder="Amount" value="${ingredient.amount}">
        </div>
        <button type="button" class="btn btn-sm btn-danger remove-ingredient">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `;

    // Add event listener to remove button
    const removeButton = ingredientItem.querySelector('.remove-ingredient');
    if (removeButton) {
      removeButton.addEventListener('click', () => {
        ingredientItem.remove();
      });
    }

    ingredientsList.appendChild(ingredientItem);
  }

  // Add ingredient button event listener
  const addIngredientButton = document.getElementById('add-ingredient-button');
  if (addIngredientButton) {
    addIngredientButton.addEventListener('click', () => {
      addIngredientInput();
    });
  }

  // Grocery list button
  const groceryListButton = document.getElementById('grocery-list-button');
  if (groceryListButton) {
    groceryListButton.addEventListener('click', () => {
      loadGroceryList(); // Load grocery list when opening the modal
      openModal('grocery-list-modal');
    });
  }

  // Select recipe button in add meal form
  const selectRecipeBtn = document.getElementById('select-recipe-btn');
  if (selectRecipeBtn) {
    selectRecipeBtn.addEventListener('click', () => {
      loadRecipes(); // Load recipes when opening the modal
      openModal('recipe-book-modal');

      // Set a flag to indicate we're selecting a recipe for the meal plan
      document.body.dataset.selectingForMeal = 'true';
    });
  }

  // Handle "Add to Meal Plan" button in recipe detail
  const addToMealPlanBtn = document.getElementById('add-to-meal-plan');
  if (addToMealPlanBtn) {
    addToMealPlanBtn.addEventListener('click', () => {
      // Get the selected recipe
      const recipeId = addToMealPlanBtn.dataset.recipeId;
      const recipeName = document.getElementById('recipe-name').textContent;

      // If we're selecting for the meal form, fill in the form and close the recipe book
      if (document.body.dataset.selectingForMeal === 'true') {
        document.getElementById('mealDescription').value = recipeName;
        document.getElementById('recipeId').value = recipeId;
        closeModal('recipe-book-modal');
        document.body.dataset.selectingForMeal = 'false';
      } else {
        // Otherwise, add the recipe to today's meal plan
        const today = new Date();
        const formattedDate = today.toISOString().split('T')[0];
        const mealType = document.querySelector('.recipe-list-item.active .recipe-list-item-type').textContent;

        // Here you would save the meal to the server
        alert(`Added ${recipeName} to ${mealType} for today (${formattedDate})`);
      }
    });
  }

  // Add grocery item form submission
  const addGroceryItemForm = document.getElementById('add-grocery-item-form');
  if (addGroceryItemForm) {
    addGroceryItemForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const nameInput = document.getElementById('groceryItemName');
      const quantityInput = document.getElementById('groceryItemQuantity');

      const name = nameInput.value.trim();
      const quantity = quantityInput.value.trim();

      if (name) {
        try {
          const response = await fetch('/api/grocery-list', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, quantity })
          });

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          // Clear form inputs
          nameInput.value = '';
          quantityInput.value = '';

          // Reload the grocery list
          loadGroceryList();

        } catch (error) {
          console.error('Error adding grocery item:', error);
          alert('Failed to add item to grocery list');
        }
      }
    });
  }

  // Add meal form submission
  const addMealForm = document.getElementById('add-meal-form');
  if (addMealForm) {
    addMealForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const description = document.getElementById('mealDescription').value.trim();
      const mealType = document.getElementById('mealType').value;
      const mealDate = document.getElementById('mealDate').value;
      const recipeId = document.getElementById('recipeId').value;
      const cook = document.getElementById('mealCook')?.value.trim() || '';

      if (description && mealType && mealDate) {
        try {
          const response = await fetch('/api/meals', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              description,
              type: mealType,
              date: mealDate,
              recipeId: recipeId || null,
              cook
            })
          });

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          // Close the modal and refresh the meal plan
          document.getElementById('mealDescription').value = '';
          document.getElementById('recipeId').value = '';
          document.getElementById('mealCook').value = '';
          closeModal('add-meal-modal');

          // Refresh the meal plan
          fetchAndDisplayMeals();

        } catch (error) {
          console.error('Error adding meal:', error);
          alert('Failed to add meal: ' + error.message);
        }
      }
    });
  }

  // Function to load recipes into the recipe book
  async function loadRecipes() {
    const recipeList = document.querySelector('.recipe-list');
    if (!recipeList) return;

    // Show loading placeholder
    recipeList.innerHTML = `
      <div class="recipe-list-placeholder">
        <i class="fas fa-spinner fa-spin"></i>
        <p>Loading recipes...</p>
      </div>
    `;

    try {
      const response = await fetch('/api/recipes');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const recipes = await response.json();

      // Clear the recipe list
      recipeList.innerHTML = '';

      // Populate recipe list
      recipes.forEach(recipe => {
        const recipeItem = document.createElement('div');
        recipeItem.className = 'recipe-list-item';
        recipeItem.dataset.recipeId = recipe.id;

        recipeItem.innerHTML = `
          <div class="recipe-list-item-name">${recipe.name}</div>
          <div class="recipe-list-item-type">${recipe.type}</div>
        `;

        recipeItem.addEventListener('click', () => {
          // Remove active class from all recipes
          document.querySelectorAll('.recipe-list-item').forEach(item => {
            item.classList.remove('active');
          });

          // Add active class to clicked recipe
          recipeItem.classList.add('active');

          // Load recipe details
          loadRecipeDetails(recipe.id);
        });

        recipeList.appendChild(recipeItem);
      });

      // If we have recipes, select the first one by default
      if (recipes.length > 0) {
        const firstRecipe = recipeList.querySelector('.recipe-list-item');
        if (firstRecipe) {
          firstRecipe.classList.add('active');
          loadRecipeDetails(recipes[0].id);
        }
      } else {
        // If no recipes, show empty state
        recipeList.innerHTML = `
          <div class="recipe-list-placeholder">
            <i class="fas fa-book"></i>
            <p>No recipes found</p>
          </div>
        `;
      }
    } catch (error) {
      console.error('Error loading recipes:', error);
      recipeList.innerHTML = `
        <div class="recipe-list-placeholder">
          <i class="fas fa-exclamation-circle"></i>
          <p>Failed to load recipes</p>
        </div>
      `;
    }
  }

  // Function to load recipe details
  async function loadRecipeDetails(recipeId) {
    const recipeDetail = document.querySelector('.recipe-detail');
    const recipeDetailContent = document.querySelector('.recipe-detail-content');
    const recipePlaceholder = document.querySelector('.recipe-detail-placeholder');

    if (!recipeDetail || !recipeDetailContent || !recipePlaceholder) return;

    // Hide content, show placeholder with loading
    recipeDetailContent.style.display = 'none';
    recipePlaceholder.innerHTML = `
      <i class="fas fa-spinner fa-spin"></i>
      <p>Loading recipe details...</p>
    `;
    recipePlaceholder.style.display = 'flex';

    try {
      const response = await fetch(`/api/recipes/${recipeId}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const recipe = await response.json();

      // Update recipe image
      document.getElementById('recipe-image').src = recipe.image;
      document.getElementById('recipe-image').alt = recipe.name;

      // Update recipe info
      document.getElementById('recipe-name').textContent = recipe.name;
      document.getElementById('recipe-description').textContent = recipe.description;

      // Set recipe ID for "Add to Meal Plan" button
      document.getElementById('add-to-meal-plan').dataset.recipeId = recipe.id;

      // Update ingredients list
      const ingredientsList = document.getElementById('recipe-ingredients-list');
      ingredientsList.innerHTML = '';

      recipe.ingredients.forEach(ingredient => {
        const li = document.createElement('li');
        li.className = 'recipe-ingredient-item';

        const availableClass = ingredient.available ? 'available' : '';
        const availableIcon = ingredient.available ? '<i class="fas fa-check"></i>' : '';
        const purchasedDate = ingredient.lastPurchased
          ? `<span class="ingredient-purchased-date">Purchased: ${formatDate(ingredient.lastPurchased)}</span>`
          : '';

        li.innerHTML = `
          <div class="ingredient-check">
            <div class="ingredient-status ${availableClass}" data-ingredient="${ingredient.name}">${availableIcon}</div>
          </div>
          <div class="ingredient-name">${ingredient.name}${purchasedDate}</div>
          <div class="ingredient-amount">${ingredient.amount}</div>
          <button class="add-to-grocery" data-ingredient="${ingredient.name}" data-amount="${ingredient.amount}">
            <i class="fas fa-cart-plus"></i>
          </button>
        `;

        ingredientsList.appendChild(li);
      });

      // Update instructions
      document.getElementById('recipe-instructions-text').textContent = recipe.instructions;

      // Show recipe details
      recipePlaceholder.style.display = 'none';
      recipeDetailContent.style.display = 'block';

      // Add event listeners for ingredient actions
      addIngredientEventListeners();

    } catch (error) {
      console.error('Error loading recipe details:', error);
      recipePlaceholder.innerHTML = `
        <i class="fas fa-exclamation-circle"></i>
        <p>Failed to load recipe details</p>
      `;
    }
  }

  // Function to add event listeners to ingredient actions
  function addIngredientEventListeners() {
    // Ingredient status toggle
    document.querySelectorAll('.ingredient-status').forEach(status => {
      status.addEventListener('click', () => {
        status.classList.toggle('available');

        if (status.classList.contains('available')) {
          status.innerHTML = '<i class="fas fa-check"></i>';

          // Create purchased date element if it doesn't exist
          let purchasedDate = status.closest('.recipe-ingredient-item').querySelector('.ingredient-purchased-date');
          if (!purchasedDate) {
            purchasedDate = document.createElement('span');
            purchasedDate.className = 'ingredient-purchased-date';
            status.closest('.recipe-ingredient-item').querySelector('.ingredient-name').appendChild(purchasedDate);
          }

          // Update purchased date
          const today = new Date();
          purchasedDate.textContent = `Purchased: ${formatDate(today.toISOString().split('T')[0])}`;
        } else {
          status.innerHTML = '';
        }

        // In a real app, you would save this change to the server
      });
    });

    // Add to grocery list
    document.querySelectorAll('.add-to-grocery').forEach(button => {
      button.addEventListener('click', async () => {
        const ingredientName = button.dataset.ingredient;
        const ingredientAmount = button.dataset.amount;

        try {
          const response = await fetch('/api/grocery-list', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              name: ingredientName,
              quantity: ingredientAmount
            })
          });

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          alert(`Added ${ingredientName} to grocery list`);
        } catch (error) {
          console.error('Error adding to grocery list:', error);
          alert('Failed to add item to grocery list');
        }
      });
    });
  }

  // Function to load grocery list
  async function loadGroceryList() {
    const groceryList = document.getElementById('grocery-items-list');
    if (!groceryList) return;

    // Show loading placeholder
    groceryList.innerHTML = `
      <li class="loading-items">
        <i class="fas fa-spinner fa-spin"></i> Loading items...
      </li>
    `;

    try {
      const response = await fetch('/api/grocery-list');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const groceryData = await response.json();

      // Clear the grocery list
      groceryList.innerHTML = '';

      if (groceryData.items.length === 0) {
        groceryList.innerHTML = `
          <li class="empty-list-message">
            Your grocery list is empty
          </li>
        `;
        return;
      }

      // Populate grocery list
      groceryData.items.forEach(item => {
        const li = document.createElement('li');
        li.className = `grocery-item ${item.checked ? 'checked' : ''}`;
        li.dataset.id = item.id;

        li.innerHTML = `
          <div class="grocery-item-check">
            <input type="checkbox" ${item.checked ? 'checked' : ''}>
          </div>
          <div class="grocery-item-name">${item.name}</div>
          <div class="grocery-item-quantity">${item.quantity}</div>
          <button class="grocery-item-delete">
            <i class="fas fa-trash-alt"></i>
          </button>
        `;

        groceryList.appendChild(li);
      });

      // Add event listeners for grocery item actions
      addGroceryItemEventListeners();

    } catch (error) {
      console.error('Error loading grocery list:', error);
      groceryList.innerHTML = `
        <li class="error-message">
          Failed to load grocery list
        </li>
      `;
    }
  }

  // Function to add event listeners to grocery item actions
  function addGroceryItemEventListeners() {
    // Checkbox toggle
    document.querySelectorAll('.grocery-item-check input').forEach(checkbox => {
      checkbox.addEventListener('change', async () => {
        const item = checkbox.closest('.grocery-item');
        const itemId = item.dataset.id;
        const checked = checkbox.checked;

        try {
          const response = await fetch(`/api/grocery-list/${itemId}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ checked })
          });

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          // Update UI
          if (checked) {
            item.classList.add('checked');
          } else {
            item.classList.remove('checked');
          }
        } catch (error) {
          console.error('Error updating grocery item:', error);
          // Revert the checkbox state
          checkbox.checked = !checked;
        }
      });
    });

    // Delete button
    document.querySelectorAll('.grocery-item-delete').forEach(button => {
      button.addEventListener('click', async () => {
        const item = button.closest('.grocery-item');
        const itemId = item.dataset.id;

        if (confirm('Are you sure you want to remove this item?')) {
          try {
            const response = await fetch(`/api/grocery-list/${itemId}`, {
              method: 'DELETE'
            });

            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }

            // Remove item from UI
            item.remove();

            // If list is now empty, show message
            if (document.querySelectorAll('.grocery-item').length === 0) {
              document.getElementById('grocery-items-list').innerHTML = `
                <li class="empty-list-message">
                  Your grocery list is empty
                </li>
              `;
            }
          } catch (error) {
            console.error('Error deleting grocery item:', error);
            alert('Failed to delete item');
          }
        }
      });
    });
  }

  // Helper function to format dates
  function formatDate(dateString) {
    return new Date(dateString).toLocaleDateString(window.appConfig.locale, { // Use window.appConfig
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  // Initialize the page
  fetchAndDisplayChores();
  updateMealWeekDates(); // This will also call fetchAndDisplayMeals

  // Profile Management in Settings
  const profileListSettings = document.getElementById('profile-list-settings');
  const addProfileButton = document.getElementById('add-profile-button');
  const editProfileModal = document.getElementById('edit-profile-modal');
  const editProfileForm = document.getElementById('edit-profile-form');
  const profileEditTitle = document.getElementById('profile-edit-title');
  const deleteProfileBtn = document.getElementById('delete-profile-btn');

  // Color and icon selectors
  const colorSelector = document.getElementById('profile-color-selector');
  const iconSelector = document.getElementById('profile-icon-selector');

  // Profile photo
  const profilePhotoPreview = document.getElementById('profile-photo-preview');
  const takePhotoBtn = document.getElementById('take-profile-photo');
  const uploadPhotoBtn = document.getElementById('upload-profile-photo');
  const photoInput = document.getElementById('profile-photo-input');

  // Load user profiles to settings
  async function loadProfilesForSettings() {
    try {
      const response = await fetch('/api/users');
      const users = await response.json();

      if (profileListSettings) {
        profileListSettings.innerHTML = '';

        users.forEach(user => {
          const profileItem = document.createElement('div');
          profileItem.className = 'profile-item-settings';
          profileItem.dataset.userId = user.id;

          profileItem.innerHTML = `
            <div class="profile-avatar-settings" style="background-color: ${user.color};">
              <i class="fas ${user.icon}"></i>
            </div>
            <div class="profile-name-settings">${user.name}</div>
            <div class="profile-meta">Game time: ${user.gameTimeLimit || 30} min/day</div>
            <button class="profile-edit-btn"><i class="fas fa-pencil-alt"></i></button>
          `;

          // Edit profile click
          const editBtn = profileItem.querySelector('.profile-edit-btn');
          editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openProfileEdit(user);
          });

          // Also allow editing by clicking the entire card
          profileItem.addEventListener('click', () => {
            openProfileEdit(user);
          });

          profileListSettings.appendChild(profileItem);
        });
      }
    } catch (error) {
      console.error('Error loading profiles for settings:', error);
    }
  }

  // Open profile edit
  function openProfileEdit(user) {
    // Set form title
    profileEditTitle.textContent = user ? 'Edit Profile' : 'Add New Profile';

    // Reset form
    editProfileForm.reset();

    // Clear previous selections
    document.querySelectorAll('.color-option.selected, .icon-option.selected').forEach(el => {
      el.classList.remove('selected');
    });

    // If editing an existing user, populate form
    if (user) {
      document.getElementById('profile-id').value = user.id;
      document.getElementById('profile-name').value = user.name;
      document.getElementById('profile-color').value = user.color;
      document.getElementById('profile-icon').value = user.icon;
      document.getElementById('profile-game-time-limit').value = user.gameTimeLimit || 30;

      // Select color
      const colorOption = document.querySelector(`.color-option[data-color="${user.color}"]`);
      if (colorOption) colorOption.classList.add('selected');

      // Select icon
      const iconOption = document.querySelector(`.icon-option[data-icon="${user.icon}"]`);
      if (iconOption) iconOption.classList.add('selected');

      // Set profile photo if exists
      if (user.photo) {
        profilePhotoPreview.innerHTML = `<img src="${user.photo}" alt="${user.name}">`;
        document.getElementById('profile-photo-data').value = user.photo;
      } else {
        profilePhotoPreview.innerHTML = `<i class="fas ${user.icon}"></i>`;
      }

      // Show delete button for existing profiles
      deleteProfileBtn.style.display = 'block';
    } else {
      // New profile, set defaults
      document.getElementById('profile-id').value = '';
      document.getElementById('profile-color').value = '#4285f4';
      document.getElementById('profile-icon').value = 'fa-user';

      // Select default color and icon
      document.querySelector('.color-option[data-color="#4285f4"]').classList.add('selected');
      document.querySelector('.icon-option[data-icon="fa-user"]').classList.add('selected');

      // Reset profile photo
      profilePhotoPreview.innerHTML = '<i class="fas fa-user"></i>';
      document.getElementById('profile-photo-data').value = '';

      // Hide delete button for new profiles
      deleteProfileBtn.style.display = 'none';
    }

    // Open modal
    editProfileModal.classList.add('show');
  }

  // Add new profile
  if (addProfileButton) {
    addProfileButton.addEventListener('click', () => {
      openProfileEdit(null); // null indicates new profile
    });
  }

  // Color selector
  if (colorSelector) {
    colorSelector.querySelectorAll('.color-option').forEach(option => {
      option.addEventListener('click', () => {
        // Remove selected class from all options
        colorSelector.querySelectorAll('.color-option').forEach(o => {
          o.classList.remove('selected');
        });

        // Add selected class to clicked option
        option.classList.add('selected');

        // Update hidden input
        document.getElementById('profile-color').value = option.dataset.color;

        // Update avatar preview background
        profilePhotoPreview.style.backgroundColor = option.dataset.color;
      });
    });
  }

  // Icon selector
  if (iconSelector) {
    iconSelector.querySelectorAll('.icon-option').forEach(option => {
      option.addEventListener('click', () => {
        // Remove selected class from all options
        iconSelector.querySelectorAll('.icon-option').forEach(o => {
          o.classList.remove('selected');
        });

        // Add selected class to clicked option
        option.classList.add('selected');

        // Update hidden input
        document.getElementById('profile-icon').value = option.dataset.icon;

        // Update avatar preview icon if no photo
        if (!document.getElementById('profile-photo-data').value) {
          profilePhotoPreview.innerHTML = `<i class="fas ${option.dataset.icon}"></i>`;
        }
      });
    });
  }

  // Take profile photo
  if (takePhotoBtn) {
    takePhotoBtn.addEventListener('click', () => {
      // Create camera modal
      const cameraModal = document.createElement('div');
      cameraModal.className = 'modal camera-modal';
      cameraModal.innerHTML = `
        <div class="modal-content">
          <div class="modal-header">
            <h3>Take Profile Photo</h3>
            <button class="modal-close">&times;</button>
          </div>
          <div class="modal-body">
            <video id="camera-feed" autoplay playsinline></video>
            <div class="camera-actions">
              <button id="capture-photo" class="btn btn-primary"><i class="fas fa-camera"></i> Take Photo</button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(cameraModal);
      cameraModal.classList.add('show');

      // Get camera feed
      const video = document.getElementById('camera-feed');
      let stream = null;

      navigator.mediaDevices.getUserMedia({ video: true })
        .then(cameraStream => {
          stream = cameraStream;
          video.srcObject = stream;
        })
        .catch(error => {
          console.error('Error accessing camera:', error);
          alert('Could not access the camera. Please check your permissions.');
        });

      // Capture photo
      document.getElementById('capture-photo').addEventListener('click', () => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);

        // Convert to data URL
        const photoData = canvas.toDataURL('image/jpeg');

        // Update preview and hidden input
        profilePhotoPreview.innerHTML = `<img src="${photoData}" alt="Profile Photo">`;
        document.getElementById('profile-photo-data').value = photoData;

        // Stop stream and close modal
        if (stream) {
          stream.getTracks().forEach(track => track.stop());
        }
        cameraModal.classList.remove('show');
        setTimeout(() => {
          cameraModal.remove();
        }, 300);
      });

      // Close button
      cameraModal.querySelector('.modal-close').addEventListener('click', () => {
        if (stream) {
          stream.getTracks().forEach(track => track.stop());
        }
        cameraModal.classList.remove('show');
        setTimeout(() => {
          cameraModal.remove();
        }, 300);
      });
    });
  }

  // Upload profile photo
  if (uploadPhotoBtn && photoInput) {
    uploadPhotoBtn.addEventListener('click', () => {
      photoInput.click();
    });

    photoInput.addEventListener('change', () => {
      if (photoInput.files && photoInput.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const photoData = e.target.result;

          // Update preview and hidden input
          profilePhotoPreview.innerHTML = `<img src="${photoData}" alt="Profile Photo">`;
          document.getElementById('profile-photo-data').value = photoData;
        };
        reader.readAsDataURL(photoInput.files[0]);
      }
    });
  }

  // Save profile
  if (editProfileForm) {
    editProfileForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const profileData = {
        id: document.getElementById('profile-id').value,
        name: document.getElementById('profile-name').value,
        color: document.getElementById('profile-color').value,
        icon: document.getElementById('profile-icon').value,
        photo: document.getElementById('profile-photo-data').value,
        gameTimeLimit: parseInt(document.getElementById('profile-game-time-limit').value, 10)
      };

      try {
        // Simulation - this would save to the server in a real app
        console.log('Saving profile:', profileData);

        // Close modal
        editProfileModal.classList.remove('show');

        // Reload profiles
        loadProfilesForSettings();
      } catch (error) {
        console.error('Error saving profile:', error);
        alert('Failed to save profile: ' + error.message);
      }
    });
  }

  // Delete profile
  if (deleteProfileBtn) {
    deleteProfileBtn.addEventListener('click', async () => {
      const profileId = document.getElementById('profile-id').value;

      if (!profileId) return;

      if (confirm('Are you sure you want to delete this profile? This cannot be undone.')) {
        try {
          // Simulation - this would delete from the server in a real app
          console.log('Deleting profile:', profileId);

          // Close modal
          editProfileModal.classList.remove('show');

          // Reload profiles
          loadProfilesForSettings();
        } catch (error) {
          console.error('Error deleting profile:', error);
          alert('Failed to delete profile: ' + error.message);
        }
      }
    });
  }

  // Load profiles when settings tab is active
  document.querySelector('.tab-item[data-tab-target="settings-content"]').addEventListener('click', () => {
    loadProfilesForSettings();
  });

  // Theme buttons
  document.querySelectorAll('.theme-button').forEach(button => {
    button.addEventListener('click', (e) => {
      const theme = e.currentTarget.dataset.theme;
      updateTheme(theme); // Corrected from setTheme(theme)

      // Set active state on this button and remove from others
      document.querySelectorAll('.theme-button').forEach(btn => {
        btn.classList.remove('active');
      });
      e.currentTarget.classList.add('active');

      // Save theme preference
      fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ theme })
      }).catch(error => console.error('Error saving theme:', error));
    });
  });

  // Initialize theme button state
  const currentTheme = window.appConfig.theme || 'light'; // Use window.appConfig
  const activeThemeButton = document.querySelector(`.theme-button[data-theme="${currentTheme}"]`);
  if (activeThemeButton) {
    activeThemeButton.classList.add('active');
  }

});


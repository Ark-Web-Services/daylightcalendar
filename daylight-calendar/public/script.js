document.addEventListener('DOMContentLoaded', function() {
  // Connect to socket.io server
  const socket = io();
  
  // Configuration
  let appConfig = {
    theme: 'light',
    show_weather: true,
    locale: 'en-US',
    time_format: '12h'
  };
  
  // Fetch configuration
  fetch('/api/config')
    .then(response => response.json())
    .then(config => {
      appConfig = config;
      updateTheme(appConfig.theme);
      updateTime();
      if (appConfig.show_weather) {
        fetchWeather();
      } else {
        document.getElementById('weather-container').style.display = 'none';
      }
    })
    .catch(error => {
      console.error('Error loading configuration:', error);
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
    if (appConfig.time_format === '24h') {
      timeFormat = 'HH:mm';
    }
    
    const timeStr = moment(now).format(timeFormat);
    const dateStr = moment(now).format('dddd, MMMM D, YYYY');
    
    document.getElementById('current-time').textContent = timeStr;
    document.getElementById('current-date').textContent = dateStr;
    
    setTimeout(updateTime, 1000);
  }
  
  // Fetch weather data
  function fetchWeather() {
    if (!appConfig.show_weather) return;
    
    fetch('/api/weather')
      .then(response => response.json())
      .then(data => {
        if (data.enabled === false) return;
        
        const temp = Math.round(data.attributes.temperature);
        const condition = data.attributes.condition;
        
        const tempEl = document.querySelector('.weather .temp');
        const conditionEl = document.querySelector('.weather .condition i');
        
        tempEl.textContent = `${temp}°`;
        
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
          'exceptional': 'fa-exclamation-triangle'
        };
        
        const iconClass = iconMap[condition] || 'fa-cloud';
        conditionEl.className = `fas ${iconClass}`;
      })
      .catch(error => {
        console.error('Error fetching weather data:', error);
      });
  }
  
  // Update theme
  function updateTheme(theme) {
    const app = document.getElementById('app');
    app.className = `theme-${theme}`;
  }
  
  // Initial data load
  fetchCalendarEvents();
  fetchAndDisplayChores(); // Call it here with other initial fetches
  
  // Set up periodic refresh
  setInterval(fetchCalendarEvents, 5 * 60 * 1000); // Refresh every 5 minutes
  setInterval(fetchWeather, 15 * 60 * 1000); // Refresh weather every 15 minutes
  
  // Listen for socket events
  socket.on('calendar_update', () => {
    fetchCalendarEvents();
  });
  
  socket.on('config_update', () => {
    fetch('/api/config')
      .then(response => response.json())
      .then(config => {
        appConfig = config;
        updateTheme(appConfig.theme);
        if (appConfig.show_weather) {
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

  // Function to fetch and display chores
  async function fetchAndDisplayChores() {
    try {
      const response = await fetch('/api/chores');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const chores = await response.json();
      const choreChartContainer = document.getElementById('chore-chart'); // Assuming this ID will exist
      
      if (!choreChartContainer) {
        console.error('Chore chart container not found!');
        return;
      }

      choreChartContainer.innerHTML = ''; // Clear previous chores
      const ul = document.createElement('ul');
      ul.className = 'chore-list';

      if (chores.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No chores today!';
        ul.appendChild(li);
      } else {
        chores.forEach(chore => {
          const li = document.createElement('li');
          li.className = chore.completed ? 'chore-item completed' : 'chore-item';
          li.dataset.choreId = chore.id;
          
          const choreName = document.createElement('span');
          choreName.className = 'chore-name';
          choreName.textContent = chore.name;
          
          const choreAssignee = document.createElement('span');
          choreAssignee.className = 'chore-assignee';
          choreAssignee.textContent = ` (${chore.assignee || 'Unassigned'})`;

          const completionStatus = document.createElement('span');
          completionStatus.className = 'chore-status';
          completionStatus.textContent = chore.completed ? ' [Done]' : ' [Pending]';

          li.appendChild(choreName);
          li.appendChild(choreAssignee);
          li.appendChild(completionStatus);
          ul.appendChild(li);
        });
      }
      choreChartContainer.appendChild(ul);

    } catch (error) {
      console.error('Error fetching or displaying chores:', error);
      const choreChartContainer = document.getElementById('chore-chart');
      if (choreChartContainer) {
        choreChartContainer.innerHTML = '<p>Could not load chores.</p>';
      }
    }
  }
}); 
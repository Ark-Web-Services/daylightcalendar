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
    const dateStr = moment(now).format('dddd, MMMM D, Y');
    
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
  fetchAndDisplayChores();
  fetchAndDisplayMeals(); // Call to fetch meals
  
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
          
          // Here you would open a modal to add a meal
          console.log(`Add meal for ${type} on ${date}`);
          alert(`Feature coming soon: Add ${type} for ${moment(date).format('dddd, MMMM D')}`);
        });
      });
      
    } catch (error) {
      console.error('Error fetching or displaying meal plan:', error);
      alert('Failed to load meal plan: ' + error.message);
    }
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

  // Initialize the page
  fetchAndDisplayChores();
  updateMealWeekDates(); // This will also call fetchAndDisplayMeals
}); 
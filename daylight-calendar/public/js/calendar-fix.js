/**
 * Calendar Fix - Ensures the calendar loads properly
 */

(function() {
  // Execute when DOM is fully loaded
  document.addEventListener('DOMContentLoaded', function() {
    console.log("CalendarFix: Initializing");

    // Try to initialize the calendar after a short delay
    setTimeout(fixCalendar, 500);

    // Also listen for page loaded events
    document.addEventListener('pageLoaded', function(e) {
      if (e.detail.page === 'calendar') {
        console.log("CalendarFix: Calendar page loaded, reinitializing...");
        setTimeout(fixCalendar, 300);
      }
    });
  });

  /**
   * Fix calendar initialization
   */
  function fixCalendar() {
    console.log("CalendarFix: Attempting to fix calendar");

    // Check if the calendar element exists
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) {
      console.error("CalendarFix: Calendar element not found");
      return;
    }

    // Check if the FullCalendar library is available
    if (typeof FullCalendar === 'undefined') {
      console.error("CalendarFix: FullCalendar library not loaded");
      injectFullCalendar();
      return;
    }

    // Check if calendar is already initialized
    if (window.calendar && typeof window.calendar.render === 'function') {
      try {
        console.log("CalendarFix: Rendering existing calendar instance");
        window.calendar.render();
        return;
      } catch (error) {
        console.error("CalendarFix: Error rendering existing calendar", error);
        // Continue to reinitialize
      }
    }

    // Initialize a new calendar instance
    try {
      console.log("CalendarFix: Creating new calendar instance");
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
      console.log("CalendarFix: Calendar successfully initialized and rendered");

      // Fetch events if that function exists
      if (typeof fetchCalendarEvents === 'function') {
        fetchCalendarEvents();
      }
    } catch (error) {
      console.error("CalendarFix: Error initializing calendar", error);
    }
  }

  /**
   * Inject FullCalendar library if it's missing
   */
  function injectFullCalendar() {
    console.log("CalendarFix: Injecting FullCalendar library");

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/fullcalendar@5.10.1/main.min.js';
    script.onload = function() {
      console.log("CalendarFix: FullCalendar library loaded");

      // Also inject CSS
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://cdn.jsdelivr.net/npm/fullcalendar@5.10.1/main.min.css';
      document.head.appendChild(link);

      // Initialize calendar after script is loaded
      setTimeout(fixCalendar, 100);
    };
    script.onerror = function() {
      console.error("CalendarFix: Failed to load FullCalendar library");
    };

    document.head.appendChild(script);
  }
})();
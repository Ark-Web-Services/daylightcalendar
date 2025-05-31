/**
 * Calendar Styles - Adds necessary styles for proper calendar rendering
 */

(function() {
  // Execute when DOM is fully loaded
  document.addEventListener('DOMContentLoaded', function() {
    console.log("CalendarStyles: Initializing");
    addCalendarStyles();
  });

  /**
   * Add required CSS styles for calendar
   */
  function addCalendarStyles() {
    // Check if styles are already added
    if (document.getElementById('calendar-custom-styles')) {
      return;
    }

    console.log("CalendarStyles: Adding calendar styles");

    const style = document.createElement('style');
    style.id = 'calendar-custom-styles';
    style.textContent = `
      /* Minimal calendar styling - closer to original */
      #calendar {
        min-height: 600px;
        width: 100%;
        background-color: #fff;
      }

      /* Fix visibility of calendar */
      .fc {
        display: block !important;
      }

      /* Fix header buttons */
      .fc .fc-button {
        background-color: #4285f4;
        border-color: #4285f4;
      }

      .fc .fc-button-primary:not(:disabled):active,
      .fc .fc-button-primary:not(:disabled).fc-button-active {
        background-color: #1a73e8;
        border-color: #1a73e8;
      }

      /* Fix day cells */
      .fc-daygrid-day-number {
        padding: 4px;
      }

      /* Match original calendar layout */
      .fc-view-harness {
        background-color: #fff;
      }

      .tab-content {
        padding: 20px;
      }
    `;

    document.head.appendChild(style);
  }
})();
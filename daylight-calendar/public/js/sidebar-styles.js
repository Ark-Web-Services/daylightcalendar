/**
 * Sidebar Styles - Adds missing CSS styles for sidebar toggle functionality
 */

(function() {
  // Execute when DOM is fully loaded
  document.addEventListener('DOMContentLoaded', function() {
    console.log("SidebarStyles: Initializing");
    addSidebarStyles();
  });

  /**
   * Add required CSS styles for sidebar toggle functionality
   */
  function addSidebarStyles() {
    // Check if styles are already added
    if (document.getElementById('sidebar-toggle-styles')) {
      return;
    }

    console.log("SidebarStyles: Adding sidebar toggle styles");

    const style = document.createElement('style');
    style.id = 'sidebar-toggle-styles';
    style.textContent = `
      /* Sidebar toggle styles */
      #app {
        display: flex;
        width: 100%;
        overflow: hidden;
      }

      #sidebar {
        transition: all 0.3s ease;
        width: 250px;
        min-width: 250px;
        position: relative;
        flex-shrink: 0;
        overflow: hidden;
      }

      #sidebar.collapsed {
        width: 60px;
        min-width: 60px;
      }

      #sidebar-logo {
        cursor: pointer;
        display: flex;
        align-items: center;
        padding: 15px;
        justify-content: space-between;
      }

      /* Make the chevron icon always visible and rotated properly */
      #sidebar-logo i.material-icons:last-child {
        transition: transform 0.3s ease;
      }

      #sidebar.collapsed #sidebar-logo i.material-icons:last-child {
        transform: rotate(180deg);
      }

      #sidebar.collapsed .tab-item span {
        opacity: 0;
        width: 0;
        visibility: hidden;
      }

      #sidebar .tab-item span {
        transition: opacity 0.3s ease, width 0.3s ease, visibility 0.3s ease;
        opacity: 1;
        width: auto;
        visibility: visible;
      }

      #sidebar.collapsed .sidebar-divider {
        margin: 10px 5px;
      }

      #main-content-area {
        transition: all 0.3s ease;
        margin-left: 0;
        flex-grow: 1;
        width: calc(100% - 250px);
      }

      #main-content-area.expanded {
        width: calc(100% - 60px);
      }

      /* Make the tab icons properly centered in collapsed mode */
      #sidebar.collapsed .tab-item {
        display: flex;
        justify-content: center;
        padding: 15px 0;
      }

      #sidebar.collapsed .tab-item i.material-icons {
        margin-right: 0;
      }

      /* Make the sidebar logo show properly in collapsed mode */
      #sidebar.collapsed #sidebar-logo span {
        display: none;
      }

      #sidebar.collapsed #sidebar-logo {
        justify-content: center;
      }
    `;

    document.head.appendChild(style);
  }
})();
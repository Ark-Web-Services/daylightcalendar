/**
 * Sidebar Fix - Ensures the sidebar toggle functionality works properly
 */

(function() {
  // Execute when DOM is fully loaded
  document.addEventListener('DOMContentLoaded', function() {
    console.log("SidebarFix: Initializing");
    initSidebarToggle();
  });

  /**
   * Initialize sidebar toggle functionality
   */
  function initSidebarToggle() {
    const sidebar = document.getElementById('sidebar');
    const sidebarLogo = document.getElementById('sidebar-logo');
    const mainContent = document.getElementById('main-content-area');

    if (!sidebar || !sidebarLogo) {
      console.error("SidebarFix: Sidebar elements not found");
      return;
    }

    console.log("SidebarFix: Setting up sidebar toggle");

    // Make sure the logo area has the toggle icon
    ensureToggleIcon(sidebarLogo);

    // Remove any existing listeners by cloning and replacing
    const oldSidebarLogo = sidebarLogo;
    const newSidebarLogo = oldSidebarLogo.cloneNode(true);
    oldSidebarLogo.parentNode.replaceChild(newSidebarLogo, oldSidebarLogo);

    // Add click event listener to the sidebar logo
    newSidebarLogo.addEventListener('click', function() {
      console.log("SidebarFix: Sidebar toggle clicked");

      // Toggle collapsed class on sidebar
      sidebar.classList.toggle('collapsed');

      // Adjust main content area
      if (mainContent) {
        mainContent.classList.toggle('expanded');
      }

      // Store sidebar state in localStorage
      try {
        const isCollapsed = sidebar.classList.contains('collapsed');
        localStorage.setItem('sidebar-collapsed', isCollapsed ? 'true' : 'false');
        console.log(`SidebarFix: Saved sidebar state: ${isCollapsed ? 'collapsed' : 'expanded'}`);
      } catch (error) {
        console.warn("SidebarFix: Could not save sidebar state to localStorage", error);
      }
    });

    // Remove hover effect behavior
    /*
    sidebar.addEventListener('mouseenter', function() {
      if (sidebar.classList.contains('collapsed')) {
        sidebar.classList.add('hover-expand');
      }
    });

    sidebar.addEventListener('mouseleave', function() {
      sidebar.classList.remove('hover-expand');
    });
    */

    // Restore sidebar state from localStorage
    try {
      const savedState = localStorage.getItem('sidebar-collapsed');
      if (savedState === 'true') {
        sidebar.classList.add('collapsed');
        if (mainContent) {
          mainContent.classList.add('expanded');
        }
        console.log("SidebarFix: Restored collapsed sidebar state");
      }
    } catch (error) {
      console.warn("SidebarFix: Could not restore sidebar state from localStorage", error);
    }
  }

  /**
   * Ensure the sidebar logo area has the toggle icon
   */
  function ensureToggleIcon(sidebarLogo) {
    // Check if the toggle icon exists
    const toggleIcon = sidebarLogo.querySelector('i.material-icons:last-child');
    if (!toggleIcon || !toggleIcon.textContent.includes('chevron')) {
      console.log("SidebarFix: Adding missing toggle icon");

      // Create the toggle icon if it doesn't exist or isn't a chevron
      const icon = document.createElement('i');
      icon.className = 'material-icons';
      icon.textContent = 'chevron_left';

      // If there's an existing icon that's not a chevron, replace it
      if (toggleIcon) {
        sidebarLogo.replaceChild(icon, toggleIcon);
      } else {
        // Otherwise just append the new icon
        sidebarLogo.appendChild(icon);
      }
    }
  }
})();
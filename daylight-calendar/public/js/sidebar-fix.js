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

      applySidebarState(!sidebar.classList.contains('collapsed'), true);
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
      // Apply BOTH the sidebar's own classes and #app.sidebar-collapsed. Only the
      // former used to be restored, so after a reload the two disagreed and the
      // next expand never took effect.
      applySidebarState(savedState === 'true', false);
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

// Single source of truth for sidebar collapse: every class that participates in the
// collapsed layout is set together, so toggle and restore cannot disagree.
function applySidebarState(collapsed, persist) {
  const sidebar = document.getElementById('sidebar');
  const mainContent = document.querySelector('.main-content') || document.getElementById('main-content');
  const app = document.getElementById('app');

  if (sidebar) sidebar.classList.toggle('collapsed', collapsed);
  if (mainContent) mainContent.classList.toggle('expanded', collapsed);
  if (app) app.classList.toggle('sidebar-collapsed', collapsed);

  if (persist) {
    try {
      localStorage.setItem('sidebar-collapsed', collapsed ? 'true' : 'false');
    } catch (error) {
      console.warn("SidebarFix: Could not save sidebar state", error);
    }
  }

  setTimeout(function () {
    if (typeof calendar !== 'undefined' && calendar && calendar.updateSize) {
      calendar.updateSize();
    }
  }, 300);
}

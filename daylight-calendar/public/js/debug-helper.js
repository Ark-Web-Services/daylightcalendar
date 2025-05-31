/**
 * Debug Helper - Tools to help diagnose and fix page issues
 */

class DebugHelper {
  constructor() {
    this.init();
  }

  init() {
    console.log("DebugHelper: Initializing");
    this.addDebugStyles();

    // Bind methods
    this.testButtonClickHandler = this.testButtonClickHandler.bind(this);
    this.addDebugButtonsToPage = this.addDebugButtonsToPage.bind(this);
    this.checkModalVisibility = this.checkModalVisibility.bind(this);
    this.highlightClickableElements = this.highlightClickableElements.bind(this);
    this.fixEventListeners = this.fixEventListeners.bind(this);

    // Add debug panel when page loads
    document.addEventListener('DOMContentLoaded', () => {
      this.injectDebugPanel();
    });

    // Also listen for page loaded events
    document.addEventListener('pageLoaded', (e) => {
      setTimeout(() => {
        this.addDebugButtonsToPage(e.detail.page);
      }, 500);
    });
  }

  addDebugStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .debug-panel {
        position: fixed;
        bottom: 10px;
        right: 10px;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        padding: 10px;
        border-radius: 5px;
        z-index: 9999;
        font-size: 12px;
        max-width: 300px;
      }

      .debug-panel h3 {
        margin: 0 0 5px 0;
        font-size: 14px;
      }

      .debug-panel button {
        margin: 5px;
        padding: 3px 8px;
        background: #333;
        color: white;
        border: 1px solid #666;
        border-radius: 3px;
        cursor: pointer;
      }

      .debug-panel button:hover {
        background: #444;
      }

      .debug-highlight {
        outline: 2px solid red !important;
        position: relative;
      }

      .debug-highlight::after {
        content: "🔴";
        position: absolute;
        top: -5px;
        right: -5px;
        font-size: 12px;
      }
    `;
    document.head.appendChild(style);
  }

  injectDebugPanel() {
    const panel = document.createElement('div');
    panel.className = 'debug-panel';
    panel.innerHTML = `
      <h3>Debug Panel</h3>
      <button id="debug-test-buttons">Test Buttons</button>
      <button id="debug-highlight-clickable">Highlight Clickable</button>
      <button id="debug-check-modals">Check Modals</button>
      <button id="debug-fix-listeners">Fix Event Listeners</button>
      <button id="debug-close">Close</button>
    `;

    document.body.appendChild(panel);

    // Add event listeners
    document.getElementById('debug-test-buttons').addEventListener('click', this.testButtonClickHandler);
    document.getElementById('debug-highlight-clickable').addEventListener('click', this.highlightClickableElements);
    document.getElementById('debug-check-modals').addEventListener('click', this.checkModalVisibility);
    document.getElementById('debug-fix-listeners').addEventListener('click', this.fixEventListeners);
    document.getElementById('debug-close').addEventListener('click', () => panel.style.display = 'none');
  }

  addDebugButtonsToPage(pageName) {
    console.log(`Adding debug buttons to ${pageName} page`);

    // Add test buttons to content headers
    const contentHeader = document.querySelector('.content-header');
    if (contentHeader) {
      const headerActions = contentHeader.querySelector('.header-actions');

      if (headerActions) {
        // Add debug button if it doesn't exist
        if (!headerActions.querySelector('.debug-page-button')) {
          const debugButton = document.createElement('button');
          debugButton.className = 'btn btn-secondary debug-page-button';
          debugButton.innerHTML = '<i class="material-icons">bug_report</i> Debug';
          debugButton.addEventListener('click', () => this.debugCurrentPage(pageName));

          headerActions.appendChild(debugButton);
        }
      }
    }
  }

  debugCurrentPage(pageName) {
    console.log(`Debugging ${pageName} page`);

    // Log all buttons on the page
    const contentArea = document.getElementById(`${pageName}-content`);
    if (contentArea) {
      const buttons = contentArea.querySelectorAll('button');
      console.log(`Found ${buttons.length} buttons on ${pageName} page:`, buttons);

      // Log all modals
      const modals = document.querySelectorAll('.modal');
      console.log(`Found ${modals.length} modals in the document:`, modals);

      // Check for duplicate IDs
      const allElements = document.querySelectorAll('[id]');
      const idMap = {};
      let duplicatesFound = false;

      allElements.forEach(el => {
        if (idMap[el.id]) {
          console.warn(`Duplicate ID found: ${el.id}`, el, idMap[el.id]);
          duplicatesFound = true;

          // Highlight the duplicate elements
          el.classList.add('debug-highlight');
          idMap[el.id].classList.add('debug-highlight');
        } else {
          idMap[el.id] = el;
        }
      });

      if (!duplicatesFound) {
        console.log("No duplicate IDs found");
      }
    }
  }

  testButtonClickHandler() {
    console.log("Testing buttons on the current page");

    // Get the current active page
    const activeContent = document.querySelector('.tab-content.active-content');
    if (activeContent) {
      const pageName = activeContent.id.replace('-content', '');
      console.log(`Current page: ${pageName}`);

      // Find all buttons on the page
      const buttons = activeContent.querySelectorAll('button:not(.debug-page-button)');
      console.log(`Found ${buttons.length} buttons on ${pageName} page`);

      // Trigger click events on add buttons
      let addButtonFound = false;

      buttons.forEach(button => {
        if (button.id && (button.id.includes('add-') || button.id.includes('-add-'))) {
          console.log(`Testing button: ${button.id || button.textContent}`);
          button.classList.add('debug-highlight');
          addButtonFound = true;

          // Schedule a click event
          setTimeout(() => {
            button.click();
            console.log(`Clicked button: ${button.id || button.textContent}`);

            // Check if any modal appeared
            setTimeout(() => {
              const visibleModals = document.querySelectorAll('.modal.show');
              if (visibleModals.length > 0) {
                console.log(`Modal opened: ${visibleModals[0].id}`);

                // Close the modal after 1 second
                setTimeout(() => {
                  const closeButton = visibleModals[0].querySelector('.modal-close');
                  if (closeButton) {
                    closeButton.click();
                    console.log(`Closed modal: ${visibleModals[0].id}`);
                  }
                }, 1000);
              } else {
                console.warn(`No modal appeared after clicking ${button.id || button.textContent}`);
              }
            }, 300);
          }, 500);
        }
      });

      if (!addButtonFound) {
        console.log("No add buttons found on this page");
      }
    }
  }

  checkModalVisibility() {
    console.log("Checking modal visibility");

    // Get all modals
    const modals = document.querySelectorAll('.modal');
    console.log(`Found ${modals.length} modals in the document`);

    // Check which ones are visible
    const visibleModals = document.querySelectorAll('.modal.show');
    console.log(`${visibleModals.length} modals are currently visible`);

    if (visibleModals.length > 0) {
      visibleModals.forEach(modal => {
        console.log(`Visible modal: ${modal.id}`);
      });
    }

    // Log all modal IDs
    const modalIds = Array.from(modals).map(modal => modal.id);
    console.log("All modal IDs:", modalIds);

    // Check for duplicate modal IDs
    const idCounts = {};
    let duplicatesFound = false;

    modalIds.forEach(id => {
      idCounts[id] = (idCounts[id] || 0) + 1;
      if (idCounts[id] > 1) {
        duplicatesFound = true;
      }
    });

    if (duplicatesFound) {
      console.warn("Duplicate modal IDs found:", idCounts);

      // Highlight the duplicate modals
      Object.keys(idCounts).forEach(id => {
        if (idCounts[id] > 1) {
          const duplicateModals = document.querySelectorAll(`#${id}`);
          duplicateModals.forEach(modal => {
            modal.classList.add('debug-highlight');
          });
        }
      });
    } else {
      console.log("No duplicate modal IDs found");
    }
  }

  highlightClickableElements() {
    console.log("Highlighting clickable elements");

    // Remove existing highlights
    document.querySelectorAll('.debug-highlight').forEach(el => {
      el.classList.remove('debug-highlight');
    });

    // Get the current active page
    const activeContent = document.querySelector('.tab-content.active-content');
    if (activeContent) {
      // Find all buttons on the page
      const buttons = activeContent.querySelectorAll('button');
      buttons.forEach(button => {
        button.classList.add('debug-highlight');
      });

      // Find all elements with click event listeners
      const allElements = activeContent.querySelectorAll('*');
      allElements.forEach(el => {
        if (el._events && el._events.click) {
          el.classList.add('debug-highlight');
        }
      });

      console.log(`Highlighted ${document.querySelectorAll('.debug-highlight').length} clickable elements`);
    }
  }

  fixEventListeners() {
    console.log("Fixing event listeners on the current page");

    // Get the current active page
    const activeContent = document.querySelector('.tab-content.active-content');
    if (activeContent) {
      const pageName = activeContent.id.replace('-content', '');
      console.log(`Current page: ${pageName}`);

      // Fix duplicate modal issues
      this.fixDuplicateModals(pageName, activeContent);

      // Reattach event listeners
      this.reattachEventListeners(pageName, activeContent);
    }
  }

  fixDuplicateModals(pageName, contentElement) {
    // Strategy: For duplicate modals, rename the IDs of the modals in index.html
    // and update any references to them

    const pageSpecificModals = contentElement.querySelectorAll('.modal');

    pageSpecificModals.forEach(modal => {
      const modalId = modal.id;
      const globalModal = document.querySelector(`#${modalId}:not([id="${modalId}"])`);

      if (globalModal) {
        console.log(`Found duplicate modal: ${modalId}`);

        // Rename the global modal
        const newId = `global-${modalId}`;
        globalModal.id = newId;
        console.log(`Renamed global modal to: ${newId}`);

        // Update any buttons that might be targeting the global modal
        document.querySelectorAll(`[data-target="#${modalId}"]`).forEach(el => {
          if (!contentElement.contains(el)) {
            el.dataset.target = `#${newId}`;
            console.log(`Updated data-target for element:`, el);
          }
        });
      }
    });
  }

  reattachEventListeners(pageName, contentElement) {
    // Re-initialize event listeners based on the page type
    if (window.pageLoader) {
      switch(pageName) {
        case 'chores':
          window.pageLoader.attachChoreEventListeners();
          console.log("Reattached chore event listeners");
          break;
        case 'meals':
          window.pageLoader.attachMealEventListeners();
          console.log("Reattached meal event listeners");
          break;
        case 'games':
          window.pageLoader.attachGameEventListeners();
          console.log("Reattached game event listeners");
          break;
        case 'settings':
          window.pageLoader.attachSettingsEventListeners();
          console.log("Reattached settings event listeners");
          break;
      }
    }

    // Find all button elements in the content and make sure they have listeners
    const buttons = contentElement.querySelectorAll('button');

    buttons.forEach(button => {
      if (button.id && (button.id.includes('add-') || button.id.includes('-add-'))) {
        // Force a fresh event listener
        const oldButton = button;
        const newButton = oldButton.cloneNode(true);

        // Replace the old button with the new one
        oldButton.parentNode.replaceChild(newButton, oldButton);

        // Add a new event listener
        newButton.addEventListener('click', (e) => {
          console.log(`Debug: ${newButton.id || newButton.textContent} clicked`);

          // Find the modal
          let modalId = null;

          if (newButton.id === 'add-chore-button') modalId = 'add-chore-modal';
          else if (newButton.id === 'recipe-book-button') modalId = 'recipe-book-modal';
          else if (newButton.id === 'add-meal-button') modalId = 'add-meal-modal';
          else if (newButton.id === 'grocery-list-button') modalId = 'grocery-list-modal';
          else if (newButton.id === 'add-game-button') modalId = 'add-game-modal';

          if (modalId) {
            // Try to find the modal in the content area first
            let modal = contentElement.querySelector(`#${modalId}`);

            // If not found, try the global one
            if (!modal) {
              modal = document.getElementById(modalId);
            }

            if (modal) {
              modal.classList.add('show');
              console.log(`Debug: Opened modal ${modalId}`);
            } else {
              console.warn(`Debug: Modal ${modalId} not found`);
            }
          }
        });

        console.log(`Added fresh event listener to ${newButton.id || newButton.textContent}`);
      }
    });
  }
}

// Initialize the debug helper
document.addEventListener('DOMContentLoaded', () => {
  console.log("Debug Helper: Initializing");
  window.debugHelper = new DebugHelper();
});
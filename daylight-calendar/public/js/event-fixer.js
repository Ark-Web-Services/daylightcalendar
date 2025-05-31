/**
 * Event Fixer - Direct solution to fix event handling issues
 */

(function() {
  // Execute when DOM is fully loaded
  document.addEventListener('DOMContentLoaded', function() {
    console.log("EventFixer: Initializing");

    // After a short delay to allow other scripts to run
    setTimeout(fixAllButtons, 1000);

    // Also listen for page loaded events
    document.addEventListener('pageLoaded', function(e) {
      console.log(`EventFixer: Page ${e.detail.page} loaded, fixing buttons...`);
      setTimeout(fixAllButtons, 500);
    });
  });

  /**
   * Fix all buttons on all pages
   */
  function fixAllButtons() {
    fixButtonsForPage('chores');
    fixButtonsForPage('meals');
    fixButtonsForPage('games');

    // Check which page is active
    const activeContent = document.querySelector('.tab-content.active-content');
    if (activeContent) {
      const pageName = activeContent.id.replace('-content', '');
      console.log(`EventFixer: Active page is ${pageName}, focusing on its buttons`);
    }
  }

  /**
   * Fix buttons for a specific page
   */
  function fixButtonsForPage(pageName) {
    const pageContent = document.getElementById(`${pageName}-content`);
    if (!pageContent) return;

    // Find all important buttons
    let buttonSelectors = [];

    switch(pageName) {
      case 'chores':
        buttonSelectors = ['#add-chore-button'];
        break;
      case 'meals':
        buttonSelectors = ['#add-meal-button', '#recipe-book-button', '#grocery-list-button'];
        break;
      case 'games':
        buttonSelectors = ['#add-game-button'];
        break;
    }

    // Fix each button
    buttonSelectors.forEach(selector => {
      const button = pageContent.querySelector(selector);
      if (button) {
        fixButton(button, pageName);
      }
    });

    // Fix modal close buttons within this page
    const modals = pageContent.querySelectorAll('.modal');
    modals.forEach(modal => {
      const closeButtons = modal.querySelectorAll('.modal-close, .modal-cancel');
      closeButtons.forEach(button => {
        button.addEventListener('click', function() {
          modal.classList.remove('show');
        });
      });
    });
  }

  /**
   * Fix a specific button
   */
  function fixButton(button, pageName) {
    // Remove existing listeners by cloning the button
    const oldButton = button;
    const newButton = oldButton.cloneNode(true);
    oldButton.parentNode.replaceChild(newButton, oldButton);

    // Add the correct event listener based on button ID
    switch(newButton.id) {
      case 'add-chore-button':
        addModalOpenListener(newButton, 'add-chore-modal', pageName);
        break;
      case 'add-meal-button':
        addModalOpenListener(newButton, 'add-meal-modal', pageName);
        break;
      case 'recipe-book-button':
        addModalOpenListener(newButton, 'recipe-book-modal', pageName);
        break;
      case 'grocery-list-button':
        addModalOpenListener(newButton, 'grocery-list-modal', pageName);
        break;
      case 'add-game-button':
        addModalOpenListener(newButton, 'add-game-modal', pageName);
        break;
    }
  }

  /**
   * Add a modal open listener to a button
   */
  function addModalOpenListener(button, modalId, pageName) {
    button.addEventListener('click', function(e) {
      console.log(`EventFixer: Button ${button.id} clicked`);

      // First, try to find the modal in the same page
      const pageContent = document.getElementById(`${pageName}-content`);
      let modal = pageContent.querySelector(`#${modalId}`);

      // If not found, look for it in the global scope
      if (!modal) {
        modal = document.getElementById(modalId);
      }

      if (modal) {
        console.log(`EventFixer: Opening modal ${modalId}`);
        modal.classList.add('show');

        // Special case handling
        if (modalId === 'recipe-book-modal' && typeof loadRecipes === 'function') {
          loadRecipes();
        } else if (modalId === 'grocery-list-modal' && typeof loadGroceryList === 'function') {
          loadGroceryList();
        }
      } else {
        console.warn(`EventFixer: Modal ${modalId} not found`);
      }
    });

    console.log(`EventFixer: Added click listener to ${button.id}`);
  }
})();
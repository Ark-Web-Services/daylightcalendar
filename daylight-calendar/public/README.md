# Daylight Calendar Architecture

This document explains the architecture of the Daylight Calendar application.

## Overview

The application has been refactored from a monolithic structure to a modular architecture that separates content into individual pages loaded dynamically.

## Key Files

- `refactored-index.html`: The main application shell that contains the navigation sidebar and empty containers for page content
- `js/page-loader.js`: JavaScript module that handles dynamic loading of page content
- `pages/`: Directory containing separate HTML files for each section of the application
  - `calendar.html`: Calendar page content
  - `chores.html`: Chores page content
  - `meals.html`: Meal planner content
  - `games.html`: Games page content
  - `settings.html`: Settings page content

## How It Works

1. The application starts with just the shell (navigation and empty containers)
2. When a user clicks on a tab in the sidebar, the `PageLoader` class:
   - Removes the active state from all tabs
   - Sets the active state on the clicked tab
   - Loads the corresponding page content from the `/pages` directory if not already loaded
   - Sets the loaded content as active

## Benefits

This architecture provides several advantages:

1. **Improved Maintainability**: Each page can be edited independently
2. **Better Performance**: Only the necessary content is loaded when needed
3. **Cleaner Code Organization**: Logical separation of concerns
4. **Easier Development**: Multiple developers can work on different pages simultaneously without conflicts
5. **Progressive Loading**: Initial page load is faster as only the shell and active content are loaded

## Migration

To migrate from the old monolithic structure to this new architecture:

1. Replace `index.html` with `refactored-index.html`
2. Make sure the `js` and `pages` directories exist
3. Ensure all page content files are in place

## Developer Notes

- The `PageLoader` class handles all the logic for tab switching and content loading
- Page content files should contain only the inner HTML for the content area, not full HTML documents
- Shared modals remain in the main index file as they can be used across multiple pages
- CSS and other resources remain in their original locations
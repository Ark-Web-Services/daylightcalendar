/**
 * Turbo Bridge - A simplified implementation of Turbo Hotwire-like functionality
 * This allows for smoother page transitions and partial page updates without full reloads
 */

class TurboBridge {
  constructor() {
    this.pageCache = {};
    this.currentVisit = null;
    this.isInitialized = false;
    this.frameMap = new Map();
    this.init();
  }

  /**
   * Initialize Turbo Bridge
   */
  init() {
    if (this.isInitialized) return;
    console.log("TurboBridge: Initializing");

    // Set up event listeners
    this.setupEventListeners();
    this.isInitialized = true;
  }

  /**
   * Set up event listeners for page navigation
   */
  setupEventListeners() {
    // Listen for clicks on tab items to handle transitions
    document.addEventListener('click', (event) => {
      // Check if this is a tab click that we should handle
      const tabItem = event.target.closest('.tab-item');
      if (tabItem) {
        // Let the regular tab handler work, but add transition effects
        this.beforeTabTransition(tabItem);
      }
    });

    // Listen for when pages are loaded
    document.addEventListener('pageLoaded', (event) => {
      const pageName = event.detail.page;
      this.afterPageLoad(pageName);
    });

    // Listen for turbo:frame targets
    document.addEventListener('turbo:frame:load', (event) => {
      const { frameId, content } = event.detail;
      this.updateFrame(frameId, content);
    });
  }

  /**
   * Actions to perform before a tab transition
   */
  beforeTabTransition(tabItem) {
    const targetId = tabItem.dataset.tabTarget;
    const container = document.getElementById(targetId);

    if (container) {
      // Add transition class
      container.classList.add('turbo-transition-in');

      // Clean up transition classes after animation completes
      setTimeout(() => {
        container.classList.remove('turbo-transition-in');
      }, 300);
    }
  }

  /**
   * Actions to perform after a page is loaded
   */
  afterPageLoad(pageName) {
    console.log(`TurboBridge: Page loaded - ${pageName}`);

    // Scan the page for turbo-frame elements and register them
    this.registerFrames();
  }

  /**
   * Register all turbo-frame elements on the page
   */
  registerFrames() {
    document.querySelectorAll('turbo-frame').forEach(frame => {
      const id = frame.id;
      if (id) {
        this.frameMap.set(id, frame);

        // If the frame has a src attribute, load it
        const src = frame.getAttribute('src');
        if (src) {
          this.loadFrameContent(id, src);
        }
      }
    });
  }

  /**
   * Load content for a turbo-frame
   */
  async loadFrameContent(frameId, src) {
    try {
      console.log(`TurboBridge: Loading frame ${frameId} from ${src}`);
      const response = await fetch(src);

      if (!response.ok) {
        throw new Error(`Failed to load frame content: ${response.status}`);
      }

      const html = await response.text();
      this.updateFrame(frameId, html);

    } catch (error) {
      console.error(`TurboBridge: Error loading frame ${frameId}:`, error);
      const frame = this.frameMap.get(frameId);
      if (frame) {
        frame.innerHTML = `<div class="turbo-error">Error loading content: ${error.message}</div>`;
      }
    }
  }

  /**
   * Update a turbo-frame with new content
   */
  updateFrame(frameId, content) {
    const frame = this.frameMap.get(frameId) || document.getElementById(frameId);
    if (frame) {
      // Extract just the content inside the matching turbo-frame if possible
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = content;

      const sourceFrame = tempDiv.querySelector(`turbo-frame#${frameId}`);
      if (sourceFrame) {
        // Replace just the inner content
        frame.innerHTML = sourceFrame.innerHTML;
      } else {
        // Just use the entire content
        frame.innerHTML = content;
      }

      // Dispatch an event to signal the frame was updated
      frame.dispatchEvent(new CustomEvent('turbo:frame:updated'));

      // Initialize any scripts in the frame
      this.initializeFrameScripts(frame);
    }
  }

  /**
   * Initialize any scripts in a frame that was just updated
   */
  initializeFrameScripts(frame) {
    // Find any script tags and execute them
    Array.from(frame.querySelectorAll('script')).forEach(oldScript => {
      const newScript = document.createElement('script');

      // Copy attributes
      Array.from(oldScript.attributes).forEach(attr => {
        newScript.setAttribute(attr.name, attr.value);
      });

      // Copy content
      newScript.textContent = oldScript.textContent;

      // Replace the old script with the new one to execute it
      oldScript.parentNode.replaceChild(newScript, oldScript);
    });
  }

  /**
   * Fetch a frame's content and update it
   * This can be called programmatically to refresh a frame
   */
  refreshFrame(frameId) {
    const frame = this.frameMap.get(frameId) || document.getElementById(frameId);
    if (frame) {
      const src = frame.getAttribute('src');
      if (src) {
        this.loadFrameContent(frameId, src);
      }
    }
  }

  /**
   * Navigate to a new page programmatically
   */
  visit(pageId) {
    const tabItem = document.querySelector(`.tab-item[data-tab-target="${pageId}-content"]`);
    if (tabItem) {
      tabItem.click();
    }
  }

  /**
   * Create a turbo-frame element and add it to the DOM
   */
  createFrame(id, src, container) {
    const frame = document.createElement('turbo-frame');
    frame.id = id;

    if (src) {
      frame.setAttribute('src', src);
    }

    if (container) {
      container.appendChild(frame);
      this.frameMap.set(id, frame);

      if (src) {
        this.loadFrameContent(id, src);
      }
    }

    return frame;
  }
}

// Initialize Turbo Bridge when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  console.log("TurboBridge: DOM content loaded");
  window.turboBridge = new TurboBridge();

  // Add the CSS for turbo transitions
  const style = document.createElement('style');
  style.textContent = `
    .turbo-transition-in {
      animation: turboPanelIn 0.3s ease-out;
    }

    @keyframes turboPanelIn {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    turbo-frame {
      display: block;
    }

    .turbo-error {
      padding: 1rem;
      background-color: #ffdddd;
      border: 1px solid #ff8888;
      border-radius: 4px;
      color: #cc0000;
    }
  `;
  document.head.appendChild(style);
});
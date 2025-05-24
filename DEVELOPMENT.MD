# Add-on Development Environment Setup

This document outlines how to set up and use the development container for working on **this Home Assistant add-on, including its frontend UI**.
The primary goal of this environment is to allow you to run a local Home Assistant instance, get necessary API access (like tokens), and test your add-on (both backend and frontend) effectively.

## Prerequisites

Before you begin, ensure you have the following installed:

*   [Docker Desktop](https://www.docker.com/products/docker-desktop/)
*   [Visual Studio Code](https://code.visualstudio.com/)
*   [Remote - Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) for VS Code.

## Official Home Assistant Documentation

For comprehensive information on local add-on testing and development, please refer to the official Home Assistant developer documentation:

*   [Local add-on testing](https://developers.home-assistant.io/docs/add-ons/testing/)
*   [Add-on Configuration (for `config.yaml`)](https://developers.home-assistant.io/docs/add-ons/configuration)
*   [Communicating with Home Assistant](https://developers.home-assistant.io/docs/add-ons/communication)

## Development Container Setup & Usage

This project is configured with a VS Code Development Container, providing a consistent and fully configured environment for add-on development.

**Node.js/npm for Frontend Development:** The frontend UI for this add-on requires Node.js and npm (e.g., for running `npm run dev`). The `.devcontainer/devcontainer.json` is configured to install a recent LTS version of Node.js. If you modify this or use a different base image, ensure Node.js is available. After any changes to `devcontainer.json`, you **must rebuild the container** (Command Palette: "Remote-Containers: Rebuild Container").

### How Add-on Files are Mapped & Discovered
The devcontainer automatically maps your add-on's source code (this entire repository) into the correct location for the Supervisor running inside the container. This allows Home Assistant to discover and load your add-on as a "local add-on." File changes are immediately reflected, but restarting the add-on (or the frontend dev server) is usually needed to see them in action.

### Running the Devcontainer

1.  **Clone the repository:** If you haven't already, clone this repository to your local machine.
2.  **Open in VS Code:** Open the root folder of the cloned repository in Visual Studio Code.
3.  **Reopen in Container:** VS Code should detect the `.devcontainer/devcontainer.json` file and prompt you to "Reopen in Container". Click this button.
    *   If you don't see the prompt, you can open the Command Palette (Ctrl+Shift+P or Cmd+Shift+P) and select "Remote-Containers: Rebuild and Reopen in Container".
    *   The first time you open the container, it may take some time to download the necessary Docker image and set up the environment.

### What to do once it starts

1.  **Start Home Assistant:** Once VS Code has reloaded and connected to the devcontainer, you **must** start the Home Assistant instance.
    *   Open the Command Palette (Ctrl+Shift+P or Cmd+Shift+P).
    *   Type `Tasks: Run Task` and select it.
    *   Choose the "Start Home Assistant" task. This bootstraps Supervisor and Home Assistant.
    *   You can monitor its startup in the VS Code Terminal that runs the task.

2.  **Access Home Assistant:** After the task completes and Home Assistant is running, access its web interface:
    *   Open your web browser and go to `http://localhost:7123/`.
    *   You will be guided through the normal Home Assistant onboarding process if it's the first time.

### Testing Your Add-on (Backend and Integrated Frontend)

Once Home Assistant is running in the devcontainer, this add-on will be available as a local add-on.

*   **Local Add-ons Repository:** Find the add-on in the Home Assistant UI under Settings > Add-ons > Add-on Store (look for the "Local Add-ons" section or "Daylight Calendar" if it was previously installed).
*   **Install and Test:** Install the add-on. You can then configure, start, stop, and view its logs directly from the Home Assistant UI.
    *   **Backend Changes:** For changes to backend code (e.g., Python files, `run.sh` scripts, the add-on's `Dockerfile` in `daylight-calendar/`), you will generally need to **Restart** the add-on from its page in the Home Assistant UI. For `Dockerfile` changes, you might need to rebuild the add-on (often an option in the add-on UI if supported, or by uninstalling/reinstalling locally).
    *   **Integrated Frontend:** The add-on serves its frontend via Ingress (typically after an `npm run build` step defined in the `daylight-calendar/Dockerfile`). Changes to this built frontend will be visible after you rebuild/restart the add-on.

## Developing the Frontend UI with `npm run dev` (Live Reloading)

For a faster frontend development experience with live/hot reloading, we now use `webpack-dev-server` managed by `concurrently` alongside `nodemon` for the backend.

1.  **Navigate to the Frontend Directory:** Open a new terminal in VS Code (which will be inside the devcontainer). The add-on's frontend code is in `daylight-calendar/`:
    ```bash
    cd daylight-calendar
    ```

2.  **Install Dependencies (if needed):** If you haven't run this before or `package.json` has changed (e.g., to add `webpack-dev-server` or `concurrently`):
    ```bash
    npm install
    ```

3.  **Start the Dev Environment:**
    ```bash
    npm run dev
    ```
    This command now does the following:
    *   Starts your backend Node.js server (`index.js`) using `nodemon` on port `3001`. `nodemon` watches for changes in `index.js` and restarts the backend automatically.
    *   Starts `webpack-dev-server` on port `8099`. This server:
        *   Compiles your frontend assets (like `public/script.js` into `public/dist/bundle.js`) in development mode.
        *   Serves the `public` directory (containing `index.html`, `styles.css`, etc.).
        *   Provides Hot Module Replacement (HMR) for JavaScript changes and live reloading for HTML/CSS changes.
        *   Proxies API requests (to `/api/*`) and Socket.IO connections (to `/socket.io/*`) to your backend server running on port `3001`.

4.  **Accessing the Frontend Dev Server:** Your browser should automatically open to `http://localhost:8099` (due to `webpack-dev-server`'s `open: true` option).
    *   If it doesn't, manually navigate to `http://localhost:8099`.
    *   You should see your application, and changes to frontend files (e.g., in `public/script.js` or `public/styles.css`) should reflect in the browser almost instantly.

5.  **Provide Home Assistant Access Token (One-Time Setup for `npm run dev`):
    **Your `npm run dev` frontend server needs a Home Assistant Long-Lived Access Token (LLAT) to communicate with the Home Assistant API (via the proxied backend). This is a manual step you need to perform:**

    *   **A. Obtain an LLAT from Home Assistant:**
        1.  In your Home Assistant instance (`http://localhost:7123`), click your user profile icon (bottom left of the sidebar).
        2.  Scroll down to "Long-Lived Access Tokens" and click "Create Token".
        3.  Give it a descriptive name (e.g., "Daylight Calendar Dev Token") and copy the generated token **immediately**. You will not see it again.

    *   **B. Create `.env.local` in `daylight-calendar/`:**
        In the `daylight-calendar/` directory, create a new file named `.env.local`.
        Paste the following content into it, replacing `YOUR_LONG_LIVED_ACCESS_TOKEN_HERE` with the token you just copied:
        ```env
        # Environment variables for local frontend development
        HASS_API_URL=http://localhost:8123/api
        HASS_TOKEN=YOUR_LONG_LIVED_ACCESS_TOKEN_HERE
        NODE_ENV=development # To help differentiate build modes
        ```
        **Important:**
        - Ensure `.env.local` is listed in your root `.gitignore` file to prevent accidentally committing your token.
        - The `HASS_API_URL` (e.g., `http://localhost:8123/api`) is used by your backend (`index.js`) when it makes calls to Home Assistant during development (when `SUPERVISOR_TOKEN` is not present). It should point to the HA instance running within your dev container (usually `localhost:7123` or `localhost:8123` depending on your HA dev setup).
        - The `webpack-dev-server` proxies requests to your *application's backend* (`index.js` on port 3001), which *then* uses `HASS_API_URL` and `HASS_TOKEN` to talk to Home Assistant.

    *   **C. Restart `npm run dev` (if needed after .env.local changes):** If `npm run dev` was already running when you created or changed `.env.local`, stop it (Ctrl+C) and restart it to ensure the backend picks up the new environment variables.

**Ensuring Production Compatibility (No LLAT in Production Build):**

The Long-Lived Access Token (LLAT) and the `HASS_API_URL` from `.env.local` are for development with `npm run dev` **only**. They must not be part of your production addon build, and the addon must not rely on them when installed by users.

### API Access Modes

The Daylight Calendar application accesses Home Assistant's API in two different ways depending on the environment:

* **In Development (`npm run dev`):**
  * The application backend (`index.js`, running on port `3001`) uses `callHaApi()` which uses axios to make API calls to Home Assistant.
  * The Home Assistant endpoint URL is set by default or read from the `HASS_API_URL` environment variable (e.g., `http://localhost:8123/api`).
  * Authentication with Home Assistant is handled by adding an `Authorization` header with the token from `HASS_TOKEN` (from `.env.local`).
  * The frontend (served by `webpack-dev-server` on port `8099`) makes API calls to its own backend API routes (e.g., `/api/weather`, `/api/calendar` via the proxy to port `3001`). These backend routes in `index.js` then make the calls to Home Assistant.

* **In Production (Built Addon):**
  * The application backend (`index.js`) uses the same `callHaApi()` function but the Home Assistant URL is set to `http://supervisor/core/api`.
  * Authentication with Home Assistant is handled by the `SUPERVISOR_TOKEN` environment variable provided by the HA Supervisor.
  * The frontend (served by the add-on's web server, typically also on port `8099` via Ingress) makes API calls to the add-on's backend routes, which then proxy to the Home Assistant API using the supervisor token.

In both cases, the frontend never directly accesses the Home Assistant API; it always goes through our backend API routes that handle the authentication and data transformation.

**Weather Data Integration:**
The Daylight Calendar displays weather information from Home Assistant in several places:
  * Current weather in the top-right corner
  * Weather forecasts on calendar days

This weather data is fetched from Home Assistant's weather entity API via `/api/weather` which internally calls `fetchWeatherData()`. The weather entity ID is configurable in the addon settings (`weather_entity_id`) or defaults to `weather.forecast_home`.

**Key API Endpoints:**
* `/api/weather` - Returns current conditions and forecast from the configured weather entity
* `/api/calendar` - Returns calendar events from the configured calendar entity
* `/api/combined-data` - Returns both weather and calendar data in a single response

## Further Development

*   Make your code changes within VS Code, which is now connected to the devcontainer.
*   The terminal in VS Code is also running inside the container, giving you access to all the tools and environment defined in `devcontainer.json`.
*   Consult the [Home Assistant developer documentation](https://developers.home-assistant.io/docs/add-ons) for more details on add-on development, configuration, communication, and publishing.
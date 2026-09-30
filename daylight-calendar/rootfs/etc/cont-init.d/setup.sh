#!/usr/bin/with-contenv bashio
# ==============================================================================
# Setup the environment for Daylight Calendar
# ==============================================================================

# Make S6 service scripts executable (if any)
# Example: chmod +x /etc/services.d/my-service/run
# Your run script is at /etc/services.d/daylight-calendar/run
if [ -f "/etc/services.d/daylight-calendar/run" ]; then
  chmod +x /etc/services.d/daylight-calendar/run
fi

# The Dockerfile should have placed all necessary application files (index.js, package.json, public/, etc.)
# and built assets into /app.
# We primarily need to ensure Node.js dependencies are present if they somehow weren't built into the image
# or if /app is a volume mount (less common for the main app dir in HA add-ons).

# Verify options in configuration using bashio
bashio::log.info "Verifying configuration options..."
# Make options optional with defaults for development
if ! bashio::config.exists 'theme'; then
  bashio::log.info "theme not set, will use default from options.json"
fi
if ! bashio::config.exists 'show_weather'; then
  bashio::log.info "show_weather not set, will use default from options.json"
fi
if ! bashio::config.exists 'locale'; then
  bashio::log.info "locale not set, will use default from options.json"
fi
if ! bashio::config.exists 'time_format'; then
  bashio::log.info "time_format not set, will use default from options.json"
fi


# Ensure Node.js dependencies are installed in /app
if [ -d "/app" ] && [ -f "/app/package.json" ]; then
  if [ ! -d "/app/node_modules" ]; then
    bashio::log.info "Node_modules not found in /app. Installing Node.js dependencies..."
    if cd /app; then
      npm install || bashio::exit.nok "Failed to install Node.js dependencies in /app"
    else
      bashio::exit.nok "Failed to cd to /app to install dependencies."
    fi
  else
    bashio::log.info "Node_modules found in /app."
  fi
else
  bashio::log.warning "/app directory or /app/package.json not found. Skipping npm install check."
fi

# This configuration is read from /data/options.json by bashio

bashio::log.info "Setup completed"
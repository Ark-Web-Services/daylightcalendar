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
bashio::config.require 'theme' '"theme" is a required configuration option'
bashio::config.require 'show_weather' '"show_weather" is a required configuration option'
bashio::config.require 'locale' '"locale" is a required configuration option'
bashio::config.require 'time_format' '"time_format" is a required configuration option'

# Add kiosk_mode option if not present, defaulting to false (as per your current logic)
if ! bashio::config.exists 'kiosk_mode'; then
  bashio::log.info "Adding kiosk_mode option with default value (false)" # Changed default to false based on recent discussions
  bashio::addon.option kiosk_mode false
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

# Setup for kiosk mode (if enabled in the add-on configuration)
# This configuration is read from /data/options.json by bashio
if bashio::config.true 'kiosk_mode'; then
  bashio::log.info "Setting up kiosk mode as per configuration..."
  
  # Create X11 configuration
  mkdir -p /etc/X11
  
  # Configure to hide cursor and disable screen blanking
  cat > /etc/X11/xorg.conf <<- EOF
Section "ServerFlags"
  Option "BlankTime" "0"
  Option "StandbyTime" "0"
  Option "SuspendTime" "0"
  Option "OffTime" "0"
EndSection

Section "InputDevice"
  Identifier "Mouse0"
  Driver "mouse"
  Option "Protocol" "auto"
  Option "Device" "/dev/input/mice"
  Option "ZAxisMapping" "4 5 6 7"
EndSection
EOF

  # Create openbox configuration
  mkdir -p /root/.config/openbox
  
  # Configure openbox autostart
  cat > /root/.config/openbox/autostart <<- EOF
# Disable screen saver and power management
xset s off
xset s noblank
xset -dpms

# Set background color
xsetroot -solid "#000000"

# Remove mouse cursor
unclutter -idle 0.1 -root &
EOF

  # Configure openbox environment
  cat > /root/.config/openbox/environment <<- EOF
# Set locale
export LC_ALL=${LANG}
EOF

  # Configure openbox for kiosk mode
  cat > /root/.config/openbox/rc.xml <<- EOF
<?xml version="1.0" encoding="UTF-8"?>
<openbox_config>
  <resistance>
    <strength>10</strength>
    <screen_edge_strength>20</screen_edge_strength>
  </resistance>
  <focus>
    <focusNew>yes</focusNew>
    <focusLast>yes</focusLast>
    <followMouse>no</followMouse>
    <underMouse>no</underMouse>
    <focusDelay>200</focusDelay>
    <raiseOnFocus>no</raiseOnFocus>
  </focus>
  <placement>
    <policy>Smart</policy>
    <center>yes</center>
    <monitor>Primary</monitor>
    <primaryMonitor>1</primaryMonitor>
  </placement>
  <theme>
    <name>Clearlooks</name>
    <titleLayout>NLIMC</titleLayout>
    <keepBorder>no</keepBorder>
    <animateIconify>yes</animateIconify>
  </theme>
  <desktops>
    <number>1</number>
    <firstdesk>1</firstdesk>
    <names>
      <name>Desktop 1</name>
    </names>
    <popupTime>875</popupTime>
  </desktops>
  <applications>
    <application class="*">
      <decor>no</decor>
      <position force="yes">
        <x>center</x>
        <y>center</y>
      </position>
      <fullscreen>yes</fullscreen>
    </application>
  </applications>
</openbox_config>
EOF
fi

bashio::log.info "Setup completed"
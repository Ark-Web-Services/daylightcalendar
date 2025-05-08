#!/usr/bin/with-contenv bashio
# ==============================================================================
# Setup the environment for Daylight Calendar
# ==============================================================================

# Make scripts executable
chmod +x /etc/services.d/daylight-calendar/run

# Create app directory
mkdir -p /app

# Copy application files
cp -r /package.json /index.js /app/
cp -r /public /app/public

# Verify options in configuration
bashio::config.require 'theme'
bashio::config.require 'show_weather'
bashio::config.require 'locale'
bashio::config.require 'time_format'

# Add kiosk_mode option if not present
if ! bashio::config.exists 'kiosk_mode'; then
  bashio::log.info "Adding kiosk_mode option with default value (true)"
  bashio::addon.option kiosk_mode true
fi

# Install additional dependencies if needed
if [ ! -d "/app/node_modules" ]; then
  bashio::log.info "Installing Node.js dependencies..."
  cd /app && npm install
fi

# Setup for kiosk mode
if bashio::config.true 'kiosk_mode'; then
  bashio::log.info "Setting up kiosk mode..."
  
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
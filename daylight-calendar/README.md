# Daylight Calendar for Home Assistant

<p align="center">
  <img src="../daylightcalendar.png" alt="Daylight Calendar" width="500" style="border-radius: 10px; border: 1px solid #ddd; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">
</p>

A beautiful fullscreen calendar display for your Home Assistant touchscreen, inspired by Daylight Calendar. Now featuring a tabbed interface for Calendar, Chores, Meals, and Games!

## Features

- Beautiful fullscreen calendar with clean, modern design
- **New:** Tabbed navigation for Calendar, Chores, Meals, and Games.
- **New:** Interactive Kanban-style Chore board for task management.
- **New:** Meal planning with weekly layout.
- **New:** Recipe book with ingredient tracking and grocery list integration.
- **New:** Grocery list management for meal planning.
- **New:** Games tab with Geometry Dash integration in fullscreen mode.
- **New:** Screen burn prevention that dims the display after inactivity
- **New:** Night mode that automatically shifts to warmer colors during evening hours
- **New:** Persistent clock display option
- Automatically switches command line interface to calendar display
- Shows upcoming events from your Home Assistant calendars
- Optional weather integration
- Light and dark themes available
- Customizable appearance and settings
- Kiosk mode for dedicated displays

## Tech Stack

<p align="center">
  <img src="https://brands.home-assistant.io/homeassistant/icon.png" alt="Home Assistant" width="40" style="margin: 0 10px;">
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/nodejs/nodejs-original.svg" alt="Node.js" width="40" style="margin: 0 10px;">
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/javascript/javascript-original.svg" alt="JavaScript" width="40" style="margin: 0 10px;">
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/html5/html5-original.svg" alt="HTML5" width="40" style="margin: 0 10px;">
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/css3/css3-original.svg" alt="CSS3" width="40" style="margin: 0 10px;">
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/docker/docker-original.svg" alt="Docker" width="40" style="margin: 0 10px;">
</p>

Built as a Home Assistant add-on, running Node.js inside a Docker container with a modern web interface.

## Recommended Hardware Setup

For the best experience, we recommend setting up dedicated information displays around your home:

### Option 1: Raspberry Pi with Touchscreen (Recommended)
- **Hardware:** Raspberry Pi 4 (2GB+ RAM) with official 7" touchscreen or larger HDMI display
- **Software:** Home Assistant OS or FullPageOS pointing to your Home Assistant instance
- **Use Case:** Perfect for kitchen counters, entryways, or home offices

### Option 2: Wall-Mounted Tablet
- **Hardware:** Any Android tablet or iPad with wall mount
- **Software:** Fully Kiosk Browser or Home Assistant Companion app in kiosk mode
- **Use Case:** Elegant wall-mounted controls for living spaces

### Option 3: Repurposed Monitor/TV
- **Hardware:** Any HDMI display with a Raspberry Pi or small form-factor PC
- **Software:** Home Assistant OS with Daylight Calendar in kiosk mode
- **Use Case:** Family dashboard in common areas like living rooms or kitchens

## Installation

1. Navigate to the Home Assistant Supervisor panel
2. Go to the Add-on Store tab
3. Click the three dots in the upper right corner and select "Repositories"
4. Add this repository URL: `https://github.com/Ark-Web-Services/daylightcalendar`
5. Find the "Daylight Calendar" add-on in the store and click "Install"

## Configuration

Option | Description | Default
--- | --- | ---
`theme` | Theme to use (light/dark) | `light`
`show_weather` | Whether to display weather info | `true`
`locale` | Language/locale setting | `en-US`
`time_format` | 12h or 24h time format | `12h`
`kiosk_mode` | Run in fullscreen kiosk mode on the connected display | `true`

## Detailed Setup Guide

### Connecting a Touchscreen

1. Connect your touchscreen display to your Home Assistant device via HDMI or compatible interface
2. Make sure your Home Assistant OS recognizes the display
3. If using a Raspberry Pi, you may need to configure the config.txt file to enable the display

### Installing and Setting Up

1. Install the add-on as described above
2. Configure your preferences in the Configuration tab
3. Start the add-on
4. The add-on automatically detects your display and starts in kiosk mode

### Troubleshooting Display Issues

If your display shows a command line instead of the calendar:

1. Make sure `kiosk_mode` is enabled in the add-on configuration
2. Check that your Home Assistant device has access to the display devices by verifying the permissions under "Hardware" in the add-on configuration page
3. Restart the add-on after making any configuration changes

## Usage

### Kiosk Mode

When `kiosk_mode` is enabled (default), the add-on will:
1. Automatically start a fullscreen browser on the connected display (/dev/tty1)
2. Hide the command line interface
3. Show the calendar in fullscreen mode
4. Disable screen blanking and cursor

To exit kiosk mode temporarily, press the `ESC` key.

### Regular Mode

If you disable `kiosk_mode`, you can still access the calendar via:
- Home Assistant UI: Click "Open Web UI" in the add-on page
- Direct URL: `http://your-home-assistant-ip:8099`

## One-Click Setup

To set up the add-on to launch automatically on your touchscreen device:

1. Go to Configuration → Automations
2. Create a new automation that triggers on Home Assistant start
3. Add an action to start the Daylight Calendar add-on

## Support

If you have any issues or feature requests, please open an issue on GitHub.

## License

MIT License 
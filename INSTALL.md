# Installing Daylight Calendar for Home Assistant

This guide will help you install and set up the Daylight Calendar add-on for your Home Assistant touchscreen.

## Prerequisites

1. Home Assistant OS or Supervised installation
2. A touchscreen connected to your Home Assistant device
3. Supervisor access to install add-ons

## Installation Steps

### 1. Add the Repository

1. Open your Home Assistant interface
2. Navigate to **Supervisor** > **Add-on Store**
3. Click the menu icon (three dots) in the top right corner
4. Select **Repositories**
5. Add the following URL: `https://github.com/Ark-Web-Services/daylightcalendar`
6. Click **Add**

### 2. Install the Add-on

1. Refresh the add-on store page
2. Find **Daylight Calendar** in the list of add-ons
3. Click on it and then click **Install**
4. Wait for the installation to complete

### 3. Configure the Add-on

1. After installation, go to the **Configuration** tab
2. Configure the following options:
   - `theme`: Choose "light" or "dark" theme
   - `show_weather`: Enable/disable weather display
   - `locale`: Set your language/locale (e.g., "en-US")
   - `time_format`: Choose "12h" or "24h" display
   - `kiosk_mode`: Keep enabled for touchscreen use
3. Click **Save**

### 4. Start the Add-on

1. Go to the **Info** tab
2. Click **Start**
3. Wait for the add-on to start
4. Your touchscreen should now display the calendar!

## Troubleshooting

If your touchscreen still shows the command line:

1. Check that you have enabled `kiosk_mode` in the configuration
2. Make sure your Home Assistant device has access to the display by checking the "Hardware" section
3. Restart the add-on after making any changes
4. If issues persist, check the add-on logs for any error messages

## Auto-Start on Boot

To make the calendar start automatically when Home Assistant boots:

1. Go to **Configuration** > **Automations**
2. Create a new automation
3. Set the trigger to "Home Assistant Start"
4. Add an action to start the Daylight Calendar add-on
5. Save the automation

Now you'll have a beautiful calendar display that starts automatically! 
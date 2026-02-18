<p align="center">
  <img src="daylightcalendar.png" alt="Daylight Calendar" width="500" style="border-radius: 10px; border: 1px solid #ddd; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">
</p>

# Daylight Calendar for Home Assistant

A beautiful, modern, fullscreen calendar and dashboard add-on for Home Assistant. Turn any touchscreen into a powerful family organizer.

## Features

- **Calendar:** Fullscreen weekly/monthly views with event details
- **Chores:** Kanban-style board for family task management
- **Meals:** Weekly meal planning and recipe book
- **Games:** curated HTML5 games with playtime limits
- **Kiosk Mode:** Auto-launch on dedicated displays
- **Weather:** Integrated local weather forecast
- **Themes:** Light/Dark modes + custom themes (Pastel, Forest, Ocean, Sunset)

## Installation

1. **Add Repository:**
   Go to **Settings → Add-ons → Add-on Store → Repositories** and add:
   `https://github.com/Ark-Web-Services/daylightcalendar`

2. **Install:**
   Find "Daylight Calendar" in the store and click **Install**.

3. **Configure:**
   Check the "Configuration" tab for options (weather, locale, theme).

4. **Start:**
   Click **Start** and open the Web UI.

## Development

We have a fully automated, zero-touch development environment.

- **One-Command Start:** `docker compose -f docker-compose.dev.yml up`
- **Mock Data Mode:** Develop UI without Home Assistant using `STANDALONE_DEV=true`
- **VS Code:** Full DevContainer support with HA Supervisor

See [DEVELOPMENT.md](DEVELOPMENT.md) for the complete guide.

## Documentation

- [User Guide (Add-on)](daylight-calendar/README.md)
- [Feature Status](daylight-calendar/FEATURES.md)
- [Development Guide](DEVELOPMENT.md)

## License

MIT License
# Troubleshooting Guide for Daylight Calendar

## Diagnostic Page

For troubleshooting, access the diagnostic page through any of these paths:
- `/debug.html` (preferred)
- `/ingress`
- `/local_daylight_calendar/ingress` (legacy path)

The diagnostic page provides:
- Token information
- API connection tests
- Data file integrity checks
- Socket.io connection testing

## Development Mode

New in version 1.1.8.4, Daylight Calendar includes a dedicated Development Mode:

1. **How to Enable**:
   - In Home Assistant, go to Settings > Add-ons > Daylight Calendar > Configuration
   - Set `development_mode` to `true`
   - Save and restart the addon

2. **What It Provides**:
   - Detailed request logging
   - Configuration override through the API
   - Enhanced error messages
   - More verbose server logs
   - Sample data for development

3. **Runtime Configuration Overrides**:
   - From the diagnostic page, you can change configuration values without restarting
   - Use the POST `/api/config/override` endpoint to change settings like `weather_entity`
   - Example: `curl -X POST http://localhost:8099/api/config/override -H "Content-Type: application/json" -d '{"weather_entity": "weather.new_entity"}'`

## Common Issues

### 404 Errors for API Requests

If you're seeing 404 errors in the console for API requests like `/api/calendar`, `/api/weather`, etc.:

1. **Home Assistant Ingress Mode Issues**:
   - In Home Assistant ingress mode, the URL paths get rewritten by the HA proxy
   - All requests should be relative paths (e.g., `/api/calendar` not `http://localhost:8099/api/calendar`)
   - If using the diagnostic page, check the "Token Information" to confirm ingress mode is active
   - Use the new `/api/debug/ingress-test` endpoint to see how paths are being transformed

2. **Development Environment**:
   - Ensure webpack-dev-server is proxying requests to the correct backend port
   - The backend runs on port 3001 in development mode
   - The frontend webpack-dev-server runs on port 8099

3. **Check webpack.config.js**:
   ```javascript
   proxy: {
     '/api': 'http://localhost:3001',
     '/socket.io': {
       target: 'http://localhost:3001',
       ws: true
     }
   }
   ```

### Socket.io Connection Failures

If socket.io connections are failing with 404 errors:

1. In Home Assistant ingress mode:
   - Socket.io path is automatically configured for ingress
   - Check the browser console for CORS errors
   - Use the diagnostic page to test socket.io connectivity

2. In development mode:
   - Ensure the backend server is running on the correct port
   - Check that the websocket proxy is properly configured in webpack.config.js
   - Run both frontend and backend together using: `npm run dev`

### Font Loading Issues

If you're seeing errors loading webfonts:

1. In Home Assistant ingress mode:
   - Version 1.1.8.4 serves webfonts at both `/webfonts` and `/api/hassio_ingress/webfonts` paths
   - Check that the `public/webfonts` directory exists and contains the required font files

2. Ensure the CORS headers are set correctly in the server configuration

### JSON Parsing Errors

If you see "unexpected non-whitespace character after JSON data" errors:

1. This usually happens when the API returns HTML or error pages instead of JSON
2. Check the network tab to see what's actually being returned
3. Use the diagnostic page to test API endpoints individually
4. Enable development mode to see detailed request logging

## Development Setup

For proper development setup:

1. Start the backend server:
   ```
   cd daylight-calendar
   npm run server
   ```

2. In a separate terminal, start the frontend development server:
   ```
   cd daylight-calendar
   npm run client
   ```

3. Or use the combined command:
   ```
   npm run dev
   ```

## Production Environment

In production (Home Assistant addon mode):

1. The application will run on port 8099
2. The server uses the Home Assistant supervisor API at http://supervisor/core/api
3. Data is stored in /data directory
4. Ingress mode is used for accessing through the Home Assistant sidebar

## Log Locations

- In development: Console output
- In production: Home Assistant addon logs (accessible through the addon configuration page)

## Reset Application Data

If you need to reset the application data:

1. In Home Assistant, go to Settings > Add-ons > Daylight Calendar > Configuration
2. Click on "Clear addon data" (this will delete all user data)
3. Restart the addon

## Home Assistant API Connection Issues

If the application cannot connect to the Home Assistant API:

1. Check that the addon has the required permissions
2. Verify the supervisor token is available (using the diagnostic page)
3. Test the API connection using the `/api/ha-proxy?endpoint=/api` endpoint on the diagnostic page
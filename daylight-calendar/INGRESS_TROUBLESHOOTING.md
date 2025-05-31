# Home Assistant Ingress and Authentication Troubleshooting

This guide addresses the specific issues related to Home Assistant ingress mode, port configuration, and authentication problems.

## 401 Unauthorized Errors

If you're seeing `401: Unauthorized` errors when the addon tries to connect to the Home Assistant API:

### Check Your Configuration

1. Ensure that in your `config.yaml` you have:
   ```yaml
   hassio_api: true
   ingress: true
   ingress_port: 8099
   ports:
     8099/tcp: 8099
   ```

2. Make sure the addon has permission to access the API:
   - The addon should be running in the Supervisor environment
   - The `SUPERVISOR_TOKEN` environment variable should be set automatically

### Debug Steps

1. Enable development mode in the addon configuration:
   - Set `development_mode: true` in the addon config
   - Restart the addon

2. Access the debug page:
   - Go to `/debug.html` or the debug tab in the addon interface

3. Test Authentication:
   - Use the "Test HA API Connection" button to check connection status
   - Click "Run Full Diagnostic Suite" to get detailed information

4. Test specific authentication methods:
   - Visit `/api/test-ha-auth` to test different authentication methods
   - This will show whether SUPERVISOR_TOKEN or HASS_TOKEN is working

## Port Mismatch Issues

If you're seeing "Port mismatch detected" in the diagnostic report:

### Check Port Configuration

1. The default port for the addon is `8099`
2. In Home Assistant ingress mode, this should be correctly mapped by Supervisor
3. If you're accessing the addon directly (not through Home Assistant):
   - Make sure you're using port 8099
   - Example: `http://your-ha-host:8099/`

### Debug Steps

1. Check port configuration:
   - Visit `/api/port-test` to get detailed port information
   - This will show what ports the server and client are using

2. Ensure the port in `config.yaml` matches:
   ```yaml
   ports:
     8099/tcp: 8099
   ingress_port: 8099
   ```

3. Check that the port is actually being exposed:
   - If using Docker directly, check port mappings with `docker ps`
   - If using HA Supervisor, check that port 8099 is allowed

## Last Resort: Override Authentication

If all else fails, you can try manually providing a long-lived access token:

1. Create a Long-Lived Access Token (LLAT) in Home Assistant:
   - Go to your profile page in Home Assistant
   - Scroll to "Long-Lived Access Tokens" and create a new one
   - Copy the token immediately (you won't see it again)

2. Create a `.env.local` file in the addon directory:
   ```
   HASS_API_URL=http://supervisor/core/api
   HASS_TOKEN=your_long_lived_token_here
   ```

3. Restart the addon

## Additional Resources

If you're still experiencing issues:
- Check the addon logs for detailed error messages
- Use the diagnostic tools to gather more information
- Review the main TROUBLESHOOTING.md file for general issues
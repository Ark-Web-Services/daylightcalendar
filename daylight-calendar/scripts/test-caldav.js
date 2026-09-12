const { createDAVClient } = require('tsdav');

// simple logger
const log = (...args) => console.log('[TestCalDAV]', ...args);
const error = (...args) => console.error('[TestCalDAV] [ERROR]', ...args);

async function testConnection(username, password) {
    log(`Testing connection for Apple ID: ${username}`);

    const client = await createDAVClient({
        serverUrl: 'https://caldav.icloud.com/',
        credentials: {
            username: username,
            password: password,
        },
        authMethod: 'Basic',
        defaultAccountType: 'caldav',
    });

    log('Client initialized. Attempting to fetch calendars...');

    try {
        const calendars = await client.fetchCalendars();
        log(`Successfully fetched ${calendars.length} calendars.`);
        calendars.forEach(cal => {
            log(`- ${cal.displayName} (URL: ${cal.url})`);
        });
        return true;
    } catch (err) {
        error('Failed to fetch calendars.');
        error('Message:', err.message);
        if (err.response) {
            error('Status:', err.response.status);
            error('StatusText:', err.response.statusText);
            error('Data:', JSON.stringify(err.response.data, null, 2));
        } else {
            error('Full error:', err);
        }
        return false;
    }
}

// Check arguments
const args = process.argv.slice(2);
if (args.length < 2) {
    console.log('Usage: node scripts/test-caldav.js <apple_id> <app_specific_password>');
    process.exit(1);
}

const [username, password] = args;
testConnection(username, password);

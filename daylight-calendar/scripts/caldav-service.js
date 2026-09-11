/**
 * CalDAV Service for Daylight Calendar
 * Handles Apple Calendar (iCloud) integration via CalDAV protocol
 * Uses tsdav library for CalDAV communication
 */

const { createDAVClient } = require('tsdav');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Home Assistant only persists /data across add-on rebuilds. Anything written
// elsewhere in the container (such as /app/data) is in the writable image layer
// and is destroyed on every update — which silently wiped connected iCloud
// accounts. Matches the DATA_DIR logic in index.js.
const IS_PRODUCTION = process.env.SUPERVISOR_TOKEN !== undefined;
const DATA_DIR = IS_PRODUCTION ? '/data' : path.join(__dirname, '..', 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'caldav_accounts.json');

// Pre-1.1.9.8 location, inside the ephemeral image layer.
const LEGACY_ACCOUNTS_FILE = path.join(__dirname, '..', 'data', 'caldav_accounts.json');

// ── Account Storage ──────────────────────────────────────────────────────

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

// One-time move of accounts written to the old ephemeral path, for installs that
// update before their container is rebuilt.
function migrateLegacyAccounts() {
    try {
        if (ACCOUNTS_FILE === LEGACY_ACCOUNTS_FILE) return;
        if (fs.existsSync(ACCOUNTS_FILE)) return;
        if (!fs.existsSync(LEGACY_ACCOUNTS_FILE)) return;

        ensureDataDir();
        fs.copyFileSync(LEGACY_ACCOUNTS_FILE, ACCOUNTS_FILE);
        console.log(`[CalDAV] Migrated accounts from ${LEGACY_ACCOUNTS_FILE} to ${ACCOUNTS_FILE}`);
    } catch (err) {
        console.error('[CalDAV] Could not migrate legacy accounts file:', err.message);
    }
}

function loadAccounts() {
    try {
        migrateLegacyAccounts();
        if (fs.existsSync(ACCOUNTS_FILE)) {
            return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
        }
    } catch (err) {
        console.error('[CalDAV] Error reading accounts file:', err.message);
    }
    return {};
}

function saveAccounts(accounts) {
    ensureDataDir();
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
}

// ── CalDAV Client Management ─────────────────────────────────────────────

// Cache of active DAV clients keyed by account ID
const clientCache = new Map();

/**
 * Create and authenticate a CalDAV client for Apple iCloud
 * @param {string} appleId - Apple ID email
 * @param {string} appPassword - App-specific password
 * @returns {Promise<object>} DAV client instance
 */
async function createAppleClient(appleId, appPassword) {
    console.log(`[CalDAV] Creating client for ${appleId}...`);

    const client = await createDAVClient({
        serverUrl: 'https://caldav.icloud.com/',
        credentials: {
            username: appleId,
            password: appPassword,
        },
        authMethod: 'Basic',
        defaultAccountType: 'caldav',
    });

    console.log(`[CalDAV] Client created for ${appleId}`);
    return client;
}

/**
 * Get or create a cached client for an account
 * @param {string} accountId - Account identifier
 * @returns {Promise<object>} DAV client
 */
async function getClient(accountId) {
    if (clientCache.has(accountId)) {
        return clientCache.get(accountId);
    }

    const accounts = loadAccounts();
    const account = accounts[accountId];
    if (!account) {
        throw new Error(`Account ${accountId} not found`);
    }

    const client = await createAppleClient(account.appleId, account.appPassword);
    clientCache.set(accountId, client);
    return client;
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Connect a new Apple Calendar account
 * Tests the connection and stores credentials
 * @param {string} appleId - Apple ID email
 * @param {string} appPassword - App-specific password
 * @param {string} [userId] - Optional User ID to associate with this account
 * @returns {Promise<object>} { id, appleId, calendars }
 */
async function connectAppleCalendar(appleId, appPassword, userId) {
    console.log(`[CalDAV] Connecting Apple Calendar for ${appleId}...`);

    // Test connection by creating client and fetching calendars
    const client = await createAppleClient(appleId, appPassword);

    let calendars = [];
    try {
        const davCalendars = await client.fetchCalendars();
        calendars = davCalendars.map(cal => ({
            url: cal.url,
            displayName: cal.displayName || 'Untitled',
            color: cal.calendarColor || null,
            ctag: cal.ctag || null,
        }));
        console.log(`[CalDAV] Found ${calendars.length} calendars for ${appleId}`);
    } catch (err) {
        console.error(`[CalDAV] Failed to fetch calendars:`, err);
        if (err.response) {
            console.error(`[CalDAV] HTTP Status: ${err.response.status}`);
            console.error(`[CalDAV] Response Data:`, JSON.stringify(err.response.data, null, 2));
        }
        throw new Error('Authentication succeeded but failed to fetch calendars: ' + err.message);
    }

    // Generate account ID and save
    const accountId = crypto.randomUUID();

    const accounts = loadAccounts();
    accounts[accountId] = {
        id: accountId,
        appleId,
        appPassword,
        userId: userId || null, // Store associated user ID
        provider: 'apple',
        calendars,
        connectedAt: new Date().toISOString(),
    };
    saveAccounts(accounts);

    // Cache the client
    clientCache.set(accountId, client);

    console.log(`[CalDAV] Account ${accountId} saved successfully`);

    return {
        id: accountId,
        appleId,
        provider: 'apple',
        calendars,
        connectedAt: accounts[accountId].connectedAt,
    };
}

/**
 * Get all connected CalDAV accounts (without passwords)
 * @returns {Array} List of accounts with safe fields
 */
function getAccounts() {
    const accounts = loadAccounts();
    return Object.values(accounts).map(acc => ({
        id: acc.id,
        appleId: acc.appleId,
        provider: acc.provider || 'apple',
        calendars: acc.calendars || [],
        connectedAt: acc.connectedAt,
    }));
}

/**
 * Remove a connected CalDAV account
 * @param {string} accountId - Account to remove
 */
function removeAccount(accountId) {
    const accounts = loadAccounts();
    if (!accounts[accountId]) {
        throw new Error(`Account ${accountId} not found`);
    }

    delete accounts[accountId];
    saveAccounts(accounts);
    clientCache.delete(accountId);

    console.log(`[CalDAV] Account ${accountId} removed`);
}

/**
 * Fetch calendars for a specific account (refreshes from server)
 * @param {string} accountId - Account ID
 * @returns {Promise<Array>} List of calendars
 */
async function fetchCalendars(accountId) {
    const client = await getClient(accountId);

    const davCalendars = await client.fetchCalendars();
    const calendars = davCalendars.map(cal => ({
        url: cal.url,
        displayName: cal.displayName || 'Untitled',
        color: cal.calendarColor || null,
        ctag: cal.ctag || null,
    }));

    // Update stored calendar list
    const accounts = loadAccounts();
    if (accounts[accountId]) {
        accounts[accountId].calendars = calendars;
        saveAccounts(accounts);
    }

    return calendars;
}

/**
 * Fetch events from all connected CalDAV accounts
 * @param {number} daysToShow - Number of days ahead to fetch (default 7)
 * @returns {Promise<Array>} FullCalendar-compatible event objects
 */
async function fetchAllEvents(daysToShow = 7) {
    const accounts = loadAccounts();
    const accountIds = Object.keys(accounts);

    if (accountIds.length === 0) {
        return [];
    }

    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + daysToShow * 24 * 60 * 60 * 1000);

    const allEvents = [];

    for (const accountId of accountIds) {
        const account = accounts[accountId];
        try {
            const client = await getClient(accountId);
            const davCalendars = await client.fetchCalendars();

            for (const cal of davCalendars) {
                try {
                    const calObjects = await client.fetchCalendarObjects({
                        calendar: cal,
                        timeRange: {
                            start: start.toISOString(),
                            end: end.toISOString(),
                        },
                    });

                    for (const obj of calObjects) {
                        const parsed = parseICalEvent(obj.data, cal, account);
                        if (parsed) {
                            allEvents.push(...parsed);
                        }
                    }
                } catch (calErr) {
                    console.error(`[CalDAV] Error fetching events from calendar ${cal.displayName}:`, calErr.message);
                }
            }
        } catch (accErr) {
            console.error(`[CalDAV] Error fetching events for account ${account.appleId}:`, accErr);
        }
    }

    console.log(`[CalDAV] Fetched ${allEvents.length} total events from ${accountIds.length} account(s)`);
    return allEvents;
}

/**
 * Parse iCal data into FullCalendar-compatible event objects
 * @param {string} icalData - Raw iCal string (VCALENDAR)
 * @param {object} calendar - Calendar metadata
 * @param {object} account - Account metadata
 * @returns {Array} Parsed events
 */
function parseICalEvent(icalData, calendar, account) {
    if (!icalData) return null;

    const events = [];

    // Simple iCal parser — extract VEVENT blocks
    const veventRegex = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
    let match;

    while ((match = veventRegex.exec(icalData)) !== null) {
        const block = match[1];

        const getField = (name) => {
            // Handle fields with parameters like DTSTART;VALUE=DATE:20260220
            const regex = new RegExp(`^${name}[;:](.*)$`, 'im');
            const m = block.match(regex);
            if (!m) return null;
            // If format is NAME;PARAMS:VALUE, extract just the value
            const val = m[1];
            const colonIdx = val.indexOf(':');
            // If the matched line already had the colon removed by the regex
            return colonIdx >= 0 ? val.substring(colonIdx + 1).trim() : val.trim();
        };

        const summary = getField('SUMMARY') || 'Untitled Event';
        const dtstart = getField('DTSTART');
        const dtend = getField('DTEND');
        const location = getField('LOCATION');
        const description = getField('DESCRIPTION');
        const uid = getField('UID');

        if (!dtstart) continue;

        // Parse dates (handle both DATE and DATE-TIME formats)
        const parseICalDate = (dateStr) => {
            if (!dateStr) return null;
            // Remove trailing Z for consistency, then parse
            const clean = dateStr.replace(/[TZ]/g, (ch) => ch);
            if (dateStr.length === 8) {
                // DATE format: YYYYMMDD
                return `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
            }
            // DATE-TIME format: YYYYMMDDTHHMMSSZ or YYYYMMDDTHHMMSS
            const d = dateStr.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?/, '$1-$2-$3T$4:$5:$6');
            return d;
        };

        const startDate = parseICalDate(dtstart);
        const endDate = parseICalDate(dtend);
        const isAllDay = dtstart.length === 8;

        events.push({
            id: `caldav_${uid || crypto.randomUUID()}`,
            title: summary,
            start: startDate,
            end: endDate || startDate,
            allDay: isAllDay,
            location: location || null,
            description: description || null,
            source: 'caldav',
            calendarName: calendar.displayName || 'Apple Calendar',
            calendarUrl: calendar.url,
            calendarColor: calendar.calendarColor || '#007AFF',
            accountId: account.id,
            userId: account.userId || null, // Include user ID in event data
            provider: 'apple',
            backgroundColor: calendar.calendarColor || '#007AFF',
            borderColor: calendar.calendarColor || '#007AFF',
        });
    }

    return events;
}

// ── Mock Data for Standalone Dev ─────────────────────────────────────────

function getMockAccounts() {
    return [
        {
            id: 'mock_apple_1',
            appleId: 'user@icloud.com',
            provider: 'apple',
            calendars: [
                { url: '/cal/personal/', displayName: 'Personal', color: '#007AFF' },
                { url: '/cal/work/', displayName: 'Work', color: '#FF9500' },
                { url: '/cal/family/', displayName: 'Family', color: '#34C759' },
            ],
            connectedAt: '2026-02-01T00:00:00.000Z',
        },
    ];
}

function getMockEvents() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const events = [];

    const mockEvents = [
        { title: 'Team Standup', daysOffset: 0, hour: 9, duration: 0.5, calendar: 'Work', color: '#FF9500' },
        { title: 'Dentist Appointment', daysOffset: 1, hour: 14, duration: 1, calendar: 'Personal', color: '#007AFF' },
        { title: 'Family Dinner', daysOffset: 2, hour: 18, duration: 2, calendar: 'Family', color: '#34C759' },
        { title: 'Project Review', daysOffset: 3, hour: 10, duration: 1.5, calendar: 'Work', color: '#FF9500' },
        { title: 'Soccer Practice', daysOffset: 4, hour: 16, duration: 1, calendar: 'Family', color: '#34C759' },
        { title: 'Birthday Party', daysOffset: 5, allDay: true, calendar: 'Personal', color: '#007AFF' },
        { title: 'Sprint Planning', daysOffset: 0, hour: 11, duration: 1, calendar: 'Work', color: '#FF9500' },
    ];

    mockEvents.forEach((e, i) => {
        const start = new Date(today);
        start.setDate(start.getDate() + e.daysOffset);

        let startStr, endStr;
        if (e.allDay) {
            startStr = start.toISOString().split('T')[0];
            endStr = startStr;
        } else {
            start.setHours(e.hour, 0, 0, 0);
            const end = new Date(start.getTime() + e.duration * 60 * 60 * 1000);
            startStr = start.toISOString();
            endStr = end.toISOString();
        }

        events.push({
            id: `caldav_mock_${i}`,
            title: e.title,
            start: startStr,
            end: endStr,
            allDay: !!e.allDay,
            source: 'caldav',
            calendarName: e.calendar,
            calendarColor: e.color,
            accountId: 'mock_apple_1',
            provider: 'apple',
            backgroundColor: e.color,
            borderColor: e.color,
        });
    });

    return events;
}

module.exports = {
    connectAppleCalendar,
    getAccounts,
    removeAccount,
    fetchCalendars,
    fetchAllEvents,
    getMockAccounts,
    getMockEvents,
};

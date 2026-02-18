const axios = require('axios');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────
const HA_URL = process.env.HA_URL || 'http://localhost:8123';
const USERNAME = process.env.HA_USERNAME || 'dev';
const PASSWORD = process.env.HA_PASSWORD || 'dev123';
const CLIENT_ID = `${HA_URL}/`;
const ENV_PATH = path.resolve(__dirname, '../.env.local');
const CHECK_ONLY = process.argv.includes('--check');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function retry(fn, retries = 5, delayMs = 2000, context = "") {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            const status = error.response ? error.response.status : error.code;
            console.log(`   ⏳ Waiting for ${context}... (${i + 1}/${retries}) [${status}]`);
            await delay(delayMs);
        }
    }
    throw lastError;
}

// ─────────────────────────────────────────────────────────────────────────────
// Check Mode: Validate existing .env.local token
// ─────────────────────────────────────────────────────────────────────────────
async function checkExistingToken() {
    console.log('🔍 Checking existing .env.local token...');

    if (!fs.existsSync(ENV_PATH)) {
        console.log('❌ No .env.local file found');
        process.exit(1);
    }

    const envContent = fs.readFileSync(ENV_PATH, 'utf8');
    const tokenMatch = envContent.match(/HASS_TOKEN=(.+)/);
    if (!tokenMatch) {
        console.log('❌ No HASS_TOKEN found in .env.local');
        process.exit(1);
    }

    const token = tokenMatch[1].trim();
    try {
        const resp = await axios.get(`${HA_URL}/api/`, {
            headers: { 'Authorization': `Bearer ${token}` },
            timeout: 5000
        });
        console.log('✅ Token is valid! HA API responded with:', resp.status);
        process.exit(0);
    } catch (err) {
        const status = err.response ? err.response.status : err.code;
        console.log(`❌ Token is invalid (${status})`);
        process.exit(1);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Flow
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
    if (CHECK_ONLY) {
        return checkExistingToken();
    }

    console.log('🤖 Starting automated Home Assistant authentication...');
    console.log(`   Target: ${HA_URL}`);

    // ── Step 1: Wait for HA API ──────────────────────────────────────────
    try {
        await retry(async () => {
            try {
                await axios.get(`${HA_URL}/api/`, { timeout: 2000 });
            } catch (err) {
                // 401 = API is running, just rejecting us (expected)
                if (err.response && err.response.status === 401) return;
                throw err;
            }
        }, 60, 5000, "Home Assistant API");
        console.log('✓ Home Assistant API is accessible');
    } catch (error) {
        console.error('❌ Home Assistant API not reachable after 5 minutes.');
        process.exit(1);
    }

    // ── Step 2: Handle Onboarding ────────────────────────────────────────
    let authCode = null;
    try {
        const onboardingStatus = await axios.get(`${HA_URL}/api/onboarding`, {
            validateStatus: () => true // Accept all status codes
        });

        if (onboardingStatus.status === 200 && Array.isArray(onboardingStatus.data)) {
            // Onboarding returns array of steps — check if user step is done
            const userStep = onboardingStatus.data.find(s => s.step === 'user');
            if (userStep && !userStep.done) {
                console.log('📝 Performing Onboarding (creating admin user)...');
                try {
                    const onboardResp = await axios.post(`${HA_URL}/api/onboarding/users`, {
                        name: 'Development User',
                        username: USERNAME,
                        password: PASSWORD,
                        client_id: CLIENT_ID,
                        language: 'en-US',
                    });
                    console.log('✓ Onboarding user created');

                    // The onboarding response contains an auth_code we can use
                    if (onboardResp.data && onboardResp.data.auth_code) {
                        authCode = onboardResp.data.auth_code;
                        console.log('✓ Got auth code from onboarding');
                    }

                    // Complete remaining onboarding steps
                    await delay(1000);

                    // We need a token for the remaining steps — exchange auth_code first
                    if (authCode) {
                        try {
                            const tokenParams = new URLSearchParams();
                            tokenParams.append('grant_type', 'authorization_code');
                            tokenParams.append('code', authCode);
                            tokenParams.append('client_id', CLIENT_ID);
                            const tokenResp = await axios.post(`${HA_URL}/auth/token`, tokenParams, {
                                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                            });
                            const tempToken = tokenResp.data.access_token;

                            // Complete remaining onboarding steps with the temp token
                            await axios.post(`${HA_URL}/api/onboarding/core_config`, {}, {
                                headers: { 'Authorization': `Bearer ${tempToken}` },
                                validateStatus: () => true
                            });
                            await axios.post(`${HA_URL}/api/onboarding/analytics`, {}, {
                                headers: { 'Authorization': `Bearer ${tempToken}` },
                                validateStatus: () => true
                            });
                            await axios.post(`${HA_URL}/api/onboarding/integration`, {
                                client_id: CLIENT_ID,
                                redirect_uri: `${HA_URL}/onboarding.html`
                            }, {
                                headers: { 'Authorization': `Bearer ${tempToken}` },
                                validateStatus: () => true
                            });
                            console.log('✓ Onboarding steps completed');
                        } catch (stepErr) {
                            console.log('⚠️  Some onboarding steps may not have completed:', stepErr.message);
                        }
                    }
                } catch (createError) {
                    console.warn('   Note: User creation returned:', createError.response ? createError.response.status : createError.message);
                }
            } else {
                console.log('✓ Onboarding already complete');
            }
        } else if (onboardingStatus.status === 404) {
            // 404 means onboarding is already done
            console.log('✓ Onboarding already complete (404 — done)');
        } else {
            console.log(`✓ Onboarding status: ${onboardingStatus.status}`);
        }
    } catch (error) {
        console.error('⚠️  Failed to check onboarding status:', error.message);
    }

    // ── Step 3: Login via HA Login Flow ──────────────────────────────────
    // HA uses a multi-step login flow, NOT password grant_type
    // 1. POST /auth/login_flow → creates a flow, returns flow_id
    // 2. POST /auth/login_flow/{flow_id} → submit credentials, get auth code
    // 3. POST /auth/token → exchange auth code for access + refresh token
    console.log('🔑 Logging in via HA login flow...');
    let token = null;
    try {
        // Step 3a: Start login flow
        const flowResp = await axios.post(`${HA_URL}/auth/login_flow`, {
            client_id: CLIENT_ID,
            handler: ['homeassistant', null],
            redirect_uri: `${HA_URL}/`
        });
        const flowId = flowResp.data.flow_id;
        console.log(`   Flow started: ${flowId}`);

        // Step 3b: Submit credentials
        const loginResp = await axios.post(`${HA_URL}/auth/login_flow/${flowId}`, {
            username: USERNAME,
            password: PASSWORD,
            client_id: CLIENT_ID
        });

        if (loginResp.data.type === 'create_entry') {
            authCode = loginResp.data.result;
            console.log('   ✓ Credentials accepted');
        } else {
            throw new Error(`Unexpected login response type: ${loginResp.data.type}`);
        }

        // Step 3c: Exchange auth code for tokens
        const tokenParams = new URLSearchParams();
        tokenParams.append('grant_type', 'authorization_code');
        tokenParams.append('code', authCode);
        tokenParams.append('client_id', CLIENT_ID);
        const tokenResp = await axios.post(`${HA_URL}/auth/token`, tokenParams, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        token = tokenResp.data.access_token;
        console.log('✓ Login successful — access token obtained');
    } catch (error) {
        console.error('❌ Login failed.');
        if (error.response) {
            console.error(`   → Status: ${error.response.status}`);
            console.error(`   → Error: ${JSON.stringify(error.response.data)}`);
        } else {
            console.error(`   → ${error.message}`);
        }
        console.log('');
        console.log('⚠️  CANNOT PROCEED AUTOMATICALLY.');
        console.log('You must manually generate a Long-Lived Token in HA UI:');
        console.log(`   1. Open ${HA_URL} in a browser`);
        console.log(`   2. Log in as ${USERNAME} / ${PASSWORD}`);
        console.log('   3. Go to your profile → Security → Long-Lived Access Tokens');
        console.log('   4. Create a token and paste it into .env.local');
        console.log('');
        process.exit(2);
    }

    // ── Step 4: Generate Long-Lived Token via WebSocket ──────────────────
    console.log('🔌 Connecting to WebSocket for Long-Lived Token...');

    return new Promise((resolve, reject) => {
        const wsUrl = HA_URL.replace('http://', 'ws://').replace('https://', 'wss://');
        const ws = new WebSocket(`${wsUrl}/api/websocket`);

        const wsTimeout = setTimeout(() => {
            console.error('❌ WebSocket timed out');
            ws.close();
            process.exit(1);
        }, 15000);

        ws.on('open', () => {
            // Wait for auth_required message
        });

        ws.on('message', async (data) => {
            const msg = JSON.parse(data);

            if (msg.type === 'auth_required') {
                ws.send(JSON.stringify({
                    type: 'auth',
                    access_token: token
                }));
            } else if (msg.type === 'auth_ok') {
                console.log('✓ WebSocket authenticated');

                // Request Long-Lived Token
                ws.send(JSON.stringify({
                    id: 1,
                    type: 'auth/long_lived_access_token',
                    client_name: 'Daylight Calendar Dev',
                    client_icon: 'mdi:calendar',
                    lifespan: 3650 // ~10 years
                }));
            } else if (msg.type === 'result' && msg.id === 1) {
                clearTimeout(wsTimeout);
                if (msg.success) {
                    const longLivedToken = msg.result;
                    console.log('✓ Long-Lived Token generated!');

                    // Write .env.local
                    const envContent = `# Development environment configuration
# Generated automatically by auth-flow.js
# Regenerate: node scripts/auth-flow.js
HASS_API_URL=${HA_URL}/api
HASS_TOKEN=${longLivedToken}
NODE_ENV=development
PORT=8100
`;
                    fs.writeFileSync(ENV_PATH, envContent);
                    console.log(`✓ .env.local written to ${ENV_PATH}`);

                    // ── Step 5: Configure weather integration ─────────────
                    console.log('🌤️  Configuring weather integration...');
                    try {
                        ws.send(JSON.stringify({
                            id: 2,
                            type: 'config/entries/flow',
                            handler: ['homeassistant'],
                        }));
                        // The met integration may auto-discover; skip if it fails
                        console.log('✓ Weather integration request sent (may auto-configure)');
                    } catch (weatherErr) {
                        console.log('⚠️  Weather integration may need manual setup');
                    }

                    // Small delay to let weather request process
                    await delay(1000);
                    ws.close();
                    process.exit(0);
                } else {
                    console.error('❌ Failed to generate token:', msg.error);
                    ws.close();
                    process.exit(1);
                }
            }
        });

        ws.on('error', (err) => {
            clearTimeout(wsTimeout);
            console.error('❌ WebSocket error:', err.message);
            process.exit(1);
        });
    });
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

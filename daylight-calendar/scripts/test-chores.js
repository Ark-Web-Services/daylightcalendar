'use strict';

// Exercise the real HTTP routes against a fake Home Assistant, including its
// service-response envelope and error statuses. No household credentials used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createChoreTodoService } = require('./chore-todo-service');

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-chores-test-'));
  const entityId = 'todo.daylight_chores';
  let states = [{ entity_id: 'todo.shopping_list', state: '7' }, { entity_id: entityId, state: '1' }];
  let items = [{ uid: 'saved-1', summary: 'Vacuum living room', status: 'needs_action' }];
  let malformed = false;
  let rejectSave = false;
  let addCalls = 0;
  let reads = 0;
  const ha = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/states') return res.end(JSON.stringify(states));
    if (req.url.startsWith('/api/services/todo/get_items')) {
      reads++;
      if (req.url !== '/api/services/todo/get_items?return_response') {
        res.writeHead(400); return res.end(JSON.stringify({ message: 'return_response required' }));
      }
      assert.equal(body.entity_id, entityId);
      return res.end(JSON.stringify(malformed ? { message: 'Invalid service response' }
        : { changed_states: [], service_response: { [entityId]: { items } } }));
    }
    if (req.url === '/api/services/todo/add_item') {
      addCalls++;
      assert.equal(body.entity_id, entityId);
      if (rejectSave) { res.writeHead(400); return res.end(JSON.stringify({ message: 'Save rejected by HA' })); }
      items.push({ uid: `saved-${items.length + 1}`, summary: body.item, status: 'needs_action' });
      return res.end('[]');
    }
    res.end('[]');
  });
  ha.listen(0, '127.0.0.1');
  await once(ha, 'listening');
  const portProbe = http.createServer();
  portProbe.listen(0, '127.0.0.1');
  await once(portProbe, 'listening');
  const port = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));
  const optionsPath = path.join(temp, 'options.json');
  fs.writeFileSync(optionsPath, JSON.stringify({ show_weather: false, development_mode: false }));
  const env = { ...process.env, PORT: String(port), HASS_API_URL: `http://127.0.0.1:${ha.address().port}/api`,
    HASS_TOKEN: 'test-only', DAYLIGHT_DATA_DIR: temp, DAYLIGHT_OPTIONS_PATH: optionsPath, STANDALONE_DEV: 'false' };
  delete env.SUPERVISOR_TOKEN;
  delete env.INGRESS_PORT;
  // Block unrelated CalDAV reads, including development account files.
  const preload = path.join(temp, 'preload.cjs');
  const caldavPath = require.resolve('./caldav-service');
  fs.writeFileSync(preload, `require.cache[${JSON.stringify(caldavPath)}] = { exports: { getAccounts: () => [], fetchAllEvents: async () => [] } };`);
  const child = spawn(process.execPath, ['--require', preload, path.resolve(__dirname, '../index.js')], { env });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk; });
  child.stderr.on('data', chunk => { logs += chunk; });
  const base = `http://127.0.0.1:${port}`;
  async function request(method = 'GET', data) {
    const response = await fetch(base + '/api/chores', { method,
      headers: { 'Content-Type': 'application/json' }, body: data && JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  }
  try {
    const deadline = Date.now() + 10000;
    while (!logs.includes('Server running on port')) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error(`App failed to start: ${logs}`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    let result = await request();
    assert.equal(result.status, 200);
    assert.equal(result.body.entityId, entityId);
    assert.equal(result.body.items[0].summary, 'Vacuum living room');
    console.log('PASS saved chores render from the HA service-response envelope, ignoring shopping list');

    result = await request('POST', { item: 'Vacuum stairs', starValue: 3 });
    assert.equal(result.status, 200);
    assert.equal(result.body.metadataSaved, true);
    result = await request();
    assert.equal(result.body.items.find(item => item.summary === 'Vacuum stairs').starValue, 3);
    console.log('PASS create, read back, and save chore metadata by confirmed UID');

    rejectSave = true;
    result = await request('POST', { item: 'Rejected chore' });
    assert.equal(result.status, 500);
    assert.match(result.body.error, /Save rejected/);
    assert.equal(addCalls, 2);
    assert.equal(items.length, 2);
    console.log('PASS rejected HA saves report an error and are not retried');
    rejectSave = false;

    result = await request('POST', { item: 'Wrong list', entityId: 'todo.shopping_list' });
    assert.equal(result.status, 400);
    assert.equal(addCalls, 2);
    malformed = true;
    assert.equal((await request()).status, 500);
    assert.equal((await request('POST', { item: 'Unreadable list' })).status, 502);
    assert.equal(addCalls, 2);
    malformed = false;
    console.log('PASS wrong-list writes and malformed reads cannot claim success');

    states = states.filter(state => state.entity_id !== entityId);
    const readsBefore = reads;
    result = await request();
    assert.equal(result.status, 500);
    assert.match(result.body.error, /Create a local to-do list/);
    assert.equal(reads, readsBefore);
    console.log('PASS missing chore list reports setup instructions without falling back to shopping');

    const custom = createChoreTodoService({ getEntityId: () => 'todo.family_chores', callHaApi: async url =>
      url === '/states' ? [{ entity_id: 'todo.family_chores', state: '0' }]
        : { service_response: { 'todo.family_chores': { items: [] } } } });
    assert.deepEqual(await custom.getItems(), { entityId: 'todo.family_chores', items: [] });
    console.log('PASS configured alternative chore lists and valid empty lists');
  } finally {
    const stopped = once(child, 'exit');
    child.kill();
    await stopped;
    await new Promise(resolve => ha.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

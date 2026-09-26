'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');
const { parseReceiptOutput } = require('./receipt-parser');

const fixturePath = process.argv[2];
const truthPath = process.argv[3];
if (!fixturePath || !truthPath) {
  console.error('Usage: node scripts/test-receipts.js <model-output.txt> <truth.json>');
  process.exit(2);
}

const fixture = fs.readFileSync(fixturePath, 'utf8');
const truth = JSON.parse(fs.readFileSync(truthPath, 'utf8'));
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-receipts-'));
const jpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]).toString('base64');
const appPort = 18100 + Math.floor(Math.random() * 400);

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function multiset(items, key) {
  const result = new Map();
  items.forEach(item => {
    const value = key(item);
    result.set(value, (result.get(value) || 0) + 1);
  });
  return result;
}

function difference(expected, actual) {
  const remaining = multiset(actual, item => `${item.raw || item.printed}|${Number(item.price).toFixed(2)}`);
  return expected.filter(item => {
    const key = `${item.raw || item.printed}|${Number(item.price).toFixed(2)}`;
    const count = remaining.get(key) || 0;
    if (count) remaining.set(key, count - 1);
    return !count;
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted && character === '"' && input[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  assert.strictEqual(quoted, false, 'CSV ended inside a quoted field');
  return rows;
}

async function startStub() {
  const state = { mode: 'good', active: 0, maxActive: 0, calls: [] };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/tags') {
        res.end(JSON.stringify({ models: [{ name: 'qwen2.5vl:3b' }] }));
        return;
      }
      if (req.url === '/mode' && req.method === 'POST') {
        state.mode = JSON.parse(body).mode;
        res.end(JSON.stringify({ mode: state.mode }));
        return;
      }
      if (req.url !== '/api/chat' || req.method !== 'POST') {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'not found' }));
        return;
      }
      const payload = JSON.parse(body);
      assert.strictEqual(payload.model, 'qwen2.5vl:3b');
      assert.strictEqual(payload.stream, false);
      assert.strictEqual(payload.keep_alive, '2m');
      assert.strictEqual(payload.options.num_ctx, 8192);
      assert.strictEqual(payload.messages[0].images.length, 1);
      const call = { mode: state.mode, startedAt: Date.now(), finishedAt: null };
      state.calls.push(call);
      state.active += 1;
      state.maxActive = Math.max(state.maxActive, state.active);
      const delay = state.mode === 'timeout' ? 1200 : 250;
      setTimeout(() => {
        state.active -= 1;
        call.finishedAt = Date.now();
        if (res.destroyed) return;
        const content = state.mode === 'garbage' ? 'I could not read this receipt.' : fixture;
        res.end(JSON.stringify({ message: { content } }));
      }, delay);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, state, port: server.address().port };
}

async function waitForServer(client, child, logs) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Daylight exited early:\n${logs.join('').slice(-4000)}`);
    try {
      await client.get('/api/receipt-settings');
      return;
    } catch (error) {
      await sleep(50);
    }
  }
  throw new Error(`Daylight did not start:\n${logs.join('').slice(-4000)}`);
}

async function waitForReceipt(client, id, terminalStatuses = ['review', 'failed']) {
  const observed = [];
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const receipt = (await client.get(`/api/receipts/${id}`)).data;
    if (!observed.includes(receipt.status)) observed.push(receipt.status);
    if (terminalStatuses.includes(receipt.status)) return { receipt, observed };
    await sleep(20);
  }
  throw new Error(`Receipt ${id} did not finish`);
}

async function setStubMode(stub, mode) {
  await axios.post(`http://127.0.0.1:${stub.port}/mode`, { mode });
}

async function main() {
  const parsed = parseReceiptOutput(fixture);
  const missing = difference(truth.items, parsed.rows);
  const unexpected = difference(parsed.rows.map(row => ({ raw: row.printed, price: row.price })), truth.items);
  assert.strictEqual(parsed.rows.length, 37);
  assert.deepStrictEqual(missing, [{ raw: 'OM Lunchble Trk/Ha', price: 2.84 }]);
  assert.deepStrictEqual(unexpected, []);
  assert.strictEqual(parsed.reconciliation.rowsTotal, 89.32);
  assert.strictEqual(parsed.total, truth.total);
  assert.deepStrictEqual(parsed.dropped.map(row => row.reason), [
    'duplicates an adjacent weighed item weight',
    'payment/card/tax/total wording',
    'payment/card/tax/total wording'
  ]);
  const reconciledAgainstTruth = parseReceiptOutput(`${fixture}\nSUBTOTAL|${truth.subtotal}\nITEMS|${truth.items.length}`);
  assert.strictEqual(reconciledAgainstTruth.reconciliation.status, 'mismatch');
  assert.strictEqual(reconciledAgainstTruth.reconciliation.difference, 2.84);
  assert.strictEqual(reconciledAgainstTruth.reconciliation.countDifference, 1);
  const currentFormat = parseReceiptOutput([
    '1.36|9|wrong|ABC-123|Cans 2 @ 0.68',
    '0.80|1|lb x 0.48/lb|-|Bananas 1.67 lb x 0.48/lb',
    'SUBTOTAL|2.16',
    'TOTAL|2.16',
    'ITEMS|2'
  ].join('\n'));
  assert.strictEqual(currentFormat.rows[0].code, 'ABC-123');
  assert.strictEqual(currentFormat.rows[0].quantity, 2);
  assert.strictEqual(currentFormat.rows[1].quantity, 1.67);
  assert.strictEqual(currentFormat.reconciliation.status, 'ok');

  const stub = await startStub();
  const logs = [];
  const child = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      STANDALONE_DEV: 'true',
      PORT: String(appPort),
      DAYLIGHT_DATA_DIR: tempDataDir,
      RECEIPT_MODEL_TIMEOUT_MS: '500'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', chunk => logs.push(chunk.toString()));
  child.stderr.on('data', chunk => logs.push(chunk.toString()));
  const client = axios.create({ baseURL: `http://127.0.0.1:${appPort}`, timeout: 3000 });

  try {
    await waitForServer(client, child, logs);
    const settings = (await client.put('/api/receipt-settings', {
      url: `http://127.0.0.1:${stub.port}`,
      model: 'qwen2.5vl:3b'
    })).data;
    assert.strictEqual(settings.url, `http://127.0.0.1:${stub.port}`);
    assert.strictEqual((await client.post('/api/receipt-settings/test')).data.present, true);

    await assert.rejects(
      client.post('/api/receipts', { image: Buffer.from('not an image').toString('base64') }),
      error => error.response && error.response.status === 400 && /JPEG/.test(error.response.data.error)
    );
    const oversized = Buffer.alloc(12 * 1024 * 1024 + 1);
    oversized[0] = 0xff;
    oversized[1] = 0xd8;
    oversized[2] = 0xff;
    oversized[oversized.length - 2] = 0xff;
    oversized[oversized.length - 1] = 0xd9;
    await assert.rejects(
      client.post('/api/receipts', { image: oversized.toString('base64') }, { timeout: 10000 }),
      error => error.response && error.response.status === 400 && /12 MB/.test(error.response.data.error)
    );

    const queued = (await client.post('/api/receipts', { image: jpegBase64 })).data;
    assert.strictEqual(queued.status, 'queued');
    assert.strictEqual(fs.existsSync(path.join(tempDataDir, 'receipts', `${queued.id}.jpg`)), true);
    const firstResult = await waitForReceipt(client, queued.id);
    assert.strictEqual(firstResult.receipt.status, 'review');
    assert(firstResult.observed.includes('processing'), 'processing status was not observable');
    assert(firstResult.receipt.timings.startedAt);
    assert(firstResult.receipt.timings.finishedAt);
    assert(firstResult.receipt.timings.seconds >= 0.2);

    const editedRows = firstResult.receipt.rows.map((row, index) => ({
      ...row,
      name: index === 0 ? 'Reusable Paper Bag' : row.name,
      category: index === 0 ? 'Household' : row.category
    }));
    await client.put(`/api/receipts/${queued.id}`, { store: 'ALDI', rows: editedRows });
    const confirmed = (await client.post(`/api/receipts/${queued.id}/confirm`)).data;
    assert.strictEqual(confirmed.status, 'confirmed');
    assert.strictEqual(fs.existsSync(path.join(tempDataDir, 'receipts', `${queued.id}.jpg`)), false);

    const callStart = stub.state.calls.length;
    const uploads = await Promise.all([
      client.post('/api/receipts', { image: jpegBase64 }),
      client.post('/api/receipts', { image: jpegBase64 })
    ]);
    const concurrentResults = await Promise.all(uploads.map(upload => waitForReceipt(client, upload.data.id)));
    concurrentResults.forEach(result => assert.strictEqual(result.receipt.status, 'review'));
    const queueCalls = stub.state.calls.slice(callStart, callStart + 2);
    assert.strictEqual(queueCalls.length, 2);
    assert(queueCalls[1].startedAt >= queueCalls[0].finishedAt, 'receipt model calls overlapped');
    assert.strictEqual(stub.state.maxActive, 1);
    assert.strictEqual(concurrentResults[0].receipt.rows[0].name, 'Reusable Paper Bag');
    assert.strictEqual(concurrentResults[0].receipt.rows[0].category, 'Household');
    assert.strictEqual(concurrentResults[0].receipt.rows.every(row => row.remembered), true);

    const removedRowId = concurrentResults[0].receipt.rows[0].id;
    const replacementRows = concurrentResults[0].receipt.rows.slice(1).concat({
      printed: 'Manual Item',
      name: 'Fresh, "Test" Item',
      category: 'Other',
      quantity: 1,
      unit: 'each',
      price: 1.23,
      include: true
    });
    const updatedReview = (await client.put(`/api/receipts/${uploads[0].data.id}`, { rows: replacementRows })).data;
    assert.strictEqual(updatedReview.rows.some(row => row.id === removedRowId), false);
    assert.strictEqual(updatedReview.rows.at(-1).flags.includes('manually_added'), true);

    const csvResponse = await client.get(`/api/receipts/${uploads[0].data.id}/csv`, { responseType: 'text' });
    const csvRows = parseCsv(csvResponse.data);
    assert.deepStrictEqual(csvRows[0], ['code', 'printed', 'name', 'category', 'quantity', 'unit', 'price']);
    assert.strictEqual(csvRows.length, updatedReview.rows.length + 1);
    assert(csvRows.every(row => row.length === 7));

    await setStubMode(stub, 'garbage');
    const garbage = (await client.post('/api/receipts', { image: jpegBase64 })).data;
    const garbageResult = await waitForReceipt(client, garbage.id);
    assert.strictEqual(garbageResult.receipt.status, 'failed');
    assert.strictEqual(garbageResult.receipt.error, 'Receipt reader returned no recognizable item rows.');
    await setStubMode(stub, 'good');
    assert.strictEqual((await client.post(`/api/receipts/${garbage.id}/retry`)).data.status, 'queued');
    assert.strictEqual((await waitForReceipt(client, garbage.id)).receipt.status, 'review');

    await setStubMode(stub, 'timeout');
    const timeout = (await client.post('/api/receipts', { image: jpegBase64 })).data;
    const timeoutResult = await waitForReceipt(client, timeout.id);
    assert.strictEqual(timeoutResult.receipt.status, 'failed');
    assert.match(timeoutResult.receipt.error, /timed out/i);

    const allReceipts = (await client.get('/api/receipts')).data;
    for (const receipt of allReceipts) await client.delete(`/api/receipts/${receipt.id}`);
    assert.strictEqual((await client.get('/api/receipts')).data.length, 0);

    console.log(JSON.stringify({
      fixture: {
        truthRows: truth.items.length,
        keptRows: parsed.rows.length,
        rowsTotal: parsed.reconciliation.rowsTotal,
        truthSubtotal: truth.subtotal,
        differenceAgainstTruth: reconciledAgainstTruth.reconciliation.difference,
        countDifferenceAgainstTruth: reconciledAgainstTruth.reconciliation.countDifference,
        missing,
        unexpected,
        dropped: parsed.dropped
      },
      flow: {
        observedStatuses: ['queued', ...firstResult.observed],
        timings: firstResult.receipt.timings,
        maxConcurrentModelCalls: stub.state.maxActive,
        secondStartedAfterFirstFinished: queueCalls[1].startedAt >= queueCalls[0].finishedAt,
        photoDeletedOnConfirm: true,
        rememberedRows: concurrentResults[0].receipt.rows.filter(row => row.remembered).length,
        csvRows: csvRows.length - 1,
        garbageError: garbageResult.receipt.error,
        timeoutError: timeoutResult.receipt.error
      }
    }, null, 2));
  } finally {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      sleep(1000).then(() => child.kill('SIGKILL'))
    ]);
    await new Promise(resolve => stub.server.close(resolve));
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

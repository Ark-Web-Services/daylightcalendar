'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');
const {
  challengeMatches,
  createDoorCheckService,
  hashPassphrase,
  mountDoorCheckRoutes,
  normalizeSpeech,
  passphraseMatches,
  validateWav
} = require('./door-check-service');
const { downsampleMono, encodePcm16Wav } = require('../public/js/audio-utils');

function makeWavBase64() {
  const inputRate = 48000;
  const source = new Float32Array(inputRate);
  for (let index = 0; index < source.length; index += 1) {
    source[index] = Math.sin(2 * Math.PI * 440 * index / inputRate) * 0.25;
  }
  const pcm = downsampleMono(source, inputRate, 16000);
  return Buffer.from(encodePcm16Wav(pcm, 16000)).toString('base64');
}

async function makeHarness({ passphraseMode = false } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-door-check-'));
  const events = [];
  const announcements = [];
  const transcripts = [];
  let nowMs = Date.parse('2026-09-30T12:00:00.000Z');
  let randomSeed = 0;
  let storageQueue = Promise.resolve();
  const withHouseholdStorageLock = operation => {
    const result = storageQueue.then(operation, operation);
    storageQueue = result.catch(() => {});
    return result;
  };
  const readJsonFile = (fileName, fallback) => {
    const filePath = path.join(dataDir, fileName);
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : fallback;
  };
  const writeJsonFile = (fileName, value) => {
    fs.writeFileSync(path.join(dataDir, fileName), JSON.stringify(value, null, 2));
  };
  const faceState = {
    profiles: {
      child_one: { descriptors: [Array(128).fill(0)] },
      child_two: { descriptors: [Array(128).fill(0.5)] }
    }
  };
  const service = createDoorCheckService({
    readJsonFile,
    writeJsonFile,
    withHouseholdStorageLock,
    fetch: async () => { throw new Error('Unexpected network call'); },
    hassApiUrl: 'http://home-assistant.invalid/api',
    getToken: () => '',
    getUsers: async () => [
      { id: 'child_one', name: 'Riley' },
      { id: 'child_two', name: 'Jordan' }
    ],
    getFaceState: () => faceState,
    matchFaceDescriptor: descriptor => descriptor[0] === 9 ? null : descriptor[0] >= 0.5 ? 'child_two' : 'child_one',
    fireEvent: async (eventName, payload) => { events.push({ eventName, payload }); },
    announce: (input, source) => { announcements.push({ input, source }); },
    now: () => new Date(nowMs),
    randomInt: maximum => (randomSeed += 1) % maximum,
    transcribeAudio: async () => transcripts.shift() ?? ''
  });

  const app = express();
  app.use(express.json({ limit: '650kb' }));
  mountDoorCheckRoutes({ app, service, authorizeAdmin: async () => ({ ok: true }) });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  console.log('  endpoint harness listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = async (endpoint, options = {}) => {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    return { response, body: await response.json() };
  };

  const initialSettings = passphraseMode
    ? { enabled: true, mode: 'passphrase', allowedProfileIds: ['child_one'], passphrase: 'purple tiger seven' }
    : { enabled: true, mode: 'challenge', allowedProfileIds: ['child_one', 'child_two'] };
  const saved = await request('/api/door-check/settings', { method: 'PUT', body: JSON.stringify(initialSettings) });
  console.log('  initial settings saved');
  assert.equal(saved.response.status, 200);

  return {
    announcements,
    dataDir,
    events,
    request,
    service,
    transcripts,
    setNow: value => { nowMs = value; },
    close: () => new Promise(resolve => server.close(resolve))
  };
}

function descriptor(firstValue) {
  const value = Array(128).fill(0);
  value[0] = firstValue;
  return value;
}

async function run() {
  console.log('Checking pure normalization and WAV helpers…');
  assert.equal(normalizeSpeech('Purple Tiger 7'), 'purple tiger seven');
  assert.equal(normalizeSpeech('Purple, tiger… 7!'), 'purple tiger seven');
  assert.equal(challengeMatches('purple lion seven', 'purple tiger seven'), true);
  assert.equal(challengeMatches('purple lion eight', 'purple tiger seven'), false);
  const hashed = { ...hashPassphrase('purple tiger seven', '00112233445566778899aabbccddeeff') };
  assert.equal(passphraseMatches('Purple, tiger… 7!', hashed), true);
  assert.equal(passphraseMatches('purple tiger eight', hashed), false);

  const wavBase64 = makeWavBase64();
  const wav = Buffer.from(wavBase64, 'base64');
  const wavInfo = validateWav(wav);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.toString('ascii', 12, 16), 'fmt ');
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.toString('ascii', 36, 40), 'data');
  assert.equal(wav.readUInt32LE(40), wav.length - 44);
  assert.equal(wavInfo.dataSize, 32000);

  console.log('Checking challenge endpoints and privacy…');
  const harness = await makeHarness();
  try {
    let created = await harness.request('/api/door-check/challenge', { method: 'POST', body: '{}' });
    console.log('  challenge created');
    harness.transcripts.push(created.body.phrase);
    let checked = await harness.request('/api/door-check/verify', {
      method: 'POST',
      body: JSON.stringify({ challengeId: created.body.challengeId, descriptors: [descriptor(0), descriptor(0), descriptor(0)], audio: wavBase64 })
    });
    console.log('  successful verification returned');
    assert.equal(checked.response.status, 200);
    assert.equal(checked.body.verified, true);
    assert.equal(checked.body.profileId, 'child_one');

    created = await harness.request('/api/door-check/challenge', { method: 'POST', body: '{}' });
    harness.transcripts.push('wrong words entirely');
    checked = await harness.request('/api/door-check/verify', {
      method: 'POST', body: JSON.stringify({ challengeId: created.body.challengeId, descriptors: [descriptor(0), descriptor(0), descriptor(0)], audio: wavBase64 })
    });
    assert.equal(checked.body.verified, false);
    assert.match(checked.body.reasons[0], /try again/i);

    created = await harness.request('/api/door-check/challenge', { method: 'POST', body: '{}' });
    harness.setNow(Date.parse('2026-09-30T12:01:01.000Z'));
    checked = await harness.request('/api/door-check/verify', {
      method: 'POST', body: JSON.stringify({ challengeId: created.body.challengeId, descriptors: [descriptor(0), descriptor(0), descriptor(0)], audio: wavBase64 })
    });
    assert.equal(checked.body.verified, false);
    assert.match(checked.body.reasons[0], /expired/i);

    checked = await harness.request('/api/door-check/verify', {
      method: 'POST', body: JSON.stringify({ challengeId: created.body.challengeId, descriptors: [descriptor(0), descriptor(0), descriptor(0)], audio: wavBase64 })
    });
    assert.equal(checked.body.verified, false);
    assert.match(checked.body.reasons[0], /already used|not available/i);

    await harness.request('/api/door-check/settings', {
      method: 'PUT', body: JSON.stringify({ allowedProfileIds: ['child_one'] })
    });
    created = await harness.request('/api/door-check/challenge', { method: 'POST', body: '{}' });
    checked = await harness.request('/api/door-check/verify', {
      method: 'POST', body: JSON.stringify({ challengeId: created.body.challengeId, descriptors: [descriptor(0.5), descriptor(0.5), descriptor(0.5)], audio: wavBase64 })
    });
    assert.equal(checked.body.verified, false);
    assert.match(checked.body.reasons[0], /not allowed/i);

    created = await harness.request('/api/door-check/challenge', { method: 'POST', body: '{}' });
    checked = await harness.request('/api/door-check/verify', {
      method: 'POST', body: JSON.stringify({ challengeId: created.body.challengeId, descriptors: [descriptor(9), descriptor(9), descriptor(9)], audio: wavBase64 })
    });
    assert.equal(checked.body.verified, false);
    assert.match(checked.body.reasons[0], /not recognised/i);

    created = await harness.request('/api/door-check/challenge', { method: 'POST', body: '{}' });
    checked = await harness.request('/api/door-check/verify', {
      method: 'POST',
      body: JSON.stringify({ challengeId: created.body.challengeId, descriptors: [descriptor(0), descriptor(0), descriptor(0)], audio: Buffer.alloc(400 * 1024 + 1).toString('base64') })
    });
    assert.equal(checked.response.status, 400);
    assert.match(checked.body.error, /400 KB/i);

    await harness.request('/api/door-check/settings', {
      method: 'PUT',
      body: JSON.stringify({ mode: 'both', allowedProfileIds: ['child_one'], passphrase: 'purple tiger seven' })
    });
    created = await harness.request('/api/door-check/challenge', { method: 'POST', body: '{}' });
    harness.transcripts.push('Purple Tiger 7', created.body.phrase);
    checked = await harness.request('/api/door-check/verify', {
      method: 'POST',
      body: JSON.stringify({
        challengeId: created.body.challengeId,
        descriptors: [descriptor(0), descriptor(0), descriptor(0)],
        audio: wavBase64,
        challengeAudio: wavBase64
      })
    });
    assert.equal(checked.body.verified, true);

    created = await harness.request('/api/door-check/challenge', { method: 'POST', body: '{}' });
    harness.transcripts.push('Purple Tiger 7', created.body.phrase);
    const voiceTest = await harness.request('/api/door-check/test-voice', {
      method: 'POST',
      body: JSON.stringify({ challengeId: created.body.challengeId, audio: wavBase64, challengeAudio: wavBase64 })
    });
    assert.equal(voiceTest.response.status, 200);
    assert.equal(voiceTest.body.match, true);
    assert.equal(voiceTest.body.mode, 'both');

    assert(harness.events.some(event => event.eventName === 'daylight_door_verified' &&
      event.payload.profile_id === 'child_one' && event.payload.name === 'Riley' &&
      JSON.stringify(event.payload.methods) === JSON.stringify(['face', 'voice'])));
    assert(harness.events.some(event => event.eventName === 'daylight_door_check_failed' && event.payload.reason));
    assert(harness.events.every(event => !Object.hasOwn(event.payload, 'transcript')));
    assert(harness.announcements.some(item => item.input.message === 'Verified — Riley'));

    const files = fs.readdirSync(harness.dataDir);
    assert(files.includes('door_check_settings.json'));
    assert(files.includes('door_checks.json'));
    assert(files.every(file => !/\.(wav|mp3|m4a|webm|ogg)$/i.test(file)));
    const savedSettingsText = fs.readFileSync(path.join(harness.dataDir, 'door_check_settings.json'), 'utf8');
    assert.equal(savedSettingsText.includes('purple tiger seven'), false);
    assert.match(savedSettingsText, /"passphraseHash"/);
    const attempts = JSON.parse(fs.readFileSync(path.join(harness.dataDir, 'door_checks.json'), 'utf8'));
    assert(attempts.every(attempt => !Object.hasOwn(attempt, 'audio') && !Object.hasOwn(attempt, 'transcript')));

    console.log('HA event calls:', JSON.stringify(harness.events, null, 2));
  } finally {
    await harness.close();
    fs.rmSync(harness.dataDir, { recursive: true, force: true });
  }

  console.log('Checking passphrase endpoint and rate limit…');
  const rateHarness = await makeHarness({ passphraseMode: true });
  try {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      rateHarness.transcripts.push('Purple Tiger 7');
      const checked = await rateHarness.request('/api/door-check/verify', {
        method: 'POST', body: JSON.stringify({ descriptors: [descriptor(0), descriptor(0), descriptor(0)], audio: wavBase64 })
      });
      assert.equal(checked.response.status, 200);
      assert.equal(checked.body.verified, true);
    }
    const limited = await rateHarness.request('/api/door-check/verify', {
      method: 'POST', body: JSON.stringify({ descriptors: [descriptor(0), descriptor(0), descriptor(0)], audio: wavBase64 })
    });
    assert.equal(limited.response.status, 429);
    assert.match(limited.body.error, /too many/i);
  } finally {
    await rateHarness.close();
    fs.rmSync(rateHarness.dataDir, { recursive: true, force: true });
  }

  console.log('Door check normalization, WAV, endpoint, event, privacy, and rate-limit checks passed.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

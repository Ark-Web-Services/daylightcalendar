'use strict';

const { randomBytes, randomInt: cryptoRandomInt, randomUUID, scryptSync, timingSafeEqual } = require('crypto');

const SETTINGS_FILE = 'door_check_settings.json';
const ATTEMPTS_FILE = 'door_checks.json';
const ATTEMPT_LIMIT = 100;
const AUDIO_MAX_BYTES = 400 * 1024;
const AUDIO_MAX_SECONDS = 8;
const CHALLENGE_TTL_MS = 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;
const STT_ENTITY_TOKEN = /^stt\.[a-z0-9_]+$/;
const MODES = new Set(['challenge', 'passphrase', 'both']);

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen', 'twenty'
];

// Short, concrete words chosen to remain distinct when spoken across a room.
const CHALLENGE_WORDS = Object.freeze([
  'acorn', 'apple', 'apron', 'arrow', 'atlas', 'bacon', 'badger', 'baker', 'beach', 'beacon',
  'beaver', 'berry', 'bingo', 'birch', 'bison', 'blanket', 'blue', 'boat', 'bottle', 'breeze',
  'brick', 'bridge', 'brook', 'brush', 'bucket', 'button', 'cabin', 'cactus', 'candle', 'canyon',
  'carrot', 'castle', 'cedar', 'chair', 'cherry', 'circle', 'cloud', 'clover', 'cocoa', 'comet',
  'cookie', 'copper', 'coral', 'crayon', 'creek', 'cricket', 'crown', 'daisy', 'dancer', 'desert',
  'dolphin', 'donut', 'dragon', 'drum', 'eagle', 'echo', 'elm', 'falcon', 'feather', 'fern',
  'field', 'firefly', 'flame', 'flower', 'forest', 'fox', 'frost', 'garden', 'ginger', 'globe',
  'grape', 'green', 'harbor', 'hazel', 'heron', 'honey', 'horse', 'island', 'ivy', 'jacket',
  'jelly', 'kettle', 'kiwi', 'koala', 'ladder', 'lake', 'lantern', 'lemon', 'lilac', 'lion',
  'lizard', 'maple', 'marble', 'meadow', 'melon', 'mint', 'mirror', 'monkey', 'moon', 'moose',
  'morning', 'muffin', 'music', 'nest', 'ocean', 'olive', 'orange', 'otter', 'owl', 'panda',
  'paper', 'peach', 'peanut', 'pebble', 'pepper', 'piano', 'pickle', 'pine', 'planet', 'plum',
  'pocket', 'pond', 'poppy', 'purple', 'rabbit', 'rainbow', 'raven', 'red', 'river', 'robin',
  'rocket', 'saddle', 'sailor', 'salmon', 'sand', 'scarlet', 'shadow', 'shell', 'silver', 'skate',
  'sky', 'slate', 'snow', 'sparrow', 'spoon', 'spring', 'spruce', 'star', 'stone', 'storm',
  'straw', 'sunny', 'sunset', 'swan', 'table', 'tangerine', 'teapot', 'tiger', 'toast', 'tomato',
  'train', 'tree', 'trumpet', 'turtle', 'valley', 'violet', 'walnut', 'water', 'whale', 'wheat',
  'willow', 'window', 'winter', 'wolf', 'yellow', 'zebra', 'anchor', 'basket', 'bell', 'boot',
  'camera', 'cello', 'coin', 'compass', 'guitar', 'diamond', 'door', 'flag', 'flute', 'helmet',
  'key', 'kite', 'lamp', 'magnet', 'pencil', 'ribbon', 'scarf', 'shield', 'starfish', 'wagon'
]);

const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  mode: 'challenge',
  allowedProfileIds: null,
  sttEngine: null,
  passphraseHash: null,
  passphraseSalt: null
});

class DoorCheckError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'DoorCheckError';
    this.status = status;
  }
}

function normalizeSpeech(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(?:20|1\d|\d)\b/g, match => NUMBER_WORDS[Number(match)] || match)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordEditDistance(left, right) {
  const a = normalizeSpeech(left).split(' ').filter(Boolean);
  const b = normalizeSpeech(right).split(' ').filter(Boolean);
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length];
}

function challengeMatches(transcript, phrase) {
  return wordEditDistance(transcript, phrase) <= 1;
}

function hashPassphrase(normalized, saltHex = randomBytes(16).toString('hex')) {
  return {
    passphraseSalt: saltHex,
    passphraseHash: scryptSync(normalized, Buffer.from(saltHex, 'hex'), 64).toString('hex')
  };
}

function passphraseMatches(transcript, settings) {
  if (!settings.passphraseHash || !settings.passphraseSalt) return false;
  const expected = Buffer.from(settings.passphraseHash, 'hex');
  const supplied = scryptSync(normalizeSpeech(transcript), Buffer.from(settings.passphraseSalt, 'hex'), expected.length);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function normalizeSettings(input = {}) {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    enabled: value.enabled === true,
    mode: MODES.has(value.mode) ? value.mode : DEFAULT_SETTINGS.mode,
    allowedProfileIds: Array.isArray(value.allowedProfileIds)
      ? [...new Set(value.allowedProfileIds.filter(id => typeof id === 'string' && id.trim()))]
      : null,
    sttEngine: typeof value.sttEngine === 'string' && STT_ENTITY_TOKEN.test(value.sttEngine)
      ? value.sttEngine : null,
    passphraseHash: typeof value.passphraseHash === 'string' && /^[a-f0-9]{128}$/i.test(value.passphraseHash)
      ? value.passphraseHash : null,
    passphraseSalt: typeof value.passphraseSalt === 'string' && /^[a-f0-9]{32}$/i.test(value.passphraseSalt)
      ? value.passphraseSalt : null
  };
}

function validateWav(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) throw new DoorCheckError('Audio must be a WAV file');
  if (buffer.length > AUDIO_MAX_BYTES) throw new DoorCheckError('Audio must be 400 KB or smaller');
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new DoorCheckError('Audio must be a WAV file');
  }

  let offset = 12;
  let format = null;
  let dataSize = null;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (chunkStart + chunkSize > buffer.length) throw new DoorCheckError('WAV data is incomplete');
    if (chunkId === 'fmt ' && chunkSize >= 16) {
      format = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        byteRate: buffer.readUInt32LE(chunkStart + 8),
        blockAlign: buffer.readUInt16LE(chunkStart + 12),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14)
      };
    }
    if (chunkId === 'data') dataSize = chunkSize;
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }
  if (!format || dataSize === null) throw new DoorCheckError('WAV header is missing required chunks');
  if (format.audioFormat !== 1 || format.channels !== 1 || format.sampleRate !== 16000 ||
    format.bitsPerSample !== 16 || format.blockAlign !== 2 || format.byteRate !== 32000) {
    throw new DoorCheckError('Audio must be 16 kHz mono 16-bit PCM WAV');
  }
  if (dataSize > 16000 * 2 * AUDIO_MAX_SECONDS) throw new DoorCheckError('Audio must be 8 seconds or shorter');
  return { ...format, dataSize, durationSeconds: dataSize / format.byteRate };
}

function decodeAudio(value) {
  if (typeof value !== 'string' || !value) throw new DoorCheckError('audio is required');
  const estimatedBytes = Math.floor(value.length * 3 / 4);
  if (estimatedBytes > AUDIO_MAX_BYTES + 2) throw new DoorCheckError('Audio must be 400 KB or smaller');
  let buffer;
  try {
    buffer = Buffer.from(value, 'base64');
  } catch (error) {
    throw new DoorCheckError('audio must be base64 WAV data');
  }
  if (!buffer.length || buffer.toString('base64').replace(/=+$/, '') !== value.replace(/\s+/g, '').replace(/=+$/, '')) {
    throw new DoorCheckError('audio must be base64 WAV data');
  }
  validateWav(buffer);
  return buffer;
}

function publicSettings(settings, enrolledProfileIds, resolvedEngine) {
  const enrolled = new Set(enrolledProfileIds);
  const allowed = settings.allowedProfileIds === null
    ? [...enrolled]
    : settings.allowedProfileIds.filter(id => enrolled.has(id));
  return {
    enabled: settings.enabled,
    mode: settings.mode,
    allowedProfileIds: allowed,
    sttEngine: resolvedEngine,
    passphraseSet: Boolean(settings.passphraseHash && settings.passphraseSalt)
  };
}

function createDoorCheckService({
  readJsonFile,
  writeJsonFile,
  withHouseholdStorageLock,
  fetch,
  hassApiUrl,
  getToken,
  getUsers,
  getFaceState,
  matchFaceDescriptor,
  fireEvent: injectedFireEvent,
  announce,
  now = () => new Date(),
  randomInt = maximum => cryptoRandomInt(maximum),
  transcribeAudio: injectedTranscribe
}) {
  const challenges = new Map();
  const rateLimit = new Map();

  function readSettings() {
    return normalizeSettings(readJsonFile(SETTINGS_FILE, DEFAULT_SETTINGS));
  }

  function enrolledProfileIds() {
    return Object.keys(getFaceState().profiles || {});
  }

  async function listSttEngines() {
    const token = getToken();
    if (!token) return [];
    const response = await fetch(`${hassApiUrl}/states`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    if (!response.ok) throw new DoorCheckError(`Home Assistant answered ${response.status}`, 502);
    const states = await response.json();
    return (Array.isArray(states) ? states : [])
      .filter(state => typeof state.entity_id === 'string' && state.entity_id.startsWith('stt.'))
      .map(state => ({ entityId: state.entity_id, name: state.attributes?.friendly_name || state.entity_id }));
  }

  async function resolveEngine(settings = readSettings()) {
    if (settings.sttEngine) return settings.sttEngine;
    const engines = await listSttEngines();
    return engines.find(engine => engine.entityId === 'stt.faster_whisper')?.entityId || engines[0]?.entityId || null;
  }

  async function getPublicSettings() {
    const settings = readSettings();
    let engine = settings.sttEngine;
    if (!engine) {
      try { engine = await resolveEngine(settings); } catch (error) { engine = null; }
    }
    return publicSettings(settings, enrolledProfileIds(), engine);
  }

  async function saveSettings(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DoorCheckError('Settings must be an object');
    for (const key of ['enabled']) {
      if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new DoorCheckError(`${key} must be true or false`);
    }
    if (input.mode !== undefined && !MODES.has(input.mode)) throw new DoorCheckError("mode must be 'challenge', 'passphrase', or 'both'");
    if (input.sttEngine !== undefined && input.sttEngine !== null &&
      (typeof input.sttEngine !== 'string' || !STT_ENTITY_TOKEN.test(input.sttEngine))) {
      throw new DoorCheckError('sttEngine must be an stt.* entity id or null');
    }
    if (input.allowedProfileIds !== undefined && !Array.isArray(input.allowedProfileIds)) {
      throw new DoorCheckError('allowedProfileIds must be an array');
    }

    const enrolledIds = new Set(enrolledProfileIds());
    const requestedAllowed = input.allowedProfileIds === undefined ? undefined
      : [...new Set(input.allowedProfileIds.filter(id => typeof id === 'string' && id.trim()))];
    if (requestedAllowed?.some(id => !enrolledIds.has(id))) throw new DoorCheckError('Only enrolled profiles may pass a door check');

    let normalizedPassphrase = null;
    if (input.passphrase !== undefined && input.passphrase !== null && input.passphrase !== '') {
      normalizedPassphrase = normalizeSpeech(input.passphrase);
      const words = normalizedPassphrase.split(' ').filter(Boolean);
      if (words.length < 2 || words.length > 8) throw new DoorCheckError('Passphrase must contain 2 to 8 words');
    }

    const saved = await withHouseholdStorageLock(async () => {
      const settings = readSettings();
      if (input.enabled !== undefined) settings.enabled = input.enabled;
      if (input.mode !== undefined) settings.mode = input.mode;
      if (requestedAllowed !== undefined) settings.allowedProfileIds = requestedAllowed;
      if (input.sttEngine !== undefined) settings.sttEngine = input.sttEngine;
      if (normalizedPassphrase) Object.assign(settings, hashPassphrase(normalizedPassphrase));
      if (input.clearPassphrase === true) {
        settings.passphraseHash = null;
        settings.passphraseSalt = null;
      }
      if (settings.enabled && ['passphrase', 'both'].includes(settings.mode) &&
        (!settings.passphraseHash || !settings.passphraseSalt)) {
        throw new DoorCheckError('Set a family passphrase before enabling this mode');
      }
      writeJsonFile(SETTINGS_FILE, settings);
      return settings;
    });
    let engine = saved.sttEngine;
    if (!engine) {
      try { engine = await resolveEngine(saved); } catch (error) { engine = null; }
    }
    return publicSettings(saved, enrolledProfileIds(), engine);
  }

  function createChallenge() {
    const settings = readSettings();
    if (!settings.enabled) throw new DoorCheckError('Door check is not enabled', 403);
    if (settings.mode === 'passphrase') throw new DoorCheckError('This door check uses the family passphrase');
    const currentTime = now().getTime();
    for (const [id, challenge] of challenges) {
      if (challenge.expiresAtMs <= currentTime) challenges.delete(id);
    }
    const chosen = [];
    while (chosen.length < 3) {
      const word = CHALLENGE_WORDS[randomInt(CHALLENGE_WORDS.length)];
      if (!chosen.includes(word)) chosen.push(word);
    }
    const number = 2 + randomInt(19);
    const phrase = `${chosen.join(' ')} ${NUMBER_WORDS[number]}`;
    const challengeId = randomUUID();
    const createdAtMs = now().getTime();
    const expiresAtMs = createdAtMs + CHALLENGE_TTL_MS;
    challenges.set(challengeId, { phrase, expiresAtMs });
    return { challengeId, phrase, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  function takeChallenge(challengeId) {
    if (typeof challengeId !== 'string' || !challengeId) return { error: 'A challenge is required' };
    const challenge = challenges.get(challengeId);
    challenges.delete(challengeId);
    if (!challenge) return { error: 'That challenge was already used or is not available' };
    if (challenge.expiresAtMs <= now().getTime()) return { error: 'That challenge expired — try again' };
    return { challenge };
  }

  function checkRateLimit(key) {
    const nowMs = now().getTime();
    const recent = (rateLimit.get(key) || []).filter(timestamp => nowMs - timestamp < RATE_LIMIT_WINDOW_MS);
    if (recent.length >= RATE_LIMIT_MAX) {
      rateLimit.set(key, recent);
      return false;
    }
    recent.push(nowMs);
    rateLimit.set(key, recent);
    return true;
  }

  async function transcribe(buffer, engine) {
    if (injectedTranscribe) return normalizeSpeech(await injectedTranscribe(buffer, engine));
    const token = getToken();
    if (!token) throw new DoorCheckError('Home Assistant speech-to-text is unavailable', 503);
    if (!engine) throw new DoorCheckError('No Home Assistant speech-to-text engine is available', 503);
    const response = await fetch(`${hassApiUrl}/stt/${encodeURIComponent(engine)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'audio/wav',
        'X-Speech-Content': 'format=wav; codec=pcm; sample_rate=16000; bit_rate=16; channel=1; language=en'
      },
      body: buffer
    });
    if (!response.ok) throw new DoorCheckError(`Speech-to-text answered ${response.status}`, 502);
    const result = await response.json();
    if (result?.result !== 'success' || typeof result.text !== 'string') {
      throw new DoorCheckError('Speech-to-text did not return a transcript', 502);
    }
    return normalizeSpeech(result.text);
  }

  async function fireEvent(eventName, payload) {
    if (injectedFireEvent) return injectedFireEvent(eventName, payload);
    const token = getToken();
    if (!token) return;
    const response = await fetch(`${hassApiUrl}/events/${eventName}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`Home Assistant event endpoint answered ${response.status}`);
  }

  async function recordAttempt({ profileId = null, verified, reasons }) {
    const attempt = { time: now().toISOString(), profile: profileId, result: verified ? 'verified' : 'failed', reasons: [...reasons] };
    await withHouseholdStorageLock(async () => {
      const attempts = readJsonFile(ATTEMPTS_FILE, []);
      const normalized = Array.isArray(attempts) ? attempts : [];
      normalized.unshift(attempt);
      normalized.length = Math.min(normalized.length, ATTEMPT_LIMIT);
      writeJsonFile(ATTEMPTS_FILE, normalized);
    });
    return attempt;
  }

  function getAttempts() {
    const attempts = readJsonFile(ATTEMPTS_FILE, []);
    return Array.isArray(attempts) ? attempts.slice(0, ATTEMPT_LIMIT) : [];
  }

  async function publishResult(result) {
    const eventName = result.verified ? 'daylight_door_verified' : 'daylight_door_check_failed';
    const eventPayload = result.verified
      ? { profile_id: result.profileId, name: result.name, methods: ['face', 'voice'] }
      : { reason: result.reasons[0] || 'Door check failed' };
    try { await fireEvent(eventName, eventPayload); } catch (error) {
      console.warn('[WARN] Door check event could not be sent:', error.message);
    }
    if (typeof announce === 'function') {
      try {
        announce({
          title: 'Door check',
          message: result.verified ? `Verified — ${result.name}` : result.reasons[0],
          icon: result.verified ? 'door_front' : 'error_outline',
          speak: false,
          duration_seconds: 10
        }, 'door-check');
      } catch (error) {
        console.warn('[WARN] Door check banner could not be shown:', error.message);
      }
    }
  }

  async function fail(reasons, profileId = null, name = null) {
    const result = { verified: false, ...(profileId ? { profileId } : {}), ...(name ? { name } : {}), reasons };
    await recordAttempt({ profileId, verified: false, reasons });
    await publishResult(result);
    return result;
  }

  async function verify(input, rateLimitKey) {
    if (!checkRateLimit(rateLimitKey)) throw new DoorCheckError('Too many door check attempts. Try again shortly.', 429);
    const settings = readSettings();
    if (!settings.enabled) return fail(['Door check is not enabled']);

    const challengeResult = settings.mode === 'passphrase' ? null : takeChallenge(input?.challengeId);
    if (challengeResult?.error) return fail([challengeResult.error]);

    let audio;
    let challengeAudio;
    try {
      audio = decodeAudio(input?.audio);
      if (settings.mode === 'both') challengeAudio = decodeAudio(input?.challengeAudio);
    } catch (error) {
      await recordAttempt({ verified: false, reasons: [error.message] });
      await publishResult({ verified: false, reasons: [error.message] });
      throw error;
    }

    const descriptors = input?.descriptors;
    const validDescriptors = Array.isArray(descriptors) && descriptors.length === 3 && descriptors.every(descriptor =>
      Array.isArray(descriptor) && descriptor.length === 128 && descriptor.every(value => typeof value === 'number' && Number.isFinite(value)));
    if (!validDescriptors) {
      const error = new DoorCheckError('Exactly 3 face descriptors of 128 finite numbers are required');
      await recordAttempt({ verified: false, reasons: [error.message] });
      await publishResult({ verified: false, reasons: [error.message] });
      throw error;
    }
    const faceState = getFaceState();
    const enrolledIds = new Set(Object.keys(faceState.profiles || {}));
    const allowedIds = new Set(settings.allowedProfileIds === null ? enrolledIds : settings.allowedProfileIds);
    const winners = descriptors.map(descriptor => matchFaceDescriptor(descriptor, enrolledIds, faceState));
    const profileId = winners[0];
    if (!profileId || winners.some(winner => winner !== profileId)) return fail(['Face not recognised']);
    if (!allowedIds.has(profileId)) return fail(['This person is not allowed to pass the door check']);

    const users = await getUsers();
    const profile = users.find(user => user.id === profileId);
    const name = profile?.name || 'Household member';
    const engine = await resolveEngine(settings);
    let passphraseTranscript = null;
    let challengeTranscript = null;
    try {
      if (settings.mode === 'challenge') challengeTranscript = await transcribe(audio, engine);
      if (settings.mode === 'passphrase') passphraseTranscript = await transcribe(audio, engine);
      if (settings.mode === 'both') {
        passphraseTranscript = await transcribe(audio, engine);
        challengeTranscript = await transcribe(challengeAudio, engine);
      }
    } catch (error) {
      if (error instanceof DoorCheckError && error.status < 500) throw error;
      return fail(["Didn't catch that — try again"], profileId, name);
    }

    if (settings.mode === 'passphrase' || settings.mode === 'both') {
      if (!passphraseMatches(passphraseTranscript, settings)) return fail(['Passphrase did not match'], profileId, name);
    }
    if (settings.mode === 'challenge' || settings.mode === 'both') {
      if (!challengeMatches(challengeTranscript, challengeResult.challenge.phrase)) {
        return fail(["Didn't catch that — try again"], profileId, name);
      }
    }

    const result = { verified: true, profileId, name, reasons: [] };
    await recordAttempt({ profileId, verified: true, reasons: [] });
    await publishResult(result);
    return result;
  }

  async function testVoice(input) {
    const settings = readSettings();
    const challengeResult = settings.mode === 'passphrase' ? null : takeChallenge(input?.challengeId);
    if (challengeResult?.error) throw new DoorCheckError(challengeResult.error);
    const engine = await resolveEngine(settings);
    const transcript = await transcribe(decodeAudio(input?.audio), engine);
    if (settings.mode === 'both') {
      const challengeTranscript = await transcribe(decodeAudio(input?.challengeAudio), engine);
      return {
        transcript,
        challengeTranscript,
        match: passphraseMatches(transcript, settings) && challengeMatches(challengeTranscript, challengeResult.challenge.phrase),
        mode: settings.mode
      };
    }
    const match = settings.mode === 'challenge'
      ? challengeMatches(transcript, challengeResult.challenge.phrase)
      : passphraseMatches(transcript, settings);
    return { transcript, match, mode: settings.mode };
  }

  return {
    checkRateLimit,
    createChallenge,
    getAttempts,
    getPublicSettings,
    listSttEngines,
    saveSettings,
    testVoice,
    verify
  };
}

function mountDoorCheckRoutes({ app, service, authorizeAdmin }) {
  const sendError = (res, error) => {
    const status = error instanceof DoorCheckError ? error.status : 500;
    if (status >= 500) console.error('[ERROR] Door check API:', error.message);
    return res.status(status).json({ error: status >= 500 ? 'Door check is unavailable right now.' : error.message });
  };
  const requireAdmin = async (req, res) => {
    const result = await authorizeAdmin(req);
    if (!result.ok) {
      res.status(result.status).json(result);
      return false;
    }
    return true;
  };

  app.get('/api/door-check/settings', async (req, res) => {
    try { res.json(await service.getPublicSettings()); } catch (error) { sendError(res, error); }
  });
  app.put('/api/door-check/settings', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try { res.json(await service.saveSettings(req.body)); } catch (error) { sendError(res, error); }
  });
  app.get('/api/door-check/stt-engines', async (req, res) => {
    try { res.json(await service.listSttEngines()); } catch (error) { sendError(res, error); }
  });
  app.get('/api/door-check/attempts', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try { res.json(service.getAttempts()); } catch (error) { sendError(res, error); }
  });
  app.post('/api/door-check/challenge', (req, res) => {
    try { res.status(201).json(service.createChallenge()); } catch (error) { sendError(res, error); }
  });
  app.post('/api/door-check/verify', async (req, res) => {
    try {
      const key = req.ip || req.socket?.remoteAddress || 'panel';
      res.json(await service.verify(req.body, key));
    } catch (error) { sendError(res, error); }
  });
  app.post('/api/door-check/test-voice', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try { res.json(await service.testVoice(req.body)); } catch (error) { sendError(res, error); }
  });
}

module.exports = {
  AUDIO_MAX_BYTES,
  CHALLENGE_WORDS,
  DEFAULT_SETTINGS,
  DoorCheckError,
  challengeMatches,
  createDoorCheckService,
  decodeAudio,
  hashPassphrase,
  mountDoorCheckRoutes,
  normalizeSpeech,
  normalizeSettings,
  passphraseMatches,
  validateWav,
  wordEditDistance
};

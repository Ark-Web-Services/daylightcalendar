'use strict';

const { randomUUID } = require('crypto');

const SETTINGS_FILE = 'voice_settings.json';
const WAKE_WORD_ENTITY = 'wake_word.openwakeword';
const STT_ENGINE = 'stt.faster_whisper';
const PANEL_PAGES = new Set(['calendar', 'chores', 'meals', 'lists', 'pantry', 'games', 'school_menu']);
const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  wakeWordId: 'hey_jarvis',
  agentId: 'conversation.family_assistant',
  sensitivity: 0.55,
  muteWhileDimmed: false
});

class VoiceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'VoiceError';
    this.status = status;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSettings(value) {
  const input = isPlainObject(value) ? value : {};
  return {
    enabled: input.enabled === true,
    wakeWordId: typeof input.wakeWordId === 'string' && /^[a-z0-9_]{1,80}$/.test(input.wakeWordId)
      ? input.wakeWordId : DEFAULT_SETTINGS.wakeWordId,
    agentId: typeof input.agentId === 'string' && /^conversation\.[a-z0-9_]+$/.test(input.agentId)
      ? input.agentId : DEFAULT_SETTINGS.agentId,
    sensitivity: Number.isFinite(Number(input.sensitivity))
      ? Math.max(0, Math.min(1, Number(input.sensitivity))) : DEFAULT_SETTINGS.sensitivity,
    muteWhileDimmed: input.muteWhileDimmed === true
  };
}

function validateSettingsInput(input) {
  if (!isPlainObject(input)) throw new VoiceError('Settings must be an object');
  for (const key of ['enabled', 'muteWhileDimmed']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') {
      throw new VoiceError(`${key} must be true or false`);
    }
  }
  if (input.wakeWordId !== undefined &&
    (typeof input.wakeWordId !== 'string' || !/^[a-z0-9_]{1,80}$/.test(input.wakeWordId))) {
    throw new VoiceError('wakeWordId must be a Home Assistant wake word id');
  }
  if (input.agentId !== undefined &&
    (typeof input.agentId !== 'string' || !/^conversation\.[a-z0-9_]+$/.test(input.agentId))) {
    throw new VoiceError('agentId must be a conversation.* entity id');
  }
  if (input.sensitivity !== undefined &&
    (!Number.isFinite(Number(input.sensitivity)) || Number(input.sensitivity) < 0 || Number(input.sensitivity) > 1)) {
    throw new VoiceError('sensitivity must be between 0 and 1');
  }
}

const SMALL_NUMBERS = Object.freeze({
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19
});
const TENS = Object.freeze({ twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 });

function parsePercent(value) {
  const text = String(value || '').trim().toLowerCase().replace(/-/g, ' ');
  if (/^\d{1,3}$/.test(text)) {
    const number = Number(text);
    return number >= 0 && number <= 100 ? number : null;
  }
  if (text === 'one hundred' || text === 'a hundred' || text === 'hundred') return 100;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 1 && SMALL_NUMBERS[words[0]] !== undefined) return SMALL_NUMBERS[words[0]];
  if (words.length === 1 && TENS[words[0]] !== undefined) return TENS[words[0]];
  if (words.length === 2 && TENS[words[0]] !== undefined && SMALL_NUMBERS[words[1]] !== undefined) {
    return TENS[words[0]] + SMALL_NUMBERS[words[1]];
  }
  return null;
}

function normalizeTranscript(value) {
  return String(value || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9%\s-]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function parsePanelCommand(transcript) {
  const text = normalizeTranscript(transcript);
  if (!text) return null;

  if (/^(?:please )?(?:stop|cancel|never mind|nevermind)(?: please)?$/.test(text)) return { type: 'cancel' };
  if (/^(?:please )?(?:mute|mute (?:the )?volume|turn (?:the )?(?:sound|volume) off)(?: please)?$/.test(text)) return { type: 'mute', muted: true };
  if (/^(?:please )?(?:unmute|unmute (?:the )?volume|turn (?:the )?(?:sound|volume) on)(?: please)?$/.test(text)) return { type: 'mute', muted: false };

  const numberPhrase = '(\\d{1,3}|(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|(?:one |a )?hundred)';
  const exactVolume = new RegExp(`^(?:please )?(?:(?:set|put) (?:the )?volume(?: level)? to|volume(?: level)?(?: to)?|turn (?:the volume|it) (?:up|down) to) ${numberPhrase}(?: ?percent|%)?(?: please)?$`);
  const volumeMatch = text.match(exactVolume);
  if (volumeMatch) {
    const percent = parsePercent(volumeMatch[1]);
    if (percent !== null) return { type: 'set-volume', percent };
  }

  if (/^(?:please )?(?:volume up|turn (?:the volume|it) up|louder)(?: please)?$/.test(text)) return { type: 'adjust-volume', delta: 10 };
  if (/^(?:please )?(?:volume down|turn (?:the volume|it) down|quieter)(?: please)?$/.test(text)) return { type: 'adjust-volume', delta: -10 };

  if (/^(?:please )?(?:dim (?:the )?screen|screen off|turn (?:the )?screen off)(?: please)?$/.test(text)) return { type: 'screen', action: 'dim' };
  if (/^(?:please )?(?:wake up|wake (?:the )?screen|screen on|turn (?:the )?screen on)(?: please)?$/.test(text)) return { type: 'screen', action: 'wake' };
  if (/^(?:please )?(?:show|open|go to)(?: me)? (?:the )?school menu(?: please)?$/.test(text)) return { type: 'show-page', page: 'school_menu' };

  const pageMatch = text.match(/^(?:please )?(?:show|open|go to)(?: me)? (?:the )?(calendar|chores|meals|lists|pantry|games)(?: page)?(?: please)?$/);
  if (pageMatch) return { type: 'show-page', page: pageMatch[1] };
  return null;
}

function createPanelController({ fetch, panelAgentUrl = 'http://10.77.77.1:8097', isStandaloneDev = false, emitToPanels }) {
  let mockState = { level: 70, muted: false };

  async function request(path, options = {}) {
    if (isStandaloneDev) {
      if (path === '/volume' && options.method === 'PUT') mockState.level = options.body.level;
      if (path === '/mute' && options.method === 'PUT') mockState.muted = options.body.muted;
      return { ...mockState };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch(`${panelAgentUrl}${path}`, {
        method: options.method || 'GET',
        headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });
      if (!response.ok) throw new VoiceError(`Panel volume agent answered ${response.status}`, 502);
      return await response.json();
    } catch (error) {
      if (error instanceof VoiceError) throw error;
      throw new VoiceError('The panel volume control is unavailable', 503);
    } finally {
      clearTimeout(timer);
    }
  }

  async function getVolume() {
    const result = await request('/volume');
    return { level: Math.max(0, Math.min(100, Math.round(Number(result.level) || 0))), muted: result.muted === true };
  }

  async function setVolume(percent) {
    const level = Math.max(0, Math.min(100, Math.round(Number(percent))));
    if (!Number.isFinite(level)) throw new VoiceError('percent must be a number from 0 to 100');
    return request('/volume', { method: 'PUT', body: { level } });
  }

  async function setMuted(muted) {
    if (typeof muted !== 'boolean') throw new VoiceError('muted must be true or false');
    return request('/mute', { method: 'PUT', body: { muted } });
  }

  async function showOnPanel(page, targetSocket = null) {
    if (!PANEL_PAGES.has(page)) throw new VoiceError('Unknown panel page');
    const action = page === 'school_menu' ? { type: 'school-menu' } : { type: 'navigate', page };
    if (targetSocket) targetSocket.emit('voice:action', action);
    else emitToPanels('voice:action', action);
    return action;
  }

  return { getVolume, setVolume, setMuted, showOnPanel };
}

function createVoiceService({
  readJsonFile,
  writeJsonFile,
  withHouseholdStorageLock,
  fetch,
  hassApiUrl,
  getToken,
  getHaWsClient,
  panelController,
  synthesizeSpeech,
  isStandaloneDev = false,
  now = () => Date.now(),
  transcribeAudio: injectedTranscribe,
  processConversation: injectedConversation,
  restartDelays = { first: 1000, repeated: 5000 }
}) {
  const panels = new Map();
  const conversations = new Map();
  let binaryFailureLogged = false;

  function readSettings() {
    return normalizeSettings(readJsonFile(SETTINGS_FILE, DEFAULT_SETTINGS));
  }

  function publicStatus() {
    const settings = readSettings();
    if (!settings.enabled) return { status: 'disabled', enabled: false };
    const states = [...panels.values()];
    if (states.some(state => state.status === 'listening')) return { status: 'listening', enabled: true };
    if (states.some(state => state.status === 'wake-unavailable')) return { status: 'wake-unavailable', enabled: true };
    return { status: isStandaloneDev ? 'wake-unavailable' : 'ha-unreachable', enabled: true };
  }

  function emitStatus(socket, state, status) {
    state.status = status;
    socket.emit('voice:status', { ...publicStatus(), status, enabled: readSettings().enabled });
  }

  async function listWakeWords() {
    if (isStandaloneDev) return [{ id: DEFAULT_SETTINGS.wakeWordId, name: 'Hey Jarvis' }];
    const client = getHaWsClient();
    if (!client) return [];
    const result = await client.sendCommand('wake_word/info', { entity_id: WAKE_WORD_ENTITY });
    return (result?.wake_words || []).map(item => ({ id: item.id, name: item.name || item.id }));
  }

  async function listAgents() {
    if (isStandaloneDev || !getToken()) return [{ entityId: DEFAULT_SETTINGS.agentId, name: 'Family Assistant' }];
    const response = await fetch(`${hassApiUrl}/states`, {
      headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' }
    });
    if (!response.ok) throw new VoiceError(`Home Assistant answered ${response.status}`, 502);
    const states = await response.json();
    return (Array.isArray(states) ? states : []).filter(state => String(state.entity_id).startsWith('conversation.'))
      .map(state => ({ entityId: state.entity_id, name: state.attributes?.friendly_name || state.entity_id }));
  }

  async function getSettingsPayload() {
    const settings = readSettings();
    const [wakeWords, agents] = await Promise.all([
      listWakeWords().catch(() => []),
      listAgents().catch(() => [])
    ]);
    return { ...settings, wakeWords, agents, status: publicStatus().status };
  }

  async function selectPipelineWakeWord(wakeWordId) {
    if (isStandaloneDev) return;
    const client = getHaWsClient();
    if (!client) throw new VoiceError('Home Assistant is unreachable', 503);
    const result = await client.sendCommand('assist_pipeline/pipeline/list');
    const pipelines = result?.pipelines || [];
    const pipeline = pipelines.find(item => item.id === result?.preferred_pipeline) || pipelines[0];
    if (!pipeline) throw new VoiceError('Home Assistant has no Assist pipeline', 503);
    if (pipeline.wake_word_entity === WAKE_WORD_ENTITY && pipeline.wake_word_id === wakeWordId) return;
    const update = { ...pipeline, wake_word_entity: WAKE_WORD_ENTITY, wake_word_id: wakeWordId };
    delete update.id;
    await client.sendCommand('assist_pipeline/pipeline/update', { pipeline: pipeline.id, ...update });
  }

  async function saveSettings(input) {
    validateSettingsInput(input);
    const saved = await withHouseholdStorageLock(async () => {
      const candidate = normalizeSettings({ ...readSettings(), ...input });
      if (candidate.enabled) await selectPipelineWakeWord(candidate.wakeWordId);
      writeJsonFile(SETTINGS_FILE, candidate);
      return candidate;
    });
    for (const [socket, state] of panels) {
      socket.emit('voice:settings', saved);
      if (!saved.enabled) stopWakeRun(socket, state, 'disabled');
      else if (state.panelListening) scheduleWakeRun(socket, state, 0);
    }
    return getSettingsPayload();
  }

  function clearRestart(state) {
    if (state.restartTimer) clearTimeout(state.restartTimer);
    state.restartTimer = null;
  }

  function stopWakeRun(socket, state, status = 'disabled') {
    clearRestart(state);
    state.run?.stop?.();
    state.run = null;
    state.handlerId = null;
    emitStatus(socket, state, status);
  }

  function scheduleWakeRun(socket, state, delay) {
    clearRestart(state);
    if (!readSettings().enabled || !state.panelListening || state.disconnected) return;
    state.restartTimer = setTimeout(() => {
      state.restartTimer = null;
      startWakeRun(socket, state).catch(error => handleWakeFailure(socket, state, error));
    }, delay);
  }

  function handleWakeFailure(socket, state, error) {
    state.run?.stop?.();
    state.run = null;
    state.handlerId = null;
    state.errorCount += 1;
    emitStatus(socket, state, error?.binaryFailure ? 'wake-unavailable' : 'ha-unreachable');
    const delay = state.errorCount > 1 ? restartDelays.repeated : restartDelays.first;
    scheduleWakeRun(socket, state, delay);
  }

  async function startWakeRun(socket, state) {
    if (state.run || !readSettings().enabled || !state.panelListening || state.disconnected) return;
    const client = getHaWsClient();
    if (!client) throw new VoiceError('Home Assistant websocket is unavailable', 503);
    const run = await client.sendEventCommand('assist_pipeline/run', {
      start_stage: 'wake_word',
      end_stage: 'wake_word',
      input: { sample_rate: 16000, timeout: 300 }
    }, event => handleWakeEvent(socket, state, event));
    state.run = run;
  }

  function handleWakeEvent(socket, state, event) {
    if (!event || state.disconnected) return;
    if (event.type === 'run-start') {
      const handlerId = event.data?.runner_data?.stt_binary_handler_id;
      if (!Number.isInteger(handlerId)) return handleWakeFailure(socket, state, new Error('No binary handler id'));
      state.handlerId = handlerId;
      emitStatus(socket, state, 'listening');
      return;
    }
    if (event.type === 'wake_word-end') {
      state.handlerId = null;
      state.errorCount = 0;
      socket.emit('voice:wake', { wakeWordId: event.data?.wake_word_output?.wake_word_id || readSettings().wakeWordId });
      return;
    }
    if (event.type === 'error' || event.type === 'run-end') {
      state.run?.stop?.();
      state.run = null;
      state.handlerId = null;
      if (state.panelListening && readSettings().enabled) {
        const isError = event.type === 'error';
        if (isError) {
          state.errorCount += 1;
          const code = event.data?.code;
          emitStatus(socket, state, code === 'wake-word-timeout' || code === 'timeout'
            ? 'wake-unavailable' : 'ha-unreachable');
        }
        const delay = isError && state.errorCount > 1 ? restartDelays.repeated : restartDelays.first;
        scheduleWakeRun(socket, state, delay);
      }
    }
  }

  async function forwardAudio(socket, state, chunk) {
    if (!state.panelListening || !readSettings().enabled || state.handlerId === null) return;
    let buffer;
    try { buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); }
    catch (error) { return; }
    if (!buffer.length || buffer.length > 8192) return;
    try {
      await getHaWsClient().sendBinary(state.handlerId, buffer);
    } catch (error) {
      if (!binaryFailureLogged) {
        binaryFailureLogged = true;
        console.error('[VOICE] HA websocket binary audio failed; wake word streaming is unavailable:', error.message);
      }
      const wrapped = new Error(error.message);
      wrapped.binaryFailure = true;
      handleWakeFailure(socket, state, wrapped);
    }
  }

  function validateAudio(value) {
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
    if (buffer.length < 44 || buffer.length > 300 * 1024 || buffer.toString('ascii', 0, 4) !== 'RIFF' ||
      buffer.toString('ascii', 8, 12) !== 'WAVE') throw new VoiceError('Command audio must be a short WAV recording');
    return buffer;
  }

  // Home Assistant waits up to two minutes on a conversation agent whose model server is asleep;
  // a family standing at the panel should hear a plain answer long before that.
  async function fetchWithin(url, options, ms, timeoutMessage) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (error.name === 'AbortError') throw new VoiceError(timeoutMessage, 504);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function transcribe(buffer) {
    if (injectedTranscribe) return String(await injectedTranscribe(buffer)).trim();
    if (!getToken()) throw new VoiceError('Home Assistant speech recognition is unavailable', 503);
    const response = await fetchWithin(`${hassApiUrl}/stt/${STT_ENGINE}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getToken()}`,
        'Content-Type': 'audio/wav',
        'X-Speech-Content': 'format=wav; codec=pcm; sample_rate=16000; bit_rate=16; channel=1; language=en'
      },
      body: buffer
    }, 15000, 'Speech recognition is not answering right now.');
    if (!response.ok) throw new VoiceError(`Speech recognition answered ${response.status}`, 502);
    const result = await response.json();
    if (result?.result !== 'success' || typeof result.text !== 'string') throw new VoiceError('Speech recognition returned no words', 502);
    return result.text.trim();
  }

  async function converse(text, agentId, conversationId) {
    if (injectedConversation) return injectedConversation({ text, agentId, conversationId });
    // 30 s covers a cold model load (~13 s on the household's Ollama server) plus the answer.
    const response = await fetchWithin(`${hassApiUrl}/conversation/process`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, agent_id: agentId, language: 'en', ...(conversationId ? { conversation_id: conversationId } : {}) })
    }, 30000, 'The assistant isn’t answering right now. The computer that runs it may be asleep.');
    if (!response.ok) throw new VoiceError(`Family Assistant answered ${response.status}`, 502);
    return response.json();
  }

  async function runFastCommand(command, socket) {
    if (command.type === 'set-volume') {
      await panelController.setVolume(command.percent);
      return `Volume ${command.percent} percent.`;
    }
    if (command.type === 'adjust-volume') {
      const current = await panelController.getVolume();
      const percent = Math.max(0, Math.min(100, current.level + command.delta));
      await panelController.setVolume(percent);
      return `Volume ${percent} percent.`;
    }
    if (command.type === 'mute') {
      await panelController.setMuted(command.muted);
      return command.muted ? 'Muted.' : 'Sound on.';
    }
    if (command.type === 'show-page') {
      await panelController.showOnPanel(command.page, socket);
      return command.page === 'school_menu' ? 'Showing the school menu.' : `Showing ${command.page}.`;
    }
    if (command.type === 'screen') {
      socket.emit('voice:action', { type: command.action });
      return command.action === 'dim' ? 'Screen dimmed.' : 'I’m awake.';
    }
    if (command.type === 'cancel') {
      socket.emit('voice:action', { type: 'cancel' });
      return 'Canceled.';
    }
    throw new VoiceError('Unknown panel command');
  }

  async function speakReply(socket, text) {
    let audioUrl = null;
    try { audioUrl = await synthesizeSpeech(text); } catch (error) {
      console.warn('[VOICE] Reply speech unavailable:', error.message);
    }
    socket.emit('voice:reply', { text, audioUrl });
  }

  async function handleCommand(socket, audio) {
    const startedAt = now();
    let type = 'unrecognized';
    try {
      const transcript = await transcribe(validateAudio(audio));
      if (!transcript) throw new VoiceError('I did not hear a command');
      socket.emit('voice:transcript', { text: transcript });
      const command = parsePanelCommand(transcript);
      socket.emit('voice:thinking');
      if (command) {
        type = command.type;
        const reply = await runFastCommand(command, socket);
        // Fast panel actions answer immediately and use the kiosk's local speech voice; waiting for
        // Piper here would turn a sub-second volume/navigation command into a multi-second round trip.
        socket.emit('voice:reply', { text: reply, audioUrl: null });
      } else {
        type = 'assistant';
        const settings = readSettings();
        const previous = conversations.get(socket.id);
        const reusableId = previous && now() - previous.usedAt < 60000 ? previous.id : null;
        const result = await converse(transcript, settings.agentId, reusableId);
        const conversationId = result?.conversation_id || reusableId || randomUUID();
        conversations.set(socket.id, { id: conversationId, usedAt: now() });
        const reply = result?.response?.speech?.plain?.speech;
        if (typeof reply !== 'string' || !reply.trim()) throw new VoiceError('The assistant returned no spoken answer', 502);
        await speakReply(socket, reply.trim());
      }
      console.log(`[VOICE] command=${type} duration_ms=${Math.max(0, now() - startedAt)}`);
    } catch (error) {
      console.warn(`[VOICE] command=${type} failed duration_ms=${Math.max(0, now() - startedAt)}`);
      socket.emit('voice:error', { message: error instanceof VoiceError ? error.message : 'Voice assistant is unavailable right now.' });
    }
  }

  function attachSocket(socket) {
    const state = { panelListening: false, handlerId: null, run: null, restartTimer: null, errorCount: 0, status: 'disabled', disconnected: false };
    panels.set(socket, state);
    socket.emit('voice:status', publicStatus());
    socket.on('voice:listening', payload => {
      state.panelListening = payload?.listening === true;
      if (!state.panelListening || !readSettings().enabled) stopWakeRun(socket, state, readSettings().enabled ? 'mic-off' : 'disabled');
      else scheduleWakeRun(socket, state, 0);
    });
    socket.on('voice:audio', chunk => { void forwardAudio(socket, state, chunk); });
    socket.on('voice:command', audio => {
      if (state.panelListening && readSettings().enabled) void handleCommand(socket, audio);
    });
    socket.on('disconnect', () => {
      state.disconnected = true;
      clearRestart(state);
      state.run?.stop?.();
      panels.delete(socket);
      conversations.delete(socket.id);
    });
  }

  return { attachSocket, getSettingsPayload, getStatus: publicStatus, readSettings, saveSettings, handleCommand };
}

module.exports = {
  DEFAULT_SETTINGS,
  PANEL_PAGES,
  VoiceError,
  createPanelController,
  createVoiceService,
  normalizeSettings,
  parsePanelCommand,
  parsePercent
};

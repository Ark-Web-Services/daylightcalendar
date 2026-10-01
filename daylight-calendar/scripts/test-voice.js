'use strict';

const assert = require('assert/strict');
const WebSocket = require('ws');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { HaWebSocketClient } = require('./ha-websocket-client');
const { createToolServer } = require('./mcp-server');
const { createVoiceService, parsePanelCommand } = require('./voice-service');
const { createVoiceVad } = require('../public/js/voice-vad');

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function testParser() {
  const cases = [
    ['volume to 40', { type: 'set-volume', percent: 40 }],
    ['volume 40 percent', { type: 'set-volume', percent: 40 }],
    ['set volume to one hundred', { type: 'set-volume', percent: 100 }],
    ['set the volume to 5', { type: 'set-volume', percent: 5 }],
    ['volume 5', { type: 'set-volume', percent: 5 }],
    ['turn the volume down to thirty percent', { type: 'set-volume', percent: 30 }],
    ['turn it down to thirty percent', { type: 'set-volume', percent: 30 }],
    ['turn it up to ninety', { type: 'set-volume', percent: 90 }],
    ['volume up', { type: 'adjust-volume', delta: 10 }],
    ['turn it up', { type: 'adjust-volume', delta: 10 }],
    ['louder', { type: 'adjust-volume', delta: 10 }],
    ['volume down', { type: 'adjust-volume', delta: -10 }],
    ['quieter', { type: 'adjust-volume', delta: -10 }],
    ['mute', { type: 'mute', muted: true }],
    ['mute the volume', { type: 'mute', muted: true }],
    ['unmute', { type: 'mute', muted: false }],
    ['stop', { type: 'cancel' }],
    ['cancel', { type: 'cancel' }],
    ['never mind', { type: 'cancel' }],
    ['show me chores', { type: 'show-page', page: 'chores' }],
    ['go to meals', { type: 'show-page', page: 'meals' }],
    ['show calendar', { type: 'show-page', page: 'calendar' }],
    ['open the lists page', { type: 'show-page', page: 'lists' }],
    ['show pantry', { type: 'show-page', page: 'pantry' }],
    ['go to games', { type: 'show-page', page: 'games' }],
    ['show the school menu', { type: 'show-page', page: 'school_menu' }],
    ['dim the screen', { type: 'screen', action: 'dim' }],
    ['screen off', { type: 'screen', action: 'dim' }],
    ['wake up', { type: 'screen', action: 'wake' }]
  ];
  cases.forEach(([phrase, expected]) => assert.deepEqual(parsePanelCommand(phrase), expected, phrase));
  [
    "what's the volume of the Atlantic",
    'should I turn the volume down when the baby sleeps',
    'what chores are due today',
    'tell me what is on the school menu',
    'is the pantry volume low'
  ].forEach(phrase => assert.equal(parsePanelCommand(phrase), null, phrase));
}

function buffer(level, length = 1600) {
  const samples = new Float32Array(length);
  samples.fill(level);
  return samples;
}

function testVad() {
  const silenceVad = createVoiceVad({ noiseFloor: 0.005 });
  let result;
  for (let time = 0; time <= 4100; time += 100) result = silenceVad.push(buffer(0), time);
  assert.equal(result.state, 'no-speech');

  const speechVad = createVoiceVad({ noiseFloor: 0.005 });
  speechVad.push(buffer(0.08), 0);
  assert.equal(speechVad.push(buffer(0.08), 100).state, 'speech');
  for (let time = 200; time <= 1000; time += 100) result = speechVad.push(buffer(0), time);
  assert.equal(result.state, 'complete');

  const cappedVad = createVoiceVad({ noiseFloor: 0.005, noSpeechMs: 10000, maxMs: 8000 });
  for (let time = 0; time <= 8000; time += 250) result = cappedVad.push(buffer(0), time);
  assert.equal(result.state, 'no-speech');
}

class FakePanelSocket {
  constructor(id = 'panel-test') {
    this.id = id;
    this.handlers = new Map();
    this.sent = [];
  }

  on(name, handler) {
    const handlers = this.handlers.get(name) || [];
    handlers.push(handler);
    this.handlers.set(name, handlers);
  }

  emit(name, payload) {
    this.sent.push({ name, payload });
  }

  receive(name, payload) {
    (this.handlers.get(name) || []).forEach(handler => handler(payload));
  }
}

function serviceDependencies(overrides = {}) {
  const settings = { enabled: true, wakeWordId: 'hey_jarvis', agentId: 'conversation.family_assistant', sensitivity: 0.55, muteWhileDimmed: false };
  return {
    readJsonFile: (name, fallback) => name === 'voice_settings.json' ? settings : fallback,
    writeJsonFile: () => {},
    withHouseholdStorageLock: operation => operation(),
    fetch: async () => { throw new Error('Unexpected fetch'); },
    hassApiUrl: 'http://ha/api',
    getToken: () => 'token',
    panelController: {
      getVolume: async () => ({ level: 70, muted: false }),
      setVolume: async () => ({}),
      setMuted: async () => ({}),
      showOnPanel: async () => ({})
    },
    synthesizeSpeech: async () => 'api/announcements/test/audio',
    ...overrides
  };
}

async function testWakeBridge() {
  const server = new WebSocket.Server({ port: 0 });
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  let runCount = 0;
  let binaryFrame = null;
  let activeRunId = null;
  let serverSocket = null;

  server.on('connection', ws => {
    serverSocket = ws;
    ws.send(JSON.stringify({ type: 'auth_required' }));
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        binaryFrame = Buffer.from(data);
        ws.send(JSON.stringify({ id: activeRunId, type: 'event', event: { type: 'wake_word-end', data: { wake_word_output: { wake_word_id: 'hey_jarvis' } } } }));
        ws.send(JSON.stringify({ id: activeRunId, type: 'event', event: { type: 'run-end', data: {} } }));
        return;
      }
      const message = JSON.parse(data.toString());
      if (message.type === 'auth') ws.send(JSON.stringify({ type: 'auth_ok' }));
      if (message.type === 'assist_pipeline/run') {
        runCount += 1;
        activeRunId = message.id;
        ws.send(JSON.stringify({ id: message.id, type: 'result', success: true, result: null }));
        ws.send(JSON.stringify({ id: message.id, type: 'event', event: { type: 'run-start', data: { runner_data: { stt_binary_handler_id: 7 } } } }));
      }
    });
  });

  const client = new HaWebSocketClient(`http://127.0.0.1:${port}`, 'token', {
    WebSocketClass: WebSocket,
    logger: { log() {}, warn() {}, error() {} }
  });
  const voice = createVoiceService(serviceDependencies({
    getHaWsClient: () => client,
    restartDelays: { first: 10, repeated: 20 }
  }));
  const panel = new FakePanelSocket();
  voice.attachSocket(panel);
  panel.receive('voice:listening', { listening: true });
  for (let attempts = 0; attempts < 50 && !panel.sent.some(item => item.name === 'voice:status' && item.payload.status === 'listening'); attempts += 1) await wait(5);
  panel.receive('voice:audio', Buffer.from([1, 2, 3, 4]));
  for (let attempts = 0; attempts < 50 && !binaryFrame; attempts += 1) await wait(5);
  assert.deepEqual(binaryFrame, Buffer.from([7, 1, 2, 3, 4]));
  assert(panel.sent.some(item => item.name === 'voice:wake'));
  for (let attempts = 0; attempts < 50 && runCount < 2; attempts += 1) await wait(5);
  assert(runCount >= 2, 'wake run should restart after run-end');
  panel.receive('disconnect');
  serverSocket?.close();
  client.ws?.close();
  await new Promise(resolve => server.close(resolve));
}

function fakeWav() {
  const wav = Buffer.alloc(44);
  wav.write('RIFF', 0, 'ascii');
  wav.write('WAVE', 8, 'ascii');
  return wav;
}

async function testCommandPaths() {
  let transcript = 'set the volume to 40';
  const volumeWrites = [];
  const conversations = [];
  let clock = 1000;
  const voice = createVoiceService(serviceDependencies({
    getHaWsClient: () => null,
    now: () => clock,
    transcribeAudio: async () => transcript,
    panelController: {
      getVolume: async () => ({ level: 70, muted: false }),
      setVolume: async level => { volumeWrites.push(level); },
      setMuted: async () => {},
      showOnPanel: async () => ({})
    },
    processConversation: async input => {
      conversations.push(input);
      return {
        conversation_id: input.conversationId || `conversation-${conversations.length}`,
        response: { speech: { plain: { speech: 'Here is the answer.' } } }
      };
    }
  }));
  const panel = new FakePanelSocket('command-panel');
  await voice.handleCommand(panel, fakeWav());
  assert.deepEqual(volumeWrites, [40]);
  assert(panel.sent.some(item => item.name === 'voice:reply' && item.payload.text === 'Volume 40 percent.' && item.payload.audioUrl === null));

  transcript = 'what is happening tomorrow';
  panel.sent = [];
  await voice.handleCommand(panel, fakeWav());
  assert.equal(conversations[0].agentId, 'conversation.family_assistant');
  assert.equal(conversations[0].conversationId, null);
  clock += 59000;
  await voice.handleCommand(panel, fakeWav());
  assert.equal(conversations[1].conversationId, 'conversation-1');
  clock += 61000;
  await voice.handleCommand(panel, fakeWav());
  assert.equal(conversations[2].conversationId, null);
  assert(panel.sent.some(item => item.name === 'voice:reply' && item.payload.audioUrl === 'api/announcements/test/audio'));
}

async function testMcpTools() {
  const calls = [];
  const dependencies = {
    getUsers: async () => [], getAdminProfileIds: async () => [], getLocalDate: () => '2026-10-01',
    getSchoolSettings: () => ({}), getSchoolMenu: async () => ({ menus: [] }), getCalendarEvents: async () => [],
    getChores: async () => [], getRoutines: async () => [], getStarBalance: () => 0,
    getMealPlan: () => ({ meals: [] }), getLists: () => [], addListItems: async () => null,
    getScreenTime: async () => ({ profiles: [] }), remember: async () => ({}), getMemories: () => [], forget: async () => false,
    setPanelVolume: async percent => calls.push(['volume', percent]),
    getPanelVolume: async () => ({ level: 40, muted: false }),
    showOnPanel: async page => calls.push(['show', page])
  };
  const server = createToolServer(dependencies, 'test');
  const client = new Client({ name: 'voice-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const listed = await client.listTools();
  const names = new Set(listed.tools.map(tool => tool.name));
  ['set_panel_volume', 'get_panel_volume', 'show_on_panel'].forEach(name => assert(names.has(name), name));
  await client.callTool({ name: 'set_panel_volume', arguments: { percent: 40 } });
  const volume = await client.callTool({ name: 'get_panel_volume', arguments: {} });
  await client.callTool({ name: 'show_on_panel', arguments: { page: 'chores' } });
  assert.deepEqual(calls, [['volume', 40], ['show', 'chores']]);
  assert.deepEqual(JSON.parse(volume.content[0].text), { level: 40, muted: false });
  await client.close();
}

async function main() {
  testParser();
  testVad();
  await testWakeBridge();
  await testCommandPaths();
  await testMcpTools();
  console.log('Voice tests passed: parser, VAD, wake bridge, commands, conversation reuse, and MCP.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

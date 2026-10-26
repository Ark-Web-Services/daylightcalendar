'use strict';
const assert = require('node:assert/strict');
const { createRouter, createServer, validateMessage } = require('../host/jarvis-router');
const body = { messages: [{ role: 'user', content: 'What is two plus two?' }] };
const answer = { role: 'assistant', content: 'Four.' };
const json = value => ({ ok: true, json: async () => value });

async function main() {
  let calls = [], time = 1000, generations = 0;
  const router = createRouter({
    localModels: [{ url: 'http://asleep', model: 'local' }], codexModels: ['fast', 'backup']
  }, {
    now: () => time,
    probeCodex: async () => ['fast', 'backup'],
    fetch: async url => { calls.push(url); throw new Error('offline'); },
    runCodex: async model => { generations += 1; calls.push(model); if (model === 'fast') throw new Error('quota'); return answer; }
  });
  await router.refresh();
  assert.equal(generations, 0, 'background availability checks never generate inference');
  calls = [];
  assert.equal((await router.chat(body)).message.content, 'Four.');
  assert.deepEqual(calls, ['fast', 'backup'], 'no availability calls run during chat');
  calls = [];
  await router.chat(body);
  assert.deepEqual(calls, ['backup'], 'cooldown skips dead hosts and inaccessible models');
  time += 61000;
  calls = [];
  await router.refresh();
  calls = [];
  await router.chat(body);
  assert.equal(calls[0], 'fast', 'model is retried after cooldown');
  const beforeStale = generations;
  time += 100000;
  await assert.rejects(router.chat(body), /No AI backend/);
  assert.equal(generations, beforeStale, 'expired readiness is not reused');

  calls = [];
  const local = createRouter({ localModels: [{ url: 'http://local', model: 'installed' }] }, {
    probeCodex: async () => [],
    fetch: async (url, options) => {
      calls.push(url);
      if (url.endsWith('/tags')) return json({ models: [{ name: 'installed' }] });
      if (url.endsWith('/show')) return json({ capabilities: ['tools'] });
      assert.equal(JSON.parse(options.body).stream, false);
      return json({ message: answer });
    },
    runCodex: async () => { throw new Error('must stay local'); }
  });
  await local.refresh();
  calls = [];
  await local.chat(body);
  assert.equal(local.status().lastRoute.backend, 'ollama:http://local:installed');
  assert.deepEqual(calls, ['http://local/api/chat'], 'local generation uses the cached readiness snapshot');

  const tools = [{ type: 'function', function: { name: 'recall', parameters: { type: 'object' } } }];
  assert.throws(() => validateMessage({ content: '', tool_calls: [{ function: { name: 'shell', arguments: {} } }] }, tools));
  assert.throws(() => validateMessage({ content: ' ' }));
  assert.equal(validateMessage({ content: '', tool_calls: [{ function: { name: 'recall', arguments: {} } }] }, tools).tool_calls.length, 1);
  let fallbackUsed = false;
  const incompatible = createRouter({ localModels: [{ url: 'http://receipt', model: 'vision' }] }, {
    probeCodex: async () => ['gpt-6-luna'],
    fetch: async url => json(url.endsWith('/tags') ? { models: [{ name: 'vision' }] } : { capabilities: ['vision'] }),
    runCodex: async () => { fallbackUsed = true; return answer; }
  });
  await incompatible.refresh();
  await incompatible.chat({ ...body, tools });
  assert(fallbackUsed, 'a vision-only model must not handle household tools');

  const timeout = createRouter({ codexModels: ['slow', 'working'], codexTimeoutMs: 5 }, {
    probeCodex: async () => ['slow', 'working'],
    runCodex: async model => model === 'slow' ? new Promise(() => {}) : answer
  });
  await timeout.refresh();
  assert.equal((await timeout.chat(body)).message.content, 'Four.');
  const down = createRouter({ codexModels: ['down'] }, { probeCodex: async () => ['down'], runCodex: async () => { throw new Error('offline'); } });
  await down.refresh();
  await assert.rejects(down.chat(body), /No AI backend/);

  const server = createServer(local);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const tags = await (await fetch(`${url}/api/tags`)).json();
    assert.equal(tags.models[0].model, 'jarvis-auto:latest');
    const stream = await fetch(`${url}/api/chat`, { method: 'POST', body: JSON.stringify({ ...body, model: 'jarvis-auto:latest', stream: true }) });
    assert.equal(stream.headers.get('content-type'), 'application/x-ndjson');
    assert.equal(JSON.parse(await stream.text()).message.content, 'Four.');
    const invalid = await fetch(`${url}/api/chat`, { method: 'POST', body: '{' });
    assert.equal(invalid.status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
  console.log('Jarvis router tests passed: local preference, availability, quotas, cooldown, recovery, tools, timeout and Ollama streaming.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

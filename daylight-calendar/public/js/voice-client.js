'use strict';

(function exposeDaylightVoice(root) {
  const MIC_STORAGE_KEY = 'daylight-voice-mic-enabled';
  const SAMPLE_RATE = 16000;
  let socket = null;
  let presence = null;
  let settings = { enabled: false, sensitivity: 0.55, muteWhileDimmed: false };
  let micEnabled = true;
  try { micEnabled = localStorage.getItem(MIC_STORAGE_KEY) !== 'false'; }
  catch (error) { console.warn('[VOICE] Could not read the microphone preference'); }
  let stream = null;
  let context = null;
  let source = null;
  let captureNode = null;
  let silentGain = null;
  let workletUrl = null;
  let startPromise = null;
  let sharedMicPauses = 0;
  let commandCapture = null;
  let wakeChunkParts = [];
  let wakeSampleCount = 0;
  let noiseFloor = 0.008;
  let heardText = '';
  let replyPlayer = null;
  let replyContext = null;
  let replyAnalyser = null;
  let replySource = null;
  let replyLevelFrame = null;
  let dimObserver = null;

  function updateMicButton() {
    const button = document.getElementById('voice-mic-toggle');
    if (!button) return;
    const activelyListening = Boolean(stream && socket?.connected);
    button.classList.toggle('is-off', !micEnabled);
    button.classList.toggle('is-paused', micEnabled && !activelyListening);
    button.setAttribute('aria-pressed', String(micEnabled));
    button.setAttribute('aria-label', micEnabled ? 'Disable the voice microphone' : 'Enable the voice microphone');
    button.title = !micEnabled ? 'Voice microphone is disabled'
      : activelyListening ? 'Voice microphone is listening' : 'Voice microphone is enabled but not listening';
    const icon = button.querySelector('.material-icons');
    if (icon) icon.textContent = micEnabled ? 'mic' : 'mic_off';
  }

  function isDimMuted() {
    return settings.muteWhileDimmed && document.getElementById('screen-dimmer')?.classList.contains('active');
  }

  function shouldCapture() {
    return Boolean(socket?.connected) && settings.enabled && micEnabled
      && sharedMicPauses === 0 && !document.hidden && !isDimMuted();
  }

  function emitToBackend(eventName, payload, { volatile = false } = {}) {
    if (!socket?.connected) return false;
    const target = volatile && socket.volatile ? socket.volatile : socket;
    target.emit(eventName, payload);
    return true;
  }

  function floatToPcm16(samples) {
    const buffer = new ArrayBuffer(samples.length * 2);
    const view = new DataView(buffer);
    for (let index = 0; index < samples.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, samples[index]));
      view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return buffer;
  }

  function concatenate(chunks) {
    const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const result = new Float32Array(length);
    let offset = 0;
    chunks.forEach(chunk => { result.set(chunk, offset); offset += chunk.length; });
    return result;
  }

  function queueWakeSamples(samples) {
    wakeChunkParts.push(new Float32Array(samples));
    wakeSampleCount += samples.length;
    if (wakeSampleCount < 1024) return;
    const merged = concatenate(wakeChunkParts);
    let offset = 0;
    while (merged.length - offset >= 1024) {
      emitToBackend('voice:audio', floatToPcm16(merged.subarray(offset, offset + 1024)), { volatile: true });
      offset += 1024;
    }
    wakeChunkParts = offset < merged.length ? [new Float32Array(merged.subarray(offset))] : [];
    wakeSampleCount = merged.length - offset;
  }

  function finishCommandCapture(reason) {
    const capture = commandCapture;
    commandCapture = null;
    if (!capture) return;
    if (reason === 'complete') {
      const wav = root.DaylightAudio.encodePcm16Wav(concatenate(capture.chunks), SAMPLE_RATE);
      presence.setState('thinking');
      if (!emitToBackend('voice:command', wav)) presence.setState('idle');
      return;
    }
    presence.setState('error');
    presence.showText('', 'I didn’t hear anything. Try again.');
  }

  function handleSamples(rawSamples) {
    if (!context || !root.DaylightAudio) return;
    const samples = root.DaylightAudio.downsampleMono(
      rawSamples instanceof Float32Array ? rawSamples : new Float32Array(rawSamples),
      context.sampleRate,
      SAMPLE_RATE
    );
    if (!samples.length) return;
    const level = root.DaylightVoiceVad.rms(samples);
    if (commandCapture) {
      commandCapture.chunks.push(new Float32Array(samples));
      const result = commandCapture.vad.push(samples, performance.now());
      presence.setLevel(Math.min(1, result.level / Math.max(result.threshold * 2.5, 0.02)));
      if (result.state === 'complete') finishCommandCapture('complete');
      else if (result.state === 'no-speech') finishCommandCapture('no-speech');
      return;
    }
    noiseFloor = noiseFloor * 0.985 + Math.min(level, 0.04) * 0.015;
    queueWakeSamples(samples);
  }

  async function startCapture() {
    if (!shouldCapture() || stream || startPromise) return startPromise;
    if (!navigator.mediaDevices?.getUserMedia || !root.DaylightAudio || !root.DaylightVoiceVad) return;
    startPromise = (async () => {
      try {
        const AudioContextClass = root.AudioContext || root.webkitAudioContext;
        if (!AudioContextClass) throw new Error('Audio capture is not supported');
        const nextStream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false
        });
        if (!shouldCapture()) {
          nextStream.getTracks().forEach(track => track.stop());
          return;
        }
        stream = nextStream;
        context = new AudioContextClass();
        source = context.createMediaStreamSource(stream);
        if (context.audioWorklet && typeof root.AudioWorkletNode === 'function') {
          const code = `class DaylightVoiceCapture extends AudioWorkletProcessor { process(inputs) { const samples = inputs[0] && inputs[0][0]; if (samples) this.port.postMessage(samples.slice(0)); return true; } } registerProcessor('daylight-voice-capture', DaylightVoiceCapture);`;
          workletUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
          await context.audioWorklet.addModule(workletUrl);
          captureNode = new AudioWorkletNode(context, 'daylight-voice-capture');
          captureNode.port.onmessage = event => handleSamples(event.data);
        } else {
          captureNode = context.createScriptProcessor(2048, 1, 1);
          captureNode.onaudioprocess = event => handleSamples(event.inputBuffer.getChannelData(0));
        }
        silentGain = context.createGain();
        silentGain.gain.value = 0;
        source.connect(captureNode).connect(silentGain).connect(context.destination);
        await context.resume();
        emitToBackend('voice:listening', { listening: true });
      } catch (error) {
        console.warn('[VOICE] Microphone capture unavailable:', error.message);
        await stopCapture();
        presence?.setState('error');
        presence?.showText('', 'Microphone unavailable. Check panel permissions.');
        renderStatus('mic-unavailable');
        emitToBackend('voice:listening', { listening: false });
      } finally {
        startPromise = null;
        updateMicButton();
      }
    })();
    return startPromise;
  }

  async function stopCapture() {
    const wasRecordingCommand = Boolean(commandCapture);
    commandCapture = null;
    if (wasRecordingCommand) presence?.setState('idle');
    emitToBackend('voice:listening', { listening: false });
    try { source?.disconnect(); } catch (error) { /* already disconnected */ }
    try { captureNode?.disconnect(); } catch (error) { /* already disconnected */ }
    try { silentGain?.disconnect(); } catch (error) { /* already disconnected */ }
    if (captureNode && 'onaudioprocess' in captureNode) captureNode.onaudioprocess = null;
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    wakeChunkParts = [];
    wakeSampleCount = 0;
    source = null;
    captureNode = null;
    silentGain = null;
    if (workletUrl) URL.revokeObjectURL(workletUrl);
    workletUrl = null;
    const closingContext = context;
    context = null;
    if (closingContext && closingContext.state !== 'closed') await closingContext.close().catch(() => {});
    updateMicButton();
  }

  async function syncCapture() {
    if (shouldCapture()) await startCapture();
    else await stopCapture();
  }

  async function pauseForSharedMic() {
    sharedMicPauses += 1;
    await stopCapture();
    return async () => {
      sharedMicPauses = Math.max(0, sharedMicPauses - 1);
      await syncCapture();
    };
  }

  function playWakeChime() {
    try {
      const AudioContextClass = root.AudioContext || root.webkitAudioContext;
      if (!AudioContextClass) return;
      const audioContext = new AudioContextClass();
      const start = audioContext.currentTime + 0.01;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(720, start);
      oscillator.frequency.exponentialRampToValueAtTime(1080, start + 0.16);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.25);
      oscillator.onended = () => audioContext.close().catch(() => {});
    } catch (error) {
      console.warn('[VOICE] Wake chime unavailable:', error.message);
    }
  }

  function beginCommandCapture() {
    if (!stream) return;
    heardText = '';
    wakeChunkParts = [];
    wakeSampleCount = 0;
    presence.showText('', '');
    presence.setState('wake');
    presence.setLevel(0.25);
    playWakeChime();
    const capture = {
      chunks: [],
      vad: root.DaylightVoiceVad.createVoiceVad({ noiseFloor, sensitivity: settings.sensitivity })
    };
    commandCapture = capture;
    setTimeout(() => {
      if (stream && commandCapture === capture) presence.setState('listening');
    }, 120);
    if (typeof root.wakeScreen === 'function') root.wakeScreen();
  }

  function stopReplyAudio() {
    cancelAnimationFrame(replyLevelFrame);
    replyLevelFrame = null;
    if (replyPlayer) {
      replyPlayer.pause();
      replyPlayer.removeAttribute('src');
    }
    if ('speechSynthesis' in root) root.speechSynthesis.cancel();
    presence?.setLevel(0);
  }

  function finishSpeaking() {
    presence.setLevel(0);
    presence.setState('idle');
  }

  function monitorReplyLevel() {
    if (!replyAnalyser || !replyPlayer || replyPlayer.paused) return;
    const samples = new Uint8Array(replyAnalyser.fftSize);
    replyAnalyser.getByteTimeDomainData(samples);
    let total = 0;
    samples.forEach(sample => { const value = (sample - 128) / 128; total += value * value; });
    presence.setLevel(Math.min(1, Math.sqrt(total / samples.length) * 4));
    replyLevelFrame = requestAnimationFrame(monitorReplyLevel);
  }

  async function speakReply({ text, audioUrl }) {
    stopReplyAudio();
    presence.showText(heardText, text || '');
    presence.setState('speaking');
    if (!audioUrl) {
      if ('speechSynthesis' in root && text) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onend = finishSpeaking;
        utterance.onerror = finishSpeaking;
        root.speechSynthesis.speak(utterance);
      } else finishSpeaking();
      return;
    }
    try {
      const AudioContextClass = root.AudioContext || root.webkitAudioContext;
      replyPlayer = replyPlayer || new Audio();
      replyPlayer.src = audioUrl;
      replyPlayer.crossOrigin = 'anonymous';
      if (AudioContextClass) {
        replyContext = replyContext || new AudioContextClass();
        replyAnalyser = replyAnalyser || replyContext.createAnalyser();
        replyAnalyser.fftSize = 256;
        if (!replySource) {
          replySource = replyContext.createMediaElementSource(replyPlayer);
          replySource.connect(replyAnalyser).connect(replyContext.destination);
        }
        await replyContext.resume();
      }
      replyPlayer.onended = finishSpeaking;
      replyPlayer.onerror = () => {
        console.warn('[VOICE] Piper audio could not be played');
        finishSpeaking();
      };
      await replyPlayer.play();
      monitorReplyLevel();
    } catch (error) {
      console.warn('[VOICE] Reply playback failed:', error.message);
      finishSpeaking();
    }
  }

  function navigateTo(page) {
    document.querySelector(`.tab-item[data-tab-target="${page}-content"]`)?.click();
  }

  function handleAction(action) {
    if (action?.type === 'navigate') navigateTo(action.page);
    if (action?.type === 'school-menu') {
      navigateTo('calendar');
      setTimeout(() => document.getElementById('school-menu-button')?.click(), 350);
    }
    if (action?.type === 'dim' && typeof root.dimScreen === 'function') root.dimScreen();
    if (action?.type === 'wake' && typeof root.wakeScreen === 'function') root.wakeScreen();
    if (action?.type === 'cancel') {
      stopReplyAudio();
      commandCapture = null;
      presence.setState('idle');
    }
  }

  function renderStatus(statusValue) {
    const line = document.getElementById('voice-settings-status');
    if (!line) return;
    const copy = {
      disabled: 'Voice assistant is off.',
      listening: 'Listening for the wake word.',
      'mic-off': 'Voice is enabled, but this panel’s microphone is off.',
      'mic-unavailable': 'The panel microphone is unavailable. Check its permissions.',
      'wake-unavailable': 'Wake word unavailable. Check Home Assistant and the add-on logs.',
      'ha-unreachable': 'Home Assistant is unreachable.'
    };
    line.textContent = copy[statusValue] || 'Checking voice status…';
    line.dataset.status = statusValue || 'checking';
  }

  function attachSocket(nextSocket) {
    if (!nextSocket || socket === nextSocket) return;
    socket = nextSocket;
    socket.on('connect', () => { void syncCapture(); });
    socket.on('disconnect', () => {
      void stopCapture();
      renderStatus('ha-unreachable');
      presence.showText(heardText, 'Voice connection lost. Reconnecting…');
      presence.setState('error');
      updateMicButton();
    });
    socket.on('voice:status', payload => renderStatus(payload?.status));
    socket.on('voice:settings', payload => {
      settings = { ...settings, ...payload };
      updateMicButton();
      void syncCapture();
    });
    socket.on('voice:wake', beginCommandCapture);
    socket.on('voice:transcript', payload => {
      heardText = String(payload?.text || '');
      presence.showText(heardText, '');
    });
    socket.on('voice:thinking', () => presence.setState('thinking'));
    socket.on('voice:reply', payload => { void speakReply(payload || {}); });
    socket.on('voice:error', payload => {
      presence.showText(heardText, String(payload?.message || 'Voice assistant unavailable.'));
      presence.setState('error');
    });
    socket.on('voice:action', handleAction);
    void loadSettings();
  }

  async function loadSettings() {
    try {
      const response = await fetch('api/voice/settings', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Voice settings could not be loaded.');
      settings = { ...settings, ...data };
      renderStatus(data.status);
      updateMicButton();
      await syncCapture();
      return data;
    } catch (error) {
      renderStatus('ha-unreachable');
      return null;
    }
  }

  function fillSelect(select, options, value, valueKey) {
    if (!select) return;
    select.replaceChildren();
    options.forEach(item => {
      const option = document.createElement('option');
      option.value = item[valueKey];
      option.textContent = item.name || item[valueKey];
      select.append(option);
    });
    if (value && ![...select.options].some(option => option.value === value)) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = `${value} (not currently available)`;
      select.append(option);
    }
    select.value = value || '';
  }

  async function initializeSettings() {
    const form = document.getElementById('voice-settings-form');
    if (!form || form.dataset.bound === 'true') return;
    form.dataset.bound = 'true';
    document.getElementById('voice-sensitivity').addEventListener('input', event => {
      document.getElementById('voice-sensitivity-value').textContent = `${Math.round(Number(event.target.value) * 100)}%`;
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      root.requestAdminAuthorization({
        title: 'Save voice assistant',
        prompt: 'Verify parent access to change the always-listening microphone.',
        onAuthorized: saveVoiceSettings
      });
    });
    const data = await loadSettings();
    if (!data) return;
    document.getElementById('voice-enabled').checked = data.enabled;
    document.getElementById('voice-mute-while-dimmed').checked = data.muteWhileDimmed;
    document.getElementById('voice-sensitivity').value = String(data.sensitivity);
    document.getElementById('voice-sensitivity-value').textContent = `${Math.round(data.sensitivity * 100)}%`;
    fillSelect(document.getElementById('voice-wake-word'), data.wakeWords || [], data.wakeWordId, 'id');
    fillSelect(document.getElementById('voice-agent'), data.agents || [], data.agentId, 'entityId');
  }

  async function saveVoiceSettings() {
    const status = document.getElementById('voice-settings-status');
    status.textContent = 'Saving voice assistant settings…';
    status.dataset.status = 'saving';
    try {
      const data = await root.screenTimeRequest('api/voice/settings', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: document.getElementById('voice-enabled').checked,
          wakeWordId: document.getElementById('voice-wake-word').value,
          agentId: document.getElementById('voice-agent').value,
          sensitivity: Number(document.getElementById('voice-sensitivity').value),
          muteWhileDimmed: document.getElementById('voice-mute-while-dimmed').checked
        })
      });
      root.touchAdminSession?.();
      settings = { ...settings, ...data };
      status.textContent = 'Voice assistant settings saved.';
      status.dataset.status = 'saved';
      await syncCapture();
    } catch (error) {
      status.textContent = error.status === 403 ? 'Parent check expired — tap Save again.' : error.message;
      status.dataset.status = 'save-error';
    }
  }

  function initialize() {
    presence = root.DaylightVoicePresence.createPresence();
    const button = document.getElementById('voice-mic-toggle');
    button?.addEventListener('click', () => {
      micEnabled = !micEnabled;
      try { localStorage.setItem(MIC_STORAGE_KEY, String(micEnabled)); }
      catch (error) { console.warn('[VOICE] Could not persist the microphone preference'); }
      if (!micEnabled) {
        stopReplyAudio();
        presence.setState('idle');
      }
      updateMicButton();
      void syncCapture();
    });
    updateMicButton();
    document.addEventListener('visibilitychange', () => { void syncCapture(); });
    const dimmer = document.getElementById('screen-dimmer');
    if (dimmer && root.MutationObserver) {
      dimObserver = new MutationObserver(() => { void syncCapture(); });
      dimObserver.observe(dimmer, { attributes: true, attributeFilter: ['class'] });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();

  root.DaylightVoice = { attachSocket, initializeSettings, pauseForSharedMic, syncCapture };
}(window));

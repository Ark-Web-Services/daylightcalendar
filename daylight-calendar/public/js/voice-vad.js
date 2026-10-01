'use strict';

(function exposeVoiceVad(root) {
  function rms(samples) {
    if (!samples || !samples.length) return 0;
    let total = 0;
    for (let index = 0; index < samples.length; index += 1) total += samples[index] * samples[index];
    return Math.sqrt(total / samples.length);
  }

  function createVoiceVad({
    noiseFloor = 0.008,
    sensitivity = 0.55,
    silenceMs = 800,
    noSpeechMs = 4000,
    maxMs = 8000,
    speechFrames = 2
  } = {}) {
    const safeSensitivity = Math.max(0, Math.min(1, Number(sensitivity) || 0));
    const threshold = Math.max(0.008 + (1 - safeSensitivity) * 0.012, noiseFloor * (3.2 - safeSensitivity * 1.7));
    let startedAt = null;
    let speechStarted = false;
    let consecutiveSpeech = 0;
    let silentSince = null;

    function push(samples, atMs) {
      if (startedAt === null) startedAt = atMs;
      const elapsed = atMs - startedAt;
      const level = rms(samples);
      const speech = level >= threshold;

      if (!speechStarted) {
        consecutiveSpeech = speech ? consecutiveSpeech + 1 : 0;
        if (consecutiveSpeech >= speechFrames) {
          speechStarted = true;
          silentSince = null;
        }
        if (!speechStarted && elapsed >= noSpeechMs) return { state: 'no-speech', level, threshold };
      } else if (speech) {
        silentSince = null;
      } else {
        if (silentSince === null) silentSince = atMs;
        if (atMs - silentSince >= silenceMs) return { state: 'complete', level, threshold };
      }

      if (elapsed >= maxMs) return { state: speechStarted ? 'complete' : 'no-speech', level, threshold };
      return { state: speechStarted ? 'speech' : 'waiting', level, threshold };
    }

    return { push, threshold, get speechStarted() { return speechStarted; } };
  }

  const api = { createVoiceVad, rms };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DaylightVoiceVad = api;
}(typeof window !== 'undefined' ? window : null));

'use strict';

(function exposeDaylightAudio(root) {
  function downsampleMono(samples, inputRate, outputRate = 16000) {
    if (!(samples instanceof Float32Array)) samples = new Float32Array(samples || []);
    if (!Number.isFinite(inputRate) || inputRate <= 0 || !Number.isFinite(outputRate) || outputRate <= 0) {
      throw new Error('Sample rates must be positive numbers');
    }
    if (inputRate === outputRate) return new Float32Array(samples);
    if (inputRate < outputRate) throw new Error('Input sample rate must be at least the output sample rate');

    const ratio = inputRate / outputRate;
    const outputLength = Math.floor(samples.length / ratio);
    const output = new Float32Array(outputLength);
    for (let index = 0; index < outputLength; index += 1) {
      const start = Math.floor(index * ratio);
      const end = Math.max(start + 1, Math.min(samples.length, Math.floor((index + 1) * ratio)));
      let sum = 0;
      for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) sum += samples[sourceIndex];
      output[index] = sum / (end - start);
    }
    return output;
  }

  function encodePcm16Wav(samples, sampleRate = 16000) {
    if (!(samples instanceof Float32Array)) samples = new Float32Array(samples || []);
    const bytesPerSample = 2;
    const dataSize = samples.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    const writeAscii = (offset, value) => {
      for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
    };

    writeAscii(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeAscii(8, 'WAVE');
    writeAscii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeAscii(36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (const sample of samples) {
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += bytesPerSample;
    }
    return buffer;
  }

  const api = { downsampleMono, encodePcm16Wav };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DaylightAudio = api;
}(typeof window !== 'undefined' ? window : null));

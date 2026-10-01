'use strict';

// Speech-to-text through Home Assistant's websocket: an Assist pipeline run with only the STT
// stage. The REST endpoint (POST /api/stt/<engine>) can't be used from the add-on — the
// Supervisor's Core proxy answers it with 400 (verified 2026-10-01) — while websocket binary
// frames pass through the same proxy, which is how the wake word already streams.

class PipelineSttError extends Error {}

function parseWav(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new PipelineSttError('Audio is not a WAV recording');
  }
  let offset = 12;
  let format = null;
  let data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= buffer.length) {
      format = {
        audioFormat: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14)
      };
    } else if (id === 'data') {
      data = buffer.subarray(body, Math.min(buffer.length, body + size));
      break;
    }
    offset = body + size + (size % 2);
  }
  if (!format || !data) throw new PipelineSttError('WAV recording has no audio');
  if (format.audioFormat !== 1 || format.channels !== 1 || format.bitsPerSample !== 16) {
    throw new PipelineSttError('WAV recording must be 16-bit mono PCM');
  }
  return { sampleRate: format.sampleRate, pcm: data };
}

// Resolves with the transcript ('' when Home Assistant heard no words).
async function transcribeViaPipeline(client, wavBuffer, { timeoutMs = 15000, chunkBytes = 4096 } = {}) {
  const { sampleRate, pcm } = parseWav(wavBuffer);
  return new Promise((resolve, reject) => {
    let run = null;
    let settled = false;
    const finish = (error, text) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      run?.stop();
      if (error) reject(error);
      else resolve(text);
    };
    const timer = setTimeout(() => finish(new PipelineSttError('Speech recognition is not answering right now.')), timeoutMs);
    client.sendEventCommand('assist_pipeline/run', {
      start_stage: 'stt',
      end_stage: 'stt',
      input: { sample_rate: sampleRate }
    }, event => {
      if (event?.type === 'run-start') {
        const handlerId = event.data?.runner_data?.stt_binary_handler_id;
        (async () => {
          for (let offset = 0; offset < pcm.length; offset += chunkBytes) {
            await client.sendBinary(handlerId, pcm.subarray(offset, offset + chunkBytes));
          }
          await client.sendBinary(handlerId, Buffer.alloc(0)); // a frame of just the handler byte ends the audio
        })().catch(error => finish(error));
      } else if (event?.type === 'stt-end') {
        finish(null, String(event.data?.stt_output?.text || '').trim());
      } else if (event?.type === 'error') {
        finish(new PipelineSttError(event.data?.message || 'Speech recognition failed'));
      } else if (event?.type === 'run-end') {
        finish(null, '');
      }
    }).then(started => {
      run = started;
      if (settled) started.stop();
    }).catch(error => finish(error));
  });
}

module.exports = { PipelineSttError, parseWav, transcribeViaPipeline };

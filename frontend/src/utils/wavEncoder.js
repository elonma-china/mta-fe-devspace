// src/utils/wavEncoder.js
//
// Encode captured microphone audio as 16 kHz mono 16-bit PCM WAV.
//
// Why WAV and not MediaRecorder: Chrome's MediaRecorder produces
// `audio/webm;codecs=opus`, and the speech-to-text service hands anything
// that is not WAV to ffmpeg — which is not installed on the Dev Space host,
// so every recording would come back 503. A WAV takes the service's
// dependency-free stdlib decode path, and it is byte-identical across
// browsers, so what we test is what ships.
//
// 16 kHz mono is the rate the STT models were trained at; sending 48 kHz
// just makes the upload 3x bigger for the same transcript.

/** Bytes per sample in the output. 16-bit signed PCM. */
const BYTES_PER_SAMPLE = 2;

/** The target sample rate. Matches what the STT engines expect. */
export const TARGET_SAMPLE_RATE = 16000;

/**
 * Flatten a list of Float32Array capture buffers into one array.
 *
 * @param {Float32Array[]} chunks - Buffers in capture order.
 * @returns {Float32Array} All samples, concatenated.
 */
function concatChunks(chunks) {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;

  const out = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Resample by linear interpolation.
 *
 * Deliberately not a windowed-sinc resampler: the input is already band-
 * limited by the capture path, the output feeds a speech recogniser rather
 * than a listener, and a naive drop-sample resampler audibly aliases. Linear
 * is the cheapest thing that does not hurt recognition.
 *
 * @param {Float32Array} samples - Input samples.
 * @param {number} fromRate - Input sample rate in Hz.
 * @param {number} toRate - Output sample rate in Hz.
 * @returns {Float32Array} Resampled samples.
 */
export function resample(samples, fromRate, toRate) {
  if (fromRate === toRate || samples.length === 0) return samples;

  const ratio = fromRate / toRate;
  const outLength = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLength);

  for (let i = 0; i < outLength; i += 1) {
    const src = i * ratio;
    const left = Math.floor(src);
    const right = Math.min(left + 1, samples.length - 1);
    const weight = src - left;
    out[i] = samples[left] * (1 - weight) + samples[right] * weight;
  }
  return out;
}

/**
 * Write an ASCII string into a DataView.
 *
 * @param {DataView} view - Target view.
 * @param {number} offset - Byte offset to write at.
 * @param {string} text - ASCII text.
 */
function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/**
 * Encode float samples as mono 16-bit PCM WAV bytes at 16 kHz.
 *
 * Split out from {@link float32ToWav16k} so the header and sample maths can
 * be asserted directly — jsdom's Blob has no `arrayBuffer()`, so a test that
 * went through the Blob could only check its size.
 *
 * @param {Float32Array[]} chunks - Captured buffers, in order, in [-1, 1].
 * @param {number} sampleRate - The rate `chunks` were captured at.
 * @returns {ArrayBuffer} A complete WAV file: 44-byte header plus samples.
 */
export function encodeWav16k(chunks, sampleRate) {
  const merged = concatChunks(chunks);
  const samples = resample(merged, sampleRate, TARGET_SAMPLE_RATE);

  const dataBytes = samples.length * BYTES_PER_SAMPLE;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const byteRate = TARGET_SAMPLE_RATE * BYTES_PER_SAMPLE;

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true); // chunk size, excluding "RIFF" + itself
  writeAscii(view, 8, "WAVE");

  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // format 1 = PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, TARGET_SAMPLE_RATE, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, BYTES_PER_SAMPLE, true); // block align
  view.setUint16(34, 8 * BYTES_PER_SAMPLE, true); // bits per sample

  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  // Clamp before scaling. A capture path with gain applied can exceed [-1, 1],
  // and letting it wrap turns a loud syllable into white noise.
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(
      44 + i * BYTES_PER_SAMPLE,
      clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
      true
    );
  }

  return buffer;
}

/**
 * Encode float samples as a mono 16-bit PCM WAV blob at 16 kHz.
 *
 * @param {Float32Array[]} chunks - Captured buffers, in order, in [-1, 1].
 * @param {number} sampleRate - The rate `chunks` were captured at.
 * @returns {Blob} An `audio/wav` blob with a 44-byte RIFF header.
 */
export function float32ToWav16k(chunks, sampleRate) {
  return new Blob([encodeWav16k(chunks, sampleRate)], { type: "audio/wav" });
}

/**
 * Duration of a capture, in seconds.
 *
 * @param {Float32Array[]} chunks - Captured buffers.
 * @param {number} sampleRate - Capture rate in Hz.
 * @returns {number} Seconds of audio.
 */
export function chunkDurationSeconds(chunks, sampleRate) {
  if (!sampleRate) return 0;
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  return total / sampleRate;
}

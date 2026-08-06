import {
  encodeWav16k,
  float32ToWav16k,
  resample,
  chunkDurationSeconds,
  TARGET_SAMPLE_RATE,
} from "../wavEncoder";

/** Encode and view the result, so the header can be asserted field by field. */
const headerOf = (chunks, sampleRate) =>
  new DataView(encodeWav16k(chunks, sampleRate));

const ascii = (view, offset, length) =>
  String.fromCharCode(
    ...Array.from({ length }, (_, i) => view.getUint8(offset + i))
  );

describe("encodeWav16k", () => {
  test("writes a 44-byte RIFF/WAVE header the stdlib decoder accepts", () => {
    // The STT service only skips ffmpeg for files its stdlib `wave` module
    // can open. Every field below is one that module validates.
    const view = headerOf([new Float32Array(1600).fill(0.5)], TARGET_SAMPLE_RATE);

    expect(ascii(view, 0, 4)).toBe("RIFF");
    expect(ascii(view, 8, 4)).toBe("WAVE");
    expect(ascii(view, 12, 4)).toBe("fmt ");
    expect(ascii(view, 36, 4)).toBe("data");

    expect(view.getUint16(20, true)).toBe(1); // format 1 = PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(TARGET_SAMPLE_RATE);
    expect(view.getUint32(28, true)).toBe(TARGET_SAMPLE_RATE * 2); // byte rate
    expect(view.getUint16(32, true)).toBe(2); // block align
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(view.getUint32(40, true)).toBe(1600 * 2); // data size
    expect(view.getUint32(4, true)).toBe(36 + 1600 * 2); // riff size
  });

  test("resamples a 48 kHz capture down to 16 kHz", () => {
    // Browsers may ignore the requested context rate; the encoder is what
    // guarantees the service gets 16 kHz regardless.
    const view = headerOf([new Float32Array(48000)], 48000);

    expect(view.getUint32(24, true)).toBe(TARGET_SAMPLE_RATE);
    expect(view.getUint32(40, true)).toBe(16000 * 2); // one second, still
  });

  test("concatenates capture buffers in order", () => {
    const view = headerOf(
      [new Float32Array(100), new Float32Array(60)],
      TARGET_SAMPLE_RATE
    );
    expect(view.getUint32(40, true)).toBe(160 * 2);
  });

  test("clamps out-of-range samples instead of letting them wrap", () => {
    // A gained capture path can exceed [-1, 1]. Without the clamp these wrap
    // to the opposite sign and a loud syllable becomes noise.
    const view = headerOf([new Float32Array([2.5, -2.5])], TARGET_SAMPLE_RATE);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });

  test("survives an empty capture", () => {
    const view = headerOf([], TARGET_SAMPLE_RATE);
    expect(view.byteLength).toBe(44);
    expect(view.getUint32(40, true)).toBe(0);
  });
});

describe("float32ToWav16k", () => {
  test("wraps the bytes in an audio/wav blob of the same size", () => {
    const chunks = [new Float32Array(320)];
    const blob = float32ToWav16k(chunks, TARGET_SAMPLE_RATE);

    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBe(encodeWav16k(chunks, TARGET_SAMPLE_RATE).byteLength);
  });
});

describe("resample", () => {
  test("is a no-op when the rates already match", () => {
    const samples = new Float32Array([0.1, 0.2]);
    expect(resample(samples, 16000, 16000)).toBe(samples);
  });

  test("interpolates rather than dropping samples", () => {
    const out = resample(new Float32Array([0, 1, 0, 1]), 32000, 16000);
    expect(out.length).toBe(2);
    expect(out[0]).toBeCloseTo(0);
    expect(out[1]).toBeCloseTo(0);
  });

  test("handles an empty input", () => {
    expect(resample(new Float32Array(), 48000, 16000).length).toBe(0);
  });
});

describe("chunkDurationSeconds", () => {
  test("counts across buffers", () => {
    expect(
      chunkDurationSeconds(
        [new Float32Array(8000), new Float32Array(8000)],
        16000
      )
    ).toBe(1);
  });

  test("returns 0 rather than NaN when the rate is unknown", () => {
    expect(chunkDurationSeconds([new Float32Array(10)], 0)).toBe(0);
  });
});

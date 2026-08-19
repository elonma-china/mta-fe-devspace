// src/hooks/useVoiceRecorder.js
import { useCallback, useEffect, useRef, useState } from "react";
import { float32ToWav16k, TARGET_SAMPLE_RATE } from "utils/wavEncoder";

/** Auto-stop after this long. A voice query is a sentence, not a monologue. */
export const MAX_SECONDS = 120;

/**
 * Upload ceiling, mirroring the gateway's `_STT_MAX_UPLOAD` and the serving
 * tier's `STT_MAX_AUDIO_BYTES`. At 16 kHz mono 16-bit (32 kB/s) the
 * MAX_SECONDS limit caps a recording near 3.8 MB, so this only fires if a
 * browser ignores the requested sample rate by a wide margin.
 */
export const MAX_BYTES = 26 * 1024 * 1024;

export const RECORDER_STATE = {
  IDLE: "idle",
  REQUESTING: "requesting",
  RECORDING: "recording",
  ENCODING: "encoding",
  ERROR: "error",
};

/**
 * The AudioWorklet processor, shipped as source text and loaded from a blob
 * URL. Keeping it inline rather than in `public/` means the feature is one
 * import with no build-config or PUBLIC_URL path to get wrong — which matters
 * because a missing worklet file fails at runtime, on the user's first click.
 */
const PCM_WORKLET_SOURCE = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) this.port.postMessage(new Float32Array(channel));
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
`;

/** Vietnamese copy per failure mode. A dead button teaches the user nothing. */
const ERROR_MESSAGES = {
  insecure:
    "Trình duyệt chỉ cho dùng micro trên HTTPS hoặc localhost. " +
    "Hãy mở qua localhost (ssh -L) rồi thử lại.",
  NotAllowedError:
    "Trình duyệt đã chặn micro. Cho phép trong thanh địa chỉ rồi thử lại.",
  PermissionDeniedError:
    "Trình duyệt đã chặn micro. Cho phép trong thanh địa chỉ rồi thử lại.",
  NotFoundError: "Không tìm thấy micro nào trên máy.",
  DevicesNotFoundError: "Không tìm thấy micro nào trên máy.",
  NotReadableError: "Micro đang được ứng dụng khác sử dụng.",
  tooLarge: "Đoạn ghi âm quá dài.",
  generic: "Không ghi âm được. Kiểm tra lại micro rồi thử lại.",
};

/** Whether this page can use `getUserMedia` at all (HTTPS or localhost). */
export function isRecordingSupported() {
  return Boolean(
    typeof navigator !== "undefined" &&
      navigator.mediaDevices &&
      navigator.mediaDevices.getUserMedia
  );
}

/**
 * Record microphone audio and return it as a 16 kHz mono WAV blob.
 *
 * Encoding happens in the browser rather than using MediaRecorder — see the
 * header of `utils/wavEncoder.js` for why that is not a stylistic choice.
 *
 * @param {object} [options]
 * @param {(blob: Blob) => void} [options.onComplete] - Called with the WAV.
 * @returns {{
 *   state: string, elapsedSeconds: number, error: string|null,
 *   isSupported: boolean, start: () => Promise<void>, stop: () => void,
 *   cancel: () => void, reset: () => void
 * }}
 */
export function useVoiceRecorder({ onComplete } = {}) {
  const [state, setState] = useState(RECORDER_STATE.IDLE);
  const [elapsedSeconds, setElapsed] = useState(0);
  const [error, setError] = useState(null);

  const streamRef = useRef(null);
  const contextRef = useRef(null);
  /**
   * AnalyserNode của lượt ghi hiện tại, hoặc null.
   *
   * Phơi qua REF chứ không qua state có chủ đích: bộ vẽ phổ đọc nó trong
   * requestAnimationFrame ~60 lần/giây. Nếu đưa vào state thì mỗi khung là
   * một lần render toàn bộ cây chat — treo máy vì một hiệu ứng trang trí.
   */
  const analyserRef = useRef(null);

  const nodesRef = useRef([]);
  const chunksRef = useRef([]);
  const workletUrlRef = useRef(null);
  const timerRef = useRef(null);
  const discardRef = useRef(false);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  /**
   * Release the microphone and every audio object built for one recording.
   *
   * Called from stop, from cancel, from the error path and from unmount. A
   * missed call here leaves the browser's recording indicator lit and the
   * device held against other applications, so it is deliberately idempotent
   * and never throws.
   */
  const teardown = useCallback(() => {
    analyserRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    for (const node of nodesRef.current) {
      try {
        node.disconnect();
        if (node.port) node.port.onmessage = null;
        node.onaudioprocess = null;
      } catch {
        /* already torn down */
      }
    }
    nodesRef.current = [];

    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (contextRef.current) {
      contextRef.current.close().catch(() => {});
      contextRef.current = null;
    }
    if (workletUrlRef.current) {
      URL.revokeObjectURL(workletUrlRef.current);
      workletUrlRef.current = null;
    }
  }, []);

  const fail = useCallback(
    (key) => {
      teardown();
      chunksRef.current = [];
      setError(ERROR_MESSAGES[key] || ERROR_MESSAGES.generic);
      setState(RECORDER_STATE.ERROR);
    },
    [teardown]
  );

  /** Turn the captured buffers into a WAV and hand it to the caller. */
  const finish = useCallback(() => {
    const context = contextRef.current;
    const sampleRate = context ? context.sampleRate : TARGET_SAMPLE_RATE;
    const chunks = chunksRef.current;

    teardown();
    chunksRef.current = [];

    if (discardRef.current || chunks.length === 0) {
      setState(RECORDER_STATE.IDLE);
      setElapsed(0);
      return;
    }

    setState(RECORDER_STATE.ENCODING);
    const blob = float32ToWav16k(chunks, sampleRate);
    if (blob.size > MAX_BYTES) {
      setError(ERROR_MESSAGES.tooLarge);
      setState(RECORDER_STATE.ERROR);
      return;
    }

    setState(RECORDER_STATE.IDLE);
    setElapsed(0);
    if (onCompleteRef.current) onCompleteRef.current(blob);
  }, [teardown]);

  const stop = useCallback(() => {
    discardRef.current = false;
    finish();
  }, [finish]);

  const cancel = useCallback(() => {
    discardRef.current = true;
    finish();
  }, [finish]);

  const reset = useCallback(() => {
    setError(null);
    setState(RECORDER_STATE.IDLE);
    setElapsed(0);
  }, []);

  const start = useCallback(async () => {
    if (!isRecordingSupported()) {
      fail("insecure");
      return;
    }

    setError(null);
    discardRef.current = false;
    chunksRef.current = [];
    setState(RECORDER_STATE.REQUESTING);

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
    } catch (err) {
      fail(err && err.name);
      return;
    }
    streamRef.current = stream;

    try {
      // Ask for the target rate directly. Browsers that honour it save the
      // resample entirely; the ones that do not are handled by the encoder,
      // which reads the context's actual sampleRate.
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const context = new AudioCtx({ sampleRate: TARGET_SAMPLE_RATE });
      contextRef.current = context;

      const source = context.createMediaStreamSource(stream);
      const collect = (samples) => chunksRef.current.push(samples);

      // Nhánh riêng cho việc hiển thị: analyser chỉ ĐỌC tín hiệu, không nằm
      // trên đường thu, nên có hay không cũng không ảnh hưởng dữ liệu gửi lên
      // STT. fftSize 512 -> 256 bin, đủ mịn cho một dải cột mà vẫn rẻ.
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      analyserRef.current = analyser;

      if (context.audioWorklet) {
        const blob = new Blob([PCM_WORKLET_SOURCE], {
          type: "application/javascript",
        });
        workletUrlRef.current = URL.createObjectURL(blob);
        await context.audioWorklet.addModule(workletUrlRef.current);

        const worklet = new window.AudioWorkletNode(context, "pcm-capture");
        worklet.port.onmessage = (event) => collect(event.data);
        source.connect(worklet);
        // Not connected to the destination: routing the mic to the speakers
        // is a feedback loop, and the worklet pulls without it.
        nodesRef.current = [source, worklet, analyser];
      } else {
        // Safari < 14.1 and friends. Deprecated, but the alternative here is
        // no microphone at all.
        const processor = context.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (event) =>
          collect(new Float32Array(event.inputBuffer.getChannelData(0)));
        source.connect(processor);
        processor.connect(context.destination);
        nodesRef.current = [source, processor, analyser];
      }
    } catch {
      fail("generic");
      return;
    }

    setElapsed(0);
    setState(RECORDER_STATE.RECORDING);
    timerRef.current = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 1;
        if (next >= MAX_SECONDS) stop();
        return next;
      });
    }, 1000);
  }, [fail, stop]);

  // Unmounting mid-recording must still release the device.
  useEffect(() => teardown, [teardown]);

  return {
    state,
    elapsedSeconds,
    error,
    /** Ref tới AnalyserNode để vẽ phổ; null khi không ghi. */
    analyserRef,
    isSupported: isRecordingSupported(),
    start,
    stop,
    cancel,
    reset,
  };
}

export default useVoiceRecorder;

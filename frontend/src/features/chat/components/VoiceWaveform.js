// src/features/chat/components/VoiceWaveform.js
import React, { useEffect, useRef } from "react";
import "./VoiceWaveform.css";

/** Số cột. 24 đủ để thấy nhịp nói mà không thành một mảng nhoè. */
const BARS = 24;

/**
 * Dưới ngưỡng này coi như im lặng — micro luôn có nhiễu nền, không có ngưỡng
 * thì các cột lúc nào cũng rung nhẹ và người dùng không phân biệt được
 * "đang nghe thấy tôi" với "đang bật".
 */
const SILENCE_RMS = 0.012;

/**
 * Phổ âm thanh trực tiếp trong lúc ghi.
 *
 * Mục đích không phải trang trí: đây là phản hồi duy nhất cho câu hỏi "máy có
 * nghe thấy tôi không". Không có nó, người dùng nói xong mới biết mic bị tắt
 * tiếng hay đặt sai thiết bị — và bộ eval cho thấy câu ngắn là loại dễ nhận
 * dạng sai nhất, tức là loại cần nói lại nhiều nhất.
 *
 * Vẽ trong requestAnimationFrame và đọc analyser qua REF, không qua state: một
 * lần setState mỗi khung sẽ render lại cả cây chat 60 lần/giây.
 *
 * @param {object} props
 * @param {{current: AnalyserNode|null}} props.analyserRef
 * @param {boolean} props.active - Đang ghi hay không.
 */
export default function VoiceWaveform({ analyserRef, active }) {
    const canvasRef = useRef(null);
    const rafRef = useRef(null);
    // Giữ mức của từng cột giữa các khung để cột rơi mềm thay vì nhảy giật.
    const levelsRef = useRef(new Array(BARS).fill(0));

    useEffect(() => {
        if (!active) return undefined;

        const canvas = canvasRef.current;
        if (!canvas) return undefined;
        const ctx = canvas.getContext("2d");
        // null khi môi trường không có canvas 2d (jsdom, hoặc trình duyệt chặn).
        // Bỏ qua phần vẽ thay vì ném — nút micro vẫn phải bấm được.
        if (!ctx) return undefined;
        // `analyserRef?.` chứ không chỉ `.current?.`: hook có thể chưa trả ref
        // (mock trong test, hoặc bản hook cũ hơn), và một hiệu ứng trang trí
        // tuyệt đối không được làm hỏng nút micro.
        const data = new Uint8Array(
            analyserRef?.current?.frequencyBinCount || 256
        );

        // Màu lấy từ token qua computedStyle: skin đỏ Dev Space đổi token, nên
        // hardcode màu ở đây sẽ làm phổ lệch màu thương hiệu (và phạm luật
        // "không hardcode màu" của project).
        const styles = getComputedStyle(canvas);
        const barColor =
            styles.getPropertyValue("--brand-primary").trim() || "#226355";
        const idleColor =
            styles.getPropertyValue("--border-neutral-secondary").trim() ||
            "#d0d5dd";

        const draw = () => {
            rafRef.current = requestAnimationFrame(draw);
            const analyser = analyserRef?.current;

            const dpr = window.devicePixelRatio || 1;
            const w = canvas.clientWidth;
            const h = canvas.clientHeight;
            if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
                canvas.width = w * dpr;
                canvas.height = h * dpr;
            }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, h);

            let rms = 0;
            if (analyser) {
                analyser.getByteFrequencyData(data);
                // Gộp các bin thành BARS cột. Bỏ nửa dải trên: giọng người gần
                // như không có năng lượng ở đó, giữ lại chỉ làm phổ phẳng lì.
                const usable = Math.floor(data.length * 0.55);
                const per = Math.max(1, Math.floor(usable / BARS));
                for (let i = 0; i < BARS; i += 1) {
                    let sum = 0;
                    for (let j = 0; j < per; j += 1) {
                        sum += data[i * per + j] || 0;
                    }
                    const v = sum / per / 255;
                    rms += v * v;
                    // Lên nhanh, xuống chậm — mắt đọc nhịp nói dễ hơn.
                    levelsRef.current[i] =
                        v > levelsRef.current[i]
                            ? v
                            : levelsRef.current[i] * 0.82;
                }
                rms = Math.sqrt(rms / BARS);
            }

            const quiet = rms < SILENCE_RMS;
            ctx.fillStyle = quiet ? idleColor : barColor;

            const gap = 2;
            const barW = Math.max(1, (w - gap * (BARS - 1)) / BARS);
            for (let i = 0; i < BARS; i += 1) {
                // Sàn 12% để khi im lặng vẫn thấy một dải mảnh: dải phẳng nói
                // "đang bật, chưa nghe thấy gì", còn canvas trắng trơn thì
                // giống như tính năng bị lỗi.
                const level = quiet ? 0.12 : Math.max(0.12, levelsRef.current[i]);
                const barH = Math.max(2, level * h);
                const x = i * (barW + gap);
                const y = (h - barH) / 2;
                const r = Math.min(barW / 2, 2);
                ctx.beginPath();
                ctx.roundRect?.(x, y, barW, barH, r);
                if (ctx.roundRect) ctx.fill();
                else ctx.fillRect(x, y, barW, barH);
            }
        };

        draw();
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
            levelsRef.current = new Array(BARS).fill(0);
        };
    }, [active, analyserRef]);

    if (!active) return null;

    return (
        <canvas
            ref={canvasRef}
            className="vw-canvas"
            aria-hidden="true"
            data-testid="voice-waveform"
        />
    );
}

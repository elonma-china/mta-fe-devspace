import React from "react";
import { render, screen } from "@testing-library/react";
import VoiceWaveform from "../VoiceWaveform";

/** jsdom không có canvas 2d thật — stub đủ những lệnh component gọi. */
const stubCanvas = () => {
  const calls = { fillRect: 0, roundRect: 0, clearRect: 0 };
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
    setTransform: jest.fn(),
    clearRect: jest.fn(() => (calls.clearRect += 1)),
    fillRect: jest.fn(() => (calls.fillRect += 1)),
    beginPath: jest.fn(),
    fill: jest.fn(),
    roundRect: jest.fn(() => (calls.roundRect += 1)),
    fillStyle: "",
  }));
  return calls;
};

const analyser = (level = 200) => ({
  current: {
    frequencyBinCount: 256,
    getByteFrequencyData: (arr) => arr.fill(level),
  },
});

beforeEach(() => {
  stubCanvas();
  jest.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
  jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

test("không render gì khi không ghi âm", () => {
  const { container } = render(
    <VoiceWaveform analyserRef={analyser()} active={false} />
  );
  expect(container).toBeEmptyDOMElement();
});

test("render canvas khi đang ghi", () => {
  render(<VoiceWaveform analyserRef={analyser()} active />);
  expect(screen.getByTestId("voice-waveform")).toBeInTheDocument();
});

test("ẩn với trình đọc màn hình — đây là tín hiệu thị giác, không phải nội dung", () => {
  render(<VoiceWaveform analyserRef={analyser()} active />);
  expect(screen.getByTestId("voice-waveform")).toHaveAttribute(
    "aria-hidden",
    "true"
  );
});

test("vẽ qua requestAnimationFrame, không qua state", () => {
  // Đẩy state mỗi khung sẽ render lại cả cây chat 60 lần/giây; hợp đồng này
  // giữ cho hiệu ứng trang trí không làm treo ô nhập tin nhắn.
  render(<VoiceWaveform analyserRef={analyser()} active />);
  expect(window.requestAnimationFrame).toHaveBeenCalled();
});

test("huỷ vòng vẽ khi unmount", () => {
  const { unmount } = render(<VoiceWaveform analyserRef={analyser()} active />);
  unmount();
  expect(window.cancelAnimationFrame).toHaveBeenCalled();
});

test("analyser null vẫn vẽ được, không ném lỗi", () => {
  // Xảy ra thật ở khung đầu tiên: component mount trước khi getUserMedia trả về.
  expect(() =>
    render(<VoiceWaveform analyserRef={{ current: null }} active />)
  ).not.toThrow();
});

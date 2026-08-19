/**
 * Tập podcast phải bám theo CUỘC HỘI THOẠI, kể cả khi người dùng bỏ đi giữa chừng.
 *
 * Kịch bản thật của người dùng: bấm tạo tập ở hội thoại A, tập chưa xong thì
 * chuyển sang hội thoại B, rồi quay lại A. Ở A phải **vẫn thấy "Đang tạo…"** và
 * việc poll phải chạy tiếp — không được mất dấu, không được hiện nhầm sang B,
 * và cũng không được đứng im mãi mãi ở trạng thái loading.
 *
 * Đây là thứ test đơn vị của store không chứng minh được: nó phụ thuộc vào việc
 * `AudioOverviewItem` được gắn theo `episodeKey(conversationId, mode)` và vào
 * việc trạng thái sống sót qua vòng unmount/mount.
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

import { AudioOverviewItem } from "../AudioOverviewTool";
import useAudioOverviewStore, {
  AUDIO_MODE,
  AUDIO_STATUS,
  episodeKey,
} from "stores/useAudioOverviewStore";
import { getAudioOverviewStatus } from "../../api/audioOverview";

// Bộ biến đổi SVG của CRA 5 dựng element bằng bản React nó tự gói kèm, va với
// React 19 trong node_modules ("A React Element from an older version of React").
// Chỉ lộ ra ở tập ĐÃ XONG, vì lúc đó mới render nút xoá có icon. Hạn chế của hạ
// tầng test, không phải của mã sản phẩm.
jest.mock("assets/images/delete.svg", () => ({
  __esModule: true,
  ReactComponent: (props) =>
    require("react").createElement("span", { "data-testid": "delete-icon", ...props }),
  default: "delete.svg",
}));

jest.mock("../../api/audioOverview", () => ({
  ...jest.requireActual("../../api/audioOverview"),
  getAudioOverviewStatus: jest.fn(),
  cancelAudioOverview: jest.fn(),
  deleteAudioOverview: jest.fn(),
}));

const KEY_A = episodeKey(7, AUDIO_MODE.NARRATION);
const KEY_B = episodeKey(8, AUDIO_MODE.NARRATION);

const inFlight = (taskId = "t-A") => ({
  taskId,
  status: AUDIO_STATUS.PROCESSING,
  submittedAt: Date.now(),
  language: "vi",
  mode: AUDIO_MODE.NARRATION,
  voiceGender: "male",
  name: "Bản đọc — Báo cáo",
});

const item = (key) => (
  <AudioOverviewItem
    episodeKey={key}
    onOpen={() => {}}
    onRequestCancel={() => {}}
    onRequestDelete={() => {}}
  />
);

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  useAudioOverviewStore.setState({ episodes: {}, openKey: null });
  // Mặc định: server vẫn đang chạy, chưa có kết quả.
  getAudioOverviewStatus.mockResolvedValue({ status: "PROCESSING" });
});

test("đang tạo thì hiện Đang tạo…", () => {
  useAudioOverviewStore.getState().setEpisode(KEY_A, inFlight());
  render(item(KEY_A));
  expect(screen.getByText(/Đang tạo/)).toBeInTheDocument();
});

test("hội thoại khác KHÔNG thấy tập của hội thoại này", () => {
  // Rò rỉ sang hội thoại khác còn tệ hơn mất tập: người dùng tưởng mình đang
  // chờ một tập mà mình chưa từng bấm tạo.
  useAudioOverviewStore.getState().setEpisode(KEY_A, inFlight());
  const { container } = render(item(KEY_B));
  expect(container).toBeEmptyDOMElement();
});

test("bỏ sang hội thoại khác rồi quay lại thì VẪN đang tạo", () => {
  const store = useAudioOverviewStore.getState();
  store.setEpisode(KEY_A, inFlight());

  // Đứng ở A
  const a = render(item(KEY_A));
  expect(screen.getByText(/Đang tạo/)).toBeInTheDocument();

  // Chuyển sang B — hàng của A rời khỏi cây DOM
  a.unmount();
  const b = render(item(KEY_B));
  expect(b.container).toBeEmptyDOMElement();
  b.unmount();

  // Quay lại A
  render(item(KEY_A));
  expect(screen.getByText(/Đang tạo/)).toBeInTheDocument();
});

test("tải lại trang giữa chừng: hydrate khôi phục trạng thái đang tạo", async () => {
  // Trạng thái nằm trong localStorage, không phải chỉ trong bộ nhớ — nếu không
  // thì F5 là mất dấu tập đang chạy trên server.
  useAudioOverviewStore.getState().setEpisode(KEY_A, inFlight());

  // Giả lập tải lại: bộ nhớ sạch, localStorage còn nguyên.
  useAudioOverviewStore.setState({ episodes: {}, openKey: null });
  expect(useAudioOverviewStore.getState().episodes[KEY_A]).toBeUndefined();

  useAudioOverviewStore.getState().hydrate(7);
  expect(useAudioOverviewStore.getState().episodes[KEY_A].status).toBe(
    AUDIO_STATUS.PROCESSING
  );

  render(item(KEY_A));
  expect(screen.getByText(/Đang tạo/)).toBeInTheDocument();
});

test("quay lại thì poll chạy tiếp, không đứng im ở loading", async () => {
  // "Vẫn hiện loading" mà không poll lại thì loading vĩnh viễn — đó không phải
  // thứ người dùng muốn. Quay lại phải hỏi server và cập nhật.
  useAudioOverviewStore.getState().setEpisode(KEY_A, inFlight());
  const a = render(item(KEY_A));
  a.unmount();
  jest.clearAllMocks();

  getAudioOverviewStatus.mockResolvedValue({
    object_key: "audio-overviews/7/18-08-2026/ep_t-A.wav",
    audio_format: "wav",
    duration_sec: 120,
    size_bytes: 2048,
    transcript: [{ speaker: "narrator", text: "Xong rồi." }],
    metadata: {},
  });

  render(item(KEY_A));
  await waitFor(() => expect(getAudioOverviewStatus).toHaveBeenCalledWith("t-A"));
  await waitFor(() =>
    expect(useAudioOverviewStore.getState().episodes[KEY_A].status).toBe(
      AUDIO_STATUS.COMPLETED
    )
  );
});

test("tập đã xong thì không poll nữa", async () => {
  useAudioOverviewStore.getState().setEpisode(KEY_A, {
    ...inFlight(),
    status: AUDIO_STATUS.COMPLETED,
    result: { object_key: "k", audio_format: "wav", duration_sec: 10,
              size_bytes: 10, transcript: [], metadata: {} },
  });
  render(item(KEY_A));
  await new Promise((r) => setTimeout(r, 50));
  expect(getAudioOverviewStatus).not.toHaveBeenCalled();
});

test("đi lâu rồi quay lại: tập đã xong vẫn được nhận, không báo quá giờ", async () => {
  // CHỐNG HỒI QUY: trần chờ đo từ `submittedAt`, mà thời gian người dùng VẮNG
  // MẶT cũng nằm trong đó. Bản đầu kiểm trần TRƯỚC khi gọi server, nên quay lại
  // sau 45 phút là thấy "quá thời gian" dù file đã nằm trong MinIO.
  useAudioOverviewStore.getState().setEpisode(KEY_A, {
    ...inFlight(),
    submittedAt: Date.now() - 60 * 60 * 1000, // 1 tiếng trước
  });
  getAudioOverviewStatus.mockResolvedValue({
    object_key: "audio-overviews/7/18-08-2026/ep_t-A.wav",
    audio_format: "wav",
    duration_sec: 120,
    size_bytes: 2048,
    transcript: [{ speaker: "narrator", text: "Xong rồi." }],
    metadata: {},
  });

  render(item(KEY_A));
  await waitFor(() =>
    expect(useAudioOverviewStore.getState().episodes[KEY_A].status).toBe(
      AUDIO_STATUS.COMPLETED
    )
  );
});

test("quá giờ mà server VẪN đang chạy thì mới bỏ cuộc", async () => {
  useAudioOverviewStore.getState().setEpisode(KEY_A, {
    ...inFlight(),
    submittedAt: Date.now() - 60 * 60 * 1000,
  });
  getAudioOverviewStatus.mockResolvedValue({ status: "PROCESSING" });

  render(item(KEY_A));
  await waitFor(() =>
    expect(useAudioOverviewStore.getState().episodes[KEY_A].status).toBe(
      AUDIO_STATUS.ERROR
    )
  );
});

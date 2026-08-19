import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AudioOverviewPanel from "../AudioOverviewPanel";
import { fetchAudioOverviewBlob } from "../../api/audioOverview";

jest.mock("../../api/audioOverview", () => ({
  fetchAudioOverviewBlob: jest.fn(),
}));

const revoke = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  fetchAudioOverviewBlob.mockResolvedValue(new Blob(["x"]));
  global.URL.createObjectURL = jest.fn(() => "blob:episode");
  global.URL.revokeObjectURL = revoke;
});

const episode = (overrides = {}) => ({
  taskId: "t-1",
  name: "Podcast — Báo cáo",
  status: "COMPLETED",
  ...overrides,
  result: {
    object_key: "k",
    audio_format: "mp3",
    duration_sec: 125,
    size_bytes: 2048,
    transcript: [
      { speaker: "host", text: "Câu mở đầu." },
      { speaker: "guest", text: "Câu trả lời." },
    ],
    metadata: {},
    ...(overrides.result || {}),
  },
});

const narrationEpisode = () =>
  episode({
    mode: "narration",
    voiceGender: "female",
    name: "Bản đọc — Báo cáo",
    result: {
      transcript: [
        { speaker: "narrator", text: "Đoạn một." },
        { speaker: "narrator", text: "Đoạn hai." },
      ],
      metadata: { mode: "narration", tone_label: "Trang trọng" },
    },
  });

test("a dialogue labels every turn with its speaker", () => {
  render(
    <AudioOverviewPanel episode={episode()} onClose={() => {}} onDelete={() => {}} />
  );
  expect(screen.getByText("Người dẫn")).toBeInTheDocument();
  expect(screen.getByText("Khách mời")).toBeInTheDocument();
  expect(screen.getByText("Lời thoại")).toBeInTheDocument();
});

test("a single-voice reading drops the speaker chips", () => {
  // A column of identical "Người đọc" labels is noise, not information.
  render(
    <AudioOverviewPanel
      episode={narrationEpisode()}
      onClose={() => {}}
      onDelete={() => {}}
    />
  );
  expect(screen.queryByText("Người đọc")).toBeNull();
  expect(screen.getByText("Nội dung")).toBeInTheDocument();
  expect(screen.getByText("Đoạn một.")).toBeInTheDocument();
  expect(screen.getByText("Đoạn hai.")).toBeInTheDocument();
});

test("voice and tone are shown so two episodes are tellable apart", () => {
  render(
    <AudioOverviewPanel
      episode={narrationEpisode()}
      onClose={() => {}}
      onDelete={() => {}}
    />
  );
  expect(screen.getByText("giọng nữ")).toBeInTheDocument();
  expect(screen.getByText("Trang trọng")).toBeInTheDocument();
});

test("an episode persisted before the two-mode split still renders", () => {
  // Old localStorage entries carry no `mode`; defaulting must not crash.
  const legacy = episode();
  delete legacy.mode;
  expect(() =>
    render(
      <AudioOverviewPanel episode={legacy} onClose={() => {}} onDelete={() => {}} />
    )
  ).not.toThrow();
  expect(screen.getByText("Người dẫn")).toBeInTheDocument();
});

test("audio is fetched as a blob, not linked directly", async () => {
  // The browser cannot attach an Authorization header to <audio src>, which is
  // the entire reason requestBlob exists.
  render(
    <AudioOverviewPanel episode={episode()} onClose={() => {}} onDelete={() => {}} />
  );
  await waitFor(() => expect(fetchAudioOverviewBlob).toHaveBeenCalled());
  expect(fetchAudioOverviewBlob.mock.calls[0][0]).toBe("t-1");
  await waitFor(() => expect(global.URL.createObjectURL).toHaveBeenCalled());
});

test("the object URL is revoked on unmount", async () => {
  const { unmount } = render(
    <AudioOverviewPanel episode={episode()} onClose={() => {}} onDelete={() => {}} />
  );
  await waitFor(() => expect(global.URL.createObjectURL).toHaveBeenCalled());
  unmount();
  expect(revoke).toHaveBeenCalledWith("blob:episode");
});


test("hiện ghi chú khi nguồn bị nén", () => {
  // Nén là hành vi hợp lý, nhưng người dùng phải biết. Bản trước cắt cụt nguồn
  // và chỉ ghi cờ `truncated` vào metadata mà không nơi nào đọc.
  render(
    <AudioOverviewPanel
      episode={episode({
        result: {
          metadata: {
            sources: {
              compacted: [
                { id: "d1", name: "Báo cáo quý 3", tokens_before: 9000, tokens_after: 1200 },
                { id: "d2", name: "Kế hoạch 2026", tokens_before: 8000, tokens_after: 1100 },
              ],
            },
          },
        },
      })}
      onClose={() => {}}
      onDelete={() => {}}
    />
  );
  expect(screen.getByText(/Đã nén 2 tài liệu dài/)).toBeInTheDocument();
  expect(screen.getByText(/Báo cáo quý 3, Kế hoạch 2026/)).toBeInTheDocument();
});

test("không có ghi chú khi nguồn vừa ngữ cảnh", () => {
  render(
    <AudioOverviewPanel episode={episode()} onClose={() => {}} onDelete={() => {}} />
  );
  expect(screen.queryByText(/Đã nén/)).toBeNull();
});

test("nút Quay lại gọi onClose — panel chiếm chỗ toàn bộ lưới công cụ nên đây là lối ra duy nhất", async () => {
  const onClose = jest.fn();
  render(
    <AudioOverviewPanel episode={episode()} onClose={onClose} onDelete={() => {}} />
  );
  await userEvent.click(screen.getByRole("button", { name: /Quay lại/ }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("tải tệp hỏng thì hiện mã lỗi và Thử lại gọi fetch lần nữa", async () => {
  // Một cú fetch trượt không được là vĩnh viễn: tập vẫn còn trên máy chủ, bắt
  // tạo lại một tập 3 phút chỉ vì lỗi mạng là mất toàn bộ công chờ.
  const err = new Error("boom");
  err.status = 502;
  fetchAudioOverviewBlob.mockRejectedValueOnce(err);

  render(
    <AudioOverviewPanel episode={episode()} onClose={() => {}} onDelete={() => {}} />
  );
  expect(await screen.findByText(/Không tải được tệp âm thanh \(lỗi 502\)/)).toBeInTheDocument();

  fetchAudioOverviewBlob.mockResolvedValueOnce(new Blob(["x"]));
  await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));

  await waitFor(() => expect(fetchAudioOverviewBlob).toHaveBeenCalledTimes(2));
  expect(screen.queryByText(/Không tải được/)).toBeNull();
});

test("401 nói rõ là hết phiên, không phải lỗi tệp", async () => {
  const err = new Error("unauthorized");
  err.status = 401;
  fetchAudioOverviewBlob.mockRejectedValueOnce(err);
  render(
    <AudioOverviewPanel episode={episode()} onClose={() => {}} onDelete={() => {}} />
  );
  expect(await screen.findByText(/Phiên đăng nhập đã hết hạn/)).toBeInTheDocument();
});

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AudioOverviewModal, {
  MAX_AUDIO_DOCS,
} from "../AudioOverviewModal";
import { estimateAudioOverview } from "../../api/audioOverview";

jest.mock("../../api/audioOverview", () => ({
  estimateAudioOverview: jest.fn(() => new Promise(() => {})),
}));

const setup = (props = {}) => {
  const onSubmit = jest.fn();
  const onClose = jest.fn();
  render(
    <AudioOverviewModal
      open
      onClose={onClose}
      documentCount={2}
      onSubmit={onSubmit}
      {...props}
    />
  );
  return { onSubmit, onClose };
};

const submit = () =>
  fireEvent.click(screen.getByRole("button", { name: /Tạo podcast/ }));

describe("chỉ một luồng: tóm tắt rồi tạo podcast", () => {
  test("no mode picker is rendered at all", () => {
    // The two-host dialogue was dropped from the UI on purpose; a mode picker
    // reappearing means the simplification regressed.
    setup();
    expect(screen.queryByText("Kiểu nội dung")).toBeNull();
    expect(screen.queryByRole("button", { name: /2 người dẫn/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Bản đọc theo yêu cầu/ })).toBeNull();
  });

  test("always submits narration, never podcast", () => {
    const { onSubmit } = setup();
    submit();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "narration" })
    );
  });

  test("never sends focus — that field belongs to the podcast mode (400)", () => {
    const { onSubmit } = setup();
    submit();
    expect(onSubmit.mock.calls[0][0].focus).toBe("");
  });

  test("the requirement field is labelled 'Trọng tâm' and is optional", () => {
    // Chọn theo role, không theo placeholder: placeholder là câu gợi ý cho
    // người dùng và sẽ còn đổi, còn "chỉ có đúng một ô nhập" là hợp đồng thật.
    const { onSubmit } = setup();
    expect(screen.getByText(/Trọng tâm/)).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    submit();
    expect(onSubmit.mock.calls[0][0].instruction).toBe("");
  });

  test("a typed requirement reaches onSubmit", () => {
    const { onSubmit } = setup();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "chỉ nói phần kiến nghị" },
    });
    submit();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ instruction: "chỉ nói phần kiến nghị" })
    );
  });
});

describe("voice and tone", () => {
  test("one voice control, labelled for a single reader", () => {
    setup();
    expect(screen.getByText("Giọng đọc")).toBeInTheDocument();
    expect(screen.queryByText(/Khách mời/)).toBeNull();
    expect(screen.queryByText("Giọng người dẫn")).toBeNull();
  });

  test("the chosen voice reaches onSubmit", () => {
    const { onSubmit } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Giọng nữ" }));
    submit();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ voiceGender: "female" })
    );
  });

  test("tone defaults to tu_nhien and is selectable", () => {
    const { onSubmit } = setup();
    submit();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ tone: "tu_nhien" })
    );
  });

  test("picking a tone sends its id, not its label", () => {
    const { onSubmit } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Sôi nổi" }));
    submit();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ tone: "soi_noi" })
    );
  });
});

describe("English is gone", () => {
  test("no language control is rendered at all", () => {
    // The cheapest guard against English creeping back into the UI after the
    // whole English voice stack was removed from serving.
    setup();
    expect(screen.queryByText("Ngôn ngữ")).toBeNull();
    expect(screen.queryByRole("button", { name: "English" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Tiếng Việt" })).toBeNull();
  });

  test("onSubmit carries no language field — the store pins it to vi", () => {
    const { onSubmit } = setup();
    submit();
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("language");
  });
});

describe("document guards", () => {
  test("submit is disabled with no documents", () => {
    setup({ documentCount: 0 });
    expect(screen.getByRole("button", { name: /Tạo podcast/ })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/ít nhất 1 tài liệu/);
  });

  test("submit is disabled past the document cap", () => {
    setup({ documentCount: MAX_AUDIO_DOCS + 1 });
    expect(screen.getByRole("button", { name: /Tạo podcast/ })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      new RegExp(`tối đa ${MAX_AUDIO_DOCS} tài liệu`)
    );
  });

  test("the cap shown matches the service's document_ids max_length", () => {
    setup({ documentCount: 3 });
    expect(screen.getByText(`3/${MAX_AUDIO_DOCS}`)).toBeInTheDocument();
  });
});

test("renders nothing when closed", () => {
  const { container } = render(
    <AudioOverviewModal open={false} onClose={() => {}} onSubmit={() => {}} />
  );
  expect(container).toBeEmptyDOMElement();
});

describe("gợi ý thời lượng khả thi từ nguồn", () => {
  // Xin 30 phút từ một trang giấy là bất khả thi. Trước đây hệ thống vẫn nhận,
  // và người dùng chờ hơn 13 phút để nhận một tập 10,7 phút (đo trên máy chủ
  // 2026-08-20). Con số phải hiện TRƯỚC khi bấm tạo.
  beforeEach(() => estimateAudioOverview.mockReset());

  test("hiện số phút nguồn nuôi nổi khi mở modal", async () => {
    estimateAudioOverview.mockResolvedValue({
      source_words: 600,
      feasible_minutes: 5,
      max_minutes: 30,
      documents: [],
    });
    setup({ documentIds: ["d1"] });
    expect(await screen.findByText(/600 từ.*khoảng 5 phút/)).toBeInTheDocument();
  });

  test("kéo quá mức thì báo trước là tập sẽ ngắn hơn", async () => {
    estimateAudioOverview.mockResolvedValue({
      source_words: 600,
      feasible_minutes: 5,
      max_minutes: 30,
      documents: [],
    });
    setup({ documentIds: ["d1"] });
    await screen.findByText(/khoảng 5 phút/);
    fireEvent.change(screen.getByLabelText(/Độ dài mong muốn/), {
      target: { value: "20" },
    });
    expect(
      await screen.findByText(/chỉ đủ cho khoảng 5 phút/)
    ).toBeInTheDocument();
  });

  test("ước tính hỏng thì im lặng, KHÔNG chặn người dùng tạo tập", async () => {
    estimateAudioOverview.mockRejectedValue(new Error("mạng lỗi"));
    setup({ documentIds: ["d1"] });
    await waitFor(() => expect(estimateAudioOverview).toHaveBeenCalled());
    expect(screen.queryByText(/đủ cho khoảng/)).toBeNull();
    expect(screen.getByRole("button", { name: /Tạo podcast/ })).not.toBeDisabled();
  });

  test("không chọn tài liệu thì không hỏi ước tính", () => {
    setup({ documentIds: [] });
    expect(estimateAudioOverview).not.toHaveBeenCalled();
  });
});

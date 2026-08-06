# Eval chất lượng podcast (Audio Overview) — hội đồng agent chấm chéo

> UC (nhóm A-G) trả lời "chạy có đúng không". Bộ eval này trả lời **"tập podcast có
> HAY và ĐÚNG không"** — bằng số đo khách quan + hội đồng nhiều agent độc lập chấm
> chéo, có vòng verify đối kháng cho mọi cáo buộc bịa đặt.

## 1. Bộ đề — `cases.jsonl` (10 case, nguồn nhúng sẵn theo *fact đánh số*)

Mỗi nguồn được viết dưới dạng **các fact đánh số [F1..Fn]** — đây là điều làm eval
chấm được một cách sắc bén: mọi mệnh đề trong transcript phải map về fact, không map
được = ứng viên bịa đặt.

| Case | Thử điều gì | Bẫy chính |
|---|---|---|
| EV01 | vi ngắn, 2', nguồn 1 văn bản | đường cơ sở |
| EV02 | cùng nguồn EV01 + `focus` "chỉ phần kiến nghị" | bám focus — nói lan man là trừ |
| EV03 | en, 2' | thuần ngữ tiếng Anh |
| EV04 | vi dài: nguồn 3 phần ~1.400 từ, 8' | bao phủ cả 3 phần + ngân sách từ |
| EV05 | nén cực mạnh: nguồn EV04, 1' | chọn lọc ý chính, không nói vống |
| EV06 | nguồn dày số liệu/% | **mọi con số trong transcript phải có trong nguồn** (đo máy, không cần judge) |
| EV07 | viết tắt + thuật ngữ quân sự | không tự chế nghĩa viết tắt |
| EV08 | 2 nguồn lệch nhau về một con số | podcast phải GHI NHẬN cả hai, không tự phán nguồn nào đúng |
| EV09 | 2 tài liệu corpus THẬT (doc_ids điền lúc chạy) | luồng document_ids end-to-end |
| EV10 | nguồn CỰC ngắn (~60 từ), 3' | **bẫy bịa đặt lớn nhất**: thiếu chất liệu có "chém" thêm để lấp thời lượng không? |

## 2. Tầng 1 — số đo khách quan (`objective_metrics.py`, không cần judge)

| Metric | Cách đo | Gate |
|---|---|---|
| Ngân sách từ | tổng từ transcript / (WPM×phút) | 0.75–1.30 |
| Thời lượng audio | `duration_sec` / (phút×60) | 0.6–1.4 |
| Cấu trúc thoại | ≥2 speaker, host+guest đều xuất hiện, không ai độc thoại >3 lượt liền | pass/fail |
| Thuần ngữ | vi: tỉ lệ từ tiếng Anh lạc; en: tỉ lệ từ có dấu tiếng Việt | <5% |
| **Số liệu (EV06/EV08)** | mọi số trong transcript ∈ tập số của nguồn (chuẩn hoá %,.,) | 100% |
| TTS nghe được | cắt 120s đầu (ffmpeg) → STT :15003 → `difflib.ratio` với transcript | ≥0.75 |
| QC nội bộ | `attempts`, note `script-budget-retry` — ghi nhận, không gate | báo cáo |

## 3. Tầng 2 — hội đồng agent chấm chéo (chạy bởi Claude, sau khi có output)

**Mỗi tập được chấm bởi 3 judge ĐỘC LẬP, mỗi judge một lăng kính** (prompt trong
`judges/`), không judge nào thấy điểm của judge khác:

| Agent | Lăng kính | Chấm gì (1-5, có neo mô tả trong prompt) |
|---|---|---|
| J-fidelity | Trung thực | map TỪNG mệnh đề → fact ID; liệt kê ứng viên bịa đặt kèm trích dẫn nguyên văn |
| J-coverage | Bao phủ + focus | fact quan trọng nào vào/bỏ sót; có bám `focus` không; EV08: có nêu cả 2 nguồn không |
| J-dialogue | Hội thoại + ngôn ngữ | tự nhiên, vai host/guest rõ, mở-kết tập, không lặp, thuần ngữ |

**Vòng verify chéo đối kháng** (điều kiện bắt buộc trước khi ra điểm):

1. **Verifier** nhận danh sách ứng viên bịa đặt của J-fidelity với nhiệm vụ **BÁC BỎ**:
   phải tìm được đúng đoạn nguồn chứa thông tin đó (trích nguyên văn) thì cáo buộc bị
   huỷ. Không tìm được → bịa đặt **XÁC NHẬN**. (Chặn judge "nhìn nhầm" — án oan lẫn án sót.)
2. **Chéo điểm**: dimension nào 2 judge lệch nhau >1 điểm → **Arbiter** nhận cả 2 bản
   chấm + transcript + nguồn, phán quyết có giải trình. Điểm cuối = median(3) sau arbiter.
3. Verifier + Arbiter là agent **mới, chưa nhiễm ngữ cảnh** của judge nào.

**Điểm & gate cuối mỗi tập:**

| Dimension | Gate |
|---|---|
| Trung thực (sau verify) | **≥4.0 và 0 bịa đặt xác nhận** — đây là gate cứng |
| Bao phủ | ≥3.5 |
| Focus (case có focus) | ≥4.0 |
| Hội thoại + ngôn ngữ | ≥3.5 |
| Objective tầng 1 | tất cả gate pass |

Tập FAIL → truy nguyên nhân về backend (prompt sinh kịch bản trong
`mta-ai-intramind/tools/prompts.py`, tham số `AUDIO_OVERVIEW_*`, model), fix, sinh lại,
chấm lại **bằng judge mới** (không tái dùng phiên judge cũ).

## 4. Quy trình chạy (khi ccoex lên, sau khi nhóm C xanh)

```
1. run_generate.py  → sinh 10 tập qua AI :15001, lưu _uctest/eval/out/EVxx/
                      (status.json, transcript.json, episode.wav, stt_roundtrip.txt)
2. objective_metrics.py → out/metrics.json + bảng tóm tắt; case đỏ tầng 1 dừng sớm
3. Hội đồng agent:  mỗi tập 3 judge song song → verifier → arbiter (nếu lệch)
                    (10 tập × 3-5 agent — chạy theo lô, kết quả JSON theo schema §5)
4. Báo cáo:         out/EVAL_REPORT.md — bảng điểm 10 tập × 5 dimension, danh sách
                    bịa đặt xác nhận (kèm trích dẫn), verdict tổng + việc phải fix
```

## 5. Schema output judge (mọi agent phải trả đúng JSON này)

```json
{
  "case": "EV04", "judge": "fidelity",
  "scores": {"dimension": 4, "confidence": "high"},
  "hallucination_candidates": [
    {"quote_transcript": "…", "reason": "không map được fact nào", "severity": "major"}
  ],
  "evidence": [{"claim": "…", "fact_id": "F7"}],
  "notes": "…"
}
```

## 6. Giới hạn thành thật

- Judge chấm **transcript** (văn bản). Chất giọng/ngắt nghỉ của TTS chỉ được đo gián
  tiếp qua STT round-trip ≥0.75 + tai người ở UC E11/E14 — nghe thật vẫn là của người.
- EV09 phụ thuộc corpus thật — nếu 2 doc chọn được quá nghèo nội dung thì thay doc,
  không hạ gate.
- Model sinh là LLM staging (gemma :5011 / qwen tool :8003) — điểm eval là điểm của
  **cả pipeline** (prompt + model + TTS), không tách riêng model.

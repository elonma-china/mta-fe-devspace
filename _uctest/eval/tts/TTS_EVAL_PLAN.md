# Eval chất lượng TTS (Piper vi/en qua sherpa-onnx, :15003)

> Eval podcast chấm NỘI DUNG; bộ này chấm riêng **giọng đọc**: đọc có đúng không
> (số, viết tắt, tên riêng), tín hiệu audio có sạch không (cắt cụt, câm lặng, vỡ
> tiếng), tốc độ tổng hợp, và độ ổn định. Ba tầng: máy đo tín hiệu → hội đồng agent
> chấm độ-đọc-đúng qua round-trip → tai người chấm MOS trên mẫu bị gắn cờ.

## 1. Bộ đề — `tts_cases.jsonl` (~35 câu, gắn nhãn nhóm)

| Nhóm | Thử điều gì | Gate riêng |
|---|---|---|
| `base` (vi+en) | câu thường ngắn/vừa/dài | nền so sánh cho mọi nhóm khác |
| `num` | số nghìn `1.250`, thập phân `98,4%`, tiền `4,2 tỷ`, giờ `6 giờ 30`, ngày `14/5`, số hiệu `285/QĐ` | đọc thành lời đúng giá trị (agent chấm — STT trả dạng chữ nên difflib thô sẽ oan) |
| `abbr` | CNTT, ATTT, QĐ, TP.HCM, USB, GDP | đọc kiểu đánh vần/quen thuộc, không phát minh cách đọc |
| `name` | tên người VN, địa danh, tên nước ngoài (Windows, Zalo) | không vỡ âm tiết |
| `punc` | câu hỏi, cảm thán, ngoặc, gạch đầu dòng | ngữ điệu — chủ yếu để tai người |
| `edge` | 1 từ; câu ~1.990 ký tự (sát trần 2000); ký tự đặc biệt/emoji; chuỗi lặp; trộn Anh-Việt | **không 500, không treo, không audio rỗng** |
| `speed` | cùng câu ở speed 0.5 / 1.0 / 2.0 | tỉ lệ thời lượng đúng chiều |
| `stability` | cùng câu chạy 2 lần | lệch thời lượng <10% |

## 2. Tầng máy — `run_tts_eval.py` (tự chạy, stdlib + httpx)

Mỗi câu: gọi `POST /api/v1/tts` (đo wall-time) → phân tích WAV → STT round-trip.

| Metric | Gate |
|---|---|
| HTTP + WAV hợp lệ (parse `wave`), duration >0 | 100% các câu không-edge |
| Edge: không 500/treo; 4xx sạch cho input không hợp lệ | pass/fail |
| Tốc độ đọc (ký tự/giây) nhóm base/num/abbr | 8–25 cps (bắt cắt cụt lẫn đọc lê thê) |
| Vỡ tiếng: tỉ lệ mẫu chạm trần biên độ | <0.1% |
| Câm lặng đầu/cuối | <1.5s mỗi đầu |
| Câm lặng GIỮA câu dài nhất (dropout) | <2.5s |
| Âm lượng RMS dBFS | −35…−10, lệch chuẩn giữa các câu base <6 dB |
| **RTF** (thời gian tổng hợp / thời lượng audio, CPU) | vi ≤0.30, en ≤0.30 (nền đã đo 2026-08-05: 0.10/0.076 — gate chùng 3× để trừ tải máy) |
| speed 0.5 vs 1.0 | dài gấp 1.6–2.4× |
| speed 2.0 vs 1.0 | còn 0.4–0.65× |
| Ổn định 2 lần chạy | lệch duration <10% |
| STT round-trip similarity | **chỉ báo cáo**, không gate — số/viết tắt về dạng chữ sẽ oan difflib; phán quyết thuộc tầng agent |

## 3. Tầng agent — hội đồng chấm ĐỘ ĐỌC ĐÚNG (verify chéo)

STT round-trip trộn lẫn hai nguồn lỗi (TTS đọc sai ↔ STT nghe sai). Tầng agent xử lý
đúng cái khó đó:

1. **2 judge độc lập** (`judges/tts_intelligibility.md`) cùng nhận bảng (câu gốc ↔ STT
   round-trip) của TỪNG câu, không thấy nhau. Việc: chuẩn hoá dạng đọc (`1.250` ≡ "một
   nghìn hai trăm năm mươi" là ĐÚNG), rồi phân loại từng sai khác:
   `số-sai-giá-trị` / `viết-tắt-đọc-sai` / `tên-riêng-vỡ` / `từ-thường-mất` /
   `chính-tả-tương-đương` (không lỗi) / `nghi-STT` (round-trip mơ hồ). Chấm 1-5 theo nhóm.
2. **Verifier đối kháng** (`judges/tts_verifier.md`): nhận danh sách lỗi hai judge gộp
   lại, phải BÁC BỎ từng lỗi — chứng minh đó là biến thể chính tả hợp lệ hoặc quy ước
   đọc đúng. Không bác được → lỗi xác nhận.
3. Lệch >1 điểm giữa 2 judge → **arbiter** (dùng chung `judges/arbiter.md`).
4. Lỗi xác nhận mức `số-sai-giá-trị` là nặng nhất — sai một con số trong bản tin đọc
   to nguy hiểm hơn mọi lỗi ngữ điệu.

**Gate tầng agent:** nhóm `num` ≥4.0 và **0 lỗi số-sai-giá-trị xác nhận**;
`base` ≥4.0; `abbr`/`name` ≥3.5.

## 4. Tầng tai người — MOS rút gọn (`MOS_SHEET.md`)

Máy + agent không nghe được ngữ điệu/độ tự nhiên. Chọn **12 mẫu**: 6 bị máy/agent gắn
cờ + 6 ngẫu nhiên (đủ vi/en, đủ nhóm), user nghe và chấm 1-5 ba cột: *tự nhiên* /
*ngữ điệu-ngắt nghỉ* / *lỗi nghe được* (click, rè, nuốt âm). MOS trung bình ≥3.5,
không mẫu nào ≤2. Sheet in sẵn lệnh phát từng file qua `ssh -L`.

## 5. Chạy & xử lý fail

```
run_tts_eval.py → tts/out/<case_id>/{tts.wav, roundtrip.txt, timing.json}
                → tts/out/tts_results.json + bảng gate
→ tầng agent (2 judge + verifier + arbiter, theo lô)
→ MOS_SHEET.md điền tay
```

Fail truy về đâu: `num`/`abbr` sai hàng loạt → tầng chuẩn hoá văn bản trước TTS
(serving `tts/piper.py` — Piper vi có tự đọc số không, hay cần text-normalize trước);
dropout/vỡ tiếng → tham số engine/ghép đoạn; RTF vượt → tải CPU máy (đo lại lúc vắng
tải). Fix xong chạy lại đúng nhóm đỏ + `stability`.

## 6. Giới hạn thành thật

- Round-trip không tách được 100% lỗi TTS khỏi lỗi STT — nhãn `nghi-STT` + MOS tai
  người trên mẫu gắn cờ là cách bù trung thực, thay vì giả vờ máy đo được tất.
- MOS 12 mẫu × 1 người nghe là screening, không phải MOS chuẩn 20+ người.
- Piper là model cố định — eval này chấm **pipeline serve** (chuẩn hoá text, tham số,
  ghép), không cải thiện được bản thân giọng; nếu muốn giọng tốt hơn thì đổi model
  (VietTTS…), ngoài phạm vi Dev Space.

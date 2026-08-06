# Báo cáo eval podcast — 2026-08-07, ccoex (9 case text; EV09 chờ live BE)

Pipeline đủ: sinh thật qua AI `:15001` (LLM staging `:8003`, TTS Piper, MinIO riêng)
→ máy đo khách quan → 3 judge độc lập 3 lăng kính → verifier đối kháng 17 cáo buộc.
Giọng đọc TTS có báo cáo riêng: `tts/TTS_EVAL_REPORT.md`.

## Bảng điểm cuối (sau verify chéo)

| Case | Trung thực¹ | Bao phủ | Hội thoại | Máy đo | Verdict |
|---|---|---|---|---|---|
| EV01 cơ sở | 4 (1 minor xác nhận) | **3** (sót F1 cốt lõi) | 4 | ✓ | ✗ bao phủ |
| EV02 focus | **3** (major: bịa "âm lịch") | 5 (focus 0.97) | 3 | duration | ✗ trung thực |
| EV03 en | 5 | 5 | 3 | hụt chữ, roundtrip .449 | ~ hội thoại/độ dài |
| EV04 dài 8' | **3** (major: gán "chuẩn hoá dữ liệu" GĐ2→GĐ1, mâu thuẫn F8) | 5 (22/22 fact!) | 4 | duration | ✗ trung thực |
| EV05 nén 1' | 5 | 5 | 3 | 357 từ / mục tiêu 150 | ~ sàn nén |
| **EV06 số liệu** | **5 (số khớp 100%)** | 4 | 4 | ✓ | **✓ PASS trọn** |
| EV07 viết tắt | **3** (major: tự chế nghĩa "QLKT"² ) | 5 | 3 | duration | ✗ trung thực |
| EV08 2 nguồn lệch | **3** (major: kết luận "gần như trùng khớp" ngoài nguồn; riêng "chênh 70"=1320−1250 hợp lệ³) | 5 (nêu đủ 2 số) | 4 | duration | ✗ trung thực |
| EV10 bẫy 60 từ | **1** (3 major xác nhận: bịa lấp thời lượng + "sớm hơn 20 phút" trong khi 6h30→6h00=30') | 5 | 4 | ✓ | **✗ NẶNG** |

¹ Gate cứng: ≥4.0 và 0 bịa đặt xác nhận. ² Hai judge độc lập (fidelity + coverage)
cùng bắt QLKT không hẹn trước — tín hiệu mạnh. ³ Máy đo flag số "70" là bịa;
judge + verifier xác nhận là phép trừ trực tiếp hợp lệ — đúng phân công máy/người.

**Kết quả: 1/9 PASS trọn (EV06). Verifier đảo 2 án oan** (EV01 "ba mươi chín" —
thông tin 30/9 có trong nguồn, chỉ là dạng đọc; EV10 "mở bếp lúc 6h00" — suy được
từ F1) **và loại 1 câu dẫn** — vòng đối kháng không phải trang trí.

## 5 nguyên nhân gốc → việc fix BE (theo đòn bẩy)

| # | Mẫu lỗi (case) | Fix đề xuất | Ở đâu |
|---|---|---|---|
| 1 | **Nguồn ít chất liệu → bịa lấp thời lượng + sai số suy diễn** (EV10: 3 major) | Prompt kịch bản: "nguồn ít thì làm tập NGẮN; TUYỆT ĐỐI không thêm thông tin/lý giải ngoài nguồn; không tự làm phép tính trừ khi chắc chắn" | `tools/prompts.py` |
| 2 | **Vượt quyền nguồn**: nâng hedge thành khẳng định (EV08), gán nhầm giai đoạn (EV04), chế nghĩa viết tắt (EV07), thêm "âm lịch" (EV02) | Prompt: "giữ nguyên mức độ chắc chắn của nguồn ('có thể do' ≠ 'chính là'); viết tắt nguồn không giải nghĩa thì đọc nguyên chữ cái, KHÔNG đoán nghĩa" | `tools/prompts.py` |
| 3 | **Audio chỉ ~0.5× thời lượng yêu cầu** (EV02/04/07/08) — Piper vi đọc ~240-250 wpm, config giả định 150 | `AUDIO_OVERVIEW_WPM=150 → ~240` (env, không cần sửa code) rồi đo lại | `.env` |
| 4 | **Host không hỏi thật** ở tập dạng liệt kê (EV02/03/05/07 → hội thoại 3đ) | Prompt: "host BẮT BUỘC đặt câu hỏi thật mỗi 2-3 lượt, không thay nhau đọc danh sách" | `tools/prompts.py` |
| 5 | Sàn nén ~350 từ bất kể target 1' (EV05 2.38×); en script hụt chữ + roundtrip en 0.449 (EV03) | Nhấn ràng buộc ngân sách từ trong prompt cho cả 2 chiều; roundtrip en đo lại sau khi tách lỗi STT-en (moonshine) bằng tai người | `tools/prompts.py` + MOS |
| — | (máy đo) heuristic thuần-ngữ đếm oan từ Việt không dấu | ĐÃ hạ xuống report-only trong lần chạy này | `objective_metrics.py` ✓ |

## Điểm sáng giữ nguyên

- **EV06**: mọi con số khớp nguồn 100% — cả gate máy lẫn judge.
- **EV04**: phủ đủ 22/22 fact qua 47 lượt, cấu trúc hỏi-đáp tốt nhất bộ.
- **EV02**: bám focus 0.97 — tính năng focus hoạt động đúng.
- **EV10** bao phủ đủ 4/4 fact và không sai vai — hỏng ở đúng chỗ bẫy nhắm vào.
- Hạ tầng sinh ổn định: 9/9 case ra mp3, QC/heartbeat/cancel đều đúng.

## Quy trình tiếp theo

1. Áp fix #1-#4 (1 file prompt + 1 env) → sinh lại 9 case → chấm lại bằng **judge
   mới** → so bảng trước/sau. 2. EV09 + RAG corpus khi live BE sống lại. 3. MOS
   tai người (TTS 12 mẫu + nghe 2-3 tập podcast).

## Hồ sơ

`out-agents/`: 17 cáo buộc + verdicts, metrics máy 2026-08-07. Transcript/audio:
ccoex `~/devspace/_uctest/eval/out/`. Bản chấm đầy đủ của 3 judge + verifier nằm
trong transcript phiên chấm 2026-08-07.

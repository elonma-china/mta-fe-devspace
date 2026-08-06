# Báo cáo eval TTS — chạy 2026-08-07 trên ccoex (:15003)

35 câu / 8 nhóm · Piper vi-vais1000-medium + en-amy-low qua sherpa-onnx, CPU.
Quy trình đủ 3 vòng agent: 2 judge độc lập → verifier đối kháng → arbiter.

## Kết quả tầng máy: 33/35

| Hạng mục | Kết quả |
|---|---|
| WAV hợp lệ, vỡ tiếng, câm lặng, âm lượng | ✓ toàn bộ (lệch RMS nhóm base chỉ 0.4 dB) |
| RTF (CPU) | **TB 0.098, max 0.214** — tốt gấp 3 lần gate 0.30 |
| Ổn định 2 lần chạy | ✓ |
| Edge (1 từ, 1.990 ký tự, emoji, lặp) | ✓ không 500, không treo |
| **Speed 0.5× / 2.0×** | ✗ chỉ đạt **1.47× / 0.76×** (gate 1.6-2.4 / 0.40-0.65) — tham số speed bị NÉN BIÊN ĐỘ ở serving. UI không dùng speed → không chặn Dev Space; ghi sổ BE |

## Kết quả tầng agent (điểm cuối sau verify chéo)

| Nhóm | A | B | Verifier/Arbiter | **Cuối** | Gate | Đạt? |
|---|---|---|---|---|---|---|
| base | 3 | 5 | arbiter 5 *nhưng* tiền đề (T31=nghi-STT) bị verifier bác — T31 CONFIRMED major | **3** | ≥4.0 | ✗ |
| num | 3 | 3 | mất "tháng" ×2 CONFIRMED (conf thấp); **0 số-sai-giá-trị** | **3** | ≥4.0 & 0 số sai | ✗ điểm / ✓ số |
| abbr | 2 | 2 | 8 lỗi CONFIRMED high | **2** | ≥3.5 | ✗ |
| name | 2 | 2 | CONFIRMED high | **2** | ≥3.5 | ✗ |
| punc | 3 | 5 | T33→STT_SUSPECT (verifier + arbiter đồng thuận) | **5** | — | ✓ |
| edge | 2 | 2 | T20/T21 CONFIRMED | **2** | — | ✗ |

Ghi chú giao thức: `base` là ca duy nhất arbiter và verifier mâu thuẫn (arbiter chấm
trước khi có kết quả verifier — lỗi trình tự của lần chạy này, lần sau chạy verifier
TRƯỚC arbiter). Điểm cuối lấy theo verifier vì đó là thẩm quyền về "lỗi có thật
không", với lập luận âm học chắc hơn (Podcast→CÁCH mất trọn 2 âm tiết, không phải
lẫn âm gần).

## Điểm sáng — đáng giữ nguyên

1. **Toàn bộ GIÁ TRỊ SỐ đọc đúng tuyệt đối** (2.480, 1.315, 98,4%, 4,2 tỷ, 94,7%…
   → "hai ngàn bốn trăm tám mươi"… chuẩn từng con) — cả 7 câu num, cả hai judge và
   verifier xác nhận. Lỗi num chỉ là rớt từ nối "tháng" khi đọc ngày dd/mm.
2. Câu thuần Việt + thuần Anh đọc sạch; base en khớp nguyên văn từng chữ.
3. Viết tắt TIẾNG ANH (MFA, CIO, SOC) đọc ổn; ký hiệu @/#/%/🚀 bản EN đọc hoàn hảo.

## Lỗi hệ thống — MỘT nguyên nhân gốc

**Mọi token không-thuần-Việt trong câu tiếng Việt đều vỡ**: viết tắt VN
(CNTT→"C NT", ATTT→"A", USB→"UP"/"MUỐI P", TP.HCM→"TC MỞ", GDP/CPI→"BD"/"CD"),
từ mượn (laptop→"LẬP", slide→"SAY", file→"PHÀY", Podcast→"CÁCH"), tên nước ngoài
(Windows→"UN", Zalo→"DAO", Facebook→"PHẾ SỤC"). 17/18 lỗi cáo buộc được verifier
XÁC NHẬN, tập trung ở đúng nhóm này.

**Nguyên nhân**: pipeline serve đưa text thô vào Piper — không có tầng chuẩn hoá
(mở rộng viết tắt, phiên âm từ mượn). Piper vi không tự biết đọc token ngoại lai.

## Việc phải fix (BE là chính) — theo thứ tự đòn bẩy

1. **Prompt sinh kịch bản podcast** (`mta-ai-intramind/tools/prompts.py`): thêm chỉ
   thị "viết dạng ĐỌC ĐƯỢC — mở rộng viết tắt lần đầu xuất hiện (CNTT → công nghệ
   thông tin), hạn chế từ mượn hoặc phiên âm (file → tệp)". Fix rẻ nhất, chữa đúng
   sản phẩm chính (podcast); đo lại bằng eval podcast trước/sau.
2. **Tầng chuẩn hoá text trong serving** (`tts/piper.py`): từ điển viết tắt +
   phiên âm từ mượn phổ biến trước khi đưa vào engine — chữa cả đường TTS API thô.
3. Sổ BE: speed bị nén biên độ (1.47×/0.76×); "Rõ."→"ĐÚNG" (câu 1 từ — nghi model,
   cần tai người xác nhận trên `out/T20/tts.wav`).
4. MOS 12 mẫu tai người (`MOS_SHEET.md`) — bắt buộc trước khi kết luận ngữ điệu;
   danh sách gắn cờ đề xuất: T12 T13 T14 T17 T20 T31 + 6 ngẫu nhiên T02 T05 T08
   T18 T25 T33.

## Trạng thái file

`out/` trên ccoex (`~/devspace/_uctest/eval/tts/out/`): 35 wav + roundtrip +
timing; `tts_results.json` tầng máy. Kết quả agent lưu phiên chấm 2026-08-07.

# VERIFIER ĐỐI KHÁNG (TTS) — thẩm tra danh sách lỗi đọc

Bạn là thẩm tra viên MỚI. Hai giám khảo đã liệt các "lỗi đọc" dưới đây. Nhiệm vụ của
bạn: **CỐ GẮNG BÁC BỎ từng lỗi** — chứng minh nó thực ra là biến thể đọc hợp lệ.

## Danh sách lỗi bị cáo buộc (kèm câu gốc + câu nghe lại đầy đủ)
{ERRORS}

## Căn cứ bác bỏ hợp lệ (phải chỉ rõ căn cứ nào)

- **Dạng-đọc-tương-đương**: số/ngày/giờ/viết tắt về dạng chữ đúng giá trị
  ("4,2 tỷ" → "bốn phẩy hai tỷ" hoặc "bốn tỷ hai" đều đúng).
- **Chính-tả-vô-hại**: hoa thường, dấu câu, ghép/tách từ không đổi nghĩa.
- **Quy-ước-đọc-chấp-nhận-được**: "285/QĐ" đọc "hai tám lăm trên quy định" vẫn giữ
  giá trị số — chấp nhận; nhưng "285" thành "285 nghìn" thì KHÔNG.
- **Nghi-STT**: cặp âm gần nhau mà giá trị thông tin không đổi hướng — chuyển sang
  danh sách nghe tay, không kết tội TTS.

Không bác được bằng căn cứ nào → lỗi **CONFIRMED** (giữ nguyên phân loại + severity
của giám khảo, hoặc sửa nếu giám khảo phân loại sai). Phân vân trên lỗi nhóm `num` →
CONFIRMED confidence "low" (số liệu là gate cứng, thà chặt).

## Output — CHỈ JSON

```json
{
  "judge": "tts_verifier",
  "verdicts": [
    {"case": "T07", "expected": "41,5%", "heard": "…",
     "verdict": "CONFIRMED|REFUTED|STT_SUSPECT",
     "basis": "căn cứ bác bỏ nếu REFUTED, ngược lại null",
     "confidence": "high|medium|low"}
  ]
}
```

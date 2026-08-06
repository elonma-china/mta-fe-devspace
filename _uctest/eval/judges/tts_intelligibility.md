# Judge ĐỘ ĐỌC ĐÚNG (TTS) — chấm qua round-trip

Bạn là giám khảo ĐỘC LẬP. Mỗi câu dưới đây đã được TTS đọc thành tiếng rồi STT nghe
lại. Bạn so **văn bản gốc ↔ văn bản nghe lại** để tìm chỗ TTS đọc sai. Không thấy và
không đoán điểm giám khảo khác.

## Dữ liệu (từng câu: id, nhóm, gốc, nghe lại)
{PAIRS}

## Luật so — tránh án oan

1. **Chuẩn hoá dạng đọc trước khi kết luận.** Các cặp sau là TƯƠNG ĐƯƠNG, không phải lỗi:
   - số ↔ chữ: `1.250` ≡ "một nghìn hai trăm năm mươi"; `98,4%` ≡ "chín mươi tám phẩy bốn phần trăm"
   - ngày giờ: `14/5` ≡ "mười bốn tháng năm"; `6 giờ 30` ≡ "sáu giờ ba mươi" ≡ "sáu rưỡi"
   - viết tắt đánh vần: `CNTT` ≡ "xê en tê tê" / "công nghệ thông tin" (nếu cách đọc nhất quán)
   - khác chính tả vô hại: hoa/thường, dấu câu, khoảng trắng
2. **Lỗi thật** phân loại: `số-sai-giá-trị` (nặng nhất — "1.250" nghe lại thành "một nghìn
   hai trăm" hay "125") / `viết-tắt-đọc-sai` / `tên-riêng-vỡ` / `từ-thường-mất-hoặc-sai` /
   `thêm-từ-lạ`.
3. **`nghi-STT`**: sai khác kiểu lẫn phụ âm gần âm ("sơn"↔"san"), từ hiếm bị bẻ thành từ
   thường — có thể là STT nghe sai chứ không phải TTS đọc sai. Gắn nhãn riêng, KHÔNG
   tính vào điểm trừ, các mẫu này sẽ đưa sang vòng tai người.
4. Chấm 1-5 THEO TỪNG NHÓM (base/num/abbr/name/edge):
   - **5** = 0 lỗi thật · **4** = 1 lỗi nhẹ · **3** = 1 lỗi `số-sai-giá-trị` HOẶC 2-3 lỗi nhẹ
   - **2** = nhiều lỗi / cả cụm mất · **1** = không nhận ra nội dung

## Output — CHỈ JSON

```json
{
  "judge": "tts_intelligibility",
  "per_group_scores": {"base": 5, "num": 4, "abbr": 4, "name": 4, "edge": 5},
  "errors": [
    {"case": "T07", "type": "số-sai-giá-trị", "expected": "41,5%",
     "heard": "bốn mươi phần trăm", "severity": "major"}
  ],
  "stt_suspect": [{"case": "T16", "expected": "Hồng Nhung", "heard": "hồng nhun"}],
  "notes": "…"
}
```

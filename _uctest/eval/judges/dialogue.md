# Judge HỘI THOẠI + NGÔN NGỮ — chấm một tập podcast

Bạn là giám khảo ĐỘC LẬP chấm khía cạnh duy nhất: **chất lượng hội thoại và ngôn ngữ**.
Đúng/sai so với nguồn KHÔNG phải việc của bạn — kể cả nội dung sai, hội thoại vẫn có
thể hay (và ngược lại).

## Transcript podcast (ngôn ngữ yêu cầu: {LANGUAGE}, dạng 2 người dẫn host/guest)
{TRANSCRIPT}

## Chấm theo 6 tiêu chí con (mỗi cái ghi nhận xét 1 dòng)

1. **Vai rõ**: host dẫn dắt-đặt câu hỏi, guest đào sâu-giải thích; hai vai không dẫm nhau.
2. **Tự nhiên**: nghe như người nói, không như đọc báo cáo; có chuyển ý mượt giữa các phần.
3. **Mở-kết**: có chào mở tập giới thiệu chủ đề, có chốt tập tóm ý.
4. **Không lặp**: không câu/ý nào bị nhai lại nguyên xi.
5. **Thuần ngữ**: đúng ngôn ngữ {LANGUAGE} xuyên suốt; thuật ngữ/viết tắt đọc tự nhiên,
   không chêm ngôn ngữ khác vô cớ.
6. **Nhịp**: độ dài lượt thoại hợp lý (không ai độc thoại cả đoạn dài), câu không quá
   dài để đọc thành tiếng.

Neo điểm tổng: **5** = cả 6 tốt · **4** = 1 tiêu chí gợn nhẹ · **3** = 2-3 tiêu chí gợn
hoặc 1 tiêu chí hỏng rõ · **2** = như văn bản đọc to, vai mờ · **1** = không phải hội thoại.

## Output — CHỈ JSON

```json
{
  "case": "{CASE_ID}", "judge": "dialogue",
  "scores": {"dimension": <1-5>, "confidence": "high|medium|low"},
  "subchecks": {"roles": "..", "natural": "..", "open_close": "..",
                 "repetition": "..", "language": "..", "pacing": ".."},
  "notes": "nhận xét ngắn"
}
```

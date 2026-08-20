# API giọng nói — tài liệu cho FE gọi

Hai nhóm: **STT** (thu âm → chữ) và **Tổng quan âm thanh** (tài liệu → tập audio).

- **Base URL**: gateway `http://<host>:5050`. Qua Node proxy của FE thì thêm tiền tố:
  `/llm` cho STT, `/tools` cho tổng quan âm thanh (proxy cắt `/llm`, **giữ** `/tools`).
- **Auth**: mọi endpoint cần `Authorization: Bearer <token>` (lấy từ `POST /login`).

| # | Endpoint | Việc |
|---|---|---|
| 1 | `POST /stt/transcribe` | thu âm → chữ |
| 2 | `POST /tools/audio-overview/estimate` | nguồn này đủ cho bao nhiêu phút |
| 3 | `POST /tools/audio-overview` | đặt lệnh tạo tập → `task_id` |
| 4 | `GET /tools/audio-overview/status/{task_id}` | theo dõi tiến độ / lấy kết quả |
| 5 | `GET /tools/audio-overview/{task_id}/file` | tải file audio |
| 6 | `POST /tools/audio-overview/{task_id}/cancel` | huỷ giữa chừng |
| 7 | `DELETE /tools/audio-overview/{task_id}` | xoá tập |

---

## 1. `POST /stt/transcribe` — thu âm thành chữ

**Body**: `multipart/form-data`

| Tham số | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `file` | file | ✔ | WAV 16 kHz mono 16-bit. **Tên file phải có đuôi hợp lệ** — chặn theo đuôi: `.wav .webm .ogg .opus .m4a .mp3 .flac .aac`. Trần **25 MB** |
| `language` | string | | `vi` (mặc định) |

**Trả về `200`**

```json
{
  "text": "Kiểm tra dịch vụ đọc tiếng Việt.",
  "raw_text": "KIỂM TRA DỊCH VỤ ĐỌC TIẾNG VIỆT",
  "language": "vi",
  "duration_ms": 1416,
  "segments": [{ "start_ms": 0, "end_ms": 1416, "text": "..." }]
}
```

Dùng `text` (đã chuẩn hoá hoa/thường + dấu câu); `raw_text` là bản thô viết HOA.

**Ví dụ**

```bash
curl -X POST http://host:5050/stt/transcribe \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@voice.wav;type=audio/wav" -F "language=vi"
```

```js
const form = new FormData();
form.append("file", blob, "voice.wav");   // đặt tên, đừng gửi blob vô danh
form.append("language", "vi");
await fetch("/llm/stt/transcribe", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },  // KHÔNG tự set Content-Type
  body: form,
});
```

**Mã lỗi**

| Mã | Nghĩa |
|---|---|
| `403` | máy chủ tắt STT |
| `413` | file vượt 25 MB |
| `415` | đuôi tên file không hỗ trợ |
| `422` | file rỗng / đoạn ghi < 250 ms / không nghe ra chữ nào |
| `503` | engine chưa nạp |

`detail` của `422` là câu tiếng Việt cụ thể ("Đoạn ghi âm quá ngắn (180 ms)…") — nên hiện nguyên văn.

---

## 2. `POST /tools/audio-overview/estimate` — ước tính độ dài

> Endpoint này **đi kèm bản vá voice**. Gateway của bản chính thức hiện chưa có (gọi ra `404`) —
> nó lên cùng lúc với patch voice mà đội FE ghép vào.

Chỉ đếm chữ, **không gọi LLM**, trả về ngay. Dùng để biết nguồn đủ cho bao nhiêu phút **trước khi** đặt lệnh.

**Body**: JSON — `text` hoặc `document_ids` (giống endpoint #3), thêm `mode`.

```bash
curl -X POST http://host:5050/tools/audio-overview/estimate \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"document_ids":["d1","d2"],"mode":"narration"}'
```

```json
{
  "source_words": 600,
  "mode": "narration",
  "feasible_minutes": 5,
  "lengths": { "short": 2, "default": 4, "long": 5 },
  "max_minutes": 30,
  "documents": [{ "id": "d1", "name": "Báo cáo", "words": 420 }]
}
```

`lengths` là số phút tương ứng ba mức của endpoint #3. Nguồn càng nhiều thì ba số này càng lớn.

---

## 3. `POST /tools/audio-overview` — đặt lệnh tạo tập

**Body**: JSON. Không trường nào bắt buộc về mặt schema, nhưng **phải có `text` hoặc `document_ids`** (thiếu → `400`).

| Tham số | Kiểu | Mặc định | Giá trị / giới hạn |
|---|---|---|---|
| `text` | string | — | nguồn dán thẳng; **tối thiểu 100 ký tự** |
| `document_ids` | string[] | — | tối đa **5** tài liệu |
| `document_id` | string | — | dạng một tài liệu |
| `conversation_id` | string | — | ≤128. **Phải ở body** (query param bị gateway bỏ) |
| `mode` | enum | `narration` | `narration` \| `podcast` |
| `voice_gender` | enum | `male` | `male` \| `female` |
| `tone` | enum | `tu_nhien` | `trang_trong` \| `tu_nhien` \| `soi_noi` \| `cham_rai` |
| `length` | enum | `default` | `short` \| `default` \| `long` — server suy số phút từ nguồn |
| `instruction` | string | — | **chỉ `narration`**, ≤2000 ký tự |
| `focus` | string | — | **chỉ `podcast`**, ≤500 ký tự |
| `language` | enum | `vi` | chỉ `vi` |
| `target_minutes` | int | — | 1..30. Đường cũ; có thì **thắng** `length`. Khuyến nghị dùng `length` |
| `temperature` | float | `0.7` | 0.0..2.0 |

```bash
curl -X POST http://host:5050/tools/audio-overview \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "document_ids": ["d1"],
    "conversation_id": "123",
    "mode": "narration",
    "voice_gender": "male",
    "tone": "trang_trong",
    "length": "default",
    "instruction": "Đọc thành bản trình bày mạch lạc."
  }'
```

```json
{ "task_id": "81cb8275-...", "status": "submitted", "timestamp": "2026-08-20T16:58:03" }
```

**Lỗi `400`**: thiếu nguồn · `instruction` gửi cho `podcast` · `focus` gửi cho `narration`.
**Lỗi `422`**: sai enum, `target_minutes` ngoài 1..30, vượt giới hạn độ dài trường.

---

## 4. `GET /tools/audio-overview/status/{task_id}` — theo dõi

Poll khoảng **3–5 giây/lần**. Ba trạng thái:

**Đang chạy**

```json
{ "status": "processing", "task_id": "...", "message": "Tổng quan âm thanh đang được tạo…",
  "progress": { "done": 7, "total": 23, "note": "tts 7/23" } }
```

`note` là pha thật: `sources` → `script` → `tts n/m` → `stitch` → `uploaded`.

**Xong** — ⚠ **không có trường `status`**. Nhận biết bằng sự tồn tại của **`object_key`**:

```json
{
  "task_id": "...",
  "object_key": "audio-overviews/123/20-08-2026/ep_81cb8275.mp3",
  "audio_format": "mp3",
  "duration_sec": 641.6,
  "size_bytes": 10265900,
  "transcript": [{ "speaker": "narrator", "text": "..." }],
  "metadata": {
    "mode": "narration", "voice_gender": "male", "tone_label": "Trang trọng",
    "length": "default", "target_minutes": 4,
    "sources": { "compacted": [{ "id": "d1", "name": "...", "tokens_before": 9000, "tokens_after": 1200 }] },
    "warnings": [{ "code": "duration_off_target", "message": "Thời lượng thực tế 1.3 phút, lệch 34%…" }]
  }
}
```

`speaker` ∈ `host` \| `guest` \| `narrator`.

**Hỏng**: `{"status": "FAILURE", "message": "<câu tiếng Việt>"}` · **Đã huỷ**: `{"status": "cancelled"}` (là trạng thái **kết thúc**).

### `metadata.warnings` — tập vẫn trả về bình thường nhưng đã xuống cấp

| `code` | Nghĩa |
|---|---|
| `voice_downgraded` | giọng chất lượng cao không dùng được → cả tập đọc bằng giọng dự phòng |
| `audio_format_fallback` | máy chủ thiếu ffmpeg → lưu WAV, dung lượng gấp ~10, không tua được |
| `duration_off_target` | thời lượng lệch > 30% so với mục tiêu |
| `target_clamped` | nguồn không đủ nên server đã hạ số phút |

Danh sách rỗng khi mọi thứ bình thường.

---

## 5. `GET /tools/audio-overview/{task_id}/file` — tải audio

Trả **bytes** (`audio/mpeg` hoặc `audio/wav`), stream. Cần header `Authorization`.

```js
const res = await fetch(`/tools/audio-overview/${taskId}/file`, {
  headers: { Authorization: `Bearer ${token}` },
});
const url = URL.createObjectURL(await res.blob());
```

| Mã | Nghĩa |
|---|---|
| `409` | tập **chưa xong hoặc `task_id` không tồn tại** — cả hai đều đọc là "chưa có kết quả", vì Celery không phân biệt được id lạ với việc đang xếp hàng. Poll `status` trước |
| `404` | tập đã xong nhưng file audio không còn trên kho |

---

## 6. `POST /tools/audio-overview/{task_id}/cancel` — huỷ

```json
{ "task_id": "...", "status": "cancel_requested", "timestamp": "..." }
```

Huỷ **hợp tác**: lệnh được ghi nhận ngay, tập dừng sau khi xong lô TTS đang chạy (vài giây). Gọi nhiều lần vô hại.

## 7. `DELETE /tools/audio-overview/{task_id}` — xoá

```json
{ "task_id": "...", "status": "ok", "deleted": true }
```

`409` nếu tập đang chạy → huỷ trước rồi xoá.

---

## Bốn quy tắc dễ sai

1. **Nhận biết "xong" bằng `object_key`**, không phải bằng `status` — tập hoàn tất không mang trường `status`.
2. **Không gửi `startTime` khi poll.** Bộ kiểm zombie của gateway thấy body không có `status` sẽ coi là kẹt và ghi đè thành `FAILURE`, phá tập đã render xong.
3. **`conversation_id` đặt trong body.** Gateway không chuyển tiếp query param; thiếu thì tập rơi vào thư mục `no-session`.
4. **`status: "cancelled"` là trạng thái kết thúc.** Không xử lý như terminal sẽ poll vô hạn.

## Mã lỗi dùng chung

| Mã | Nghĩa |
|---|---|
| `400` | body không phải JSON hợp lệ, hoặc sai tổ hợp trường |
| `401` | thiếu / sai / hết hạn token |
| `403` | máy chủ tắt tính năng |
| `422` | sai kiểu, sai enum, vượt giới hạn |
| `500` | lỗi phía máy chủ — `message` là câu tiếng Việt, chi tiết kỹ thuật nằm ở log |
| `502` | gateway không gọi được dịch vụ AI |

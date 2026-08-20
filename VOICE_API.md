# API giọng nói

**Base URL**: `http://<host>:5050` · **Auth**: `Authorization: Bearer <token>` (từ `POST /login`)
Qua Node proxy FE: STT thêm tiền tố `/llm` (proxy cắt), audio-overview giữ nguyên `/tools`.

| # | Method | Path |
|---|---|---|
| 1 | POST | `/stt/transcribe` |
| 2 | POST | `/tools/audio-overview/estimate` |
| 3 | POST | `/tools/audio-overview` |
| 4 | GET | `/tools/audio-overview/status/{task_id}` |
| 5 | GET | `/tools/audio-overview/{task_id}/file` |
| 6 | POST | `/tools/audio-overview/{task_id}/cancel` |
| 7 | DELETE | `/tools/audio-overview/{task_id}` |

---

## 1. POST `/stt/transcribe`

`multipart/form-data`

| Tham số | Kiểu | Bắt buộc | Giới hạn |
|---|---|---|---|
| `file` | file | ✔ | WAV 16 kHz mono 16-bit · ≤ 25 MB · đuôi: `.wav .webm .ogg .opus .m4a .mp3 .flac .aac` |
| `language` | string | | `vi` (mặc định) |

```bash
curl -X POST http://host:5050/stt/transcribe \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@voice.wav;type=audio/wav" -F "language=vi"
```

```js
const form = new FormData();
form.append("file", blob, "voice.wav");
form.append("language", "vi");
fetch("/llm/stt/transcribe", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
  body: form,
});
```

**200**

```json
{
  "text": "Kiểm tra dịch vụ đọc tiếng Việt.",
  "raw_text": "KIỂM TRA DỊCH VỤ ĐỌC TIẾNG VIỆT",
  "language": "vi",
  "duration_ms": 1416,
  "segments": [{ "start_ms": 0, "end_ms": 1416, "text": "..." }]
}
```

| Lỗi | |
|---|---|
| 403 | STT tắt |
| 413 | > 25 MB |
| 415 | đuôi file không hỗ trợ |
| 422 | file rỗng · < 250 ms · không nghe ra chữ |
| 503 | engine chưa nạp |

---

## 2. POST `/tools/audio-overview/estimate`

| Tham số | Kiểu | Ghi chú |
|---|---|---|
| `text` \| `document_ids` \| `document_id` | string \| string[] | một trong ba |
| `mode` | enum | `narration` \| `podcast` |

```bash
curl -X POST http://host:5050/tools/audio-overview/estimate \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"document_ids":["d1","d2"],"mode":"narration"}'
```

**200**

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

| Lỗi | |
|---|---|
| 400 | thiếu nguồn |
| 404 | gateway chưa có endpoint này (bản chưa ghép patch voice) |

---

## 3. POST `/tools/audio-overview`

`application/json`

| Tham số | Kiểu | Mặc định | Giá trị / giới hạn |
|---|---|---|---|
| `text` | string | — | ≥ 100 ký tự |
| `document_ids` | string[] | — | ≤ 5 |
| `document_id` | string | — | |
| `conversation_id` | string | — | ≤ 128 · đặt trong **body** |
| `mode` | enum | `narration` | `narration` \| `podcast` |
| `voice_gender` | enum | `male` | `male` \| `female` |
| `tone` | enum | `tu_nhien` | `trang_trong` \| `tu_nhien` \| `soi_noi` \| `cham_rai` |
| `length` | enum | `default` | `short` \| `default` \| `long` |
| `instruction` | string | — | chỉ `narration` · ≤ 2000 |
| `focus` | string | — | chỉ `podcast` · ≤ 500 |
| `language` | enum | `vi` | `vi` |
| `target_minutes` | int | — | 1..30 · thắng `length` |
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

**200**

```json
{ "task_id": "81cb8275-...", "status": "submitted", "timestamp": "2026-08-20T16:58:03" }
```

| Lỗi | |
|---|---|
| 400 | thiếu nguồn · body không phải JSON · `instruction` với `podcast` · `focus` với `narration` |
| 422 | sai enum · `target_minutes` ngoài 1..30 · vượt giới hạn độ dài |

---

## 4. GET `/tools/audio-overview/status/{task_id}`

Poll 3–5 s/lần.

```bash
curl http://host:5050/tools/audio-overview/status/$TASK_ID \
  -H "Authorization: Bearer $TOKEN"
```

**Đang chạy**

```json
{
  "status": "processing",
  "task_id": "...",
  "message": "Tổng quan âm thanh đang được tạo, vui lòng chờ.",
  "progress": { "done": 7, "total": 23, "note": "tts 7/23" }
}
```

`note`: `sources` → `script` → `tts n/m` → `stitch` → `uploaded`

**Xong** — có `object_key`, không có trường `status`

```json
{
  "task_id": "...",
  "object_key": "audio-overviews/123/20-08-2026/ep_81cb8275.mp3",
  "audio_format": "mp3",
  "duration_sec": 641.6,
  "size_bytes": 10265900,
  "transcript": [{ "speaker": "narrator", "text": "..." }],
  "metadata": {
    "mode": "narration",
    "voice_gender": "male",
    "tone_label": "Trang trọng",
    "length": "default",
    "target_minutes": 4,
    "sources": { "compacted": [{ "id": "d1", "name": "...", "tokens_before": 9000, "tokens_after": 1200 }] },
    "warnings": [{ "code": "duration_off_target", "message": "Thời lượng thực tế 1.3 phút, lệch 34%…" }]
  }
}
```

`speaker`: `host` \| `guest` \| `narrator`

**Kết thúc khác**

```json
{ "status": "FAILURE", "message": "<lý do>" }
{ "status": "cancelled", "task_id": "...", "message": "..." }
```

`metadata.warnings[].code`

| code | |
|---|---|
| `voice_downgraded` | tập đọc bằng giọng dự phòng |
| `audio_format_fallback` | lưu WAV thay vì mp3 |
| `duration_off_target` | thời lượng lệch > 30% |
| `target_clamped` | nguồn không đủ, số phút đã bị hạ |

---

## 5. GET `/tools/audio-overview/{task_id}/file`

Trả bytes, `audio/mpeg` hoặc `audio/wav`.

```js
const res = await fetch(`/tools/audio-overview/${taskId}/file`, {
  headers: { Authorization: `Bearer ${token}` },
});
const url = URL.createObjectURL(await res.blob());
```

| Lỗi | |
|---|---|
| 409 | tập chưa xong hoặc `task_id` không tồn tại |
| 404 | file không còn trên kho |

---

## 6. POST `/tools/audio-overview/{task_id}/cancel`

```json
{ "task_id": "...", "status": "cancel_requested", "timestamp": "..." }
```

Idempotent. Tập dừng sau lô TTS đang chạy.

---

## 7. DELETE `/tools/audio-overview/{task_id}`

```json
{ "task_id": "...", "status": "ok", "deleted": true }
```

| Lỗi | |
|---|---|
| 409 | tập đang chạy — huỷ trước |

---

## Mã lỗi chung

| | |
|---|---|
| 400 | body sai |
| 401 | thiếu / hết token |
| 403 | tính năng tắt |
| 422 | sai kiểu · sai enum · vượt giới hạn |
| 500 | lỗi máy chủ |
| 502 | không gọi được dịch vụ AI |

## Ràng buộc hợp đồng

- Tập xong: nhận biết bằng `object_key`, không phải `status`.
- Không gửi `startTime` khi poll status.
- `conversation_id` trong body, không dùng query param.
- `status: "cancelled"` là trạng thái kết thúc.
- File audio tải bằng blob kèm `Authorization`.

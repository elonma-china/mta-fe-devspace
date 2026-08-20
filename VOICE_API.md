# Tích hợp API giọng nói vào FE

Hướng dẫn cho đội FE ghép **nút mic (STT)** và **Tổng quan âm thanh (TTS)** vào phần mềm.
Mỗi bước có kèm file tham chiếu trong `mta-fe-devspace` — bản đã chạy thật, cứ mở ra đối chiếu.

---

## 0. Đường đi của một request

```
Trình duyệt ──► frontend-server (Node proxy) ──► gateway FastAPI ──► AI :5001 ──► serving :5003
                     /db  /llm  /tools                                (voice)     (TTS + STT)
```

FE **không bao giờ** gọi thẳng `:5001` / `:5003`. Mọi thứ đi qua proxy → gateway.

### ⚠ Bẫy số 1 — tiền tố proxy không đồng nhất

| Tiền tố | Proxy làm gì | Trình duyệt gọi | Gateway nhận |
|---|---|---|---|
| `/db` | **cắt** tiền tố | `/db/login` | `/login` |
| `/llm` | **cắt** tiền tố | `/llm/stt/transcribe` | `/stt/transcribe` |
| `/tools` | **GIỮ** nguyên | `/tools/audio-overview` | `/tools/audio-overview` |

Và quy tắc `/tools` **khác nhau giữa dev và production** vì hai môi trường dùng hai bản
`http-proxy-middleware`:

| Môi trường | Bản | Cấu hình đúng |
|---|---|---|
| `npm start` (CRA dev-server) | 2.0.9 — đọc `req.originalUrl` | **KHÔNG** `pathRewrite` |
| `frontend-server` (production) | 3.0.5 — đọc `req.url` đã bị Express cắt | **PHẢI** `pathRewrite: { '^/': '/tools/' }` |

> Đồng bộ hai file cho "giống nhau" là làm hỏng một trong hai. Triệu chứng: **mọi** tool trả 404
> qua proxy trong khi gọi thẳng gateway vẫn 401 → đó là mất tiền tố, không phải sai route.
>
> 📁 `frontend-server/server.js` · `frontend/src/setupProxy.js`

---

## 1. Lấy token

```js
POST /db/login   { username, password }   →   { token | access_token, user }
```

Mọi request bên dưới cần header `Authorization: Bearer <token>`.

---

# Phần A — Nút mic (STT)

## Bước A1. Ghi âm thành WAV **trong trình duyệt**

Dùng `AudioWorklet`/`ScriptProcessor` + tự đóng gói WAV. **Không dùng `MediaRecorder`.**

- Chrome cho ra `webm/opus`; dịch vụ STT phải đẩy mọi thứ không phải WAV qua `ffmpeg`,
  máy chủ thiếu `ffmpeg` sẽ trả **503**.
- Định dạng cần: **WAV 16 kHz, mono, 16-bit**.

> 📁 `frontend/src/utils/wavEncoder.js` · `frontend/src/hooks/useVoiceRecorder.js`

**Micro cần secure context**: `getUserMedia` chỉ chạy trên **HTTPS hoặc `localhost`**.
Mở bằng `http://<ip>` là không có mic — hãy làm nút mờ đi kèm lý do, đừng để nút chết câm.

## Bước A2. Gửi lên

```js
const form = new FormData();
form.append("file", blob, "voice.wav");   // TÊN FILE QUAN TRỌNG
form.append("language", "vi");
POST /llm/stt/transcribe                  // multipart, KHÔNG tự đặt Content-Type
```

> ⚠ **Bẫy số 2** — dịch vụ chặn theo **đuôi tên file**. Blob vô danh bị từ chối **415** trước khi
> giải mã. Luôn đặt tên `voice.wav`.

Trần dung lượng **25 MB** (26.214.400 byte) — vượt là **413**.

> 📁 `frontend/src/features/chat/api/stt.js`

## Bước A3. Đọc kết quả

```json
{
  "text": "Kiểm tra dịch vụ đọc tiếng Việt.",
  "raw_text": "KIỂM TRA DỊCH VỤ ĐỌC TIẾNG VIỆT",
  "language": "vi",
  "duration_ms": 1416,
  "segments": [{ "start_ms": 0, "end_ms": 1416, "text": "..." }]
}
```

Hiển thị **`text`** (đã chuẩn hoá hoa/thường, dấu câu). `raw_text` viết HOA toàn phần, chỉ để đối chiếu.

**Đưa chữ vào ô nhập, đừng tự gửi đi** — STT không đủ chính xác để thay người dùng bấm gửi.

## Bảng mã lỗi STT — mỗi mã một hành động khác nhau

| Mã | Nghĩa | Nói gì với người dùng |
|---|---|---|
| 401 | thiếu/hết token | đăng nhập lại |
| 403 | máy chủ tắt tính năng | không phải lỗi người dùng |
| 413 | đoạn ghi quá dài | ghi ngắn lại |
| 415 | định dạng không hỗ trợ | thường là quên đặt tên file |
| 422 | rỗng / quá ngắn (<250 ms) / không nghe ra chữ | **giữ nguyên `detail` của server** — nó nói rõ nhấn giữ lâu hơn hay nói to hơn |
| 503 | engine chưa nạp | thử lại sau |

> ⚠ **Bẫy số 3** — đừng gộp hết thành "Lỗi kết nối". 422 gộp nhiều nguyên nhân rất khác nhau, và
> server đã trả câu tiếng Việt hành động được; ưu tiên hiện `detail` khi nó là câu hoàn chỉnh.
>
> 📁 `sttErrorMessage()` trong `frontend/src/features/chat/api/stt.js`

---

# Phần B — Tổng quan âm thanh (TTS)

Tập được render **nền** bằng Celery: submit → nhận `task_id` → poll → tải file.

## Bước B1. Ước tính độ dài **trước khi** cho chọn

```js
POST /tools/audio-overview/estimate
{ "document_ids": ["d1","d2"], "mode": "narration" }
→ { "source_words": 600, "feasible_minutes": 5,
    "lengths": { "short": 2, "default": 4, "long": 5 }, "max_minutes": 30 }
```

Chỉ đếm chữ, **không gọi LLM**, trả về tức thì.

**Không hỏi người dùng số phút.** Họ không biết một tập 30 phút cần bao nhiêu tài liệu — xin 30 phút
từ 500 từ chỉ tổ đẻ ra chữ độn. Cho chọn **Ngắn / Mặc định / Dài**, kèm số phút ước tính trên nhãn.

Ước tính hỏng thì **im lặng, không chặn** — đây là gợi ý, không phải cổng chặn.

> 📁 `AudioOverviewModal.js` (khối `AUDIO_LENGTHS`)

## Bước B2. Submit

```js
POST /tools/audio-overview
{
  "language": "vi",
  "mode": "narration",          // "narration" | "podcast"
  "voice_gender": "male",       // "male" | "female"
  "tone": "tu_nhien",           // trang_trong | tu_nhien | soi_noi | cham_rai
  "length": "default",          // short | default | long
  "conversation_id": "123",     // BẮT BUỘC nếu muốn tập gắn với hội thoại
  "instruction": "...",         // narration, ≤ 2000 ký tự
  "document_ids": ["d1"]        // tối đa 5; hoặc dùng "text"
}
→ { "task_id": "...", "status": "submitted", "timestamp": "..." }
```

Ràng buộc: `focus` (≤500) chỉ cho `podcast`, `instruction` (≤2000) chỉ cho `narration` — gửi sai chỗ
là **400**. Nguồn dưới **100 ký tự** thì tập sẽ FAILURE.

> ⚠ **Bẫy số 4** — `conversation_id` phải nằm trong **body**. Gateway chỉ chuyển tiếp body, query param
> rụng mất và mọi tập rơi vào thư mục `no-session`.

## Bước B3. Poll trạng thái

```js
GET /tools/audio-overview/status/{task_id}
```

| Đang chạy | Xong | Hỏng |
|---|---|---|
| `status: "processing"` + `progress: {done, total, note}` | **`object_key` xuất hiện**, `status` = `null` | `status: "FAILURE"` + `message` |

> ⚠ **Bẫy số 5 (đắt nhất)** — tập đã xong **không có** trường `status`. Suy ra hoàn tất bằng **sự tồn
> tại của `object_key`**, đừng chờ một giá trị status nào cả.
>
> Và **đừng gửi `startTime`** khi poll: bộ kiểm zombie của gateway thấy body không có `status` sẽ coi là
> "kẹt" và ghi đè thành `FAILURE`, **phá tập đã render xong**. Trần chờ để phía client tự giữ.

`progress.note` là tên pha thật (`script`, `tts 7/23`, `stitch`) — hiện thẳng cho người dùng.
`status: "cancelled"` là trạng thái **kết thúc**, phải xử lý như terminal nếu không sẽ poll vô hạn.

> 📁 `useTaskPoller.js` · `classifyStatus()` trong `stores/useAudioOverviewStore.js`

## Bước B4. Đọc kết quả và **hiện cảnh báo**

```json
{
  "object_key": "audio-overviews/123/20-08-2026/ep_<task>.mp3",
  "audio_format": "mp3", "duration_sec": 641.6, "size_bytes": 10265900,
  "transcript": [{ "speaker": "narrator", "text": "..." }],
  "metadata": {
    "mode": "narration", "voice_gender": "male", "tone_label": "Trang trọng",
    "length": "default", "target_minutes": 4,
    "sources": { "compacted": [...] },
    "warnings": [{ "code": "...", "message": "..." }]
  }
}
```

**`metadata.warnings` phải được hiển thị.** Ba tình huống dưới đây đều trả tập bình thường,
không mã lỗi nào — không hiện thì người dùng chờ xong mà không biết mình nhận bản đã xuống cấp:

| `code` | Nghĩa |
|---|---|
| `voice_downgraded` | giọng chất lượng cao không dùng được, cả tập đọc bằng giọng dự phòng |
| `audio_format_fallback` | máy chủ thiếu ffmpeg → lưu WAV, to gấp ~10, không tua được |
| `duration_off_target` | thời lượng lệch xa số phút đã tính |
| `target_clamped` | nguồn không đủ nên đã hạ số phút |

`metadata.sources.compacted` liệt kê tài liệu bị nén cho vừa ngữ cảnh — cũng nên nói ra.

> 📁 `AudioOverviewPanel.js`

## Bước B5. Phát file

```js
GET /tools/audio-overview/{task_id}/file    // fetch dạng BLOB, kèm Authorization
const url = URL.createObjectURL(blob);      // rồi mới gán vào <audio src>
```

> ⚠ Không trỏ thẳng `<audio src>` vào endpoint: thẻ media **không gửi header `Authorization`**.
> Nhớ `URL.revokeObjectURL()` khi đóng — mỗi tập vài chục MB.

## Bước B6. Huỷ và xoá

| Việc | Gọi | Trả về |
|---|---|---|
| Huỷ giữa chừng | `POST /tools/audio-overview/{id}/cancel` | `{ status: "cancel_requested" }` — huỷ **hợp tác**, dừng sau một lô TTS |
| Xoá tập | `DELETE /tools/audio-overview/{id}` | **409** nếu đang chạy → huỷ trước rồi xoá |

---

## Lưu tập ở đâu

Tập **không** nằm trong DB (ràng buộc `info_table_type_check` chỉ cho 4 loại). Bản devspace giữ ở
`localStorage`, khoá `im.audioOverview.<conversationId>.<mode>`.

> Đổi tên khoá thì **phải kèm bước migration**: một tập chạy 45 phút mà handle duy nhất là cái khoá này
> — đổi tên mà không chuyển giá trị là bỏ rơi job đang chạy: không thấy, không huỷ được, vẫn đang render.
>
> 📁 `hydrate()` trong `stores/useAudioOverviewStore.js`

---

## Bảng tra file tham chiếu

| Việc | File trong `mta-fe-devspace` |
|---|---|
| Proxy `/db` `/llm` `/tools` | `frontend-server/server.js` · `frontend/src/setupProxy.js` |
| Mã hoá WAV | `frontend/src/utils/wavEncoder.js` |
| Ghi âm + đo mức | `frontend/src/hooks/useVoiceRecorder.js` |
| Nút mic + đồng hồ + phổ | `features/chat/components/MicButton.js` · `VoiceWaveform.js` |
| Gọi STT + dịch mã lỗi | `features/chat/api/stt.js` |
| Gọi 6 API tập | `features/analysis/api/audioOverview.js` |
| Modal chọn giọng/tông/độ dài | `features/analysis/components/AudioOverviewModal.js` |
| Panel nghe + transcript + cảnh báo | `features/analysis/components/AudioOverviewPanel.js` |
| Dòng trạng thái + poll | `features/analysis/components/AudioOverviewTool.js` · `hooks/useTaskPoller.js` |
| Store + localStorage | `stores/useAudioOverviewStore.js` |
| Gateway (tham chiếu backend) | `backend-fastapi/app/routes/voice.py` · `llm.py` |

---

## Checklist trước khi bàn giao

- [ ] `/tools` giữ tiền tố ở production, **không** giữ ở dev-server
- [ ] Blob ghi âm luôn có tên `voice.wav`
- [ ] Nút mic mờ + nêu lý do khi không có secure context
- [ ] Poll **không** gửi `startTime`; nhận biết "xong" bằng `object_key`
- [ ] `status: "cancelled"` xử lý như trạng thái kết thúc
- [ ] `metadata.warnings` được hiển thị
- [ ] File tải bằng blob + `Authorization`, có `revokeObjectURL`
- [ ] Mã lỗi STT giữ nguyên `detail` của server, không gộp thành một câu chung
- [ ] Xoá tập đang chạy: huỷ trước, xử lý 409

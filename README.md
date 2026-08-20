# DEV SPACE — bản thử nghiệm Voice RAG

> ⚠️ **Đây KHÔNG phải bản thật.** Bản sao của `mta-fe-intramind@devops 8002093f`
> (2026-07-31), đổi màu **đỏ** + logo **"DEV SPACE"**, ghép sẵn voice để dùng thử
> trước khi đội FE tích hợp vào bản thật. Bản thật vẫn chạy ở `:8001`/`:5050`.

| | Dev Space | Bản thật |
|---|---|---|
| Frontend | `:18001` | `:8001` |
| Gateway | `:15050` | `:5050` |
| AI | `:15001` (có voice) | `:5001` |
| Corpus | **chỉ đọc** corpus thật | đọc–ghi |

### Khác gì bản thật

1. **Nút mic** trong ô chat → ghi âm → STT → điền chữ vào ô nhập (không tự gửi).
2. **Tổng quan âm thanh** — 2 kiểu nội dung, chọn được giọng và tông giọng; có player + transcript + huỷ/xoá.

   | Kiểu | Kịch bản | Giọng |
   |---|---|---|
   | **Podcast 2 người dẫn** | hội thoại hỏi–đáp | chọn giọng người dẫn, khách mời tự lấy giọng còn lại |
   | **Bản đọc theo yêu cầu** | 1 người đọc bản tóm tắt viết theo ô "Yêu cầu" | 1 giọng |

   - **Giọng**: nam / nữ. **Tông giọng**: Trang trọng · Tự nhiên · Sôi nổi · Chậm rãi.
   - **Độ dài**: Ngắn · Mặc định · Dài (kiểu NotebookLM) — **không nhập số phút**.
     Máy chủ suy số phút từ chính nguồn đã chọn, nên mọi lựa chọn đều khả thi;
     modal hiện luôn ước tính "Ngắn · ~5 phút" ngay khi chọn xong tài liệu.
   - **Chỉ tiếng Việt** — không còn lựa chọn ngôn ngữ; nhánh tiếng Anh đã gỡ khỏi cả 3 tầng.
   - Mỗi sổ ghi chú giữ **1 tập mỗi kiểu** → podcast và bản đọc cùng tồn tại được.
   - Bảng nghe tập có nút **← Quay lại** (nó thay chỗ cả lưới công cụ nên đây là lối ra),
     và khi tải tệp hỏng thì báo **mã lỗi** kèm nút **Thử lại** — không phải tạo lại tập.
3. **Màu đỏ + logo DEV SPACE** — bật bởi `REACT_APP_BRAND=devspace`; bỏ biến này là về teal IntraMind.
4. **Chặn ghi corpus** — `DEV_READONLY_CORPUS=true` khiến upload/xoá/xử-lý-lại tài liệu trả `403`.
   Kéo tài liệu thật vào hội thoại bằng **"Chọn từ kho"** (link-repository, không ghi upstream).

### ⚠️ Micro cần secure context

`getUserMedia` chỉ chạy trên **HTTPS hoặc `localhost`**. Mở bằng IP trần → **không có mic**
(nút sẽ mờ và báo lý do, không phải nút chết câm).

```bash
ssh -L 18001:localhost:18001 ccoex@100.108.33.98   # rồi mở http://localhost:18001
```

---

## Triển khai trên ccoex

Dev Space chạy **song song** stack thật trên cùng máy, trong cây riêng
`~/devspace/` (không nằm trong `~/Desktop/intramind_staging`). Thứ tự bắt buộc:

| # | Bước | Lệnh | Cổng |
|---|---|---|---|
| 0 | Lấy mã nguồn | `git clone https://github.com/elonma-china/mta-fe-devspace.git ~/devspace/mta-fe-devspace` | — |
| 1 | Cài đặt lần đầu (clone backend, venv, model, ffmpeg, `.env`) | `ops/devspace-bootstrap.sh` | — |
| 2 | Dựng backend voice | `ops/devspace-up.sh` (hoặc `SKIP_LIVE=1 ops/restore-all.sh`) | AI `15001`, serving `15003`, redis `16379`, minio `19000` |
| 3 | Dựng FE Dev Space | xem lệnh đầy đủ bên dưới | FE `18001`, gateway `15050`, pg `15432`, mongo `37018` |
| 4 | Nghiệm thu | `PORT_OFFSET=10000 COMPOSE_PROJECT=devspace-fe SKIP_PYTEST=1 ./deploy/03-test.sh` | — |
| — | Gỡ sạch | `ops/devspace-down.sh` | — |

Lệnh bước 3 — bốn biến in đậm là thứ giữ Dev Space **không đụng** bản thật; thiếu
biến nào thì `02-up.sh` rơi về mặc định của bản thật và giẫm lên nó:

```bash
IM_REGISTRY=devspace IM_TAG=devspace NETWORK_NAME=devspace_net \
PORT_OFFSET=10000 COMPOSE_PROJECT=devspace-fe ./deploy/02-up.sh
```

| Thứ bị tách | Dev Space | Bản thật |
|---|---|---|
| Cổng (`PORT_OFFSET=10000`) | 18001 / 15050 / 15432 / 37018 | 8001 / 5050 / 5432 / 27018 |
| Ảnh Docker (`IM_REGISTRY`/`IM_TAG`) | `devspace/fe*:devspace` | `intramind-client-*` |
| Container + volume (`docker/.env`) | `devspace-` / `devspace_` | `intramind-` / `intramind_` |
| Mạng (`NETWORK_NAME`) | `devspace_net` | `intramind_net` |
| Redis / MinIO | `:16379` / `:19000` | `:6379` / `:9000` |

`docker/.env` bắt buộc có:

```ini
IM_REGISTRY=devspace                # ảnh riêng, không đè ảnh bản thật
IM_TAG=devspace
CONTAINER_PREFIX=devspace-
VOLUME_PREFIX=devspace_
NETWORK_NAME=devspace_net
REACT_APP_BRAND=devspace
DEV_READONLY_CORPUS=true            # chốt chặn thật (gateway)
REACT_APP_READONLY_CORPUS=true      # lớp UX (ẩn nút upload) — phải bằng dòng trên
AI_SERVICE_HOST=http://host.docker.internal:15001/api/v1   # AI voice
AI_INGEST_HOST=http://host.docker.internal:5002/api/v1     # BE thật, chỉ đọc
JWT_SECRET=<openssl rand -hex 32>   # KHÔNG tái dùng secret của bản thật
```

Backend voice mà FE này cần (nhánh `feature-voiceRAG`, ghim trong bootstrap):

| Repo | Commit | Phải có |
|---|---|---|
| `mta-ai-intramind` | `985698a` | `tools/audio_overview_utils/tone.py`, nhận `mode`/`voice_gender`/`tone` |
| `mta-ai-serving-intramind` | `9f93248` | `vieneu==3.2.6` + `onnxruntime`, `/api/v1/voices` trả 4 giọng |

Bản cũ hơn (thời Piper) **không dùng được**: submit Tổng quan âm thanh sẽ lỗi vì
backend không biết `voice_gender`/`tone`.

### 3 luật an toàn (stack thật dùng chung máy)

1. **Không bao giờ `pkill -f uvicorn`** — sẽ giết cả AI/BE/embedding thật. Kill **theo cổng**.
2. **Không `apt install`** — một lần apt trên máy này đã nâng driver NVIDIA giữa chừng
   và giết mọi container GPU mới. ffmpeg lấy bản static vào `~/devspace/bin`.
3. **Không `git checkout`** trong `~/Desktop/intramind_staging` — đó là cây live và
   checkout AI đang có việc chưa commit.

**Redis + MinIO phải riêng, không thoả hiệp.** Celery của bản thật cùng tên app
(`intramind_worker`), cùng broker db, và danh sách queue mặc định của worker
**trùng 5 queue** với live → dùng chung broker là worker dev **ăn mất** summary/report
của người dùng thật. `ENABLE_RERANKER=false` cũng là bắt buộc: card chỉ còn ~3.7 GB,
nạp thêm một jina-v3 sẽ **OOM chính LLM trả lời của bản thật**.

---

## Bàn giao voice cho đội FE

> 📄 **Tài liệu API cho đội FE: [`VOICE_API.md`](VOICE_API.md)** — 7 endpoint, bảng tham số,
> ví dụ curl + fetch, bảng mã lỗi, và 4 quy tắc dễ sai của hợp đồng.

Skin nằm sau cổng `REACT_APP_BRAND` nên tách sạch được phần voice:

```bash
git diff 1814dd7..HEAD -- \
  backend-fastapi/ \
  frontend/src/utils/wavEncoder.js frontend/src/hooks/useVoiceRecorder.js \
  frontend/src/features/chat/ frontend/src/features/analysis/ \
  frontend/src/stores/useAudioOverviewStore.js \
  > voice-rag-fe.patch
```

5 điều phải nói kèm patch:

1. **Không gửi `startTime`** khi poll audio-overview. Tập xong **không có** field
   `status`, mà `_apply_zombie_check` đọc body không có `status` là "kẹt" → quá
   `ZOMBIE_TASK_TIMEOUT_MS` sẽ ghi đè thành `FAILURE`, **phá tập đã xong**. Trần chờ
   chuyển sang phía client (`AUDIO_OVERVIEW_MAX_WAIT_MS`).
2. **Mã hoá WAV trong trình duyệt**, đừng dùng `MediaRecorder`. Chrome cho ra
   `webm/opus`, dịch vụ STT đẩy mọi thứ không phải WAV sang ffmpeg → `503` nếu máy
   thiếu ffmpeg.
3. **Episode đang nằm ở `localStorage`**, không phải `info_table`, vì CHECK constraint
   `info_table_type_check` chỉ cho 4 type. Muốn đưa vào DB thì cần `migrate_011.sql`.

---

4. **Submit audio-overview KHÔNG đi qua catch-all `/tools/{tool}`.** Catch-all trả
   `parsed` mà không kiểm `upstream.status_code`, nên lỗi 422 của AI về trình duyệt
   thành **HTTP 200 kèm lỗi trong body** — FE đọc `ApiError.status` nên coi là thành
   công rồi poll một `task_id` `undefined` mãi mãi. Đã khai route tường minh
   `POST /tools/audio-overview` phía trên catch-all (`backend-fastapi/app/routes/llm.py`).
   Các tool khác vẫn giữ hành vi cũ — sửa catch-all là đổi hành vi của cả 4 tool.
5. **Khoá localStorage là `im.audioOverview.<convId>.<mode>`.** Bản trước khoá theo
   hội thoại; `hydrate` có bước migration chuyển khoá cũ sang slot `podcast`. **Đừng
   bỏ bước đó** — một tập chạy 45 phút mà handle duy nhất là cái khoá này, đổi tên
   khoá mà không chuyển giá trị sẽ bỏ rơi job đang chạy: không thấy, không huỷ được,
   vẫn đang render.

## Kiến trúc gốc (kế thừa từ mta-fe-intramind)

Tier người dùng của IntraMind: SPA React + Node proxy + gateway/BFF FastAPI
(auth, RBAC, Postgres, Mongo). Là tier **cuối** trong thứ tự dựng
`infra → serving → be → ai → fe`.

## Kiến trúc

```
Trình duyệt ─► frontend (:3000, publish :8001) ─► backend (:5050, gateway/BFF)
               SPA + proxy /db /llm /tools          │  AI_SERVICE_HOST ─► ai-api:5001
                                                    │  AI_INGEST_HOST  ─► be-api:5002
                                                    ├─ sql-db  :5432  (users/RBAC/units/audit)
                                                    └─ nosql-db:27017 (nội dung tin nhắn)
```

Truy cập chính thức đi qua nginx của tier infra (`:8080`) → `frontend:3000`.

## Thư mục

| Thư mục | Nội dung |
|---|---|
| `frontend/` | SPA React 19 (Create React App, `react-scripts`) |
| `frontend-server/` | Node/Express: serve build + proxy `/db` `/llm` `/tools` sang gateway |
| `backend-fastapi/` | Gateway/BFF FastAPI — auth, RBAC, proxy sang AI/BE |
| `db/psql/`, `db/mongo/` | `init.sql` (volume mới) + `migrate_NNN.sql` (DB đang chạy) |
| `docker/` | Dockerfile + `docker-compose-v2.yml` + `.env.example` |
| `deploy/` | Kit 5 script: check → up → test → bundle offline |

## Chạy bằng Docker (khuyến nghị)

```bash
cp docker/.env.example docker/.env   # BẮT BUỘC đổi JWT_SECRET
./deploy/start.sh                    # 01-check → 02-up → 03-test
```

Mở `http://localhost:8001`, đăng nhập `admin` / `admin` (user seed — đổi ngay).

| Cổng | Service | Ghi chú |
|---|---|---|
| 8001 | frontend | không dùng 3000 (đụng langfuse / dev server) |
| 5050 | gateway | `up-all.sh` gate bằng `GET /health` |
| 5432 | Postgres | |
| 27018 | Mongo | không dùng 27017 (đụng Mongo của tier infra) |

Chi tiết đóng gói / bundle offline: **`deploy/README.md`**; chi tiết compose và
migration: **`docker/README.md`**.

## Trạng thái tài liệu: gateway tự nghe Redis (bug 1, 2026-07-31)

Tier BE publish `completed`/`failed` lên Redis pub/sub (`doc-status:{conv_id}`,
db 2) ngay khi số hoá xong. Gateway **tự subscribe** lúc khởi động
(`app/services/status_listener.py`) và ghi trạng thái cuối vào Postgres — không
cần trình duyệt nào mở, không cần F5.

| Biến env (compose đã có default) | Giá trị mặc định |
|---|---|
| `STATUS_LISTENER_ENABLED` | `true` (`false` = quay về chỉ-poll) |
| `REDIS_URL` | `redis://redis:6379` |
| `STATUS_PUBSUB_REDIS_DB` | `2` |
| `STATUS_PUBSUB_CHANNEL_PREFIX` | `doc-status` |

- **3 giá trị sau phải TRÙNG `.env` của `mta-be-intramind`** — lệch là im lặng,
  listener không nhận gì.
- Dependency mới: `redis==5.2.1` (`backend-fastapi/requirements.txt`).
- `/admin/documents/{id}/status` (kéo) vẫn hoạt động — là đường dự phòng khi
  Redis rớt.

## Viewer: focus trích dẫn tự giữ qua reflow (bug 2/3/4, 2026-07-31)

Mọi cú cuộn-tới-trích-dẫn (DocumentViewer, PdfCitationView, FileOriginalView)
đều **re-áp cho tới khi người dùng tự thao tác** (wheel/touch/mousedown/keydown)
— vì hoạt ảnh mở panel 200 ms, placeholder PDF nở/co khi render thật, và ảnh
docx decode muộn đều dịch nội dung SAU khi đã cuộn. Đừng quay lại kiểu cuộn
một-lần: đó chính là nguồn của cả ba bug (lệch khi mở lại trích dẫn, mất
highlight, popup rà soát đứng sai trang).

## Chạy dev (không Docker)

```bash
cd backend-fastapi && uv venv && uv sync && uv run uvicorn app.main:app --port 5050
cd frontend        && npm ci && npm start      # :3000, proxy qua setupProxy.js
```

## Quy tắc bắt buộc: phải chọn tài liệu trước khi hỏi

Gateway trả **400 `"Vui lòng chọn ít nhất một tài liệu để hỏi đáp."`** khi lượt hỏi
không kèm tài liệu nào — kể cả hội thoại còn trống.

- **Vì sao:** tier AI không có tầng lọc theo người dùng/đơn vị. Bỏ trống lựa chọn
  thì `document_ids: []` xuống tới AI, mà `qdrant.py`/`elasticsearch.py` gate
  `if document_ids:` nên mảng rỗng = "không lọc" = trả lời từ **toàn bộ kho**.
- **Đo được 2026-07-30:** user thường đơn vị 3 hỏi trong hội thoại trống và nhận
  trọn tài liệu riêng của admin đơn vị 1. Gateway là chỗ duy nhất biết ai được đọc gì.
- Luật cũ chỉ chặn khi hội thoại **đã có** tài liệu (`doc_id_set and not selected_ids`)
  — đừng khôi phục.


## Test

```bash
cd backend-fastapi && uv run pytest        # gateway
cd frontend        && npm test             # jest (CRA)
```

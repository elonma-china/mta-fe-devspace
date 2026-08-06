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
2. **Tổng quan âm thanh** — sinh podcast 2 người dẫn từ tài liệu, có player + transcript + huỷ/xoá.
3. **Màu đỏ + logo DEV SPACE** — bật bởi `REACT_APP_BRAND=devspace`; bỏ biến này là về teal IntraMind.
4. **Chặn ghi corpus** — `DEV_READONLY_CORPUS=true` khiến upload/xoá/xử-lý-lại tài liệu trả `403`.
   Kéo tài liệu thật vào hội thoại bằng **"Chọn từ kho"** (link-repository, không ghi upstream).

### Micro cần secure context

`getUserMedia` chỉ chạy trên HTTPS hoặc `localhost`. Mở bằng IP trần sẽ **không có mic**.
Cách dùng: `ssh -L 18001:localhost:18001 <vps>` rồi mở `http://localhost:18001`.

---

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

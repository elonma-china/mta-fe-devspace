# deploy/ — kit dựng & đóng gói offline tier FE

Cùng khuôn 5 script với `mta-be-intramind`, `mta-ai-intramind`, `mta-ai-serving-intramind`.

## Script

| Script | Việc | Ghi chú |
|---|---|---|
| `01-check.sh` | Tiền kiểm máy (chỉ đọc) | docker ≥ 24, đĩa/RAM, 4 cổng trống, file cấu hình, `docker/.env` |
| `02-up.sh` | Build 4 image + dựng stack + gate health | idempotent; `FORCE_BUILD=1` để build lại |
| `03-test.sh` | Nghiệm thu: pytest + S00..S12 | `WITH_FE_TESTS=1` chạy thêm jest |
| `04-make-bundle.sh` | Đóng bundle offline → `dist/fe-offline-<ngày>/` (+ `.tar`) | 5 image + repo + checksum 2 tầng |
| `start.sh` | Điểm vào một lệnh: check → up → test | tự nhận chế độ bundle/repo |

## Image (tag khai trong `docker/docker-compose-v2.yml`)

| Image | Service | Vai trò | Nén trong bundle |
|---|---|---|---|
| `intramind/fe:devops` | `frontend` | SPA + Node proxy (:3000, publish :8001) | 63 MB |
| `intramind/fe-gateway:devops` | `backend`, `db-seed` | BFF FastAPI (:5050) | 74 MB |
| `intramind/fe-sql:devops` | `sql-db` | Postgres 15 + init.sql | 109 MB — **cùng file với ↓** |
| `postgres:15-alpine` | `db-migrate` | one-shot áp migration | (0 — chia sẻ layer) |
| `intramind/fe-nosql:devops` | `nosql-db` | Mongo 7 + init-mongo.js | 278 MB |

5 image nhưng chỉ **4 file** trong `images/`: `fe-sql` chính là
`postgres:15-alpine` cộng một `init.sql`, nên hai tag được `docker save` trong
một lệnh và dùng chung layer nền — tách riêng thì mất 218 MB, gộp còn 109 MB.

## Dung lượng (đo thật, `pigz -6`)

| | |
|---|---|
| `images/` (4 file, 5 tag) | ~525 MB |
| `repo/` (loại `.git`, `node_modules`, `build`) | ~5 MB |
| Thư mục bundle | ~530 MB |
| `.tar` ngoài (tar không nén lại) | ~530 MB |
| **Đĩa cần lúc đóng** | **~1,1 GB** (ngưỡng chặn `MIN_DISK_GB=2`) |
| **Giao cho máy đích** | **~530 MB** |

Máy đích còn cần ~2,6 GB trong `/var/lib/docker` sau khi `docker load`.

## Chạy nhanh (máy dev, trong repo)

```bash
cp docker/.env.example docker/.env   # đổi JWT_SECRET
./deploy/start.sh                    # 01 → 02 → 03
```

Stack thử song song (không đụng stack thật):

```bash
PORT_OFFSET=10000 COMPOSE_PROJECT=intramind-fe-test \
CONTAINER_PREFIX=imtest- VOLUME_PREFIX=imtest_ ./deploy/02-up.sh
# dọn — 2 lệnh, không phải 1:
docker compose -p intramind-fe-test -f docker/docker-compose-v2.yml down -v
docker volume rm imtest_fe_postgres imtest_fe_mongo
```

> `down -v` **không** xoá `*_fe_postgres` / `*_fe_mongo`: volume khai `name:`
> tường minh nên compose để nguyên (kiểm chứng trên compose 5.3.1). Với stack
> thật đây là lưới an toàn cho dữ liệu; với stack thử phải xoá tay.

## Máy đích air-gap

1. Chuyển `fe-offline-<ngày>.tar` (+ `.tar.sha256`) sang máy đích.
2. `sha256sum -c fe-offline-<ngày>.tar.sha256`
3. `tar xf fe-offline-<ngày>.tar && cd fe-offline-<ngày>`
4. `./start.sh` — verify checksum → `docker load` → check → up → test.
5. Sửa `repo/docker/.env`: **đổi `JWT_SECRET`**; nếu AI/BE không cùng host docker thì trỏ lại `AI_SERVICE_HOST` / `AI_INGEST_HOST`.

## Bundle này KHÔNG phải cả hệ thống

| Cần | Từ đâu | Thiếu thì |
|---|---|---|
| mạng `intramind_net` | tier infra (`up-all.sh`) | 02-up tự tạo (có nhãn, xem dưới) — nhưng nginx/AI/BE chưa có |
| `ai-api:5001` | `mta-ai-intramind` | chat/stream 502 (login/RBAC vẫn chạy) |
| `be-api:5002` | `mta-be-intramind` | upload/tài liệu 502 |
| nginx `:8080` | tier infra | vào thẳng `:8001` thay vì cổng chính thức |

Thứ tự dựng thật: `infra → serving → be → ai → fe` — do `up-all.sh` của
`mta-infrastructure-intramind` điều phối, tier fe được gate bằng `GET :5050/health`.

**Thứ tự cài không còn quan trọng với riêng cái mạng.** `02-up.sh` tạo
`intramind_net` kèm đúng 2 nhãn compose mà tier infra kỳ vọng, nên dựng FE
trước rồi infra sau vẫn chạy, và `infra down` vẫn dọn mạng sạch. (Trước
2026-07-30 mạng tạo trần làm infra lên sau chết `exit 1` —
*incorrect label com.docker.compose.network*.) Đổi bằng `INFRA_NETWORK_KEY` /
`INFRA_PROJECT` nếu tier infra chạy với project name khác `intramind-infra`.

## Cổng & đụng độ đã biết

| Biến | Mặc định | Vì sao không phải giá trị "quen" |
|---|---|---|
| `FRONTEND_PORT` | **8001** | host 3000 đụng langfuse-web / React dev server |
| `FE_MONGO_PORT` | **27018** | 27017 là mongo của tier infra; trong mạng backend vẫn gọi `nosql-db:27017` |
| `DB_PORT` | 5432 | chỉ FE dùng Postgres trong workspace |
| `BACKEND_PORT` | 5050 | gate của up-all.sh |

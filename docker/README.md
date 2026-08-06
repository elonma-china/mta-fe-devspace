# docker/ — đóng gói tier FE

Stack 6 service trong `docker-compose-v2.yml` — file mà `up-all.sh` (repo
infra) dựng ở tier cuối: `docker compose -p intramind-fe -f docker-compose-v2.yml up -d`.
Build/dựng/nghiệm thu/đóng bundle: dùng kit **`../deploy/`** (xem `deploy/README.md`).

```
sql-db (Postgres :5432) ──► db-migrate ──► db-seed ──► backend (:5050) ──► frontend (:3000→:8001)
nosql-db (Mongo :27018→27017) ─────────────────────────┘
```

## Mạng

| Mạng | Ai tham gia | Để làm gì |
|---|---|---|
| `fe_internal` (bridge riêng) | cả 6 service | Postgres/Mongo không lộ ra ngoài tier |
| `intramind_net` (external, của repo infra) | `frontend`, `backend` | nginx infra proxy `/` → `frontend:3000`; backend gọi `ai-api:5001` / `be-api:5002` bằng DNS |

## File

| File | Vai trò |
|---|---|
| `docker-compose-v2.yml` | stack chính (tên/vị trí cố định — up-all.sh trỏ vào) |
| `Dockerfile.frontend` | SPA build (node:22-alpine, 2 stage) → `intramind/fe` |
| `Dockerfile.backend-fastapi` | BFF (python:3.12-slim-bookworm, 2 stage, non-root) → `intramind/fe-gateway` |
| `Dockerfile.psql` / `Dockerfile.mongo` | Postgres/Mongo + init script → `intramind/fe-sql` / `fe-nosql` |
| `migrate.sh` | runner của `db-migrate` (một-shot, idempotent) |
| `generate-env.sh` | ENTRYPOINT của frontend — sinh `env-config.js` lúc runtime |
| `.env.example` | chép thành `docker/.env` rồi chỉnh (bắt buộc đổi `JWT_SECRET`) |
| `docker-compose-client.yml`, `RUN-client.md`, `.env.client.stg` | đường deploy "client" cũ, giữ tham khảo — không thuộc quy ước mới |

## Migration Postgres

- Tự động: `db-migrate` chạy trước `backend` mỗi lần `up` (gate
  `service_completed_successfully`), áp các `db/psql/migrate_NNN.sql` chưa chạy,
  ghi sổ vào bảng `schema_migrations`. Idempotent.
- Chạy tay: `docker compose -p intramind-fe -f docker-compose-v2.yml run --rm db-migrate`
- Thêm migration mới: tạo `db/psql/migrate_<NNN>.sql` (3 chữ số, idempotent —
  `IF [NOT] EXISTS`); glob tự nhặt, không cần sửa compose.
- `db/psql/init.sql` chỉ seed volume **mới tinh**; đổi schema DB đang có dữ
  liệu thì viết migration, đừng sửa init.sql.

## Log rotation

Không còn khối `logging:` per-service — cấu hình một lần ở daemon
(`/etc/docker/daemon.json`), giống các tier khác:

```json
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
```

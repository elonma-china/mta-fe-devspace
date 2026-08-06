# Hướng dẫn chạy & rebuild — Stack `intramind-client` (staging)

> Stack staging **độc lập**, đổi tên từ `intramind-frontend` → `intramind-client`.
> Thay thế stack `docker-compose-v2.yml`. Project name được **pin** = `intramind-client`
> nên container/network/volume cô lập hoàn toàn, không đụng stack v2 / pnv / langfuse / minio.
>
> File liên quan: [docker-compose-client.yml](docker-compose-client.yml) · [.env.client.stg](.env.client.stg)

---

## 1. Bảng ánh xạ tên (v2 → client)

| Thành phần | v2 (cũ) | client (mới) |
|---|---|---|
| Project name | `docker` (mặc định, hay đụng) | `intramind-client` (pin) |
| Postgres | `intramind-frontend-sql-db` | `intramind-client-sql-db` |
| MongoDB | `intramind-frontend-nosql-db` | `intramind-client-nosql-db` |
| Migrate (one-shot) | `intramind-frontend-migrate` | `intramind-client-migrate` |
| Seed (one-shot) | `intramind-frontend-seed` | `intramind-client-seed` |
| Backend | `intramind-frontend-api` | `intramind-client-api` |
| Frontend | `intramind-frontend` | `intramind-client` |
| Network | `intramind-network` | `intramind-client-network` |
| Volume PG / Mongo | `docker_postgres-data` / `docker_mongo-data` | **dùng lại y nguyên** (external) |

---

## 2. Cổng (host)

| Service | Host port | Container | Ghi chú |
|---|---|---|---|
| frontend | **8001** | 3000 | Cổng truy cập web |
| backend | **5050** | 5050 | API `/health`, `/docs` |
| sql-db | **5432** | 5432 | Postgres |
| nosql-db | **27018** | 27017 | Đổi 27017→27018 để né container `mongo` độc lập |

> **DATA KHÔNG MẤT.** Stack client trỏ `external` vào đúng volume v2 đang giữ
> (`docker_postgres-data` / `docker_mongo-data`) → dùng lại nguyên data, không copy.
> Bắt buộc xác nhận tên volume + đảm bảo volume tồn tại trước khi up — xem mục 4 & 5.

---

## 3. Tắt stack v2 trước khi rebuild client

`intramind-client` và `v2` dùng **cùng host port** 5432/5050/8001 → phải tắt v2 trước.

```bash
cd docker

# (KHUYẾN NGHỊ) Backup Postgres ra file trước khi đổi stack — để rollback nếu cần
# Container Postgres khác tên tuỳ stack đang chạy:
#   - v2 (cũ):   intramind-frontend-sql-db
#   - client:    intramind-client-sql-db
# Tự dò container thật thay vì hardcode (tránh lỗi "No such container"):
PG_CONTAINER=$(docker ps -a --format '{{.Names}}' | grep -E 'sql-db$' | head -n1)
echo "Dùng container: ${PG_CONTAINER:?Không thấy container *-sql-db nào, kiểm tra: docker ps -a}"
docker exec "$PG_CONTAINER" \
  pg_dump -U postgres intramind > ~/intramind_pg_backup_$(date +%F).sql

# Tắt v2 — GIỮ volume data v2 (KHÔNG có cờ -v). Dùng đúng invocation đã tạo nó.
docker compose -f docker-compose-v2.yml --env-file .env.client.stg down

# Xác nhận container intramind-frontend-* đã biến mất và cổng đã trống
docker ps | grep intramind-frontend        # phải không còn dòng nào
sudo lsof -i :5432 ; sudo lsof -i :5050 ; sudo lsof -i :8001   # 5050/8001 phải trống

# Quan trọng: volume data v2 VẪN CÒN sau down (chỉ container bị gỡ) — kiểm tra:
docker volume ls | grep -E 'postgres|mongo'
```

> ⚠️ Đừng dùng `--remove-orphans` ở lệnh v2 (project của nó là `docker`, sẽ xoá lây
> langfuse/llamacpp/minio). Lệnh `down` thường thì an toàn.

---

## 4. Rebuild & chạy stack client

```bash
cd docker

# Pre-flight 1: AI host remote sống chưa
curl -m 5 http://100.108.33.98:5001/api/v1/health   # AI_SERVICE
curl -m 5 http://100.108.33.98:5002/api/v1/health   # AI_INGEST

# Pre-flight 2: volume external PHẢI tồn tại đúng tên (nếu không, up sẽ lỗi "volume not found")
#  - Postgres: bắt buộc đã có (đang chứa data v2). Nếu thiếu -> SAI TÊN, dừng lại kiểm tra.
docker volume inspect docker_postgres-data >/dev/null 2>&1 \
  && echo "OK postgres volume" \
  || echo "‼️ THIẾU docker_postgres-data — kiểm tra lại tên bằng: docker inspect intramind-frontend-sql-db"
#  - Mongo: nếu chưa từng chạy nosql-db thì volume chưa có -> tạo mới (mongo sẽ khởi tạo sạch)
docker volume inspect docker_mongo-data >/dev/null 2>&1 || docker volume create docker_mongo-data

# Build + up. Project đã pin = intramind-client nên cô lập; --remove-orphans giờ AN TOÀN
docker compose -f docker-compose-client.yml --env-file .env.client.stg up -d --build

# Theo dõi
docker compose -f docker-compose-client.yml --env-file .env.client.stg ps
docker compose -f docker-compose-client.yml --env-file .env.client.stg logs -f backend
```

Kiểm tra:
```bash
curl http://localhost:5050/health     # → {"ok": true}
curl -I http://localhost:8001         # FE
# Web: http://localhost:8001 — đăng nhập super-admin do db-seed tạo (mặc định admin/admin).
```

> 💡 Alias cho gọn:
> ```bash
> alias dcc='docker compose -f docker-compose-client.yml --env-file .env.client.stg'
> dcc up -d --build  |  dcc ps  |  dcc logs -f backend  |  dcc down
> ```

---

## 5. Cơ chế giữ data (external volume) — vì sao không mất

Stack client **không tạo volume mới**. Trong `docker-compose-client.yml`:

```yaml
volumes:
  postgres-data-client:
    external: true
    name: docker_postgres-data     # volume Postgres v2 đang dùng
  mongo-data-client:
    external: true
    name: docker_mongo-data
```

- `external: true` = Compose **không tạo/không xoá** volume, chỉ mount volume có
  sẵn theo `name`. Nhờ vậy client dùng chung **đúng** data của v2.
- `down` v2 (không `-v`) chỉ gỡ container, **volume vẫn nằm trên đĩa** → client
  mount lại nguyên vẹn. Kể cả `down` client sau này cũng KHÔNG xoá volume external
  (chỉ `docker volume rm` thủ công mới xoá).

### Xác nhận tên volume thật (nếu khác `docker_*`)
```bash
docker inspect intramind-frontend-sql-db \
  --format '{{range .Mounts}}{{.Name}} -> {{.Destination}}{{println}}{{end}}'
docker volume ls | grep -E 'postgres|mongo'
```
Nếu tên Postgres không phải `docker_postgres-data` → sửa field `name:` trong compose cho khớp.

### Riêng MongoDB
Stack v2 trước giờ **chỉ chạy `sql-db`**, chưa chạy `nosql-db` → volume
`docker_mongo-data` có thể **chưa tồn tại**. Vì để `external: true` nên phải tạo
trước (đã có ở pre-flight mục 4), nếu không up sẽ báo `volume not found`:
```bash
docker volume inspect docker_mongo-data >/dev/null 2>&1 || docker volume create docker_mongo-data
```
Nếu data Mongo thật đang ở container `mongo` độc lập (mongo:6) → đó là DB riêng;
muốn dùng phải `docker stop mongo` rồi đổi `name:` của `mongo-data-client` về
volume của container đó (`docker inspect mongo --format '{{range .Mounts}}{{.Name}}{{end}}'`).

---

## 6. Dừng / dọn

```bash
cd docker
docker compose -f docker-compose-client.yml --env-file .env.client.stg stop   # giữ data
docker compose -f docker-compose-client.yml --env-file .env.client.stg down    # gỡ container (GIỮ volume)
# Lưu ý: volume data là external -> `down -v` KHÔNG xoá nó. Muốn xoá phải thủ công:
#   docker volume rm docker_postgres-data docker_mongo-data   # ⚠️ MẤT DATA, cân nhắc kỹ
docker compose -f docker-compose-client.yml --env-file .env.client.stg down -v # gỡ container + volume KHÔNG-external (nếu có)
```

---

## 7. Lưu ý AI

- `AI_SERVICE_HOST` (query/stream/tools/llm, port 5001) và `AI_INGEST_HOST`
  (documents/ingest, port 5002) của staging trỏ remote `100.108.33.98`, khai báo
  trong `.env.client.stg` và override default compose.
- Chat trả **502** → kiểm tra reachability tới `AI_SERVICE_HOST`.
- Upload tài liệu kẹt → kiểm tra `AI_INGEST_HOST`.
- Log từng service:
  ```bash
  docker logs -f intramind-client-api        # backend
  docker logs -f intramind-client            # frontend
  docker logs -f intramind-client-migrate    # one-shot migrate
  docker logs -f intramind-client-seed       # one-shot seed
  ```

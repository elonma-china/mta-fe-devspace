#!/usr/bin/env bash
# 03-test.sh — nghiệm thu mta-fe-intramind: pytest gateway (như CI) + acceptance
# S00..S11 trên container đang chạy. Bài ghi dữ liệu (đăng nhập) chỉ đọc/ghi
# phiên throwaway; migrate/seed re-run là idempotent theo thiết kế.
#
# `set -u` chứ không `-e`: script báo cáo, phải chạy hết mọi mục rồi tổng kết.
#
# Tuỳ biến:
#   PORT_OFFSET     cộng vào cổng host                (mặc định 0)
#   COMPOSE_PROJECT tên compose project               (mặc định intramind-fe)
#   COMPOSE_EXTRA   cờ -f phụ
#   IM_REGISTRY / IM_TAG   image kiểm tính chất tĩnh  (mặc định intramind/…:devops)
#   SKIP_PYTEST=1   bỏ nhóm pytest
#   SKIP_ACCEPT=1   bỏ nhóm acceptance (khi container chưa dựng)
#   WITH_FE_TESTS=1 thêm jest của frontend (cần frontend/node_modules, ~vài phút)
#   ADMIN_USER/ADMIN_PASS  thông tin đăng nhập cho S05 (mặc định admin/admin
#                   của seed; đổi nếu máy đích đã đổi mật khẩu)
set -u

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
REPO="$(dirname "$HERE")"

PORT_OFFSET="${PORT_OFFSET:-0}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-intramind-fe}"
COMPOSE_EXTRA="${COMPOSE_EXTRA:-}"
IM_REGISTRY="${IM_REGISTRY:-intramind}"
IM_TAG="${IM_TAG:-devops}"
GW_IMAGE="${IM_REGISTRY}/fe-gateway:${IM_TAG}"
FE_IMAGE="${IM_REGISTRY}/fe:${IM_TAG}"
BACKEND_PORT_EFF=$((5050 + PORT_OFFSET))
FRONTEND_PORT_EFF=$((8001 + PORT_OFFSET))
GW="http://localhost:${BACKEND_PORT_EFF}"
FE="http://localhost:${FRONTEND_PORT_EFF}"

# Bốn biến cổng phải được EXPORT cho mọi lời gọi compose của script này, không
# chỉ dùng để dựng URL. Lý do: S10 chạy `compose run --rm db-migrate`, mà `run`
# kéo theo `depends_on` — tức nó DỰNG LẠI postgres/mongo. Không export thì
# compose nội suy `${DB_PORT:-5432}` từ docker/.env và bind cổng MẶC ĐỊNH; trên
# một stack thử chạy song song (PORT_OFFSET=10000) cổng đó đã bị stack thật giữ
# → container postgres kẹt ở `created`, `exit=128`
# ("Bind for 0.0.0.0:5432 failed: port is already allocated"), và mọi bài sau
# đó FAIL dây chuyền. Đo được 2026-07-30 trong lượt mô phỏng air-gap.
# (Stack thật không bị ảnh hưởng — nó đang giữ cổng, chỉ stack thử chết.)
export BACKEND_PORT="${BACKEND_PORT:-$BACKEND_PORT_EFF}"
export FRONTEND_PORT="${FRONTEND_PORT:-$FRONTEND_PORT_EFF}"
export DB_PORT="${DB_PORT:-$((5432 + PORT_OFFSET))}"
export FE_MONGO_PORT="${FE_MONGO_PORT:-$((27018 + PORT_OFFSET))}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-admin}"

P=0; F=0; S=0
pass(){ echo "  PASS  $1"; P=$((P+1)); }
fail(){ echo "  FAIL  $1 — $2"; F=$((F+1)); }
skip(){ echo "  SKIP  $1 — $2"; S=$((S+1)); }

cd "${REPO}/docker" || { echo "không cd được vào ${REPO}/docker" >&2; exit 1; }
# shellcheck disable=SC2206
COMPOSE=(docker compose -p "${COMPOSE_PROJECT}" -f docker-compose-v2.yml ${COMPOSE_EXTRA})

echo "== 03-test — mta-fe-intramind (gateway ${BACKEND_PORT_EFF}, frontend ${FRONTEND_PORT_EFF}, project ${COMPOSE_PROJECT})"

# ── Nhóm 1: pytest gateway, đúng lệnh CI ────────────────────────────────────
# .github/workflows/tests.yml chạy `python -m pytest tests/ -q` không --ignore;
# các bài *_db.py tự skip khi không có Postgres cấu hình. Không thêm --ignore
# ở đây để làm job xanh.
if [ "${SKIP_PYTEST:-0}" = "1" ]; then
  skip "pytest gateway" "SKIP_PYTEST=1"
else
  PY="${REPO}/backend-fastapi/.venv/bin/python"
  if [ ! -x "${PY}" ]; then
    skip "pytest gateway" "không thấy backend-fastapi/.venv (venv RIÊNG — đừng dùng ../.venv của workspace: pin fastapi khác)"
  else
    echo "  ... đang chạy pytest (~30s)"
    if out=$(cd "${REPO}/backend-fastapi" && "${PY}" -m pytest tests/ -q -p no:cacheprovider 2>&1); then
      pass "pytest gateway ($(echo "${out}" | tail -1))"
    else
      fail "pytest gateway" "$(echo "${out}" | tail -3 | tr '\n' ' ')"
    fi
  fi
fi

# Jest của frontend: nặng (500+ test) nên opt-in. Cùng cách loại của CI: bài
# fileOriginalView_docx bị loại vì jest.mock("mammoth") không ăn trên runner
# (xem chú thích trong tests.yml).
if [ "${WITH_FE_TESTS:-0}" = "1" ]; then
  if [ -d "${REPO}/frontend/node_modules" ]; then
    echo "  ... đang chạy jest (vài phút)"
    if out=$(cd "${REPO}/frontend" && CI=true npx jest --ci --watchAll=false \
        --testPathIgnorePatterns='fileOriginalView_docx' 2>&1); then
      pass "jest frontend ($(echo "${out}" | grep -E '^Tests:' | head -1))"
    else
      fail "jest frontend" "$(echo "${out}" | grep -E '^(Tests|Snapshots|●)' | head -3 | tr '\n' ' ')"
    fi
  else
    skip "jest frontend" "chưa có frontend/node_modules (npm ci trước)"
  fi
else
  skip "jest frontend" "WITH_FE_TESTS chưa bật"
fi

# ── Nhóm 2: acceptance trên container ───────────────────────────────────────
if [ "${SKIP_ACCEPT:-0}" = "1" ]; then
  skip "acceptance S00..S11" "SKIP_ACCEPT=1"
else

# S00 — có THẬT container của đúng project này (chống thành công rỗng — bài
# học infra defect #1: gate trên output rỗng kết luận healthy với 0 container).
# 4 container dài hạn: sql-db, nosql-db, backend, frontend (migrate/seed đã exit).
NCON=$(docker ps --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" \
       --format '{{.Names}}' 2>/dev/null | grep -c . || true)
if [ "${NCON:-0}" -ge 4 ]; then
  pass "S00 project ${COMPOSE_PROJECT} có ${NCON} container đang chạy (≥4)"
else
  fail "S00 project ${COMPOSE_PROJECT}" "chỉ thấy ${NCON:-0} container — mọi bài sau sẽ đo nhầm stack khác nếu tiếp tục"
fi

# S01 — gateway /health 200 + {"ok": true}
R=$(curl -sf --max-time 5 "${GW}/health" 2>/dev/null || echo '')
if echo "${R}" | python3 -c 'import json,sys; assert json.load(sys.stdin)["ok"] is True' 2>/dev/null; then
  pass "S01 gateway /health {\"ok\":true}"
else
  fail "S01 gateway /health" "$(echo "${R}" | head -c 120)"
fi

# S02 — OpenAPI mở được (mọi router nạp hết, không chỉ /health)
N=$(curl -sf --max-time 10 "${GW}/openapi.json" 2>/dev/null \
    | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["paths"]))' 2>/dev/null)
if [ -n "${N}" ] && [ "${N}" -gt 10 ] 2>/dev/null; then
  pass "S02 /openapi.json (${N} route)"
else
  fail "S02 /openapi.json" "paths=${N:-none}"
fi

# S03 — sai mật khẩu phải ra 401 có chủ đích, không 500 trần
C=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST "${GW}/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"${ADMIN_USER}\",\"password\":\"sai-mat-khau-$$\"}" || echo X)
if [ "${C}" = 401 ]; then pass "S03 login sai mật khẩu → 401"; else fail "S03 login negative" "http=${C} (kỳ vọng 401)"; fi

# S04 — route cần auth không token phải 401/403, không 500
C=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${GW}/me" || echo X)
case "${C}" in
  401|403) pass "S04 /me không token → ${C}" ;;
  *) fail "S04 /me không token" "http=${C} (kỳ vọng 401/403)" ;;
esac

# S05 — đăng nhập bằng user seed → 200 + token (chứng minh chuỗi
# migrate → seed → Postgres → bcrypt đi suốt). Máy đã đổi mật khẩu admin:
# truyền ADMIN_USER/ADMIN_PASS.
R=$(curl -s --max-time 10 -X POST "${GW}/login" -H 'Content-Type: application/json' \
    -d "{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}\"}" 2>/dev/null || echo '')
TOK=$(echo "${R}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["token"])' 2>/dev/null)
if [ -n "${TOK}" ]; then
  pass "S05 login ${ADMIN_USER} → token"
else
  fail "S05 login ${ADMIN_USER}" "$(echo "${R}" | head -c 120) (máy đã đổi mật khẩu? truyền ADMIN_PASS=...)"
fi

# S06 — frontend serve SPA: / trả 200 + có mount point React, và index KHÔNG
# được cache (Cache-Control no-store — sai cái này là rebuild xong user kẹt
# bundle cũ, xem chú thích server.js).
B=$(curl -s --max-time 5 "${FE}/" 2>/dev/null || echo '')
H=$(curl -s -I --max-time 5 "${FE}/" 2>/dev/null | tr -d '\r' | grep -i '^cache-control:' || echo '')
ok1=0; echo "${B}" | grep -q 'id="root"' && ok1=1
ok2=0; echo "${H}" | grep -qi 'no-store' && ok2=1
if [ "${ok1}${ok2}" = 11 ]; then
  pass "S06 frontend / (SPA + Cache-Control no-store)"
else
  fail "S06 frontend /" "root=${ok1} no-store=${ok2} (${H:-không có cache-control})"
fi

# S07 — env-config.js được generate-env.sh sinh lúc runtime, phải có
# REACT_APP_DB_HOST (thiếu = ENTRYPOINT không chạy / env không truyền)
B=$(curl -s --max-time 5 "${FE}/env-config.js" 2>/dev/null || echo '')
if echo "${B}" | grep -q 'REACT_APP_DB_HOST'; then
  pass "S07 /env-config.js sinh lúc runtime"
else
  fail "S07 /env-config.js" "$(echo "${B}" | head -c 120)"
fi

# S08 — chuỗi proxy Node → gateway: /db/health qua frontend phải về đúng
# {"ok":true} của gateway (server.js rewrite ^/db → /)
R=$(curl -sf --max-time 5 "${FE}/db/health" 2>/dev/null || echo '')
if echo "${R}" | python3 -c 'import json,sys; assert json.load(sys.stdin)["ok"] is True' 2>/dev/null; then
  pass "S08 proxy /db/health → gateway ok"
else
  fail "S08 proxy /db/health" "$(echo "${R}" | head -c 120)"
fi

# S09 — datastore trả lời thật: pg_isready + mongosh ping qua exec
if "${COMPOSE[@]}" exec -T sql-db pg_isready -U "${DB_USER:-postgres}" -d "${DB_NAME:-intramind}" >/dev/null 2>&1; then
  pass "S09a postgres pg_isready"
else
  fail "S09a postgres" "pg_isready fail"
fi
if "${COMPOSE[@]}" exec -T nosql-db mongosh --quiet --eval 'db.adminCommand("ping")' >/dev/null 2>&1; then
  pass "S09b mongo ping"
else
  fail "S09b mongo" "mongosh ping fail"
fi

# S10 — migrate + seed idempotent: chạy lại phải exit 0 (schema đã áp thì
# no-op). Đây vừa là kiểm tra vừa là thao tác vận hành chuẩn sau khi kéo code
# có migration mới.
if "${COMPOSE[@]}" run --rm db-migrate >/dev/null 2>&1; then
  pass "S10a db-migrate re-run exit 0 (idempotent)"
else
  fail "S10a db-migrate re-run" "exit khác 0"
fi
if "${COMPOSE[@]}" run --rm db-seed >/dev/null 2>&1; then
  pass "S10b db-seed re-run exit 0 (idempotent)"
else
  fail "S10b db-seed re-run" "exit khác 0"
fi

# S11 — tính chất tĩnh của image: cả hai image app phải non-root (rule docker
# của repo), gateway không được mang build tool (multi-stage đúng nghĩa).
U=$(docker run --rm --entrypoint id "${GW_IMAGE}" -u 2>/dev/null || echo X)
if [ "${U}" = "10001" ]; then pass "S11a fe-gateway non-root (uid ${U})"; else fail "S11a fe-gateway non-root" "uid=${U}"; fi
U=$(docker run --rm --entrypoint id "${FE_IMAGE}" -u 2>/dev/null || echo X)
if [ "${U}" != "0" ] && [ "${U}" != "X" ]; then pass "S11b fe non-root (uid ${U})"; else fail "S11b fe non-root" "uid=${U}"; fi
if docker run --rm --entrypoint sh "${GW_IMAGE}" -c 'command -v gcc' >/dev/null 2>&1; then
  fail "S11c fe-gateway không build tool" "gcc CÓ trong runtime — build-essential lọt khỏi stage builder"
else
  pass "S11c fe-gateway không build tool (gcc vắng mặt như mong đợi)"
fi

# S12 — tích hợp nginx tier infra (tuỳ chọn — chỉ khi nginx đang chạy trên
# host này): location / phải về được SPA qua intramind_net.
NGINX_PORT="${NGINX_PORT:-8080}"
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q 'nginx' \
   && curl -sf --max-time 3 "http://localhost:${NGINX_PORT}/healthz" >/dev/null 2>&1; then
  B=$(curl -s --max-time 5 "http://localhost:${NGINX_PORT}/" 2>/dev/null || echo '')
  if echo "${B}" | grep -q 'id="root"'; then
    pass "S12 nginx :${NGINX_PORT}/ → SPA (frontend resolve được trên intramind_net)"
  else
    fail "S12 nginx / → SPA" "nginx sống nhưng / không về SPA: $(echo "${B}" | head -c 120) — service frontend có join intramind_net không?"
  fi
else
  skip "S12 nginx → SPA" "nginx của tier infra không chạy trên host này"
fi

fi  # SKIP_ACCEPT

echo
echo "== TỔNG: ${P} PASS, ${S} SKIP, ${F} FAIL"
(( F == 0 )) || exit 1

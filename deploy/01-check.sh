#!/usr/bin/env bash
# 01-check.sh — tiền kiểm máy trước khi build/dựng mta-fe-intramind. Chỉ đọc,
# không sửa gì, chạy lại bao nhiêu lần cũng được.
#
# Cố ý KHÔNG kiểm GPU: tier FE thuần CPU (SPA + gateway + Postgres + Mongo).
# Cố ý KHÔNG kiểm %đĩa như BE: FE không có Elasticsearch nên không dính
# watermark; chỉ cần GB trống cho image + volume.
#
# LƯU Ý phụ thuộc: FE đứng một mình vẫn lên (login/RBAC chạy được — Postgres
# và Mongo nằm trong chính tier này), nhưng chat/upload cần ai-api:5001 và
# be-api:5002 sống trên mạng intramind_net; giao diện qua nginx (:8080) cần
# tier infra. Thứ tự dựng thật do up-all.sh của repo infra đảm nhiệm (fe cuối).
#
# `set -u` chứ không `-e`: script báo cáo, phải chạy hết mọi mục rồi tổng kết.
#
# Tuỳ biến:
#   PORT_OFFSET      cộng vào cổng khi chạy stack thử song song (mặc định 0)
#   MIN_DISK_GB      đĩa trống tối thiểu (mặc định 6 — 4 image ~1.5GB + bundle)
#   MIN_RAM_GB       RAM tối thiểu (mặc định 4 — tổng trần các service ~6G)
#   NETWORK_NAME     mạng docker dùng chung (mặc định intramind_net)
set -u

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
REPO="$(dirname "$HERE")"

PORT_OFFSET="${PORT_OFFSET:-0}"
MIN_DISK_GB="${MIN_DISK_GB:-6}"
MIN_RAM_GB="${MIN_RAM_GB:-4}"
NETWORK_NAME="${NETWORK_NAME:-intramind_net}"
BACKEND_PORT_EFF=$((5050 + PORT_OFFSET))
FRONTEND_PORT_EFF=$((8001 + PORT_OFFSET))
DB_PORT_EFF=$((5432 + PORT_OFFSET))
FE_MONGO_PORT_EFF=$((27018 + PORT_OFFSET))

P=0; F=0; W=0
pass(){ echo "  PASS  $1"; P=$((P+1)); }
fail(){ echo "  FAIL  $1"; F=$((F+1)); }
warn(){ echo "  WARN  $1"; W=$((W+1)); }

echo "== 01-check — mta-fe-intramind (repo: ${REPO})"

# ── docker ──────────────────────────────────────────────────────────────────
if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    pass "docker daemon sống ($(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '?'))"
  else
    fail "docker có nhưng daemon không chạy (thử: sudo systemctl start docker)"
  fi
else
  fail "chưa cài docker"
fi

if docker compose version >/dev/null 2>&1; then
  pass "docker compose v2 ($(docker compose version --short 2>/dev/null || echo '?'))"
else
  fail "thiếu plugin 'docker compose' v2 (bản 'docker-compose' v1 không dùng được)"
fi

# Engine ≥ 24: bundle được `docker save` từ daemon containerd-store (tar dạng
# OCI-layout); engine cũ hơn không `docker load` được file đó trên máy đích.
EV=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo 0)
if [ "$(printf '%s\n' 24 "${EV}" | sort -V | head -1)" = "24" ]; then
  pass "docker engine ${EV} >= 24 (docker load được tar OCI-layout của bundle)"
else
  fail "docker engine ${EV} < 24 — bundle save dạng OCI-layout, engine này không load được"
fi

# ── đĩa / RAM ───────────────────────────────────────────────────────────────
DISK_GB=$(df -BG --output=avail / 2>/dev/null | tail -1 | tr -dc '0-9')
if [ -n "${DISK_GB}" ]; then
  if [ "${DISK_GB}" -ge "${MIN_DISK_GB}" ]; then
    pass "đĩa trống ${DISK_GB}G (cần ≥ ${MIN_DISK_GB}G)"
  else
    fail "đĩa trống ${DISK_GB}G < ${MIN_DISK_GB}G — docker load/build sẽ chết giữa chừng"
  fi
else
  warn "không đọc được dung lượng đĩa"
fi

RAM_GB=$(awk '/MemTotal/ {printf "%d", $2/1024/1024}' /proc/meminfo 2>/dev/null)
if [ -n "${RAM_GB}" ]; then
  if [ "${RAM_GB}" -ge "${MIN_RAM_GB}" ]; then
    pass "RAM ${RAM_GB}G (cần ≥ ${MIN_RAM_GB}G)"
  else
    warn "RAM ${RAM_GB}G < ${MIN_RAM_GB}G — tổng trần các service ~6G (pg 1G + mongo 2G + gateway 1G + frontend 1G + one-shot 1G)"
  fi
else
  warn "không đọc được /proc/meminfo"
fi

# ── mạng dùng chung ─────────────────────────────────────────────────────────
# WARN chứ không FAIL: 02-up.sh tự tạo được nếu thiếu. Nhưng nhớ: thiếu mạng
# nghĩa là tier infra chưa lên — nginx (:8080) và ai-api/be-api chưa có.
if docker network inspect "${NETWORK_NAME}" >/dev/null 2>&1; then
  pass "mạng '${NETWORK_NAME}' đã có"
else
  warn "chưa có mạng '${NETWORK_NAME}' — 02-up.sh sẽ tạo (chủ sở hữu thật là repo infra; chưa có = infra chưa lên = chat/upload sẽ 502)"
fi

# ── cổng ────────────────────────────────────────────────────────────────────
for pv in "BACKEND ${BACKEND_PORT_EFF}" "FRONTEND ${FRONTEND_PORT_EFF}" \
          "POSTGRES ${DB_PORT_EFF}" "MONGO ${FE_MONGO_PORT_EFF}"; do
  name="${pv%% *}"; port="${pv##* }"
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${port}\$"; then
    fail "cổng ${name} ${port} đang bị chiếm — đặt PORT_OFFSET khác hoặc dừng tiến trình đó"
  else
    pass "cổng ${name} ${port} trống (PORT_OFFSET=${PORT_OFFSET})"
  fi
done

# ── file cấu hình ───────────────────────────────────────────────────────────
for f in docker/docker-compose-v2.yml docker/Dockerfile.frontend \
         docker/Dockerfile.backend-fastapi docker/Dockerfile.psql \
         docker/Dockerfile.mongo docker/migrate.sh docker/generate-env.sh \
         docker/.env.example .dockerignore; do
  if [ -e "${REPO}/${f}" ]; then pass "có ${f}"; else fail "thiếu ${f}"; fi
done

# ── docker/.env ─────────────────────────────────────────────────────────────
# Khác BE/AI: FE không có khoá PHẢI-ĐIỀN chết người — mọi biến có mặc định
# chạy được. Duy nhất JWT_SECRET là phải đổi cho môi trường thật.
ENVF="${REPO}/docker/.env"
if [ -f "${ENVF}" ]; then
  pass "có docker/.env"
  envval(){ grep -E "^$1=" "${ENVF}" 2>/dev/null | head -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*$//'; }

  JS="$(envval JWT_SECRET)"
  if [ -z "${JS}" ] || [ "${JS}" = "change-me" ]; then
    warn "JWT_SECRET đang trống/mặc định 'change-me' — token không sống qua restart / secret đoán được; đổi trước khi dùng thật"
  else
    pass "JWT_SECRET đã đặt riêng"
  fi

  # Chiều AI_SERVICE/AI_INGEST hay bị đảo (trap #3 CLAUDE.md workspace):
  # SERVICE phải trỏ 5001 (ai-api), INGEST phải trỏ 5002 (be-api).
  ASH="$(envval AI_SERVICE_HOST)"; AIH="$(envval AI_INGEST_HOST)"
  if echo "${ASH}" | grep -q '5002\|be-api' || echo "${AIH}" | grep -q '5001\|ai-api'; then
    fail "AI_SERVICE_HOST/AI_INGEST_HOST có vẻ bị ĐẢO CHIỀU (SERVICE→5001/ai-api, INGEST→5002/be-api) — triệu chứng: chat 502 nhưng upload chạy, hoặc ngược lại"
  else
    pass "AI_SERVICE_HOST/AI_INGEST_HOST đúng chiều (hoặc để mặc định)"
  fi

  # Rác stack thử lọt vào .env sẽ dựng container imtest- ở cổng lệch 10000.
  for kv in 'CONTAINER_PREFIX=imtest-' 'VOLUME_PREFIX=imtest_' 'FRONTEND_PORT=18001' 'BACKEND_PORT=15050'; do
    if grep -q "^${kv}$" "${ENVF}" 2>/dev/null; then
      fail "docker/.env còn giá trị stack thử '${kv}' — xoá trước khi deploy thật"
    fi
  done

  # Hai cổng cố ý KHÔNG mặc định kiểu cũ — bắt lại nếu ai chỉnh về giá trị đụng độ.
  FP="$(envval FRONTEND_PORT)"
  if [ "${FP}" = "3000" ]; then
    warn "FRONTEND_PORT=3000 — đụng langfuse-web/React dev server trên host; mặc định chuẩn là 8001"
  fi
  MP="$(envval FE_MONGO_PORT)"
  if [ "${MP}" = "27017" ]; then
    fail "FE_MONGO_PORT=27017 — đụng mongo của tier infra; để 27018 (backend trong mạng vẫn nói nosql-db:27017)"
  fi
else
  warn "chưa có docker/.env — cp docker/.env.example docker/.env (compose vẫn chạy được bằng mặc định, nhưng JWT_SECRET sẽ là secret tạm)"
fi

# ── venv (chỉ cần cho nhóm pytest của 03-test.sh) ───────────────────────────
# backend-fastapi dùng venv RIÊNG (pin fastapi khác 3 repo backend — không
# được trỏ vào ../.venv của workspace).
if [ -x "${REPO}/backend-fastapi/.venv/bin/python" ]; then
  pass "venv backend-fastapi: có ($("${REPO}/backend-fastapi/.venv/bin/python" -V 2>&1))"
else
  warn "không thấy backend-fastapi/.venv — nhóm pytest của 03-test.sh sẽ bỏ qua"
fi
if [ -d "${REPO}/frontend/node_modules" ]; then
  pass "frontend/node_modules: có (WITH_FE_TESTS=1 dùng được)"
else
  warn "chưa có frontend/node_modules — nhóm jest (WITH_FE_TESTS=1) sẽ bỏ qua"
fi

echo
echo "== TỔNG: ${P} PASS, ${W} WARN, ${F} FAIL"
(( F == 0 )) || exit 1

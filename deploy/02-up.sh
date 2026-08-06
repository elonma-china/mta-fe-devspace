#!/usr/bin/env bash
# 02-up.sh — build 4 image của tier FE rồi dựng cả stack (sql-db → migrate →
# seed → gateway → frontend). Idempotent: image đã có thì bỏ qua build (trừ
# khi FORCE_BUILD=1); container đã chạy thì `up -d` chỉ reconcile.
#
# Giữ ĐÚNG lời gọi của up-all.sh (repo infra): project intramind-fe, cd vào
# docker/, -f docker-compose-v2.yml — script này chỉ thêm build + gate.
#
# Tuỳ biến:
#   IM_REGISTRY    tiền tố tag image           (mặc định intramind)
#   IM_TAG         tag image                   (mặc định devops)
#   PORT_OFFSET    cộng vào cổng host          (mặc định 0; stack thử dùng 10000)
#   COMPOSE_PROJECT tên compose project        (mặc định intramind-fe)
#   COMPOSE_EXTRA  cờ -f phụ
#   FORCE_BUILD    =1 để build lại dù image đã có
#   NETWORK_NAME   mạng dùng chung             (mặc định intramind_net)
#   INFRA_NETWORK_KEY  KHOÁ mạng trong compose của infra (mặc định intramind_net)
#   INFRA_PROJECT  compose project của tier infra (mặc định intramind-infra)
#   HEALTH_TIMEOUT_SECONDS  hạn chờ /health    (mặc định 180)
set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
REPO="$(dirname "$HERE")"

IM_REGISTRY="${IM_REGISTRY:-intramind}"
IM_TAG="${IM_TAG:-devops}"
PORT_OFFSET="${PORT_OFFSET:-0}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-intramind-fe}"
COMPOSE_EXTRA="${COMPOSE_EXTRA:-}"
FORCE_BUILD="${FORCE_BUILD:-0}"
NETWORK_NAME="${NETWORK_NAME:-intramind_net}"
# Hai nhãn compose mà tier infra sẽ kỳ vọng nếu nó lên SAU tier FE — xem mục 2.
# INFRA_NETWORK_KEY là KHOÁ trong `networks:` của docker-compose.storages.yml
# (`intramind_net`), KHÔNG phải tên mạng: đổi NETWORK_NAME không đổi khoá này.
INFRA_NETWORK_KEY="${INFRA_NETWORK_KEY:-intramind_net}"
INFRA_PROJECT="${INFRA_PROJECT:-intramind-infra}"   # up.sh của infra: COMPOSE_PROJECT_NAME
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-180}"

BACKEND_PORT_EFF=$((5050 + PORT_OFFSET))
FRONTEND_PORT_EFF=$((8001 + PORT_OFFSET))
DB_PORT_EFF=$((5432 + PORT_OFFSET))
FE_MONGO_PORT_EFF=$((27018 + PORT_OFFSET))
# compose nội suy ${IM_REGISTRY}/${IM_TAG} cho khoá `image:` — phải export để
# compose thấy đúng giá trị script đang dùng.
export IM_REGISTRY IM_TAG
# docker-compose-v2.yml nội suy ${NETWORK_NAME} cho tên mạng external — export để
# compose thấy cả khi caller không tự export (không set thì cả hai bên cùng rơi
# về mặc định intramind_net, nên đây chỉ là chốt an toàn).
export NETWORK_NAME

# service → image (db-seed dùng lại image của backend, không build riêng)
GW_IMAGE="${IM_REGISTRY}/fe-gateway:${IM_TAG}"
FE_IMAGE="${IM_REGISTRY}/fe:${IM_TAG}"
SQL_IMAGE="${IM_REGISTRY}/fe-sql:${IM_TAG}"
NOSQL_IMAGE="${IM_REGISTRY}/fe-nosql:${IM_TAG}"

log(){ echo "[up $(date +%H:%M:%S)] $*"; }
die(){ echo "[up] LỖI: $*" >&2; exit 1; }

cd "${REPO}/docker"
# shellcheck disable=SC2206
COMPOSE=(docker compose -p "${COMPOSE_PROJECT}" -f docker-compose-v2.yml ${COMPOSE_EXTRA})

log "── 1. preflight: mọi đường COPY trong 4 Dockerfile phải tồn tại"
# Bài học từ kit AI: một COPY trỏ vào thư mục đã xoá chỉ lộ ra sau vài phút
# build; ở đây nó lộ trong một giây. Bỏ COPY --from= (nguồn nằm trong stage
# trước, không nằm trong context). Nguồn có glob (package*.json) kiểm bằng
# compgen.
missing=()
for df in Dockerfile.frontend Dockerfile.backend-fastapi Dockerfile.psql Dockerfile.mongo; do
  while read -r src; do
    [ -z "${src}" ] && continue
    compgen -G "${REPO}/${src}" >/dev/null 2>&1 || missing+=("${df}:${src}")
  done < <(grep -E '^COPY[[:space:]]' "${df}" | grep -v -- '--from=' \
           | awk '{for(i=2;i<NF;i++) if($i !~ /^--/) print $i}')
done
if (( ${#missing[@]} )); then
  die "Dockerfile COPY trỏ vào đường dẫn không tồn tại: ${missing[*]}"
fi
log "   mọi COPY hợp lệ"

log "── 2. mạng ${NETWORK_NAME}"
if docker network inspect "${NETWORK_NAME}" >/dev/null 2>&1; then
  log "   đã có"
else
  # Chủ sở hữu thật là mta-infrastructure-intramind; tạo ở đây chỉ để tier FE
  # đứng một mình được (compose khai external: true nên thiếu mạng là chết
  # ngay lúc up). Driver mặc định, không đặt subnet, để lúc infra lên sau
  # không xung đột.
  #
  # HAI NHÃN DƯỚI ĐÂY LÀ BẮT BUỘC, không phải trang trí. Trong compose của infra
  # mạng khai `intramind_net: {name: ...}` — KHÔNG `external:` — nên compose coi
  # đó là mạng nó sở hữu và kiểm nhãn trước khi dùng lại. Tạo mạng trần (không
  # nhãn) thì infra lên sau CHẾT HẲN, exit 1, 0 container:
  #   network intramind_net was found but has incorrect label
  #   com.docker.compose.network set to "" (expected: "intramind_net")
  # Kiểm chứng trên chính máy này 2026-07-30, Docker 29.6.1 / Compose 5.3.1:
  #   - không nhãn        → exit 1, infra không lên được
  #   - chỉ nhãn network  → infra lên OK nhưng `infra down` bỏ lại mạng mồ côi
  #   - đủ cả 2 nhãn      → infra lên OK, không warning, `down` dọn mạng sạch
  # ProjectLabel lệch chỉ gây warning (không chặn), nên đặt sai INFRA_PROJECT
  # cũng không làm hỏng gì — chỉ mất phần dọn dẹp tự động.
  docker network create \
    --label com.docker.compose.network="${INFRA_NETWORK_KEY}" \
    --label com.docker.compose.project="${INFRA_PROJECT}" \
    "${NETWORK_NAME}" >/dev/null
  log "   đã tạo, gắn nhãn cho ${INFRA_PROJECT} (chủ sở hữu thật là mta-infrastructure-intramind)"
fi

log "── 3. build image"
build_if_missing(){ # $1=service $2=image
  if [ "${FORCE_BUILD}" != "1" ] && docker image inspect "$2" >/dev/null 2>&1; then
    log "   $2 đã có — bỏ qua (FORCE_BUILD=1 để build lại)"
  else
    # `image:` khai cạnh `build:` nên compose build ra thẳng tag chuẩn. Máy
    # air-gap không bao giờ nên tới nhánh này: bundle đã docker load sẵn.
    "${COMPOSE[@]}" build "$1" \
      || die "build $1 fail — nếu đây là máy air-gap thì đừng build: chạy ./start.sh của bundle để docker load image có sẵn"
    docker image inspect "$2" >/dev/null 2>&1 \
      || die "build $1 xong nhưng không thấy $2 — kiểm khai báo image: trong compose"
  fi
  log "   $2: $(docker images --format '{{.Size}}' "$2" | head -1)"
}
build_if_missing backend  "${GW_IMAGE}"
build_if_missing frontend "${FE_IMAGE}"
build_if_missing sql-db   "${SQL_IMAGE}"
build_if_missing nosql-db "${NOSQL_IMAGE}"

log "── 4. smoke image (không cần container)"
# Gateway: import được app.main — bắt thiếu dependency ngay tại đây thay vì
# crash-loop trong docker logs. PATH của image đã trỏ venv.
if out=$(docker run --rm --entrypoint python "${GW_IMAGE}" -c 'import app.main; print("OK")' 2>&1); then
  log "   fe-gateway import app.main: ${out}"
else
  die "image fe-gateway không import được app.main:
${out}"
fi
# Frontend: server.js là ESM — resolve được express + có build/index.html.
if out=$(docker run --rm --entrypoint node "${FE_IMAGE}" -e '
import("express").then(()=>{
  const fs=require("fs");
  if(!fs.existsSync("/app/build/index.html")) { console.error("thiếu build/index.html"); process.exit(1); }
  console.log("OK");
}).catch(e=>{console.error(e.message);process.exit(1)})' 2>&1); then
  log "   fe express+build: ${out}"
else
  die "image fe hỏng: ${out}"
fi

log "── 5. up (project ${COMPOSE_PROJECT}, gateway ${BACKEND_PORT_EFF}, frontend ${FRONTEND_PORT_EFF})"
BACKEND_PORT="${BACKEND_PORT_EFF}" FRONTEND_PORT="${FRONTEND_PORT_EFF}" \
DB_PORT="${DB_PORT_EFF}" FE_MONGO_PORT="${FE_MONGO_PORT_EFF}" \
  "${COMPOSE[@]}" up -d

log "── 6. chờ health"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SECONDS ))
until curl -fsS --max-time 5 "http://localhost:${BACKEND_PORT_EFF}/health" >/dev/null 2>&1; do
  if (( $(date +%s) >= deadline )); then
    echo "--- docker logs (50 dòng cuối) ---" >&2
    "${COMPOSE[@]}" logs --tail 50 backend >&2 || true
    die "gateway không healthy sau ${HEALTH_TIMEOUT_SECONDS}s (http://localhost:${BACKEND_PORT_EFF}/health) — xem cả logs db-migrate/db-seed: backend bị gate sau hai one-shot đó"
  fi
  sleep 2
done
log "   gateway trả /health"

deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SECONDS ))
until curl -fsS --max-time 5 "http://localhost:${FRONTEND_PORT_EFF}/" >/dev/null 2>&1; do
  if (( $(date +%s) >= deadline )); then
    "${COMPOSE[@]}" logs --tail 50 frontend >&2 || true
    die "frontend không trả / sau ${HEALTH_TIMEOUT_SECONDS}s (http://localhost:${FRONTEND_PORT_EFF}/)"
  fi
  sleep 2
done
log "   frontend trả /"

# Phần hai: mọi container CÓ healthcheck trong project phải hết "starting"/
# "unhealthy". One-shot (migrate/seed) đã exited, trường Health rỗng — tự
# động được bỏ qua.
deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SECONDS ))
while true; do
  not_ready="$("${COMPOSE[@]}" ps --format '{{.Name}} {{.Health}}' 2>/dev/null \
    | awk '$2=="starting" || $2=="unhealthy" {print $1" ("$2")"}')"
  [ -z "${not_ready}" ] && break
  if (( $(date +%s) >= deadline )); then
    echo "${not_ready}" >&2
    die "còn container chưa healthy sau ${HEALTH_TIMEOUT_SECONDS}s"
  fi
  sleep 2
done

log "XONG — chạy tiếp deploy/03-test.sh để nghiệm thu."
"${COMPOSE[@]}" ps --format '  {{.Name}}\t{{.State}}\t{{.Health}}'

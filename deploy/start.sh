#!/usr/bin/env bash
# start.sh — điểm vào một lệnh cho mta-fe-intramind.
#
# Tự nhận chế độ:
#   bundle  — có ./repo và ./images cạnh file này (đã giải nén bundle offline):
#             verify checksum 2 tầng → docker load → chạy kit trong ./repo
#   repo    — đang nằm trong repo git: bỏ qua phần load, chạy kit tại chỗ
#
# Chuỗi: 01-check → 02-up → 03-test. Mỗi bước hỏng là dừng.
#
# Tuỳ biến: mọi env của 01/02/03 (PORT_OFFSET, IM_TAG, COMPOSE_EXTRA, ...)
#   SKIP_TEST=1   dựng xong thì dừng, không nghiệm thu
set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
if [ -d "${HERE}/repo" ] && [ -d "${HERE}/images" ]; then
  MODE=bundle; REPO="${HERE}/repo"; IMAGES="${HERE}/images"
else
  MODE=repo;   REPO="$(dirname "${HERE}")"; IMAGES=""
fi
DEPLOY="${REPO}/deploy"

log(){ echo "[start $(date +%H:%M:%S)] $*"; }
die(){ echo "[start] LỖI: $*" >&2; exit 1; }

log "chế độ: ${MODE} — repo: ${REPO}"

command -v docker >/dev/null || die "chưa cài docker"
docker info >/dev/null 2>&1 || die "docker daemon không chạy"

if [ "${MODE}" = bundle ]; then
  # Hai tầng, verify NGOÀI trước TRONG: SHA256SUMS.bundle ký VERSION +
  # start.sh + README + .env.example + images/SHA256SUMS + images/IMAGES.list
  # + TOÀN BỘ repo/. Nếu chỉ kiểm images/SHA256SUMS thì một bản copy làm hỏng
  # docker-compose-v2.yml vẫn "OK" và máy đích dựng stack bằng code hỏng.
  log "── verify checksum bundle (VERSION + start.sh + .env.example + repo/ + manifest images)"
  ( cd "${HERE}" && sha256sum -c SHA256SUMS.bundle --quiet ) \
    || die "checksum bundle LỆCH — repo/ hoặc metadata hỏng khi sao chép; chuyển lại nguyên vẹn (tar/rsync, đừng cp qua exFAT)"
  log "── verify checksum images"
  ( cd "${IMAGES}" && sha256sum -c SHA256SUMS --quiet ) \
    || die "checksum LỆCH — bundle hỏng khi sao chép, không load"

  # IMAGES.list: mỗi dòng "<file>\t<image:tag>" — chỉ load khi tag chưa có.
  # MỘT file có thể mang NHIỀU tag (fe-sql.tar.gz chứa cả intramind/fe-sql lẫn
  # postgres:15-alpine — chúng dùng chung layer nền nên được save chung, tiết
  # kiệm 109MB). Đường thường: `docker load` file đó khôi phục CẢ HAI tag một
  # lượt, nên dòng thứ hai rơi vào nhánh "đã có" ở trên. LOADED là lớp chắn
  # cho trường hợp bệnh lý — tag thứ hai không hiện ra sau khi load — để
  # không giải nén lại 110MB rồi mới chết ở dòng kiểm tra cuối vòng.
  declare -A LOADED=()
  while IFS=$'\t' read -r f tag; do
    [ -z "${f:-}" ] && continue
    if docker image inspect "${tag}" >/dev/null 2>&1; then
      log "image ${tag} đã có — bỏ qua"
      continue
    fi
    if [ -n "${LOADED[${f}]:-}" ]; then
      log "  ${tag} nằm trong ${f} vừa load"
    else
      log "docker load ${f} (${tag})..."
      docker load -i "${IMAGES}/${f}" >/dev/null
      LOADED[${f}]=1
    fi
    docker image inspect "${tag}" >/dev/null 2>&1 || die "load xong vẫn không thấy ${tag}"
  done < "${IMAGES}/IMAGES.list"

  # .env của tier FE sống ở docker/.env (compose đọc từ thư mục docker/),
  # KHÔNG phải gốc repo như BE/AI. Bundle mang .env.example ở gốc.
  if [ ! -f "${REPO}/docker/.env" ]; then
    cp "${HERE}/.env.example" "${REPO}/docker/.env"
    log "tạo docker/.env từ .env.example — ĐỔI JWT_SECRET trước khi dùng thật"
  fi
  # Image trong bundle đã mang sẵn tag đúng, đừng build lại trên máy air-gap.
  export FORCE_BUILD=0
fi

log "── 01-check"
bash "${DEPLOY}/01-check.sh" || die "máy chưa đạt yêu cầu — xử lý các mục FAIL rồi chạy lại"

log "── 02-up"
bash "${DEPLOY}/02-up.sh" || die "dựng không lên"

if [ "${SKIP_TEST:-0}" = "1" ]; then
  log "── 03-test: bỏ qua (SKIP_TEST=1)"
else
  log "── 03-test"
  bash "${DEPLOY}/03-test.sh" || die "dựng lên nhưng nghiệm thu FAIL — xem output trên"
fi

log "XONG."

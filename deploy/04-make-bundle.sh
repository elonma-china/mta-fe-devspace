#!/usr/bin/env bash
# 04-make-bundle.sh — đóng bundle offline CHỈ cho mta-fe-intramind.
#
# Khác BE/AI một điểm: tier FE sở hữu datastore của nó, nên bundle mang 5
# image chứ không phải 1 — fe (SPA+proxy), fe-gateway (BFF), fe-sql, fe-nosql,
# và postgres:15-alpine (db-migrate dùng image gốc). Bundle này vẫn KHÔNG tự
# chạy đủ chức năng một mình: chat/upload cần ai-api:5001 + be-api:5002, giao
# diện chính thức qua nginx tier infra. Xem deploy/README.md.
#
# 5 image nhưng chỉ 4 FILE: xem chú thích ở khối FILE_TAGS bên dưới.
#
# Idempotent: bước nào đã có sản phẩm thì bỏ qua, chạy lại được sau khi đứt —
# trừ VERSION/checksum/tar ngoài: luôn làm lại (VERSION mang timestamp nên tar
# đóng tay từ lần trước sẽ lệch thầm lặng với thư mục hiện tại).
#
# Tuỳ biến:
#   BUNDLE_DIR    thư mục đích (mặc định ./dist/fe-offline-<ngày>)
#   IM_REGISTRY   tiền tố tag image (mặc định intramind)
#   IM_TAG        tag image        (mặc định devops)
#   MIN_DISK_GB   đĩa trống tối thiểu (mặc định 2 — xem chú thích tại chỗ)
set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
REPO="$(dirname "$HERE")"

IM_REGISTRY="${IM_REGISTRY:-intramind}"
IM_TAG="${IM_TAG:-devops}"
BD="${BUNDLE_DIR:-${REPO}/dist/fe-offline-$(date +%Y%m%d)}"
# Ngưỡng đĩa đo thật, không phải bê từ kit BE (bundle BE ~2.5GB nên nó để 6):
# images/ 525MB + repo/ 5MB + tar ngoài ~530MB ≈ 1.06GB đỉnh điểm. Để 2GB cho
# gần gấp đôi. Đặt cao hơn chỉ chặn oan những máy thừa sức đóng bundle này.
MIN_DISK_GB="${MIN_DISK_GB:-2}"

# file nén → DANH SÁCH tag. Thường 1:1, riêng fe-sql.tar.gz mang HAI tag:
# intramind/fe-sql CHÍNH LÀ postgres:15-alpine cộng đúng một file init.sql, nên
# `docker save` cả hai trong MỘT lệnh cho chúng dùng chung layer nền. Đo thật
# (docker save | pigz -6 | wc -c): tách riêng 109MB + 109MB = 218MB, gộp còn
# 109MB — cắt 17% kích thước bundle. IMAGES.list vẫn giữ đúng khuôn TSV
# "<file>\t<tag>" của kit BE/AI, chỉ là hai dòng cùng trỏ về một file;
# start.sh biết không đọc lại file đã load.
IMAGE_FILES=(fe.tar.gz fe-gateway.tar.gz fe-sql.tar.gz fe-nosql.tar.gz)
declare -A FILE_TAGS=(
  [fe.tar.gz]="${IM_REGISTRY}/fe:${IM_TAG}"
  [fe-gateway.tar.gz]="${IM_REGISTRY}/fe-gateway:${IM_TAG}"
  [fe-sql.tar.gz]="${IM_REGISTRY}/fe-sql:${IM_TAG} postgres:15-alpine"
  [fe-nosql.tar.gz]="${IM_REGISTRY}/fe-nosql:${IM_TAG}"
)

log(){ echo "[bundle $(date +%H:%M:%S)] $*"; }
die(){ echo "[bundle] LỖI: $*" >&2; exit 1; }

# nén: pigz (đa luồng) nếu có, không thì gzip — docker load đọc gzip trực tiếp.
# KHÔNG dùng zstd: docker load không tự giải, máy đích air-gap có thể thiếu binary.
GZ=$(command -v pigz || command -v gzip) || die "cần gzip"

log "── [1/7] kiểm tiền đề"
for f in "${IMAGE_FILES[@]}"; do
  # shellcheck disable=SC2086 — cố ý tách từ: một file có thể mang nhiều tag
  for tag in ${FILE_TAGS[${f}]}; do
    docker image inspect "${tag}" >/dev/null 2>&1 \
      || die "thiếu image ${tag} — chạy deploy/02-up.sh trước (postgres:15-alpine sẽ được pull khi up)"
  done
done
command -v rsync >/dev/null || die "cần rsync"
mkdir -p "${BD}/images"
# Kiểm đĩa SAU khi mkdir: df trên thư mục chưa tồn tại thì lỗi. Viết bằng `if`,
# không phải chuỗi `&& die` — dưới set -e chuỗi đó giết script khi đĩa ĐỦ.
DISK_GB=$(df -BG --output=avail "${BD}" 2>/dev/null | tail -1 | tr -dc '0-9')
if [ -n "${DISK_GB}" ] && [ "${DISK_GB}" -lt "${MIN_DISK_GB}" ]; then
  die "đĩa trống ${DISK_GB}G < ${MIN_DISK_GB}G — docker save sẽ chết giữa chừng"
fi
log "   đủ 5 image; đĩa trống ${DISK_GB:-?}G"

log "── [2/7] docker save (nén bằng $(basename "${GZ}"))"
: > "${BD}/images/IMAGES.list"
for f in "${IMAGE_FILES[@]}"; do
  tags="${FILE_TAGS[${f}]}"
  if [ -f "${BD}/images/${f}" ]; then
    log "   ${f} đã có — bỏ qua"
  else
    # Nhiều tag trong MỘT lệnh save => layer chung chỉ nằm trong tar một lần.
    # shellcheck disable=SC2086 — cố ý tách từ
    docker save ${tags} | "${GZ}" -6 > "${BD}/images/${f}"
    log "   ${f} $(du -h "${BD}/images/${f}" | cut -f1) [${tags}]"
  fi
  # IMAGES.list: start.sh đọc TSV này để biết load file nào ra tag nào. Một
  # file mang N tag => N dòng cùng trỏ về nó.
  # shellcheck disable=SC2086
  for tag in ${tags}; do
    printf '%s\t%s\n' "${f}" "${tag}" >> "${BD}/images/IMAGES.list"
  done
done
( cd "${BD}/images" && sha256sum ./*.tar.gz > SHA256SUMS )

log "── [3/7] VERSION"
{
  echo "bundle: fe-offline (mta-fe-intramind — SPA + gateway/BFF, :8001 + :5050)"
  echo "created: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  echo "commit: $(git -C "${REPO}" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "branch: $(git -C "${REPO}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  echo "dirty: $(git -C "${REPO}" status --porcelain 2>/dev/null | wc -l) file chưa commit"
  echo "app_version: $(grep -m1 '"version"' "${REPO}/frontend/package.json" 2>/dev/null | grep -oE '[0-9.]+' || echo unknown)"
  for f in "${IMAGE_FILES[@]}"; do
    # shellcheck disable=SC2086
    for tag in ${FILE_TAGS[${f}]}; do
      id=$(docker image inspect --format '{{.Id}}' "${tag}")
      dg=$(docker image inspect --format '{{join .RepoDigests ","}}' "${tag}")
      [ -n "${dg}" ] || dg="-"
      printf '%s\t%s\t%s\n' "${tag}" "${id}" "${dg}"
    done
  done
} > "${BD}/VERSION"

log "── [4/7] repo copy (KHÔNG kèm .env — máy đích tự sinh từ .env.example)"
# rsync: pattern KHỚP TRƯỚC thắng — include '.env.example' phải đứng TRƯỚC
# exclude '.env.*', nếu không nó thành code chết và bundle thiếu
# docker/.env.example → 01-check trên máy đích FAIL (dính thật trong mô phỏng
# air-gap 2026-07-31; BE/AI thoát vì file của họ tên .env_example gạch dưới).
rsync -a --delete \
  --exclude .git --exclude .venv --exclude node_modules --exclude __pycache__ \
  --exclude .serena --exclude .nodeterm --exclude .pytest_cache \
  --include '.env.example' --exclude .env --exclude '.env.*' \
  --exclude dist --exclude '*.log' --exclude .claude \
  --exclude 'frontend/build' --exclude 'frontend/coverage' \
  "${REPO}/" "${BD}/repo/"

log "── [5/7] điểm vào + hướng dẫn"
cp "${BD}/repo/deploy/start.sh" "${BD}/start.sh" && chmod +x "${BD}/start.sh"
cp "${BD}/repo/deploy/README.md" "${BD}/README.md"
# .env của tier FE sống ở docker/.env (không phải gốc repo như BE/AI)
cp "${REPO}/docker/.env.example" "${BD}/.env.example"

log "── [6/7] checksum tổng (2 tầng)"
# Tầng ngoài phủ CẢ repo/ lẫn images/IMAGES.list + .env.example — bài học
# infra defect #3: scheme mỏng để lọt 1 byte lật trong compose của repo/ mà
# vẫn "OK". IMAGES.list phải ký vì start.sh đọc nó để biết load gì.
( cd "${BD}" && {
    sha256sum VERSION start.sh README.md .env.example images/SHA256SUMS images/IMAGES.list
    find repo -type f -print0 | sort -z | xargs -0 sha256sum
  } > SHA256SUMS.bundle )
log "   SHA256SUMS.bundle: $(grep -c . "${BD}/SHA256SUMS.bundle") mục"

log "── [7/7] tar ngoài (LUÔN đóng lại, không skip)"
BD_PARENT="$(dirname "${BD}")"; BD_NAME="$(basename "${BD}")"
( cd "${BD_PARENT}" && tar -cf "${BD_NAME}.tar" "${BD_NAME}" \
    && sha256sum "${BD_NAME}.tar" > "${BD_NAME}.tar.sha256" )

log "XONG — thư mục $(du -sh "${BD}" | cut -f1), tar $(du -sh "${BD_PARENT}/${BD_NAME}.tar" | cut -f1)"
log "   giao máy đích 1 trong 2: thư mục (rsync/scp) hoặc ${BD_NAME}.tar (+ .tar.sha256)"
log "   máy đích: tar xf ${BD_NAME}.tar && cd ${BD_NAME} && ./start.sh"

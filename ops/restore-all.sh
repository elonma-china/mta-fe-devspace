#!/usr/bin/env bash
#
# Dựng lại TOÀN BỘ sau khi ccoex mất điện / reboot.
#
# Chạy TRÊN ccoex:  bash ~/devspace/ops/restore-all.sh
#
# Vì sao cần script này: 22 container tự lên theo restart-policy, nhưng 6 tiến
# trình bare-metal thì KHÔNG có autostart nào (đã kiểm: không crontab, không
# systemd, không rc.local) — 3 của bản THẬT và 3 của Dev Space. Container FE
# Dev Space tự lên nhưng sẽ lỗi cho đến khi AI :15001 sống.
#
# ─────────────────────────────────────────────────────────────────────
# LUẬT AN TOÀN (giữ nguyên, đừng nới):
#   * Kill THEO CỔNG. Không bao giờ `pkill -f uvicorn` — sẽ giết cả bản thật.
#   * Không `git checkout`/`git pull` ở bất cứ đâu. Cây AI live đang có việc
#     chưa commit.
#   * Không `apt install`. Một lần apt trên máy này đã nâng driver NVIDIA
#     giữa chừng và giết mọi container GPU mới.
#   * Thứ tự BẮT BUỘC: serving trước — BE và AI đều probe embedding lúc boot.
# ─────────────────────────────────────────────────────────────────────
set -u

STAGING="$HOME/Desktop/intramind_staging/mta-intramind"
DEV="$HOME/devspace"
SKIP_LIVE="${SKIP_LIVE:-0}"   # SKIP_LIVE=1 → chỉ dựng Dev Space

log()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$*"; }

# Đợi /health trả 200, tối đa $2 giây.
wait_health() {
  local port=$1 limit=${2:-180} code=000 waited=0
  while [ $waited -lt "$limit" ]; do
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 3 "localhost:$port/health" 2>/dev/null)
    [ "$code" = 200 ] && { printf '  :%s health 200 (sau %ss)\n' "$port" "$waited"; return 0; }
    sleep 5; waited=$((waited + 5))
  done
  warn ":$port KHÔNG lên sau ${limit}s (mã cuối: $code)"
  return 1
}

alive() { curl -s -o /dev/null -m 3 "localhost:$1/health" 2>/dev/null; }

# ── Tầng LIVE ────────────────────────────────────────────────────────
if [ "$SKIP_LIVE" = "0" ]; then
  log "LIVE 1/3 — serving :5003 (phải xong trước BE/AI)"
  if alive 5003; then echo "  đã sống, bỏ qua"; else
    (cd "$STAGING/mta-ai-serving-intramind" && setsid -f bash scripts/start.sh </dev/null >/tmp/live-serving.log 2>&1)
    wait_health 5003 240 || { warn "dừng: không có embedding thì BE/AI vô nghĩa"; exit 1; }
  fi

  log "LIVE 2/3 — BE :5002 + worker"
  if alive 5002; then echo "  đã sống, bỏ qua"; else
    (cd "$STAGING/mta-be-intramind" && setsid -f bash scripts/start.sh </dev/null >/tmp/live-be.log 2>&1)
    wait_health 5002 240 || exit 1
    (cd "$STAGING/mta-be-intramind" && setsid -f bash scripts/start-worker.sh </dev/null >/tmp/live-be-worker.log 2>&1)
  fi

  log "LIVE 3/3 — AI :5001 + tools worker"
  if alive 5001; then echo "  đã sống, bỏ qua"; else
    (cd "$STAGING/mta-ai-intramind" && setsid -f bash scripts/start.sh </dev/null >/tmp/live-ai.log 2>&1)
    wait_health 5001 240 || exit 1
    (cd "$STAGING/mta-ai-intramind" && setsid -f bash scripts/start-worker.sh </dev/null >/tmp/live-ai-worker.log 2>&1)
  fi
else
  log "BỎ QUA tầng live (SKIP_LIVE=1)"
fi

# ── Dev Space ────────────────────────────────────────────────────────
log "DEV 1/2 — serving-voice :15003"
if alive 15003; then echo "  đã sống, bỏ qua"; else
  # Env PHẢI export trên dòng lệnh: repo serving đọc os.environ thuần, KHÔNG
  # đọc .env — bỏ qua bước này thì engine không nạp (/voices trả rỗng) và
  # embedder nhảy lên GPU, ăn tranh VRAM của LLM bản thật.
  ( cd "$DEV/mta-ai-serving-intramind" && \
    env PATH="$DEV/bin:$PATH" \
      EMBEDDING_DEVICE=cpu HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
      ENABLE_RERANKER=false \
      ENABLE_TTS=true TTS_ENGINE_VI=piper_vi TTS_ENGINE_EN=piper_en_amy_low \
      TTS_MODEL_DIR="$DEV/models/tts" TTS_DEVICE=cpu TTS_NUM_THREADS=2 \
      ENABLE_STT=true STT_ENGINE_VI=sherpa_vi_30m STT_ENGINE_EN=moonshine_tiny_en \
      STT_MODEL_DIR="$DEV/models/stt" STT_DEVICE=cuda STT_NUM_THREADS=2 \
      setsid -f .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 15003 \
      </dev/null >>"$DEV/logs/serving-voice.log" 2>&1 )
  wait_health 15003 240 || exit 1
  curl -s -m 5 localhost:15003/api/v1/voices | grep -q '"vi"' \
    && echo "  giọng vi+en đã nạp" || warn "/voices RỖNG — kiểm TTS_MODEL_DIR"
fi

log "DEV 2/2 — AI :15001 + worker (chỉ queue audio_overview)"
if alive 15001; then echo "  đã sống, bỏ qua"; else
  ( cd "$DEV/mta-ai-intramind" && \
    PATH="$DEV/bin:$PATH" setsid -f .venv/bin/python -m uvicorn api.main:app \
      --host 0.0.0.0 --port 15001 </dev/null >>"$DEV/logs/ai-voice.log" 2>&1 )
  wait_health 15001 240 || exit 1
  # CELERY_QUEUES là chắn tầng 2 chồng lên Redis riêng :16379 — mặc định của
  # start-worker.sh trùng 5 queue với worker bản thật.
  ( cd "$DEV/mta-ai-intramind" && \
    PATH="$DEV/bin:$PATH" CELERY_QUEUES=audio_overview CELERY_WORKER_NAME=devspace-audio \
      setsid -f bash scripts/start-worker.sh </dev/null >>"$DEV/logs/ai-voice-worker.log" 2>&1 )
fi

# Redis/MinIO riêng có --restart unless-stopped nên tự lên; chỉ bật lại nếu tắt.
for c in devspace-redis devspace-minio; do
  docker ps --format '{{.Names}}' | grep -qx "$c" || { docker start "$c" >/dev/null 2>&1 && echo "  bật lại $c"; }
done

# FE Dev Space là container, tự lên; chỉ nhắc nếu thiếu.
docker ps --format '{{.Names}}' | grep -q devspace-fe-frontend \
  || warn "FE Dev Space chưa chạy: docker compose -p devspace-fe -f $DEV/mta-fe-devspace/docker/docker-compose-v2.yml up -d"

# ── Tổng kết ─────────────────────────────────────────────────────────
log "Trạng thái cuối"
for p in 5003 5002 5001 5050 8001 15003 15001 15050 18001; do
  printf '  :%-6s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' -m 5 "localhost:$p/health" 2>/dev/null || echo 000)"
done
nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader | sed 's/^/  VRAM: /'
echo
echo "  Bản thật     : http://100.108.33.98:8001"
echo "  Dev Space    : http://100.108.33.98:18001   (admin/admin)"
echo "  Mic cần HTTPS/localhost → ssh -L 18001:localhost:18001 ccoex@100.108.33.98"

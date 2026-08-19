#!/usr/bin/env bash
#
# Bring up the Dev Space voice backend on the ccoex VPS.
#
# Runs ON the VPS, as user `ccoex`. Brings up, in order:
#   1. dedicated redis  :16379   (isolated broker + cache)
#   2. dedicated minio  :19000   (isolated episode bucket)
#   3. serving-voice    :15003   (TTS + STT, bare metal)
#   4. AI voice         :15001   (+ audio_overview celery worker)
#
# ─────────────────────────────────────────────────────────────────────
# ABSOLUTE SAFETY RULES — the live staging stack shares this machine.
#
#   * NEVER touch the bare-metal uvicorn processes on :5001 / :5002 /
#     :5003, or any container not named devspace-*.
#   * NEVER `pkill -f uvicorn` — that kills live. Kill by PORT only.
#   * NEVER `git checkout` under ~/Desktop/intramind_staging: that is the
#     live tree and its AI checkout has uncommitted work.
#   * NEVER `apt install`. A previous apt run on this box upgraded the
#     NVIDIA userspace driver mid-flight and killed every new GPU
#     container. ffmpeg comes from a static tarball into ~/devspace/bin.
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="${DEVSPACE_ROOT:-$HOME/devspace}"
AI_PORT="${AI_PORT:-15001}"
SERVING_PORT="${SERVING_PORT:-15003}"
REDIS_PORT="${REDIS_PORT:-16379}"
MINIO_PORT="${MINIO_PORT:-19000}"
MINIO_CONSOLE_PORT="${MINIO_CONSOLE_PORT:-19001}"

log() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ── Refuse to run if the live stack is not where we expect it ────────
# If :5003 is down, the dev AI has no embedder and retrieval would
# silently return nothing rather than fail loudly.
for port in 5001 5002 5003; do
  curl -fsS --max-time 5 "http://localhost:$port/health" >/dev/null \
    || die "live service :$port is not healthy — fix that before starting Dev Space"
done
log "live stack healthy on :5001 :5002 :5003 (untouched)"

# ── tmux hoặc setsid ─────────────────────────────────────────────────
# ccoex KHÔNG có tmux (đã kiểm 2026-08-19: không /usr/bin/tmux, không snap) và
# không có sudo để cài. Giữ tmux khi có vì nó cho `attach` xem log trực tiếp;
# thiếu thì rơi về setsid — cùng cách restore-all.sh vẫn dùng để dựng lại sau
# reboot. Đừng đổi thành `command -v tmux || die`: cả hai đường đều chạy được.
HAVE_TMUX=0
command -v tmux >/dev/null 2>&1 && HAVE_TMUX=1

# run_bg <tên phiên> <thư mục> <lệnh shell>
run_bg() {
  local name="$1" dir="$2" cmd="$3"
  if [ "$HAVE_TMUX" = 1 ]; then
    tmux kill-session -t "$name" 2>/dev/null || true
    tmux new-session -d -s "$name" -c "$dir" "$cmd"
  else
    ( cd "$dir" && setsid -f bash -c "$cmd" </dev/null >/dev/null 2>&1 )
  fi
}



[ -d "$ROOT" ] || die "$ROOT missing — run devspace-bootstrap.sh first"

# ── 1+2. Isolated stateful containers ────────────────────────────────
# Redis MUST be dedicated. The live Celery app has the same name
# (intramind_worker) on the same broker db, and start-worker.sh defaults
# to a queue list that overlaps live's — sharing the broker means the dev
# worker eats real users' summaries.
if ! docker ps --format '{{.Names}}' | grep -qx devspace-redis; then
  log "starting devspace-redis on 127.0.0.1:$REDIS_PORT"
  docker run -d --name devspace-redis --restart unless-stopped \
    -p "127.0.0.1:$REDIS_PORT:6379" redis:7-alpine >/dev/null
fi

if ! docker ps --format '{{.Names}}' | grep -qx devspace-minio; then
  log "starting devspace-minio on 127.0.0.1:$MINIO_PORT"
  docker run -d --name devspace-minio --restart unless-stopped \
    -p "127.0.0.1:$MINIO_PORT:9000" \
    -p "127.0.0.1:$MINIO_CONSOLE_PORT:9001" \
    -e MINIO_ROOT_USER=devspace -e MINIO_ROOT_PASSWORD=devspace123 \
    -v devspace_minio:/data \
    minio/minio server /data --console-address ":9001" >/dev/null
fi

# ── 3. Voice serving ─────────────────────────────────────────────────
# ENABLE_RERANKER=false and EMBEDDING_DEVICE=cpu are load-bearing: the
# card has ~3.7 GB free and a second jina-v3 (~2 GB + a ~1.8 GB listwise
# spike) would OOM the LIVE answer LLM.
log "starting serving-voice on :$SERVING_PORT"
# Serving đọc os.environ THUẦN, không đọc .env — thiếu khối env này thì engine
# không nạp, /voices trả rỗng và embedder nhảy lên GPU tranh VRAM của bản thật.
# TTS_OUTPUT_SAMPLE_RATE=48000 là tần số gốc của VieNeu; resample không có lọc
# chống răng cưa nên không bao giờ đặt thấp hơn tần số gốc của engine đang nạp.
run_bg devspace-serving "$ROOT/mta-ai-serving-intramind" \
  "PATH=$ROOT/bin:\$PATH \
   EMBEDDING_DEVICE=cpu HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 ENABLE_RERANKER=false \
   ENABLE_TTS=true \
   TTS_VOICE_VI_FEMALE=piper_vi_female TTS_VOICE_VI_MALE=piper_vi_male TTS_VOICE_VI_MALE_SID=38 \
   TTS_VOICE_VI_FEMALE_HQ=vieneu_vi_female TTS_VOICE_VI_MALE_HQ=vieneu_vi_male \
   TTS_VIENEU_SPEAKER_FEMALE='Kim Thanh' TTS_VIENEU_SPEAKER_MALE='Minh Đức' \
   TTS_VIENEU_PRECISION=int8 TTS_VIENEU_MAX_CHARS=64 TTS_VIENEU_MAX_BATCH=1 \
   TTS_OUTPUT_SAMPLE_RATE=48000 \
   TTS_MODEL_DIR=$ROOT/models/tts TTS_DEVICE=cpu TTS_NUM_THREADS=2 \
   ENABLE_STT=true STT_ENGINE_VI=sherpa_vi_30m \
   STT_MODEL_DIR=$ROOT/models/stt STT_DEVICE=cpu STT_NUM_THREADS=2 \
   .venv/bin/python -m uvicorn app.main:app \
     --host 0.0.0.0 --port $SERVING_PORT >> $ROOT/logs/serving-voice.log 2>&1"

log "waiting for serving-voice /health"
for i in $(seq 1 60); do
  curl -fsS --max-time 3 "http://localhost:$SERVING_PORT/health" >/dev/null && break
  [ "$i" = 60 ] && die "serving-voice never came up — see $ROOT/logs/serving-voice.log"
  sleep 2
done

# The voice routes are the whole point; a 200 on /health with no engines
# loaded is a silent failure, so check the real endpoint. Grep for the voice
# ids rather than just '"vi"' — that 4-character match would pass on any
# payload mentioning the language.
VOICES=$(curl -fsS "http://localhost:$SERVING_PORT/api/v1/voices")
echo "$VOICES" | grep -q '"vi_female"' \
  || die "no Vietnamese TTS voice loaded — check TTS_MODEL_DIR"
# A warning, not a die: female-only is a usable system, it just cannot render
# a two-host podcast.
echo "$VOICES" | grep -q '"vi_male"' \
  || echo "WARN: giọng nam chưa nạp — chạy docker/voice_model_download.sh (bundle vivos)"
# Giọng HQ nạp lười: /voices khai báo trước, trọng số vào RAM ở lượt TTS đầu.
echo "$VOICES" | grep -q '"vi_male_hq"' \
  || echo "WARN: thiếu vi_*_hq — kiểm gói vieneu trong .venv + HF cache; tập sẽ tự hạ về Piper 16 kHz"

# ── 4. AI voice + worker ─────────────────────────────────────────────
log "starting ai-voice on :$AI_PORT"
run_bg devspace-ai "$ROOT/mta-ai-intramind" \
  "PATH=$ROOT/bin:\$PATH .venv/bin/python -m uvicorn api.main:app \
     --host 0.0.0.0 --port $AI_PORT >> $ROOT/logs/ai-voice.log 2>&1"

# CELERY_QUEUES is defence in depth on top of the dedicated Redis: the
# script's default queue list overlaps the live worker's five queues.
log "starting ai-voice worker (queue: audio_overview only)"
run_bg devspace-worker "$ROOT/mta-ai-intramind" \
  "CELERY_QUEUES=audio_overview \
   CELERY_WORKER_NAME=devspace-audio \
   PATH=$ROOT/bin:\$PATH \
   bash scripts/start-worker.sh >> $ROOT/logs/ai-voice-worker.log 2>&1"

log "waiting for ai-voice /health"
for i in $(seq 1 60); do
  curl -fsS --max-time 3 "http://localhost:$AI_PORT/health" >/dev/null && break
  [ "$i" = 60 ] && die "ai-voice never came up — see $ROOT/logs/ai-voice.log"
  sleep 2
done

# ── Isolation proof ──────────────────────────────────────────────────
log "isolation check"
echo -n "  live redis db0 keys : "
docker exec redis redis-cli -n 0 DBSIZE
echo -n "  dev  redis db0 keys : "
docker exec devspace-redis redis-cli -n 0 DBSIZE
echo    "  live minio buckets  : $(docker exec minio ls /data | tr '\n' ' ')"
echo -n "  live :5003 has voice: "
curl -s -o /dev/null -w '%{http_code} (404 expected)\n' \
  "http://localhost:5003/api/v1/voices"

log "Dev Space backend up — AI :$AI_PORT · serving :$SERVING_PORT"
echo "  logs:   $ROOT/logs/"
if command -v tmux >/dev/null 2>&1; then
  echo "  attach: tmux attach -t devspace-ai | devspace-worker | devspace-serving"
else
  echo "  không có tmux — tiến trình chạy nền qua setsid, xem log ở $ROOT/logs/"
fi
echo "  down:   $ROOT/ops/devspace-down.sh"

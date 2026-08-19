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
tmux kill-session -t devspace-serving 2>/dev/null || true
tmux new-session -d -s devspace-serving -c "$ROOT/mta-ai-serving-intramind" \
  "PATH=$ROOT/bin:\$PATH .venv/bin/python -m uvicorn app.main:app \
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

# ── 4. AI voice + worker ─────────────────────────────────────────────
log "starting ai-voice on :$AI_PORT"
tmux kill-session -t devspace-ai 2>/dev/null || true
tmux new-session -d -s devspace-ai -c "$ROOT/mta-ai-intramind" \
  ".venv/bin/python -m uvicorn api.main:app \
     --host 0.0.0.0 --port $AI_PORT >> $ROOT/logs/ai-voice.log 2>&1"

# CELERY_QUEUES is defence in depth on top of the dedicated Redis: the
# script's default queue list overlaps the live worker's five queues.
log "starting ai-voice worker (queue: audio_overview only)"
tmux kill-session -t devspace-worker 2>/dev/null || true
tmux new-session -d -s devspace-worker -c "$ROOT/mta-ai-intramind" \
  "CELERY_QUEUES=audio_overview \
   CELERY_WORKER_NAME=devspace-audio@admin-server \
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
echo "  attach: tmux attach -t devspace-ai | devspace-worker | devspace-serving"
echo "  down:   $ROOT/ops/devspace-down.sh"

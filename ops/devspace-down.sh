#!/usr/bin/env bash
#
# Tear down everything Dev Space, and nothing else.
#
# Deliberately NOT `set -e`: teardown must keep going past anything that
# is already gone, or a half-cleaned box needs manual work.
#
# ─────────────────────────────────────────────────────────────────────
# The one rule: kill by PORT and by devspace- NAME. Never by pattern.
# `pkill -f uvicorn` on this machine kills the live AI, BE and embedding
# services that real users are on.
# ─────────────────────────────────────────────────────────────────────
set -u

ROOT="${DEVSPACE_ROOT:-$HOME/devspace}"
KEEP_VOLUMES="${KEEP_VOLUMES:-0}"

log() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

log "stopping tmux sessions"
for s in devspace-ai devspace-worker devspace-serving; do
  tmux kill-session -t "$s" 2>/dev/null && echo "  killed $s"
done

log "releasing dev ports (by port, never by process name)"
for p in 15001 15003; do
  if fuser -k -n tcp "$p" 2>/dev/null; then echo "  freed :$p"; fi
done

log "stopping Dev Space FE stack"
docker compose -p devspace-fe \
  -f "$ROOT/mta-fe-devspace/docker/docker-compose-v2.yml" down 2>/dev/null \
  && echo "  devspace-fe down"

log "removing Dev Space containers"
docker rm -f devspace-redis devspace-minio 2>/dev/null

if [ "$KEEP_VOLUMES" = "1" ]; then
  log "keeping volumes (KEEP_VOLUMES=1)"
else
  # `compose down -v` does NOT remove these: docker-compose-v2.yml gives
  # them explicit `name:` keys, which puts them outside the project's
  # lifecycle. Skipping this step silently reuses stale data next run.
  log "removing Dev Space volumes"
  docker volume rm devspace_fe_postgres devspace_fe_mongo devspace_minio 2>/dev/null
fi

# ── Prove live is untouched ──────────────────────────────────────────
log "live stack after teardown"
for p in 5001 5002 5003; do
  printf '  :%s → %s\n' "$p" \
    "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://localhost:$p/health")"
done
echo -n "  containers still up: "
docker ps --format '{{.Names}}' | wc -l
echo -n "  any devspace-* left: "
docker ps -a --format '{{.Names}}' | grep -c '^devspace-' || echo 0

log "dev ports"
ss -tlnp 2>/dev/null | grep -E ':(15001|15003|15050|18001|15432|37018|16379|19000)' \
  || echo "  all released"

echo
echo "Source tree kept at $ROOT (delete manually if you are done)."

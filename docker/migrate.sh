#!/bin/sh
# ============================================================================
# migrate.sh — apply pending db/psql/migrate_NNN.sql files in version order.
# ============================================================================
# Runs every migrate_<3-digit>.sql found in $MIGRATIONS_DIR, in sorted order,
# skipping any version already recorded in the schema_migrations table. Each
# migration is applied in a single transaction together with its bookkeeping
# insert, so a failed migration is not marked as applied.
#
# Intended to run as a one-shot container against an existing Postgres volume
# (see the db-migrate service in docker-compose-v2.yml). Idempotent: re-running
# is a no-op once all migrations are applied.
# ============================================================================
set -eu

DB_HOST="${DB_HOST:-sql-db}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-intramind}"
export PGPASSWORD="${DB_PASSWORD:-postgres}"

MIGRATIONS_DIR="${MIGRATIONS_DIR:-/migrations}"

psql_cmd() {
  psql -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" "$@"
}

echo "[migrate] waiting for postgres at $DB_HOST:$DB_PORT ..."
until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" >/dev/null 2>&1; do
  sleep 2
done

echo "[migrate] ensuring schema_migrations table ..."
psql_cmd -q -c "CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);"

applied_any=0
for f in "$MIGRATIONS_DIR"/migrate_[0-9]*.sql; do
  # Guard against the glob matching nothing.
  [ -e "$f" ] || continue

  version=$(basename "$f" .sql)
  exists=$(psql_cmd -tA -c "SELECT 1 FROM schema_migrations WHERE version = '$version';")
  if [ "$exists" = "1" ]; then
    echo "[migrate] $version already applied — skipping"
    continue
  fi

  echo "[migrate] applying $version ..."
  psql_cmd --single-transaction \
    -f "$f" \
    -c "INSERT INTO schema_migrations (version) VALUES ('$version');"
  echo "[migrate] $version applied"
  applied_any=1
done

if [ "$applied_any" = "0" ]; then
  echo "[migrate] no pending migrations"
fi
echo "[migrate] done"

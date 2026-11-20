#!/bin/bash
# All-in-one entrypoint: starts a local PostgreSQL cluster, creates the app
# database on first boot, runs migrations/seed, then starts the server.
# Everything lives under /data so one volume is enough.
set -euo pipefail

UPLOAD_DIR="${UPLOAD_DIR:-/data/uploads}"
PGDATA="${PGDATA:-/data/pgdata}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-meme}"
PGDATABASE="${PGDATABASE:-meme_battle}"

mkdir -p "$UPLOAD_DIR" "$(dirname "$PGDATA")"
export UPLOAD_DIR

# First boot: create the cluster. Trust auth is safe here because PostgreSQL
# only listens on 127.0.0.1 inside this container.
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "Initializing bundled PostgreSQL in $PGDATA..."
  initdb -D "$PGDATA" -U "$PGUSER" --auth=trust --no-locale -E UTF8 >/dev/null
  {
    echo "listen_addresses = '127.0.0.1'"
    echo "port = $PGPORT"
    echo "unix_socket_directories = '/tmp'"
  } >> "$PGDATA/postgresql.conf"
fi

echo "Starting bundled PostgreSQL on 127.0.0.1:$PGPORT..."
if ! pg_ctl -D "$PGDATA" -l /data/postgres.log -w start; then
  echo "ERROR: PostgreSQL failed to start. Last log lines:" >&2
  tail -n 50 /data/postgres.log >&2 || true
  exit 1
fi

stop_postgres() {
  echo "Stopping bundled PostgreSQL..."
  pg_ctl -D "$PGDATA" -m fast stop >/dev/null 2>&1 || true
}
trap stop_postgres EXIT

if ! psql -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER" -d postgres \
  -tAc "SELECT 1 FROM pg_database WHERE datname = '$PGDATABASE'" | grep -q 1; then
  echo "Creating database $PGDATABASE..."
  createdb -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER" "$PGDATABASE"
fi

if [ -z "${DATABASE_URL:-}" ]; then
  # No password: local trust auth, and the port is not published.
  export DATABASE_URL="postgresql://$PGUSER@127.0.0.1:$PGPORT/$PGDATABASE?schema=public"
fi
echo "Bundled database ready: 127.0.0.1:$PGPORT/$PGDATABASE"

echo "Applying database migrations..."
./node_modules/.bin/prisma migrate deploy

if [ "${SEED_ON_BOOT:-true}" = "false" ]; then
  echo "SEED_ON_BOOT=false - skipping seed."
else
  echo "Seeding database (idempotent)..."
  ./node_modules/.bin/tsx prisma/seed.ts
fi

# Best effort: a cleanup failure must never keep the app from starting.
echo "Cleaning up unreferenced uploads..."
if ! ./node_modules/.bin/tsx scripts/cleanup-uploads.ts; then
  echo "WARNING: upload cleanup failed; continuing startup." >&2
fi

echo "Starting meme-battle..."
node --import tsx server.ts &
APP_PID=$!

# PID 1 is this script: forward container stops to Node, then let the EXIT
# trap shut PostgreSQL down cleanly.
forward_signal() {
  kill -TERM "$APP_PID" 2>/dev/null || true
}
trap forward_signal TERM INT

set +e
wait "$APP_PID"
STATUS=$?
set -e
exit "$STATUS"

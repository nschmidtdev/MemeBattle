#!/bin/bash
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set." >&2
  echo "Use the all-in-one image (tag: latest-bundled) for a single container," >&2
  echo "or pass DATABASE_URL=postgresql://user:password@host:5432/db?schema=public." >&2
  exit 1
fi

UPLOAD_DIR="${UPLOAD_DIR:-/data/uploads}"
mkdir -p "$UPLOAD_DIR"
export UPLOAD_DIR

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
exec node --import tsx server.ts

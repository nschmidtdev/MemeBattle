#!/bin/bash
set -euo pipefail

UPLOAD_DIR="${UPLOAD_DIR:-/data/uploads}"
mkdir -p "$UPLOAD_DIR"

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

#!/bin/sh
set -e

echo "Applying database migrations..."
npx prisma migrate deploy

echo "Starting seed check..."
npx tsx prisma/seed.ts || echo "Seed skipped (already seeded or failed - see log above)"

echo "Starting meme-battle..."
exec node --import tsx server.ts

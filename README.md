# Meme Battle

A self-hosted, browser-based party game inspired by *Make It Meme*. Players get a meme
template, caption it under time pressure, and vote on each other's memes. The best
meme-maker wins. No accounts, no filters, no mercy.

## Features

- **Core loop** — lobby → caption timer → synced voting → round results → ranking.
- **Meme Buddy** — once per round you can pick one other player's meme (only the
  one currently on screen) as your Buddy. You get half of its final points,
  positive or negative, and the meme gets +10 per Buddy. Picks stay secret until
  the round results.
- **Ranked round gallery** — every round ends with a gallery of that round's
  memes, best first. Cards show rank, final score, the +10×N Buddy bonus and who
  picked the meme. Next to it: the round podium, a full round ranking with
  `Meme ±X · Buddy ±Y` breakdown, and the cumulative overall standings.
- **Private & public lobby** — share a 5-letter code with your group, or join a
  public lobby. Up to 30 players per lobby.
- **Guest play** — just pick a name and play, no sign-up.
- **Custom memes** — admins can create packs and upload template images. Players
  edit every meme in a WYSIWYG editor: pre-placed text boxes are just starting
  positions — move, restyle, delete and add as many texts as you like.
- **Content-only admin panel** — manage packs and templates via `/admin`. No user
  management, no reporting, no moderation.
- **Böse memes allowed** — there is intentionally no profanity filter and no
  auto-moderation. What you caption is what the room gets.
- **Self-hosted & private** — Docker Compose, one Postgres container, no external
  services, no telemetry, no ads.

## Quick start (Docker)

Requirements: [Docker](https://www.docker.com/) with Docker Compose.

```sh
git clone <repo-url> meme-battle
cd meme-battle
cp .env.example .env        # optional, but set POSTGRES_PASSWORD and ADMIN_PASSWORD
docker compose up -d --build
```

Open <http://localhost:3000>. The first boot applies migrations, seeds a **Classic**
pack with 7 templates (only when the pack is missing or empty), and creates the admin
user.

- Admin panel: <http://localhost:3000/admin>
- If you set `ADMIN_PASSWORD` in `.env`, that is the admin password. If you leave it
  empty, a random password is generated on first boot and printed **once** to the
  container log: `docker compose logs app | grep -i password`.
- Set `POSTGRES_PASSWORD` **before the first start**; Postgres only applies it when
  the `pgdata` volume is initialized. The `secret` fallback is a development
  convenience — do not expose it to a LAN you do not trust.

If port 3000 is already in use, set `APP_PORT` in `.env` (e.g. `APP_PORT=3100`) and
open <http://localhost:3100>. The port is published on all interfaces (`APP_BIND`,
default `0.0.0.0`) so phones on the same LAN can join; set `APP_BIND=127.0.0.1` for
local-only access.

Postgres data and uploaded images persist in the `pgdata` and `uploads` volumes.
Remove them with `docker compose down -v` (this deletes all data).

## Development

Node.js 24 is the supported runtime (`.nvmrc`); `package.json` allows `>=22 <27`.

```sh
# 1. Start a Postgres (or point DATABASE_URL at any existing one)
docker run -d --name mb-dev-pg -e POSTGRES_USER=meme -e POSTGRES_PASSWORD=secret \
  -e POSTGRES_DB=meme_battle -p 127.0.0.1:5432:5432 postgres:16-alpine

# 2. Install, configure, migrate, seed
npm install
cp .env.example .env
npm run db:migrate
npm run db:seed

# 3. Run
npm run dev        # http://localhost:3000
```

`npm run dev` and `npm start` load `.env`, `.env.local`, `.env.<mode>` (Next.js
conventions) before config is read; variables already set in the shell win. `npm
start` runs the same server with `NODE_ENV=production` (via `scripts/start.mjs`,
Windows-safe, no extra dependency).

`npm run db:push` is for local prototyping only — it syncs the schema without a
migration. Production upgrades use committed migrations (`npm run db:migrate`).

A full E2E smoke test (game loop + admin API) lives in `scripts/e2e.ts`. It logs in
as the admin, so use the same `ADMIN_PASSWORD` the server was started with:

```sh
ADMIN_EMAIL=admin@localhost ADMIN_PASSWORD="your-dev-password" npx tsx scripts/e2e.ts
```

## How to play

1. Enter a name and create a lobby (or join one by code).
2. Pick the template packs, rounds, and timer lengths (host only).
3. When the round starts, everyone gets one template — caption it before time runs
   out. Once **everyone** has submitted, voting starts right away.
4. Memes are shown one at a time; upvote, downvote, or "meh". Votes are synced and
   can be changed while the meme is on screen. Once per round you can also make
   one other player's meme your **Meme Buddy** (not your own): you get half of its
   final points, positive or negative, and it gets +10 per Buddy.
5. At the end of the round, points are scored from the vote tallies
   (`1000 * (up − down) / (up + down)`, range −1000…+1000), plus the Meme Buddy
   bonuses, and added to your total. You can't vote for your own meme.
6. After the final round, the ranking is revealed.

## Configuration

All configuration is via environment variables (see `.env.example`):

| Variable            | Default                  | Description |
| ------------------- | ------------------------ | ----------- |
| `DATABASE_URL`      | — (required)             | Postgres connection string. Compose builds it from `POSTGRES_PASSWORD`. |
| `PORT`              | `3000`                   | HTTP port the app listens on (validated 1–65535). Docker: always 3000 inside the container. |
| `APP_PORT`          | `3000`                   | Host port published by Docker Compose. |
| `APP_BIND`          | `0.0.0.0`                | Host interface published by Docker Compose (`127.0.0.1` for local-only). |
| `CORS_ORIGIN`       | unset = same-origin only | Comma-separated extra allowed Socket.io origins (e.g. `https://a.example,http://192.168.1.10:3000`). Same-origin is always allowed; `*` allows all. |
| `ADMIN_EMAIL`       | `admin@localhost` (Compose) | Admin login email, created on first boot. |
| `ADMIN_PASSWORD`    | empty = generated        | Admin password. If set, it is applied on every boot. Empty: random one-time password printed on first boot. |
| `COOKIE_SECURE`     | auto-detect              | Forces the admin session cookie's `Secure` flag (`true`/`false`). Unset: HTTPS detected via `X-Forwarded-Proto` or the request URL. |
| `UPLOAD_DIR`        | `./data/uploads`         | Where uploaded template images are stored (Docker: `/data/uploads`). |
| `SEED_ON_BOOT`      | `true`                   | Docker entrypoint only: set `false` to skip seeding at startup. |
| `SEED_FORCE`        | unset                    | Set to `1` for a deliberate re-sync of the seeded Classic pack. |
| `POSTGRES_PASSWORD` | `secret` (Compose only)  | Password for the bundled Postgres. Set it before the first start; use letters/digits (it is embedded in `DATABASE_URL`). |

With Docker Compose, values from `.env` are used for variable substitution (e.g.
`POSTGRES_PASSWORD`, `APP_PORT`, `ADMIN_PASSWORD`); the container environment itself is
defined in `docker-compose.yml`.

### HTTP in the LAN vs. HTTPS

Phones on your LAN will usually reach the game over plain HTTP
(`http://192.168.x.y:3000`). The session cookie stays non-`Secure` there, which is the
correct behavior. If you put a TLS-terminating reverse proxy in front of the app (e.g.
Caddy, nginx), make sure it sets `X-Forwarded-Proto: https` so the cookie is marked
`Secure` automatically — or pin `COOKIE_SECURE=true`. If the public origin differs from
the Host the app sees (proxy rewrites Host), set `CORS_ORIGIN` to the public origin so
Socket.io accepts the handshake.

## Operations

### Health check

`GET /api/health` runs `SELECT 1` against Postgres and answers `200 {"ok":true}`, or
`503 {"ok":false}` when the database is unreachable. The Compose healthcheck polls it
(Node `fetch`, 40 s start period); `docker compose ps` shows the container as healthy.

```sh
curl -i http://localhost:3000/api/health
```

### Seed behavior

- First boot: creates the `Classic` pack with its 7 templates.
- If the pack already exists **and has at least one template**, seeding is skipped —
  user edits and deleted templates are left untouched.
- `SEED_FORCE=1` re-applies the seed definitions (updates the 7 templates, restores
  missing ones, resets the pack metadata). In Docker:
  `docker compose exec -e SEED_FORCE=1 app npx tsx prisma/seed.ts`.
- Seed errors are reported and exit non-zero; the container entrypoint aborts instead
  of silently starting with half-seeded data.

### Upload cleanup

At boot the entrypoint removes files from `UPLOAD_DIR` that no template references
(seed images under `public:` are never touched). Cleanup is best-effort and cannot
block startup. Run it manually with:

```sh
docker compose exec app npx tsx scripts/cleanup-uploads.ts   # Docker
npm run uploads:cleanup                                      # local
```

### Backup and restore

```sh
# Backup database
docker compose exec -T db pg_dump -U meme -d meme_battle > backup-db.sql
# Backup uploads
docker compose exec -T app tar czf - -C /data/uploads . > backup-uploads.tar.gz

# Restore (stop the app first so nothing writes during the restore)
docker compose stop app
docker compose exec -T db psql -U meme -d meme_battle < backup-db.sql
docker compose run --rm --no-deps -T --entrypoint sh app \
  -c 'tar xzf - -C /data/uploads' < backup-uploads.tar.gz
docker compose start app
```

### Upgrade

```sh
git pull
docker compose up -d --build
docker compose ps     # wait for "healthy"
```

Migrations run automatically in the entrypoint (`prisma migrate deploy`) before the
server starts. The app runs as the unprivileged `node` user; if you upgrade from an
older image that ran as root, fix the existing uploads volume once:

```sh
docker compose run --rm --no-deps --user root --entrypoint chown app -R node:node /data/uploads
```

## Project structure

```
server.ts                     Custom entry: Next.js + Socket.io in one process
src/
  app/                        Next.js App Router (start page, lobby, admin UI, API routes)
    api/health/route.ts       DB-backed health endpoint for the container probe
  server/                     Game server: lobby state machine + socket wiring
  lib/                        Shared types, scoring, storage, auth, config, env loading
prisma/                       Schema + seed (Classic pack with 7 SVG templates)
public/seed/                  Seeded template images (hand-made SVGs)
scripts/start.mjs             Production start with NODE_ENV=production
scripts/cleanup-uploads.ts    Removes unreferenced files from UPLOAD_DIR
scripts/e2e.ts                End-to-end smoke test (socket.io-client, no browser needed)
```

## Tech stack

Node.js 24 · Next.js 15 (App Router, TypeScript) · Tailwind CSS · Socket.IO ·
Prisma + PostgreSQL · Canvas-based client-side meme rendering · Docker Compose for
self-hosting.

## License

[MIT](./LICENSE) — do whatever you want with it, even böse memes.

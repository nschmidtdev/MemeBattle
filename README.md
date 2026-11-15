# Meme Battle

A self-hosted, browser-based party game inspired by *Make It Meme*. Players get a meme
template, caption it under time pressure, and vote on each other's memes. The best
meme-maker wins. No accounts, no filters, no mercy.

## Features

- **Core loop** — lobby → caption timer → synced voting → round results → ranking.
- **Private & public lobbys** — share a 5-letter code with your group, or join a
  public lobby. Up to 30 players per lobby.
- **Guest play** — just pick a name and play, no sign-up.
- **Custom memes** — admins can create packs and upload template images, and every
  template supports editable text boxes *and* free-form text (fully freeform
  "any image + caption" style).
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
cp .env.example .env        # optional: tweak admin credentials / port
docker compose up --build
```

Open <http://localhost:3000>. The first boot applies migrations, seeds a **Classic**
pack with 7 templates, and creates the admin user.

- Admin panel: <http://localhost:3000/admin>
- Default admin: `admin@localhost` / `memeadmin` (set your own in `.env` — see below).

If port 3000 is already in use on your machine, set `APP_PORT` in `.env`
(e.g. `APP_PORT=3100`) and open <http://localhost:3100> instead.

Postgres data and uploaded images persist in the `pgdata` and `uploads` volumes.
Remove them with `docker compose down -v`.

## Development

```sh
# 1. Start a Postgres (or point DATABASE_URL at any existing one)
docker run -d --name mb-dev-pg -e POSTGRES_USER=meme -e POSTGRES_PASSWORD=secret \
  -e POSTGRES_DB=meme_battle -p 127.0.0.1:5432:5432 postgres:16-alpine

# 2. Install, migrate, seed
npm install
cp .env.example .env
npm run db:migrate
npm run db:seed

# 3. Run
npm run dev        # http://localhost:3000
```

`npm run start` runs the same production-style server (`tsx server.ts` with
`NODE_ENV=production`). A full E2E smoke test (game loop + admin API) lives in
`scripts/e2e.ts`:

```sh
ADMIN_EMAIL=admin@localhost ADMIN_PASSWORD=memeadmin npx tsx scripts/e2e.ts
```

## How to play

1. Enter a name and create a lobby (or join one by code).
2. Pick the template packs, rounds, and timer lengths (host only).
3. When the round starts, everyone gets one template — caption it before time runs
   out. Once **everyone** has submitted, voting starts right away.
4. Memes are shown one at a time; upvote, downvote, or "meh". Votes are synced and
   can be changed while the meme is on screen.
5. At the end of the round, points are scored from the vote tallies
   (`1000 * (up − down) / (up + down)`, range −1000…+1000) and added to your total.
   You can't vote for your own meme.
6. After the final round, the ranking is revealed.

## Configuration

All configuration is via environment variables (see `.env.example`):

| Variable         | Default                              | Description                                        |
| ---------------- | ------------------------------------ | -------------------------------------------------- |
| `DATABASE_URL`   | `postgresql://meme:secret@localhost:5432/meme_battle?schema=public` | Postgres connection string |
| `PORT`           | `3000`                               | HTTP port the app listens on (Docker: always 3000 inside the container) |
| `APP_PORT`       | `3000`                               | Host port the Docker Compose setup maps the app to (Docker only) |
| `CORS_ORIGIN`    | same-origin (`*` in dev)             | Allowed origin for socket.io                       |
| `ADMIN_EMAIL`    | —                                    | Admin login email. The admin user is created on first boot. |
| `ADMIN_PASSWORD` | — (auto-generated, printed to log)   | Admin password. Pin it to make login deterministic. |
| `UPLOAD_DIR`     | `./data/uploads`                     | Where uploaded template images are stored (Docker: `/data/uploads`) |

With Docker Compose, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `APP_PORT` are read from
the `.env` file next to `docker-compose.yml` (or your shell environment).

## Project structure

```
server.ts               Custom entry: Next.js + Socket.io in one process
src/
  app/                  Next.js App Router (start page, lobby, admin UI, API routes)
  server/               Game server: lobby state machine + socket wiring
  lib/                  Shared types, scoring, storage, auth, client socket helper
prisma/                 Schema + seed (Classic pack with 7 SVG templates)
public/seed/            Seeded template images (hand-made SVGs)
scripts/e2e.ts          End-to-end smoke test (socket.io-client, no browser needed)
```

## Tech stack

Next.js 15 (App Router, TypeScript) · Socket.IO · Prisma + PostgreSQL ·
Canvas-based client-side meme rendering · Docker Compose for self-hosting.

## License

[MIT](./LICENSE) — do whatever you want with it, even böse memes.

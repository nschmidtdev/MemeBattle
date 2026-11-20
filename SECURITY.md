# Security

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Use GitHub's private
vulnerability reporting:

<https://github.com/nschmidtdev/MemeBattle/security/advisories/new>

Include the affected commit/version, reproduction steps, impact, and any logs with
secrets removed. Reports are acknowledged as soon as possible; please allow a few
days before disclosing publicly.

## Supported versions

Only the latest `main` is supported. There are no backports for older commits.

## Self-hosting checklist

- Set a strong, unique `POSTGRES_PASSWORD` and `ADMIN_PASSWORD` in `.env` before the
  first start. Rotate the admin password if it was ever shared or logged.
- Never commit `.env` files, database dumps, uploads, API keys, session cookies or
  private keys. The repository ignores them; check `git status` before pushing.
- Put the app behind a TLS-terminating reverse proxy for internet exposure and make
  sure it sets `X-Forwarded-Proto: https` (or pin `COOKIE_SECURE=true`).
- Keep the default `APP_BIND=0.0.0.0` only on a trusted LAN; use `127.0.0.1` for
  local-only access.
- Restrict `CORS_ORIGIN` to the origins you actually use instead of `*`.
- Backups contain user data and uploaded images — store and encrypt them accordingly.
- Imported meme packs are user content. You are responsible for their legality and
  for the rights to distribute them.

## Scope

In scope: authentication/session handling, the admin API, upload handling, Socket.io
authorization, and injection or denial-of-service issues in the app.

Out of scope: missing security headers on third-party reverse proxies, content
uploaded by players/admins, and issues that require the admin password.

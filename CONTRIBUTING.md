# Contributing

Thanks for helping out! Bug reports, fixes, docs and UI improvements are welcome.

## Workflow

1. Fork the repository and create a branch from `main`.
2. Make the change, keep it focused, and add or update tests.
3. Run the checks below.
4. Open a pull request against `main` and describe what changed and why.

## Local setup

```sh
npm install
cp .env.example .env
# start Postgres (see README > Development) and adjust DATABASE_URL if needed
npm run db:migrate
npm run db:seed
npm run dev
```

## Required checks

```sh
npx tsc --noEmit
npm test
npm run lint
```

For changes that touch the game loop or admin API, run the E2E suite against a local
server (see `README.md`):

```sh
npm run test:e2e
```

## Code conventions

- TypeScript, React function components, Tailwind utility classes.
- Keep shared logic in `src/lib` and server state in `src/server`; do not duplicate
  scoring, validation or rendering rules.
- UI icons are `.svg` files in `public/res/icons/` and render through
  `src/components/Icon.tsx`. Do not paste SVG markup into components.
- Prefer small, focused commits with imperative messages.

## Assets & content

- **Never commit** third-party meme packs, imported images, uploads, database dumps,
  `.env` files, API keys or session data.
- The repository only ships the hand-made seed SVGs in `public/seed/` and the Anton
  font under `public/fonts/` (SIL Open Font License).
- Import test content through the local admin importer, not through git.
- Do not add illegal content or real personal data to fixtures, screenshots or docs.

## Security

Do not report vulnerabilities in public issues — see [SECURITY.md](./SECURITY.md).

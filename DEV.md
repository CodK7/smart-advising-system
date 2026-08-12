# Development guide

## First run

```powershell
npm ci
npm run dev
```

Use Node.js 22.13 or newer. Express owns port 5173 and mounts Vite as middleware, so the SPA and protected API use one origin.

## Database workflow

- The official Login Data PDF is the sole authority for account IDs, names, emails, credential values, and roles. `database/dataset.ts` contains the checked in-code transcription plus academic reference data; it stores only one-way password hashes.
- `database/schema.sql` is the schema.
- `database/seed.ts` is the supported seeder.
- `database/verify.ts` verifies exact official accounts, hashes, roles, relationships, schema metadata, and SQLite integrity.

```powershell
npm run db:reset
npm run db:verify
```

Stop the server before resetting the database. Production resets are refused. Do not add parallel seed files, duplicate user lists, or runtime account-creation paths that can diverge from the official PDF roster.

## Quality gate

```powershell
npm run typecheck
npm run lint
npm run test:db
npm run test:unit
npm run test:api
npm run build
npm run test:production
npm run test:browser
```

Browser testing requires Chrome or Chromium. Set `CHROME_PATH` when the executable is not in a standard location.

## Configuration

Copy `.env.example` to `.env.local` only for local development. Shell variables have highest precedence. Tests and production intentionally ignore `.env.local`. Never commit `.env`, `.env.local`, generated databases, logs, or build artifacts.

`DATABASE_PATH` accepts only a local file ending in `.db`, `.sqlite`, or `.sqlite3`. For durable deployment, set `DATABASE_URL` to a PostgreSQL connection URL (for example, from Neon); it takes precedence over `DATABASE_PATH`.

Production requires `APP_ORIGIN` to be a public HTTPS origin. Configure `TRUST_PROXY` only when a trusted reverse proxy is actually in front of the application.

# Codk7 — UTAS Smart Academic Advising System

A bilingual React, TypeScript, Express, and SQLite academic-advising application for UTAS Nizwa. Authentication, authorization, sessions, academic records, messaging, advisor notes, settings, and AI context are enforced on the backend.

## Requirements

- Node.js 22.13 or newer
- npm
- A local writable path for SQLite

## Install and run

```bash
npm ci
npm run dev
```

Open `http://localhost:5173`. Do not open `index.html` directly; the application requires its backend API.

The official login PDF is the only source of truth for accounts and credentials. The database seed contains exactly:

- 1 System Admin
- 1 Registrar Admin
- 1 Student Affairs Admin
- 5 Advisors
- 8 Students

Passwords are stored only as salted scrypt hashes. The application does not display credentials in the UI or documentation.

## Roles and authorization

- **System Admin:** system settings, institution-wide records, official-account oversight (read-only identity), and administrative reporting.
- **Registrar Admin:** student academic-record workflows, curriculum data, advisor assignments, and read-only access to the official staff roster.
- **Student Affairs Admin:** institution statistics and student-affairs views without system-setting, staff-roster, or academic-record mutation access.
- **Advisor:** only assigned students, advising notes, permitted academic information, and messages.
- **Student:** only the signed-in student's own academic information, assigned-advisor communication, and permitted self-service actions.

Authorization is checked on the backend for every protected route. Client-side navigation is not treated as a security boundary.

### Official account immutability

The 16 PDF-defined identities are immutable at runtime: IDs, names, emails, roles, and accounts cannot be changed or deleted through the API, and password rotation is intentionally not exposed. The server validates the complete official account set at startup. Academic records such as major, level, and advisor assignment are separate and may be changed only by System Admin or Registrar Admin.

## Mock behavior

There is no automatic Mock Mode. When the backend cannot be reached, the frontend displays a server connection error. It never silently substitutes mock users or mock data.

## Environment

Copy `.env.example` to `.env.local` for development overrides. Production intentionally ignores `.env.local`; provide production values through the hosting platform or process environment.

```env
PORT=5173
APP_HOST=127.0.0.1
DATABASE_PATH=database.sqlite
TRUST_PROXY=false
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.6-flash
```

Production additionally requires an HTTPS origin:

```env
NODE_ENV=production
APP_ORIGIN=https://your-domain.example
```

Never place secrets in variables prefixed with `VITE_`, because Vite exposes those values to browser code.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Ensure the development database and start the unified Express/Vite server |
| `npm run db:reset` | Rebuild the local database from the checked official-roster transcription and academic reference data |
| `npm run db:verify` | Verify schema, official users, password hashes, roles, and relationships |
| `npm run typecheck` | Run strict TypeScript checks |
| `npm run lint` | Run ESLint, React Hooks, and JSX accessibility rules |
| `npm run test:unit` | Run unit and component tests |
| `npm run test:db` | Seed and verify an isolated database |
| `npm run test:api` | Run isolated authentication and authorization integration tests |
| `npm run test:browser` | Run Chrome/Chromium smoke tests |
| `npm test` | Run the main automated quality gate |
| `npm run build` | Create the production frontend bundle in `dist/` |
| `npm start` | Validate the production database, build, and start the production server |

Test databases are created in temporary directories and do not replace the workspace database.

## Production deployment

1. Run `npm ci` and `npm test` on the target platform.
2. Set `NODE_ENV=production`, `APP_ORIGIN`, `DATABASE_PATH`, and any optional Gemini configuration.
3. Run `npm run db:ensure`, `npm run db:verify`, and `npm run build`.
4. Start with `npm start` or PM2 using `ecosystem.config.cjs`.
5. Put the app behind HTTPS and persist/back up the SQLite database.

Production startup refuses to rebuild an existing incompatible database automatically. A schema or credential-source mismatch fails closed so an operator can back up and perform an explicit migration.

## Source-data limitations

The project does not invent academic facts missing or conflicting in the supplied source dataset. Known curriculum gaps and conflicts are recorded in `database/dataset.ts` and reported by the database seeder and verifier.

See `VERIFICATION.md` for the checks run on the delivered archive.

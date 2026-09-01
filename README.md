# Codk7 — UTAS Smart Academic Advising System

A bilingual React, TypeScript, Hono, and PostgreSQL academic-advising application for UTAS Nizwa. Authentication, authorization, sessions, academic records, messaging, advisor notes, settings, and AI context are enforced on the backend. Deployed to **Cloudflare Workers** with the existing PostgreSQL database (Neon or any hosted provider) accessed via **Cloudflare Hyperdrive**.

## Requirements

- Node.js 22.13 or newer
- npm
- A Cloudflare account (for deployment)
- A PostgreSQL database (Neon, Supabase, RDS, or self-hosted) — the existing Neon database continues to work without changes

## Install and run

```bash
npm ci
npm run build
npm run cf:dev      # Cloudflare Workers local dev (recommended)
# or
npm run dev:node    # Node.js local dev (Hono + @hono/node-server)
# or
npm run dev:frontend # Vite dev server with HMR (proxies /api to wrangler dev)
```

Open `http://localhost:5173` (Vite) or `http://localhost:8787` (Wrangler). Do not open `index.html` directly; the application requires its backend API.

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

### Local development (`.env.local`)

Copy `.env.example` to `.env.local` for development overrides. Production intentionally ignores `.env.local`; provide production values through Cloudflare's bindings and secrets.

```env
# Empty for local Node.js dev (uses SQLite). For Cloudflare dev, wrangler.toml
# controls bindings directly; DATABASE_URL is used by the Node.js entry point.
DATABASE_URL=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.6-flash
APP_ORIGIN=http://127.0.0.1:5173
```

### Cloudflare Workers (production)

- `HYPERDRIVE` binding → PostgreSQL connection string (configured in `wrangler.toml`)
- `GEMINI_API_KEY` → `wrangler secret put GEMINI_API_KEY`
- `GEMINI_MODEL` → `wrangler secret put GEMINI_MODEL` or set in the dashboard
- `APP_ORIGIN` → required, set in the Cloudflare dashboard (HTTPS origin URL)

Never place secrets in variables prefixed with `VITE_`, because Vite exposes those values to browser code.

## Commands

| Command | Purpose |
|---|---|
| `npm run cf:dev` | Run the Worker locally with Wrangler (recommended) |
| `npm run dev:node` | Run the Hono app directly in Node.js |
| `npm run dev:frontend` | Run the Vite dev server with HMR (proxy `/api` to Wrangler) |
| `npm run build` | Create the production frontend bundle in `dist/` |
| `npm run cf:deploy` | Deploy to Cloudflare Workers |
| `npm run db:reset` | Rebuild the local SQLite database from the checked official-roster transcription |
| `npm run db:reset:postgres` | Seed an empty PostgreSQL database (refuses to overwrite existing data) |
| `npm run db:verify` | Verify schema, official users, password hashes, roles, and relationships |
| `npm run typecheck` | Run strict TypeScript checks |
| `npm run lint` | Run ESLint, React Hooks, and JSX accessibility rules |
| `npm run test:unit` | Run unit and component tests |
| `npm run test:db` | Seed and verify an isolated database |
| `npm run test:api` | Run isolated authentication and authorization integration tests |
| `npm test` | Run the main automated quality gate |

Test databases are created in temporary directories and do not replace the workspace database.

## Production deployment (Cloudflare Workers)

1. Run `npm ci` and `npm test` locally.
2. Create a Cloudflare account and install Wrangler: `npm install -g wrangler` (or use `npx wrangler`).
3. Authenticate: `npx wrangler login`.
4. Create a Hyperdrive instance pointing to your PostgreSQL database:
   ```bash
   npx wrangler hyperdrive create utas-db --connection-string="postgres://user:pass@host:port/db"
   ```
   Note the returned Hyperdrive ID and paste it into `wrangler.toml` under `[[hyperdrive]] id`.
5. Build the frontend: `npm run build`.
6. Set secrets:
   ```bash
   npx wrangler secret put GEMINI_API_KEY
   npx wrangler secret put APP_ORIGIN   # e.g. https://your-domain.example
   ```
7. Deploy: `npm run cf:deploy`.

The Worker serves the API at `/api/*` and the built frontend assets from `dist/` via Cloudflare's Assets binding. A Cloudflare Cron Trigger purges expired sessions every hour.

### Architecture

- **Backend**: Hono on Cloudflare Workers (`src/worker.ts` → `server.ts`)
- **Database**: PostgreSQL on Neon (or any provider) via Cloudflare Hyperdrive
- **Frontend**: React 19 + Vite 6 + Tailwind CSS 4, built to `dist/` and served as static assets
- **Sessions**: HTTP-only `Secure` cookies; session data stored in the `sessions` table
- **AI**: Google Gemini with a local fallback engine
- **Cron**: Hourly session purge via `[triggers] crons`

### Data safety

- The existing PostgreSQL schema and data are **never modified or overwritten** by the Worker.
- The database adapter is read/write; the application does not run any DDL on startup.
- Production refuses to start if the schema version is out of date; explicit migrations are required.

## Source-data limitations

The project does not invent academic facts missing or conflicting in the supplied source dataset. Known curriculum gaps and conflicts are recorded in `database/dataset.ts` and reported by the database seeder and verifier.

See `VERIFICATION.md` for the checks run on the delivered archive.

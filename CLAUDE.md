# Provenance Tracker

A local web app for tracking provenance of multimedia assets — AI-generated, archival, and original produced content — and building C2PA Content Credentials manifests for video production.

## Tech Stack

- **Frontend:** React 18, React Router v6, TanStack Query v5, Tailwind CSS v4
- **Backend:** Express (Node.js)
- **Database:** PostgreSQL via Drizzle ORM + `pg`
- **Build:** Vite with `@vitejs/plugin-react`
- **Dev:** `concurrently` runs Express (port 3001) + Vite dev server (port 5173, proxies `/api` to Express)

## Conventions

- JavaScript only (`.js`, `.jsx`) — no TypeScript
- Node `--env-file=.env` for environment variables (no dotenv package)
- Relative imports between server modules; React components use relative paths

## Project Structure

```
src/
  client/                  # React frontend (Vite root)
    components/layout/     # AppShell, Sidebar, PageHeader
    pages/                 # Route pages (Dashboard, ImportHub, Settings, etc.)
      ai-assets/           # AI asset list + detail
      archival/            # Archival list + detail
      produced/            # Produced asset list + detail
      projects/            # Project list + creation
    App.jsx                # React Router config
    app.css                # Tailwind v4 theme (@theme block, dark theme)
    main.jsx               # Entry point
  server/
    db/                    # Drizzle schema, migrations, connection
    lib/                   # Business logic (modular)
      archival/            # Archival CRUD, Notion sync, extraction, constants
      assets/              # AI asset CRUD
      core/                # Shared constants, file utilities
      extraction/          # EXIF, C2PA, PNG chunk extraction + platform parsers
      produced/            # Produced asset CRUD
      dashboard.js         # Dashboard stats + enrichment conditions
      integrity.js         # File integrity checks (orphans, missing)
      projects.js          # Project CRUD + storage folder management
    routes/                # Express route handlers
    index.js               # Express app entry point
```

## Key Commands

```bash
npm run dev              # Start both servers (Express + Vite) concurrently
npm run server:dev       # Express only with --watch + --env-file=.env
npm run client:dev       # Vite dev server only
npm run build            # Production client build to dist/
npm start                # Production: serve Express (serves dist/ + API)
npm run db:push          # Push schema directly to DB (dev shortcut)
npm run db:generate      # Generate Drizzle migrations from schema
npm run db:migrate       # Run pending migrations
```

## Database

PostgreSQL (local install). Connection via `DATABASE_URL` in `.env`. Schema in `src/server/db/schema.js`; committed migrations in `src/server/db/migrations/`.

- **Local iteration** (solo dev DB): `npm run db:push` — fast diff-and-apply, bypasses migration tracking, can silently drop columns.
- **Any shared or shipped DB**: change `schema.js` → `npm run db:generate` → review the new SQL file → commit → `npm run db:migrate` (or let fresh installs run `db:migrate` on first setup). The baseline through v0.1.0 is already tracked in `drizzle.__drizzle_migrations`.

### Tables

- `projects` — multi-project support with per-project module toggles
- `assets` + `generation_params` + `asset_metadata` — AI-generated assets
- `archival_assets` — archival images (museums, archives, historical sources)
- `produced_assets` — original recordings (audio, video, photos)
- `project_config` — legacy single-project config (kept for migration)

## Multi-Project Architecture

Each project has a `modules` JSON field (`["ai_assets", "archival"]`) controlling which features are available. Sidebar navigation adapts based on the active project's modules. All asset tables have a `projectId` FK.

## Environment

Copy `.env.example` to `.env`. Key variables:
- `DATABASE_URL` — PostgreSQL connection string
- `PORT` — Express server port (default 3001)
- `NOTION_API_KEY` — optional, for Notion sync (archival module)
- `APP_CONTACT` — email or URL sent in the User-Agent header on outbound HTTP. Wikimedia's policy requires identification; unidentified clients get throttled harder. Centralized in [`src/server/lib/user-agent.js`](src/server/lib/user-agent.js).

## Archive Search Queue

Approved candidates are downloaded by a background worker ([`src/server/lib/search/queue.js`](src/server/lib/search/queue.js)), not inline in the request. This lets bulk-approves of hundreds of items survive rate limits without losing work.

- Poll interval is 5s — deliberately slow to stay under Wikimedia's per-IP limits on full-resolution image fetches. Shortening this will cause 429 storms.
- Retries use exponential backoff (15s → 45s → 2m → 5m → 10m), max 5 attempts.
- When Wikimedia returns a `Retry-After` header on 429, [`extraction.js`](src/server/lib/archival/extraction.js) surfaces it in the error message as `[retry-after:N]`, and the queue uses `max(server_ask, default_backoff)`.
- Claim/lease pattern (60s lease) means a crashed process doesn't double-process work on restart. `releaseStaleLeases()` runs at server start.

## External Integrations

- **Notion** (optional): Syncs archival assets to a Notion database. Configured per-project with a database ID. API key is global in `.env`.
- **ExifTool**: Vendored via `exiftool-vendored` for EXIF extraction.
- **C2PA**: Content Credentials via `c2pa-node` for manifest generation.

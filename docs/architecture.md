# Architecture notes

Explanations that used to live in `CLAUDE.md`. `CLAUDE.md` is rules only; this file is the why and the how.

## Tech stack

- **Frontend:** React 19, React Router v8, TanStack Query v5, Tailwind CSS v4 (dark theme in `src/client/app.css`)
- **Backend:** Express 5 (Node 24)
- **Database:** PostgreSQL via Drizzle ORM + `pg`
- **Build:** Vite with `@vitejs/plugin-react`
- **Dev:** `concurrently` runs Express (port 3001) and the Vite dev server (port 5173, proxies `/api` to Express)
- **Extraction:** `exiftool-vendored` (EXIF and container tags, including video duration, frame rate and codec), `c2pa-node` (C2PA read and sign) with `c2patool` as a fallback reader (see `tools/README.md` once it lands), `png-chunks-extract`

## Project structure

```
src/
  client/                  # React frontend (Vite root)
    components/layout/     # AppShell, Sidebar, PageHeader
    pages/                 # Route pages (Dashboard, ImportHub, Settings, ...)
      ai-assets/           # AI asset list + detail
      archival/            # Archival list + detail
      produced/            # Produced asset list + detail
      projects/            # Project list + creation
    App.jsx                # React Router config
    main.jsx               # Entry point
  server/
    db/                    # Drizzle schema, migrations, connection
    lib/                   # Business logic: pure functions per area
      archival/            # Archival CRUD, Notion sync, URL extraction
      assets/              # AI asset CRUD
      core/                # Shared constants, file utilities (hash, MIME)
      extraction/          # EXIF, C2PA, PNG chunk extraction + platform parsers
      produced/            # Produced asset CRUD
      search/              # Wikimedia search, job queue, rate limiter
      dashboard.js         # Dashboard stats + enrichment conditions
      integrity.js         # File integrity checks (orphans, missing)
      projects.js          # Project CRUD + storage folder management
    routes/                # Express route handlers (IO lives here)
    index.js               # Express entry point
```

## Database

Schema in `src/server/db/schema.js`; committed migrations in `src/server/db/migrations/`. Connection via `DATABASE_URL` in `.env`.

Workflow for any schema change: edit `schema.js`, run `npm run db:generate`, review the SQL, make it idempotent (`IF NOT EXISTS` on every `CREATE TABLE` and `ADD COLUMN`), commit the SQL with its `meta/` snapshot, run `npm run db:migrate`. `db:push` is not used: it bypasses migration tracking and can silently drop columns.

Why idempotent: a private downstream fork of this repo carries its own migrations against the same tables. When it merges public `main`, public migrations run against a database that may already have some of those columns. `IF NOT EXISTS` makes that merge survivable. See `docs/decisions.md` D6.

### Tables

- `projects`: multi-project support with per-project module toggles
- `assets` + `generation_params` + `asset_metadata`: AI-generated assets
- `archival_assets`: archival images (museums, archives, historical sources)
- `produced_assets`: original recordings (audio, video, photos)
- `asset_relationships`: parent/derivative links between assets
- `manifests`: C2PA Content Credentials manifests
- `search_groups`, `search_jobs`, `search_candidates`: Wikimedia archive search
- `project_config`: legacy single-project config (kept for migration)

## Multi-project architecture

Each project has a `modules` JSON field (`["ai_assets", "archival"]`) controlling which features are available. Sidebar navigation adapts to the active project's modules. All asset tables have a `projectId` FK.

## Archive search queue

Approved candidates are downloaded by a background worker (`src/server/lib/search/queue.js`), not inline in the request, so bulk approves of hundreds of items survive rate limits without losing work.

- Poll interval is 5 s, deliberately slow to stay under Wikimedia's per-IP limits on full-resolution fetches. Shortening it causes 429 storms.
- Retries use exponential backoff (15 s, 45 s, 2 m, 5 m, 10 m), max 5 attempts.
- When Wikimedia returns `Retry-After` on a 429, `src/server/lib/archival/extraction.js` surfaces it in the error as `[retry-after:N]` and the queue uses `max(server_ask, default_backoff)`.
- Claim/lease pattern (60 s lease) means a crashed process does not double-process work on restart. `releaseStaleLeases()` runs at server start.

## Environment

Copy `.env.example` to `.env`:

- `DATABASE_URL`: PostgreSQL connection string
- `PORT`: Express port (default 3001)
- `NOTION_API_KEY`: optional, for Notion sync (archival module)
- `APP_CONTACT`: email or URL sent in the User-Agent on outbound HTTP. Wikimedia's policy requires identification; unidentified clients are throttled. Centralised in `src/server/lib/user-agent.js`.

## External integrations

- **Notion** (optional): syncs archival assets to a Notion database, configured per project. API key is global in `.env`.
- **ExifTool**: vendored via `exiftool-vendored`.
- **C2PA**: `c2pa-node` for reading and signing; `c2patool` fallback for manifests newer than the bindings.

## Testing

`npm test` runs vitest inside a repo guard (`scripts/test.mjs`) that fails if a test changes the checkout or the suite takes over 60 s. Tests are pure functions over fixtures or write to temp directories only. Large media samples stay in `test-fixtures/` (gitignored); small committed fixtures go under `test/fixtures/`. vitest 4 on Windows needs `pool: 'forks'` (`vitest.config.js` says why).

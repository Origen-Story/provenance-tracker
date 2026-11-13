# Architecture notes

Explanations that used to live in `CLAUDE.md`. `CLAUDE.md` is rules only; this file is the why and the how.

## Tech stack

- **Frontend:** React 19, React Router v8, TanStack Query v5, Tailwind CSS v4 (dark theme in `src/client/app.css`)
- **Backend:** Express 5 (Node 24)
- **Database:** PostgreSQL via Drizzle ORM + `pg`
- **Build:** Vite with `@vitejs/plugin-react`
- **Dev:** `concurrently` runs Express (port 3001) and the Vite dev server (port 5173, proxies `/api` to Express)
- **Extraction:** `exiftool-vendored` (EXIF and container tags, including video duration, frame rate and codec), `c2pa-node` (C2PA read, optional) with the bundled `c2patool` as the fallback reader and the only signer, `png-chunks-extract`

## Project structure

```
src/
  client/                  # React frontend (Vite root)
    components/layout/     # AppShell, Sidebar, PageHeader
    pages/                 # Route pages (Dashboard, ImportHub, Settings, ...)
      ai-assets/           # AI asset list + detail
      archival/            # Archival list + detail
      produced/            # Produced asset list + detail
      outputs/             # Finished edits: composition view, clip list (D10)
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
- `asset_relationships`: links between any two assets as `(type, id)` pairs across the three asset tables (D4), with `relationship_type` (`ingredient`, `derived_from`, `output_of`), `match_method` and `confidence`. No foreign keys; each table's delete function removes its rows.
- `manifests`: legacy, unused (empty); superseded by `signatures`
- `creator_statements`: the creator statement for an output (words and author; the numbers are built at sign time)
- `in_place` on `assets`, `archival_assets`, `produced_assets` (D12): the row's `file_path` is the file where it already lived, not a managed copy
- `signatures`: every signed copy of an asset or output: the new file, its hash, the manifest definition without key paths, the c2patool read-back and its status
- `search_groups`, `search_jobs`, `search_candidates`: Wikimedia archive search
- `project_config`: legacy single-project config (kept for migration)

### Origin classes

Every asset row carries `origin_class`, `origin_class_confirmed`, `origin_class_source` and `origin_class_note`. The class is an IPTC Digital Source Type code or `unknown` (D11; definitions in `docs/vocabulary.md`). The vocabulary lives in `src/shared/origin-vocabulary.js`, pure data and functions imported by both the server and the client: labels, the picker's short list, the spectrum position of each class, `normalizeSourceType` (URIs, bare codes, retired codes), `spectrumPosition`, and `compositeClassFor`.

Beside the class sit three attributes: `signed_by` and `signer_name` (who vouches for the file's credentials: the capture device, the tool that made it, or the creator at ingest), `ai_assisted` (an AI wrote the instructions and an ordinary program made the pixels), and archive origin, which is simply the asset's table.

The pure classifier in `src/server/lib/origin/classify.js` proposes a class at import from the stored signals, in this order: a C2PA manifest (component ingredients make a composite; otherwise the declared source type is kept, with the known tool quirks corrected), an enhancer tool following its `derived_from` parent, unsigned XMP/IPTC hints (`DigitalSourceType`, an AI credit line), then the table the row lives in. `origin_class_source` records which rule fired so the UI can explain the proposal. Only `unknown` counts as a missing enrichment field. `src/server/lib/origin/origin.js` is the IO wrapper: it gathers the signals (AI assets keep theirs in `asset_metadata`), writes proposals, never overwrites a confirmed class unless forced but always keeps the signer current, and re-proposes unconfirmed `derived_from` children when a parent changes.

Colour belongs to the spectrum position, not the class: six CSS custom properties, `--pt-origin-captured`, `-digital`, `-assisted`, `-hybrid`, `-synthetic` and `-unknown`, defined in `src/client/app.css`. Badges, the composition strip and legends read only those, so a theme or the public viewer overrides the palette in one place.

Enhancer outputs (Topaz Video AI, Topaz Gigapixel) are modifiers, not generators. On import, `src/server/lib/relationships/auto-link.js` strips the Topaz suffix from the filename and looks for a same-stem asset in the project; one hit links it as `derived_from` with confidence 0.7, several are returned as suggestions. Routes: `/api/origin/*` and `/api/relationships/*`.

### Timelines and screen time

`timelines` holds one imported NLE sequence per produced output (format, fps, duration, settings, cached breakdown, path of the raw file kept under `<storage>/timelines/<producedId>/`); `timeline_segments` holds one row per clip per track with its match (`matched_asset_type`/`id`, `match_method`, `match_confidence`) and an optional per-clip `origin_class` override.

Pure modules under `src/server/lib/timeline/`: `formats/` is the registry (xmeml first, D2; a module exports `detect` and `parse` to one normalised shape), `match.js` matches each distinct source file to a tracked asset by path (including a signed copy's original path), SHA-256, filename plus size, then filename only, and reconciles a manual pick with that evidence (`reconcileManualMatch`); `compose.js` builds the headline view (D10): two lanes, picture and audio, each a list of intervals tiling the sequence, `single` when every playing layer sits at one spectrum position, `mixed` when positions overlap (layers listed top track first), `gap` when nothing plays, with per-position, mixed-combination and gap numbers derived from those same intervals, and the real tracks kept for the expanded view; `breakdown.js` keeps the per-track tallies (primary track, overlay sweep, audio with stereo pairs collapsed) and embeds the composition as `breakdown.composition`. `timelines.js` is the IO wrapper: it parses, stores, matches with real file stats and hashes, persists, caches the breakdown (recomputing a cached one that predates the composition on first read), flags the produced asset as an output, proposes the output's class from what is in it, and links every matched asset to the output as `output_of`. Fixing a segment's match applies to every clip of the same source; an asset's origin-class change recomputes every timeline that counts it.

### Outputs

`produced_assets.is_output` marks a finished edit (D10); `output_source` says who set it (`timeline`, `c2pa_ingredients`, `user`). `/api/outputs` lists them with their latest composition and toggles the flag. The client's Outputs section (`src/client/pages/outputs/`) opens straight onto the composition: the render playing in `<video>` (served by `/api/preview`, which honours Range requests so seeking works) above the two lanes (`components/timeline/LaneStrip.jsx`, mixed stretches as stripes of the component colours), a readout of what is on screen and audible at the playhead, the numbers, and the clip list. Setting a class from a clip row writes the asset (`components/origin/InlineClassSetter.jsx`), never the timeline row, with an optional `origin_class_note` for the manifest. Statement, Credentials and Export are tabs on the same page, filled in by later phases.

Real-world notes from a Premiere Pro 2026 export: file definitions live in the master-clip list and are back-referenced by id; stereo audio is exploded into two linked tracks; stills carry a large source duration with in/out offsets near frame 107892; `pathurl` percent-encodes the drive colon; assets imported into managed storage match by hash rather than path.

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
- **C2PA**: reading tries `c2pa-node` and falls back to `c2patool`. Signing (phase 4c) is c2patool only: `src/server/lib/manifest/build.js` builds the manifest definition (pure), `c2patool.js` signs an output into a new `<name>.signed.v<N>.<ext>` (embedded) and a source asset into a `<name>.c2pa` sidecar (D13), then reads it back, `verify.js` turns the report into a status (`unrecognised_issuer` is the expected status for the dev certificate). Ingredients go in through `c2patool -i` records, with a sidecar attached as the record's manifest store when the file has one (`-i` reads embedded credentials only), so an ingredient with its own credentials keeps them inside the signed file. The asset row is never repointed at a signed copy; signed copies are rows in `signatures`.

## Testing

`npm test` runs vitest inside a repo guard (`scripts/test.mjs`) that fails if a test changes the checkout or the suite takes over 60 s. Tests are pure functions over fixtures or write to temp directories only. Large media samples stay in `test-fixtures/` (gitignored); small committed fixtures go under `test/fixtures/`. vitest 4 on Windows needs `pool: 'forks'` (`vitest.config.js` says why).

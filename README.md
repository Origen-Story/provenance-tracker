# Provenance Tracker

A local web tool for tracking the provenance of multimedia assets across video productions. Manages AI-generated images, archival source material, and original produced content — with metadata extraction, enrichment tracking, and C2PA Content Credentials support.

Built by [Origen Story](https://www.origenstory.com/).

## What it does

1. **Multi-project support** — Each production gets its own project with configurable modules (AI assets, archival, produced)
2. **Imports assets** via file upload, folder scan, file path, or URL download (archival)
3. **Extracts metadata** automatically — EXIF, C2PA manifests, PNG chunks, AI generation parameters
4. **Detects platforms** — ComfyUI, MidJourney, Freepik, Meta.ai workflows are parsed for prompts, models, seeds, etc.
5. **Tracks enrichment** — highlights assets missing required metadata so nothing falls through the cracks
6. **Searches Wikimedia Commons** — background job queue runs grouped keyword/category searches against Wikimedia, with candidate review, bulk approval, and resumable downloads
7. **Syncs to Notion** (optional) — archival assets can sync to a Notion database for collaborative research
8. **Builds C2PA manifests** — Content Credentials manifests for produced assets, combining archival + AI provenance
9. **Exports** — structured export of project assets and their provenance
10. **Manages files** — copies imports into managed storage with SHA-256 duplicate detection and integrity monitoring
11. **Signs assets with C2PA** — generate a dev cert with one command and sign WAV/MP3/JPEG/PNG locally, with `c2pa.actions`, `stds.schema-org.CreativeWork`, training-mining opt-out, and a CAWG-lite identity assertion
12. **Composes final mixes** — sign narrative MP3s with composite C2PA manifests (ingredient refs from source assets) plus a custom `com.origenstory.narrative` assertion driven by Notion script data, with full sidecar JSON for downstream sites

## Quick start

### Prerequisites

- Node.js 22+
- PostgreSQL 16+ (Docker Compose config included; local install also works)

### Setup

```bash
# Clone and install
git clone <repo-url>
cd provenance-tracker
npm install

# Configure environment
cp .env.example .env
# Edit .env — DATABASE_URL and APP_CONTACT (see Environment below)

# Start Postgres (Docker path — skip if you already run Postgres locally)
docker compose up -d

# Apply database schema (uses committed migrations)
npm run db:migrate

# Optional: generate a dev signing cert (only needed if you'll sign assets locally)
npm run cert:generate

# Start dev server (Express + Vite)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## How to use

### 1. Create a project

On first launch you'll be prompted to create a project. Choose which modules to enable:
- **AI Assets** — for AI-generated images/video (MidJourney, ComfyUI, Freepik, etc.)
- **Archival** — for historical/reference images from museums, archives, libraries
- **Produced** (always on) — for original recordings, field audio, video, photos

Set a storage path where imported files will be managed.

### 2. Import assets

Go to **Import** and choose your asset type, then your import method:
- **Upload** — drag and drop or browse files
- **Scan folder** — point to a dump folder; the tool copies files into managed storage
- **File path** — import a single file by path
- **URL** (archival only) — download from a web source

Metadata is extracted automatically. Fill in any gaps on the enrichment form, then confirm.

### 3. Enrich and track

The dashboard shows which assets need enrichment. Click through to filtered list views where incomplete assets are highlighted with amber indicators showing exactly which fields are missing.

### 4. Archive Search (archival)

Use **Search Groups** to define named groups of keywords and Wikimedia categories (e.g. one per subject or scene). From **Archive Search**, pick a group and run a search — a background worker queries Wikimedia Commons, deduplicates results, and populates a list of candidates. Review candidates, approve the ones you want, and a download worker fetches the full-resolution images with polite rate-limiting and automatic retry/backoff on 429s.

Search and download jobs run in the background, so you can close the page and come back. The app ships with two bundled examples in [`src/server/db/example-data/`](src/server/db/example-data/):

- [`example.groups.json`](src/server/db/example-data/example.groups.json) — a minimal 2-group template with placeholder values, showing the expected shape (multi-language keywords, categories, notes)
- [`gaudi-tour-groups.json`](src/server/db/example-data/gaudi-tour-groups.json) — a fully-populated real-world example from an Antoni Gaudí documentary project

### 5. Notion sync (archival)

If you configure a Notion API key and database ID on your project, archival assets can be synced individually or in batch to a Notion database.

The tracker is the **source of truth** for triage fields — assignments, selects, and scene labels are edited in the tracker and pushed to Notion as a read-only display layer. Manual edits to triage fields in Notion will be overwritten on next sync.

To receive triage data, add these columns to your archival Notion DB (one-time setup):

| Notion column name | Type | Filled by |
|---|---|---|
| `Stop` | Multi-select | Tracker — list of assigned stops by display name |
| `Selected` | Checkbox | Tracker — true if user marked the photo as a "select" |
| `Scene` | Text | Tracker — optional free-text scene label |

The existing `Source Search` (or whatever you configured as the search-origin property) keeps pointing at the immutable original search; it's never overwritten by triage.

### 5b. Triage workflow (archival)

Once images are imported and you want to decide which photos belong to which stop and which ones make the final cut:

1. Open **Archival** and click **Triage mode** in the toolbar
2. Three new filters appear: stop assignment, "selects only", and "unassigned only" — useful for finding photos that still need a home
3. Click a card to toggle its multi-select; the bulk action bar appears once anything is selected
4. Use bulk actions to **Assign to stop…**, **Remove stop…**, **Mark selected**, or **Set scene name…**
5. Click the star on any individual card to toggle its `selected` flag without entering multi-select mode

Stops live in **Search Groups**. Each group has a stable `groupId` and a free-to-rename `groupName`. Reordering stops or renaming display labels is safe — assets stay attached because they reference the `groupId`. Use the ▲▼ arrows or the **Renumber 10/20/30…** button to manage order. The **+ insert above** button on each group creates an open slot at that position so you can drop a new stop in the middle without renumbering.

If you ever need to change a `groupId` itself, the editor shows a danger-zone warning and tells you how many assets currently use it. You'll need to retag those assets manually after the change.

### 6. C2PA manifest + export

Under **Manifest** and **Export**, assemble Content Credentials manifests for produced assets and export structured records of a project's provenance chain.

### 7. Signing assets with Content Credentials

Any produced or AI asset that arrives without an embedded C2PA manifest (most ElevenLabs audio, hand-recorded WAVs, MP3s from non-CAI tools) can be signed inside the tracker.

**One-time setup:**

```bash
# Generate a self-signed dev cert + key chain (writes to ./certs/)
npm run cert:generate
```

Then in **Project Settings**, paste the printed paths into the C2PA signing section. Optionally fill in a CAWG identity URL + name to embed a `cawg.identity` assertion pointing at your hosted identity document (see CAWG section below).

**Signing a single asset:**

On any produced or AI asset detail page that lacks Content Credentials, click **Sign with Content Credentials**. The modal pre-fills creator/organization/CAWG fields from the project, and the tool name from the asset's platform/equipment. Confirm and the tracker:

1. Reads cert + key from the configured paths
2. Builds a manifest with `c2pa.actions`, `stds.schema-org.CreativeWork`, `c2pa.training-mining` opt-out, and (if configured) `cawg.identity`
3. Writes a `<basename>.signed.<ext>` copy alongside the original
4. Updates the asset record to point at the signed copy; preserves the unsigned path on `originalFilePath`

The original is never deleted. Assets re-signed against an already-signed file write a new `.signed.signed` — handy for layering iterations during development.

**About the dev cert:**

The generator produces a two-step chain (a self-issued root CA + an end-entity signing cert) because c2pa-rs rejects fully self-signed leaves. Signatures from this cert verify cryptographically but won't appear as "trusted publisher" on contentcredentials.org — the trust signal is meant to come from the CAWG identity assertion (see below), not the cert chain. For production use a CA-issued cert.

### 8. Composing final mixes

Once narrative scripts live in Notion (Script + Characters + Sources databases) and source assets have been signed, the **Compose Final Mix** page assembles a signed final MP3 with:

- A composite C2PA manifest with ingredient references for every source asset used
- A custom `com.origenstory.narrative` assertion containing per-script-line metadata (character, voice attribution, sources, confidence)
- Standard CAWG-lite + schema.org + training-mining-opt-out assertions
- A parallel `<stop>.narrative.json` sidecar with the full untruncated narrative payload (the labs site reads this directly instead of parsing C2PA in-browser)

Pick a stop from the Notion script DB, pick the unsigned final mix file from your produced assets, optionally tick the source ingredients, and click compose. Output writes to the same folder as the input mix unless you override the output dir.

### CAWG identity (current state)

The tracker embeds a `cawg.identity` assertion in CAWG-1.2's declarative shape — `signer_payload` carries the identity URL and name, with `sig_type: cawg.x509.cose.unsigned`. Full COSE-signed CAWG identity is deferred to v0.3 (see TODO in [`c2pa-sign.js`](src/server/lib/extraction/c2pa-sign.js)) and depends on either c2pa-node exposing first-class CAWG signing or a public CAWG identity-claims-aggregation provider going live.

For now, the assertion functions as a structured pointer at your hosted identity document. Strict CAWG verifiers will report it as unsigned; permissive readers (including contentcredentials.org) will surface the URL + name. This is by design — the project intentionally surfaces the gap between what individual creators / SMBs can sign today vs. what verified CAWG identity will eventually look like.

## Deployment notes

Provenance Tracker is designed as a **local tool**. It ships with no authentication, no rate-limiting on inbound requests, and assumes a trusted single-user environment. The dev server listens on all interfaces.

Do **not** expose the Express server (port 3001) or the built client directly to the public internet. If you need remote access:

- Put the app behind a reverse proxy with authentication (e.g. nginx + basic auth, Cloudflare Access, Tailscale)
- Serve over HTTPS
- Consider isolating the Postgres instance — the connection string in `.env` is unencrypted

For single-user local work, `npm run dev` (development) or `npm start` (production build served from `dist/`) is the intended usage pattern.

## What gets extracted automatically

| Platform | What's extracted | What you'll need to add |
|----------|-----------------|------------------------|
| **ComfyUI** | Full prompt, negative prompt, model, seed, steps, CFG, sampler, scheduler, dimensions, LoRAs | Description, generation date |
| **MidJourney** | Full prompt, model version, seed, stylize, aspect ratio, C2PA timestamp | Description |
| **Meta.ai** | Digital source type (XMP), partial prompt from filename | Full prompt, model, generation date |
| **Freepik** | C2PA manifest, digital source type (XMP) | Prompt, model, generation date |
| **Other** | EXIF data, file hash, dimensions | Most fields |

## Tech stack

- **Frontend:** React 18, React Router v6, TanStack Query v5
- **Styling:** Tailwind CSS v4 (dark theme)
- **Backend:** Express (Node.js)
- **Database:** PostgreSQL via Drizzle ORM
- **Build:** Vite
- **Extraction:** exiftool-vendored, c2pa-node, png-chunks-extract
- **Integrations:** @notionhq/client (optional)

## Project structure

```
src/
  client/                    # React frontend (Vite root)
    components/layout/       # AppShell, Sidebar, PageHeader
    pages/                   # Route pages
      ai-assets/             # AI asset list + detail
      archival/              # Archival list + detail
      produced/              # Produced asset list + detail
      projects/              # Project list + creation
    App.jsx                  # React Router config
    app.css                  # Tailwind v4 dark theme
  server/
    db/                      # Drizzle schema + migrations
    lib/                     # Business logic
      archival/              # Archival CRUD, Notion sync, URL extraction
      assets/                # AI asset CRUD
      core/                  # Shared constants, file utilities
      extraction/            # EXIF, C2PA, PNG chunk extractors + platform parsers
      produced/              # Produced asset CRUD
    routes/                  # Express route handlers
    index.js                 # Express entry point
```

## Database tables

| Table | Purpose |
|-------|---------|
| `projects` | Multi-project support with module toggles and Notion config |
| `assets` | AI-generated asset records |
| `generation_params` | Normalized AI generation parameters (prompt, model, seed, etc.) |
| `asset_metadata` | Raw extracted metadata blobs (EXIF, PNG text, C2PA, platform) |
| `archival_assets` | Archival image records with provenance fields |
| `produced_assets` | Original produced content records |
| `search_groups` | Per-project keyword/category groups for Archive Search |
| `search_candidates` | Wikimedia search results (holds review status + download-queue state) |
| `search_jobs` | Background search jobs with progress/cancellation state |
| `manifests` | C2PA Content Credentials manifests |
| `asset_relationships` | Parent/derivative links between assets |

## Key commands

```bash
npm run dev              # Start Express + Vite dev servers
npm run build            # Production client build
npm start                # Production server (serves dist/ + API)
npm run db:push          # Push schema to DB (dev shortcut — see Database section)
npm run db:generate      # Generate migrations from schema
npm run db:migrate       # Run pending migrations
```

## Database

The schema lives in [`src/server/db/schema.js`](src/server/db/schema.js); migrations live in [`src/server/db/migrations/`](src/server/db/migrations/).

**For development** (your own local DB), `npm run db:push` is the fast path — it diffs your `schema.js` against the DB and applies changes immediately. Handy while iterating on schema, but it bypasses migration tracking and can silently drop columns.

**For deployed installs and any shared environment**, use generated migrations:

```bash
# After changing schema.js
npm run db:generate     # produces src/server/db/migrations/NNNN_*.sql
# ...review the generated SQL, commit it...
npm run db:migrate      # applies any unapplied migrations to the DB
```

A fresh clone should run `npm run db:migrate` (not `db:push`) against a new Postgres to build the schema from the committed migration history. The baseline migrations through v0.1.0 are already in the repo.

## Environment

Copy `.env.example` to `.env`:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `PORT` | No | Express port (default: 3001) |
| `NOTION_API_KEY` | No | Notion integration token (for archival sync) |
| `APP_CONTACT` | Recommended (archival) | Email or URL sent in the User-Agent on outbound HTTP. Wikimedia's policy requires identification — unidentified clients are throttled or blocked, which makes Archive Search unreliable. |
| `STORAGE_PATH` | No | Root folder for downloaded archival images (default: `./data`) |
| `NODE_ENV` | No | Set to `production` to serve the built client from `dist/` |
| `LOG_LEVEL` | No | Server log verbosity: `debug`, `info`, `warn`, `error` (default: `info`) |

## License

Licensed under the [Apache License 2.0](LICENSE). Copyright 2026 Origen Story.

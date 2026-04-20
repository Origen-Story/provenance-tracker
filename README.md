# Provenance Tracker

A local web tool for tracking the provenance of multimedia assets across video productions. Manages AI-generated images, archival source material, and original produced content — with metadata extraction, enrichment tracking, and C2PA Content Credentials support.

Built by [Origen Story](https://www.origenstory.com/).

## What it does

1. **Multi-project support** — Each production gets its own project with configurable modules (AI assets, archival, produced)
2. **Imports assets** via file upload, folder scan, file path, or URL download (archival)
3. **Extracts metadata** automatically — EXIF, C2PA manifests, PNG chunks, AI generation parameters
4. **Detects platforms** — ComfyUI, MidJourney, Freepik, Meta.ai workflows are parsed for prompts, models, seeds, etc.
5. **Tracks enrichment** — highlights assets missing required metadata so nothing falls through the cracks
6. **Syncs to Notion** (optional) — archival assets can sync to a Notion database for collaborative research
7. **Manages files** — copies imports into managed storage with SHA-256 duplicate detection and integrity monitoring

## Quick start

### Prerequisites

- Node.js 22+
- PostgreSQL (local install)

### Setup

```bash
# Clone and install
git clone <repo-url>
cd provenance-tracker
npm install

# Configure environment
cp .env.example .env
# Edit .env with your PostgreSQL connection string

# Push database schema
npm run db:push

# Start dev server
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

### 4. Notion sync (archival)

If you configure a Notion API key and database ID on your project, archival assets can be synced individually or in batch to a Notion database.

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

## Key commands

```bash
npm run dev              # Start Express + Vite dev servers
npm run build            # Production client build
npm start                # Production server (serves dist/ + API)
npm run db:push          # Push schema to DB (dev shortcut)
npm run db:generate      # Generate migrations from schema
npm run db:migrate       # Run pending migrations
```

## Environment

Copy `.env.example` to `.env`:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `PORT` | No | Express port (default: 3001) |
| `NOTION_API_KEY` | No | Notion integration token (for archival sync) |

## License

Private — all rights reserved.

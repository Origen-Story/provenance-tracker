# Provenance Tracker

A local SvelteKit web app for tracking AI-generated assets and building C2PA Content Credentials manifests for video production.

## Tech Stack
- **SvelteKit** (Svelte 5 with runes, JavaScript — no TypeScript)
- **Tailwind CSS v4** with dark theme via `@theme` block in `app.css`
- **SQLite** via Drizzle ORM + better-sqlite3
- **adapter-node** (localhost tool)

## Conventions
- JavaScript only (.js, .svelte) — no TypeScript
- Svelte 5 runes syntax: `$state()`, `$derived()`, `$props()`, `{@render children()}`
- Relative imports between modules (not `$lib`) so extraction can run standalone for testing
- `$lib` alias works in routes and components within SvelteKit context

## Architecture: Modular / Vertical Slice

Each module in `src/lib/` is self-contained. Only import from a module's public API (index.js or *.server.js), never internal files.

| Module | Location | Purpose |
|--------|----------|---------|
| core | `src/lib/core/` | DB schema, connection, constants, file utilities |
| extraction | `src/lib/extraction/` | Metadata extraction + platform parsers |
| import | `src/lib/import/` | Import wizard service + components |
| catalog | `src/lib/catalog/` | Asset CRUD, catalog UI components |
| manifest | `src/lib/manifest/` | C2PA manifest generation |
| export | `src/lib/export/` | CSV/JSON export |
| shell | `src/lib/shell/` | Layout, sidebar, shared UI components |

## Key Commands
```bash
npm run dev          # Start dev server
npx drizzle-kit generate  # Generate DB migrations from schema
npx drizzle-kit push      # Push schema directly (dev shortcut)
```

## Database
SQLite at `data/provenance.db` (gitignored). Schema in `src/lib/core/db/schema.js`. Migrations run automatically on server start via `hooks.server.js`.

## Testing Extraction Standalone
The extraction module can run outside SvelteKit:
```bash
node -e "import { extractMetadata } from './src/lib/extraction/index.js'; ..."
```
Test images in `test-images/` directory.

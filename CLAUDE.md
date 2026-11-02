# Provenance Tracker

Local web app that records where multimedia assets came from (camera, archive, AI generation, AI enhancement) and writes C2PA Content Credentials for finished video and audio. Rules only; the runbook is README.md and the explanations are in docs/.

## Commands (from repo root)
- Tests: `npm test`. Run them before saying anything is done. They run vitest inside the repo guard (scripts/test.mjs), which fails if a test changes the checkout or the suite takes over 60 s.
- Tests are pure or temp-dir only: no database, no network, no signing against certs/. Small fixtures are committed under test/fixtures/; large media stays in test-fixtures/ (gitignored).
- Dev: `npm run dev` (Express on 3001, Vite on 5173). Build: `npm run build`.
- Node 24 locally and in CI.

## Rules
- JavaScript only (.js, .jsx), no TypeScript. Relative imports between modules.
- Schema changes: edit src/server/db/schema.js, `npm run db:generate`, make the SQL idempotent (IF NOT EXISTS) with a shell edit in the same commit, `npm run db:migrate`. Never `npm run db:push`. The guard hook blocks the file tools on migrations/ so that one edit is a deliberate step, not a habit.
- Originals are never modified in place. Signing, re-encoding and exporting write a new file; the row keeps the original path.
- Secrets live in .env and certs/ (both gitignored). Never read them into output, logs or commits. Deny rules and the guard hook block Claude's file tools there; shell commands are not blocked, so never write those paths from a shell either.
- Pure logic lives in src/server/lib/<area>/ as functions with unit tests. IO (database, filesystem, child processes, HTTP) lives in routes and thin wrappers.
- Platform parsers and timeline formats are registry modules (see src/server/lib/extraction/parsers/index.js): add a module, register it, commit a fixture and a test.
- This repo is public. No client, tour or production names in code, fixtures, example data or docs. Production-specific work lives in the private downstream repo (docs/decisions.md D1).
- Commits stage explicit paths. No `git add -A`, no force push, no history rewrite.

## Worktrees
- .claude/worktrees/ are code-only: no database migrations, no signing, no .env. node_modules is symlinked (Windows needs Developer Mode or the link fails silently).

## Pointers
- Architecture, queue behaviour, environment: docs/architecture.md
- Decisions D1 to D8: docs/decisions.md
- Session handoffs: docs/handoffs/NN_session_handoff_YYYY-MM-DD.md
- Planned work: docs/planned-features.md

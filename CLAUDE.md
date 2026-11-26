# Provenance Tracker

Local web app that records where multimedia assets came from (camera, archive, AI generation, AI enhancement) and writes C2PA Content Credentials for finished video and audio. Rules only; the runbook is README.md and the explanations are in docs/.

## Commands (from repo root)

- Tests: `npm test`. Run them before saying anything is done. They run vitest inside the repo guard (scripts/test.mjs), which fails if a test changes the checkout or the suite takes over 60 s (180 s in CI, which names its own budget).
- Tests are pure, temp-dir or in-memory catalog only: no network, no signing against certs/. core-node tests pass a machine of their own (packages/core-node/test/helpers/machine.ts) and never touch this machine's settings. Small fixtures are committed beside the tests that use them (packages/core/test/fixtures/); large media stays in test-fixtures/ (gitignored).
- Dev: `npm run dev` (Express on 3001, Vite on 5173). Build: `npm run build`. Command line: `npm run cli -- help`.
- Node 24 locally and in CI.

## Rules

- New code is TypeScript, erasable syntax only (D16); existing JavaScript converts a file at a time; the public viewer stays JavaScript. Relative imports within a package, the package name across packages (`@provenancetracker/core/timeline/compose.js`).
- Catalog format (packages/core/src/catalog/, spec/catalog/; D26): while CATALOG_FORMAT_STATUS is "draft", edit the SQL and run `npm run catalog:write`. Once released, a change is a new format with an upgrade step and its own sample catalog, never an edit to the old SQL. A human-editable catalog field (catalog/fields.ts) changes only through catalog/edit.ts, which writes its history in the same transaction; catalog tests open catalogs through `catalogsForTests()`, which runs verifyCatalog after each test.
- Originals are never modified in place. Signing, re-encoding and exporting write a new file; the row keeps the original path.
- Secrets live in .env and certs/ (both gitignored). Never read them into output, logs or commits. Deny rules and the guard hook block Claude's file tools there; shell commands are not blocked, so never write those paths from a shell either.
- The API is local-only and has no login: `localOnly` stays the first middleware on `/api`, the server binds `HOST` (default 127.0.0.1), and the Vite proxy keeps `changeOrigin: false`. A project, an asset or this machine's settings leave the API as named fields, never as a raw row; signing paths never leave it. Routes take request fields from a named list, never `req.body` whole.
- Pure logic lives in packages/core/src/<area>/ with its tests in packages/core/test/; core never imports the app. Core runs SQL on a catalog it is handed and never opens a file (lint enforces it). What touches the machine (catalog files, this machine's settings, folders, the command line) is packages/core-node (D28); the app's IO stays in src/server/ in routes and thin wrappers.
- Platform parsers and timeline formats are registry modules (see packages/core/src/extraction/parsers/index.js): add a module, register it, commit a fixture and a test.
- This repo is public. No client, tour or production names in code, fixtures, example data or docs. Production-specific work lives in the private downstream repo (docs/decisions.md D1).
- Dependencies (docs/dependencies.md): exact versions; the newest release at least 14 days old; a new runtime dependency needs a reason in docs/decisions.md; helper programs come from `npm run tools:fetch`, pinned and checksummed.
- Changes reach `main` only by pull request, with CI green; `main` is protected. Every commit is signed off (`git commit -s`); the sign-off check fails a pull request otherwise.
- Commits stage explicit paths. No `git add -A`, no force push, no history rewrite.

## Worktrees

- .claude/worktrees/ are code-only: no signing, no .env. A worktree has no node_modules of its own: run `npm ci` in it before tests or the app (a shared node_modules would load the main checkout's packages).

## Pointers

- Architecture, queue behaviour, environment: docs/architecture.md
- What the tool defends against, and what leaves the machine: docs/threat-model.md, docs/network.md
- Decisions, numbered: docs/decisions.md
- Session handoffs: handoffs/NN_session_handoff_YYYY-MM-DD.md at the repo root. Gitignored and never committed; nothing goes in docs/handoffs/.
- Planned work: docs/planned-features.md

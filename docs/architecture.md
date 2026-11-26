# Architecture notes

Explanations that used to live in `CLAUDE.md`. `CLAUDE.md` is rules only; this file is the why and the how. The decisions behind each part are numbered in `docs/decisions.md`.

## Tech stack

- **Runtime:** Node 24, with its built-in SQLite (`node:sqlite`). TypeScript with erasable syntax only (D16), run directly by Node; older modules stay JavaScript until converted.
- **Frontend:** React 19, React Router 8, TanStack Query 5, Tailwind CSS 4 (dark theme in `src/client/app.css`), built by Vite.
- **Backend:** Express 5, the local API on `/api`.
- **Dev:** `concurrently` runs the server (port 3001) and the Vite dev server (port 5173, proxying `/api` to the server).
- **Helper programs:** ExifTool (through `exiftool-vendored`); the C2PA library (`@contentauth/c2pa-node`), which reads every file's C2PA credentials against the pinned C2PA trust lists (D51) and signs (D53); and `c2patool`, the signing fallback a machine can choose. The library's native binary, c2patool and the trust lists are installed by `npm run tools:fetch`, pinned and checksummed. Neither binary is code-signed, so Windows Smart App Control, when it is on, can block them (D15).

## The shape of it

A project is a folder. Its catalog is one SQLite file, `<project>/.provenancetracker/catalog.sqlite`, with the timeline files it imported kept beside it in `timelines/`. The catalog records files as a named media folder (a root) plus a path inside it, so the project can be copied, archived or moved whole. Which folder each project and each root outside it is in on this machine, the person's name, and the signing certificate and key live in this machine's settings, which never travel with a project (D28). Moving to another machine is: copy the folder, open it, locate any root outside it.

```
packages/
  core/          # @provenancetracker/core: pure logic, no file access (D24; lint enforces it)
    src/
      catalog/   # the catalog format (schema-v1.ts, spec/catalog/), reading, edits with history, timelines, signatures, rescan
      extraction/# observations, platform parsers and their dispatch
      origin/    # the origin classifier; origin-vocabulary.js holds the classes
      timeline/  # timeline formats, matching, composition, breakdown
      manifest/  # manifest and creator statement builder, public export, verification report
      legacy/    # reading the old Postgres app's dumps, for the migration (D33-D35)
  core-node/     # @provenancetracker/core-node: what touches the machine (D28)
    src/         # project folders, this machine's settings, roots, scan, extract (ExifTool, the C2PA library, PNG), timeline import,
                 # signing (sign/), the migration (legacy/), the command line (cli/)
src/
  server/        # index.js starts the server; app.ts is the app (tests run it on a port of their own);
                 # api/catalog.ts is every route; api/jobs.ts runs long work
  client/        # main.jsx and App.jsx; the pages in catalog/, the composition strip in components/timeline/
public-viewer/   # the static public page section for a signed film's record (plain JavaScript, no build step)
spec/            # the catalog format, the creator statement and the public export, with their schemas
```

Core runs SQL on a catalog it is handed and never opens a file; core-node opens catalogs, reads folders and runs ExifTool, the C2PA library and c2patool; the server's routes are thin: each request opens the project's catalog by the id in the URL, runs the work in a transaction, and closes it. There is no global "active project" and no database server.

## The catalog

Tables (format 2, spec/catalog/catalog.v2.sql; D26, D56): `meta` (the project's settings), `runs` (each scan, read, classify, import or signing, with its tool and outcome), `roots`, `assets` with `credits` and `generation`, `contents` (each distinct file by SHA-256, a version of an asset), `locations` (where each content is), `observations` (what a reader said about a file, in full), `relationships`, `timelines` with `timeline_sources` and `timeline_clips`, `statements` (each save a new row), `signatures`, `publications` (where a signed copy is published, D56), and `history`. Opening a project upgrades an older catalog, one format at a time, after a checked copy of it is saved in `.provenancetracker/backups/`; a newer one is refused.

A human-editable field (catalog/fields.ts) changes only through catalog/edit.ts, which writes a `history` row in the same transaction: who (a person, the tool with its run, or `legacy` for values carried from Postgres), when, the old and new value, a note and the evidence. A tool never overwrites what a person set or confirmed.

A rescan reads only new or changed files. The same bytes at a new path are the same content (a move); other bytes at a known path are a new version of the same asset (a re-render), unless those bytes are already known; a folder that is not there says nothing about its files.

## Origin classes

Every asset has an origin class, an IPTC Digital Source Type code or `unknown` (D11; definitions in `docs/vocabulary.md`), whether it is confirmed, where the proposal came from, a note, and whether AI assisted. The vocabulary lives in `packages/core/src/origin-vocabulary.js`, shared with the client: labels, the picker's short list, each class's spectrum position (captured, digital, assisted, hybrid, synthetic, unknown), and the class of a composite.

The classifier (`packages/core/src/origin/classify.js`, run on the catalog by catalog/classify.ts) proposes a class from what the file said, in order: a C2PA manifest (component ingredients make a composite; otherwise its declared source type, with known tool quirks corrected), an enhancer following its `derived_from` parent, unsigned XMP or IPTC hints, then the asset's kind. Enhancer outputs (Topaz) are linked to a same-stem parent by `relationships/auto-link.js`.

Colour belongs to the spectrum position, not the class: six CSS custom properties, `--pt-origin-captured`, `-digital`, `-assisted`, `-hybrid`, `-synthetic` and `-unknown`, in `src/client/app.css`. Badges, the composition strip and the public viewer read only those.

## Timelines and the composition

A finished edit is an asset marked as an output (D10). Importing its timeline (core-node/timeline-import.ts) keeps the file's exact bytes under `timelines/<sha256>`, parses it through the format registry (`packages/core/src/timeline/formats/`, xmeml first, D2), taking the sequence the edit was exported from when the file holds several (the one a person chose, else the one as long as the edit's file, else none until a person chooses; D59), matches each source to an asset (by path, then bytes, then file name and size, then name only), and writes a timeline for the cut it belongs to. The newest import of the output's newest cut is the one the page and signing use; earlier ones stay in the record. A clip can have a class of its own, which carries to the next import of the edit (D48). Each export of a film is its own finished edit; a new one can start from an earlier one, copying its public details, credits, newest statement and clip classes once, and keeping a `started_from` link to it (D50), or a `made_from` link when it is a vertical cut, a trailer or a transcode of it rather than its next revision (D60). The edit's page reads those links into the line of revisions, what it was made from and what was made from it, and its re-renders (`catalog/revisions.ts`). The image a signed copy is shown by in verifiers, its claim thumbnail, is picked per edit and kept as a `thumbnail_of` link from the edit to an image asset (D52).

`compose.js` builds the headline view: two lanes, picture and audio, each a list of intervals covering the sequence, `single` where everything playing sits at one spectrum position, `mixed` where positions overlap, `gap` where nothing plays, with the numbers derived from the same intervals. `breakdown.js` keeps the per-track tallies and embeds the composition. The breakdown is a cache, recomputed from the clips when a match or a class changes.

Real-world notes from a Premiere Pro export: file definitions live in the master-clip list and are back-referenced by id; stereo audio is split into two linked tracks; stills carry a large source duration with in and out points; `pathurl` percent-encodes the drive colon; clip ids are renumbered on every export.

## Signing and the public export

Signing runs as a job. A finished edit is signed into a new file beside the cut, `<name>.signed.v<N>.<ext>` (D13, D41): the cut as parent, each asset the newest timeline places as an ingredient with its class, and the newest saved statement as the `org.provenancetracker.creator_statement` assertion. An ingredient with credentials of its own, embedded or in a sidecar the catalog knows, keeps them inside the new file, unless the person keeps them out (D62). Before signing, every source is hashed against the catalog and read again, and what it carries must be what the review showed (D63). Any other asset is signed into a `.c2pa` sidecar beside it (D42). The original is never changed. What would be signed is shown before signing, built by the same code (D46).

Signing goes through an engine picked by name (`packages/core-node/src/sign/engines/`, D53): the C2PA library by default, or c2patool when this machine's setting or `sign --engine` says so. The key is held by a credential holder (`packages/core-node/src/sign/holders/`, D54), opened for one signing: it gives the certificate chain and signs the bytes the library hands over, so the key never passes into the library. Today the only holder is key files on this machine; c2patool needs one, since it opens the files itself. When the creator's identity is set up (D55), the library adds a CAWG identity assertion, a COSE_Sign1 built by `packages/core/src/manifest/cose.ts` and signed by the identity's own holder; its reading (`manifest/identity.ts`) stays apart from the claim's verdict. After signing, the engine reads the file back and the report becomes a status (`verify.js`; `unrecognised_issuer` is expected for a test certificate). The public export (`manifest/public-export.js`, schema `spec/public-export.v2.schema.json`, D57) is built from a signature's record and its publication, never the live timeline, so it always matches its file. It gives the file, the signer (with its time stamp's authority) and the creator's identity as separate results, which the public viewer shows apart; the viewer also reads format 1. Both engines rename ingredient labels in the file they write, so read-back entries are paired with the statement's ingredients by position and file name. Where a signed copy is published, the web address of the file and of its page, is kept per signing in `publications` (D56) and set on the Export tab or with `npm run cli -- publish`; the tracker never fetches those addresses. The steps for publishing are in [publishing.md](publishing.md).

## Long work

Scan, read, classify, import and signing run as jobs (`src/server/api/jobs.ts`): one at a time per project, with progress, a way to stop at the next safe point, and the result or the error in words. The pages ask for a running job's state every second and refresh what it changed when it ends (D39, D45).

## Local-only API

There is no login, so reach is the access control. `src/server/lib/core/local-only.js` (pure, unit-tested), wired in `src/server/app.ts`:

- **Bind.** The server listens on `HOST`, default `127.0.0.1`. Other devices get a refused connection.
- **Request check.** `localOnly` is the first middleware on `/api`, before any body is parsed. It refuses a `Host` that is not this machine (DNS rebinding), a loopback `Host` on a connection that did not come from this machine (D66), an `Origin` that is not the same host and port as `Host` (another site's form post, which needs no CORS preflight), and anything the browser marks `Sec-Fetch-Site: cross-site`.

The Vite proxy must forward the browser's `Host` unchanged for the second rule to pass in development, which is why `vite.config.js` uses the long proxy form with `changeOrigin: false`.

Smaller rules beside it: files are served by their hash, and only pictures, video and sound (`isPreviewable`); routes take request fields from named lists and answer with named fields, so signing paths never leave the API; a folder or file taken from the request is one the person names on purpose (docs/threat-model.md). What leaves the machine is in `docs/network.md`.

## Environment

All optional (`.env` or the environment): `PORT` (default 3001), `HOST` and `ALLOWED_HOSTS` (see the README's deployment notes), `APP_CONTACT` (the contact in the User-Agent when downloading a file the person asked for, `src/server/lib/user-agent.js`), `NODE_ENV=production` to serve the built pages, `LOG_LEVEL`.

## Testing

`npm test` runs vitest inside a repo guard (`scripts/test.mjs`) that fails if a test changes the checkout or the suite takes over 60 s. Tests use temp folders and throwaway machines only; the API is tested over real HTTP against temporary projects (`test/unit/api/`), and the pages' API client against the real routes (`test/unit/client/`). Signing for real uses a throwaway certificate made in the test's folder. Large media samples stay in `test-fixtures/` (gitignored); small fixtures are committed beside their tests. vitest on Windows needs `pool: 'forks'` (`vitest.config.js` says why).

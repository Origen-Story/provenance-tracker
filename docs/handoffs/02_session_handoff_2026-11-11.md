# Session handoff 02: 2026-11-11

Previous: `01_session_handoff_2026-11-02.md`. This one covers 2026-11-03 to 2026-11-11: dependency majors, Phase 4a, 4b, the Outputs section and the origin vocabulary. The roadmap is still `~/.claude/plans/in-the-docs-folder-wondrous-walrus.md`; decisions D9 to D11 were added to `docs/decisions.md`.

## 1. State

- **A finished edit can be imported, composed and classified end to end.** Import a Premiere "Final Cut Pro XML" for a produced asset and the Outputs section shows the render playing above a picture lane and an audio lane, coloured by spectrum position, with mixed stretches striped, a readout at the playhead, numbers derived from the same intervals, and a clip list where setting a class writes the asset. Verified against a real Premiere 2026 export (8 picture clips, 5 audio tracks, all matched by hash).
- **Origin classes are IPTC digital source type codes (D11).** `src/shared/origin-vocabulary.js` is shared by server and client. Signed-by, from-an-archive and AI-assisted are attributes. Colour is six `--pt-origin-*` tokens in `src/client/app.css`.
- **Signing is not built yet, but it is de-risked.** A c2patool spike on the existing 90 MB export produced a valid manifest with the Premiere export as parent and six component ingredients keeping their own credentials, a DigiCert timestamp and a sidecar, in under a second. The only failure was the untrusted (self-issued) certificate, as expected.
- **`c2pa-node` is unreliable on Matt's machine.** Windows Smart App Control has blocked its unsigned native binding. It is loaded lazily (`c2pa-node-loader.js`); reads fall back to the bundled c2patool; `signAsset` throws a clear error when the binding is unavailable. The per-asset Sign button therefore may not work until signing moves to c2patool.
- **Both repos are in step.** Public `main` is `c3a6aea`, pushed, CI green. The private clone merged it (`11a7c7d`), journal idx 16 and 17 are core's 0008 and 0009, 18 migrations applied. Public database: 10 migrations applied.
- **Tests:** `npm test` → `Test Files 19 passed (19), Tests 164 passed (164)`, repo guard OK. `npm run build` OK. `npm run audit` OK (run before the last two merges, not re-run after the docs-only commits).
- Auditor agent: **not run** this session.

## 2. What changed this session

All on public `main` unless noted (31 non-merge commits since handoff 01).

- **Dependencies (D9):** Renovate replaces Dependabot version updates; Express 5, React 19, React Router 8, Vite 8, vitest 5, Tailwind 4.3, exiftool-vendored 39. Node 26 and Postgres 18 deliberately parked.
- **4a, migration 0005:** origin-class columns, video technical fields, generalised `asset_relationships`, classifier, Topaz Gigapixel parser, auto-link of enhancer outputs, UI controls.
- **4b, migration 0006:** `src/server/lib/timeline/` (xmeml parser, matching, breakdown), `timelines` and `timeline_segments`, routes, fixture `test/fixtures/timeline/sample.xmeml.xml`.
- **Outputs (D10), migration 0007:** `compose.js` (lanes), `is_output` flag, `origin_class_note`, `/api/outputs`, `src/client/pages/outputs/`, `components/timeline/`, Range support in `/api/preview`, shared `AssetPicker`, forgiving asset search (`searchTerms`).
- **Origin vocabulary (D11), migrations 0008 and 0009:** `src/shared/origin-vocabulary.js`, rewritten `classify.js`, `ai_assisted` / `signed_by` / `signer_name`, hand-written data migration (`drizzle-kit generate --custom`), palette tokens, `ClassFields.jsx`, `docs/vocabulary.md`.
- **Fixes:** lazy `c2pa-node` loading; `scripts/test.mjs` resolves the true-cased repo path (a lowercase drive letter made every test file fail to load).
- **On branch `feat/4c-signing`, not merged:** `cb4b498` (CC BY 4.0 credit for the quoted IPTC and C2PA definitions) and this handoff.
- **Outside the repo:** preset repos `indieglo/renovate-config` and `Origen-Story/renovate-config`; backups under `P:\WebProjects\_backups\provenance-tracker-2026-11-03\` and `...-2026-11-11\`; a palette and vocabulary comparison page published as a private artifact.

## 3. Pickup queue

🔴 **High, needed for the demo video (shoot 12 Nov, edit 13 Nov, page 14 to 15 Nov, London 17 to 18 Nov)**

1. **4c: creator statement and output signing through c2patool.** Start from `src/server/lib/extraction/c2pa-sign.js` and the spike notes in section 1. Build the manifest definition as a pure function (`src/server/lib/manifest/build.js`): `c2pa.opened` on the export as `parentOf`, one `c2pa.placed` per matched asset with its IPTC `digitalSourceType` from `sourceTypeUri`, the creator statement as `org.provenancetracker.creator_statement` carrying the composition numbers and, per ingredient, the class, the class the file's own credentials claim, the AI-assisted flag and `origin_class_note`. Sign to a new versioned file, read back, map `signingCredential.untrusted` to "unrecognised issuer". Move `signAsset` onto the same c2patool signer so the per-asset button works under Smart App Control. Needs a migration for `creator_statements` and the manifest columns. Fill the Statement and Credentials tabs in `src/client/pages/outputs/OutputPage.jsx`.
2. **4d: public export.** `buildPublicExport` with the composition intervals (not per-track segments), no paths. Schema in `schemas/`. Fills the Export tab.
3. **4e: public viewer.** `public-viewer/`, no build step, reads the export JSON, colours from the `--pt-origin-*` names, player adapter so a `<video>` element or a YouTube embed can drive the strip. Then publish on origenstory.com (Vercel; repo `P:\WebProjects\origen-story-site`). The signed video will likely exceed 100 MB, so plan Vercel Blob and verify the bytes by hash after upload.

🟡 **Medium**

4. **Signed-at-ingest detection.** `signerOf` treats a claim generator matching `c2patool` or `provenance-tracker` as creator-signed. Pass the project's certificate name as `ownSignerNames` from `collectSignals` so a real Origen Story certificate is recognised.
5. **Image sequences.** The matcher is one file to one hash. Motion plates should arrive as one ProRes 4444 file each; a PNG sequence referenced by a timeline is untested.
6. **Add a decision entry on C2PA conformance direction** (promised on 2026-11-03, still not written).
7. **ElevenLabs WAV parser** detect via the C2PA summary; **Veo via Freepik** parser. See `docs/planned-features.md`.

🟢 **Nice to have**

8. README line that the Origen Story name and logo are not covered by the Apache licence; `CONTRIBUTING.md` before inviting contributors.
9. Bulk confirm of origin classes from a list.
10. Node 26, Postgres 18 compose tag, archiver 8 (private).

## 4. Open questions for Matt

- **Signing certificate for the real video:** point the demo project's certificate settings at the Origen Story certificate before Friday's signing, or sign with the dev certificate for the first pass?
- **Hosting:** Vercel Blob for the signed file, or a YouTube embed with the signed original linked beside it, or both?
- **The private downstream database** still has all 1,239 archival rows as `unknown`. Matt chose to leave them until that project restarts. Do not run the re-proposal there unprompted.
- **Brand:** the deck's spectrum component should take the purple (`#a264ef`) so deck, plates and tracker agree. Matt said he will add it.

## 5. Quick-reference commands

```bash
# Tests, build, audit (from the repo root)
npm test
npm run build
npm run audit

# Dev: Express on 3001, Vite on 5173
npm run dev

# Schema change
#   edit src/server/db/schema.js, then:
npm run db:generate          # then add IF NOT EXISTS by shell edit, same commit
npm run db:migrate

# Data migration (hand-written SQL, dry-run in a rolled-back transaction first)
npx drizzle-kit generate --custom --name=<what_it_does>

# Read a file's Content Credentials with the bundled tool
tools/c2patool/c2patool.exe <file>

# Private clone: bring in public main
cd <private clone> && git fetch core && git merge core/main
#   journal: core migrations continue the private idx sequence; keep the private meta snapshots
```

Backups before any migration: `pg_dump -Fc -d "$DATABASE_URL" -f P:\WebProjects\_backups\provenance-tracker-<date>\<name>.dump` (pg_dump is at `C:\Program Files\PostgreSQL\16\bin\`).

## 6. Key files

- `docs/decisions.md`: D1 to D11.
- `docs/vocabulary.md`: IPTC and C2PA terms, how the tracker uses them, what real tools write, the palette.
- `docs/architecture.md`: origin classes, timelines, outputs.
- `src/shared/origin-vocabulary.js`: classes, positions, `spectrumPosition`, `sourceTypeUri`, `compositeClassFor`.
- `src/server/lib/origin/classify.js` and `origin.js`: proposal rules and their IO.
- `src/server/lib/timeline/compose.js`, `match.js`, `timelines.js`: the composition and its IO.
- `src/server/lib/extraction/c2pa.js`, `c2pa-node-loader.js`, `c2pa-sign.js`: reading and signing; where 4c starts.
- `src/client/pages/outputs/OutputPage.jsx` and `src/client/components/timeline/`: the output page and the strip.
- `src/client/components/origin/originClasses.js`, `OriginBadge.jsx`, `ClassFields.jsx`: how origin is shown and set.
- `scripts/test.mjs`: the repo guard around vitest.

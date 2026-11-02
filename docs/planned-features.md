# Planned Features

Scratchpad for work we intend to do but haven't scheduled. When the repo goes public, each item in here should become a labeled GitHub issue (`enhancement`, `platform-parser`, `help wanted`, `good first issue`, etc.) and this file goes away — issues are discoverable and linkable, docs like this one rot.

Edit freely. If something in here gets done, delete it.

---

## Platform parsers

New platforms to extract metadata from. The current parsers live in [`src/server/lib/extraction/parsers/`](../src/server/lib/extraction/parsers/) — each is a pure function `(exifTags, chunks) → normalized object`. Adding one means: write the parser, register it in the dispatcher, add a detection rule, commit test fixtures.

### High-priority generators (projects actively use)

- **Adobe Firefly family extensions** — base Firefly (web) parser is done. Still pending: Photoshop Generative Fill / Expand, Premiere Generative Extend, Audition Enhance Speech. All write C2PA but with different action manifests — likely sub-variants of the existing Firefly parser keyed off `Actions.parameters['com.adobe.firefly.operation']`.
- **Meta-AI image output** — deferred. Real samples carry only `DigitalSourceType=trainedAlgorithmicMedia` plus a filename pattern (`image-<17 digits>.jpeg`) that overlaps with generic Facebook/Instagram downloads. Needs either a richer signal from Meta (XMP fields we haven't seen yet) or a filename-match UX that tolerates false positives. The novelty system correctly flags these as "unknown" today.

### High-priority modifiers (projects actively use)

Modifiers transform existing content rather than generating it. Conceptually distinct from generators — a modified asset has both an origin and a modification event. See "Modification chain tracking" below for the schema implications.

- **Topaz Photo AI / Gigapixel** (image upscaling) — Topaz Video AI parser is done (keys off the `Videoai` container tag). Image tools likely use a different EXIF `Software` or XMP tag; parser needs real samples first.
- **Topaz source-chain detection** — current Topaz Video AI parser records "this is a Topaz enhancement" but does not link to the source file. When modification-chain tracking lands, Topaz outputs with matching `<basename>_prob*` filenames should auto-link to the original.

### Deferred (no current project uses)

- **Runway / Sora / Pika / Luma Dream Machine** (AI video) — C2PA-signed MP4. Container handling is different from images.
- **Stable Diffusion / Automatic1111** — PNG `parameters` tEXt chunk, key=value format (distinct from ComfyUI's workflow JSON).
- **DALL-E / ChatGPT image** — C2PA + IPTC `DigitalSourceType`.
- **Leonardo.ai**, **Ideogram** — commonly mentioned, formats TBD.
- **Suno / Udio / Stable Audio** (AI music) — C2PA MP3.
- **Descript / Resemble AI** (voice) — formats TBD.

Note: Origen Story's projects currently use only the high-priority set. Deferred entries are for other users / future productions.

---

## Infrastructure & dev-ex

- **Replace the signing backend** — files signed by the tracker today (c2pa-node 0.5.26, which bundles c2pa-rs 0.49.2) verify their signature and DigiCert timestamp in c2patool 0.27.1 but then fail with `assertion.required.missing: Failed to load manifest` and an empty manifest map (seen 2026-11-02 on a signed WAV and PNG). The reference reader no longer accepts what the old core writes. Options for the output manifest (Phase 4c): a newer c2pa-node if one exists, or shelling out to a current c2patool for signing with a JSON manifest definition, keeping c2pa-node only as the fast reader. The integration test `test/integration/sign-verify.test.js` is the harness to swap the backend under.
- **Bump the bundled c2patool and configure a trust list** — the vendored c2patool 0.27.1 and c2pa-node 0.5.26 predate c2pa-rs fix #2434 (indexed xpath exclusions in `c2pa.hash.bmff.v3`, shipped in c2pa-v0.91.0 on 2026-09-21). Pixel 10 Pro video manifests exclude `/moov[1]/trak[3]`, so older readers report `assertion.bmffHash.mismatch` on untouched camera originals (reproduced 2026-11-02 on a real clip; c2paviewer.com on c2pa-web 0.13.1 fails the same way). Also load the C2PA trust list so Google, Leica, Sony and the others validate as trusted instead of `signingCredential.untrusted`. The verify status in the tracker must distinguish "hash verified" from "hash not verifiable with this tooling".
- **ESLint + Prettier config** — standard JS/JSX rules, auto-format on save. Keep it lightweight — no over-opinionated ruleset.
- **Dockerfile for the app** — `docker-compose.yml` already runs Postgres; add a second service for the Node app so a single `docker compose up` boots the whole stack. Useful for contributors who don't want Node 22 on their host.
- **`/api/health` endpoint** — returns `{ ok: true, db: true, version: "..." }`. Useful for reverse-proxy health checks and for the self-hosting docs.
- **Plugin-style extraction registry** — refactor [`ai-extraction.js`](../src/server/lib/extraction/ai-extraction.js) from a big if/else into a `{ detect, parse }` registry. Prerequisite for adding platform parsers cleanly. *(Scheduled this session.)*
- **Retry-failed-job endpoint + UI button** — today we flip `search_jobs.status` back to `queued` via SQL. Should be a proper endpoint (mirrors `retryCandidate` in [`queue.js`](../src/server/lib/search/queue.js)) with a button on the search page. *(Scheduled this session.)*

---

## Documentation & release

- **Replace the production-named example data** — `src/server/db/example-data/gaudi-tour-groups.json` and its README mention predate the public/private split (decision D1) and name a specific production. Swap it for a neutral, smaller worked example (a few groups with multilingual keywords and categories) and keep `example.groups.json` as the template. The README line in "Archive Search" changes with it.
- **CONTRIBUTING.md** — written fresh at public launch, not retroactive. Covers: dev setup, how to add a platform parser, test-fixtures conventions, PR checklist.
- **CHANGELOG.md** — started fresh at public launch; use Keep-a-Changelog format.
- **Self-hosting guide** — section in README or a separate doc: reverse-proxy examples (nginx, Caddy, Tailscale), HTTPS, backups, log rotation.
- **Convert this file to GitHub issues** at public launch. One issue per bullet, appropriately labeled.

---

## Features

- **Video AI support** — once a project needs it. Entails: a video-specific extraction path (FFmpeg probe for codec + container), C2PA on MP4, possibly a video preview component in the UI.
- **Drift fingerprint tracking** — maintain a baselines table recording every unique `Software` tag value and C2PA `claim_generator` string seen per project. When a new fingerprint appears, surface a "new signal on known platform" callout separate from the "unknown platform" flag. Deferred until we have a few months of imports to justify the baseline storage.
- **Review status columns on assets** — add `review_status` (`pending` / `reviewed` / `flagged`) to asset tables so users can dismiss novel flags or explicitly flag items for future parser work. Deferred; start with derive-at-query-time novelty and add this only if noise becomes a problem.
- **Novelty detection for archival + produced assets** — the first pass covers only AI assets (where platform parsing matters most). Extend to archival (where C2PA may be present but unparsed) and produced (where new camera/mic firmware writes unseen EXIF/RIFF data) once the AI side is stable.
- **Modification chain tracking** — our schema currently models origin (generators) but not modifications. If an archival photo is upscaled with Topaz, there's no place to record "this asset is a Topaz-modified version of archival asset #42." Entails: a generic `modification_events` table (or extending `asset_relationships` across asset types), parser output of a `modifications: [{tool, version, action, date}]` array, UI for viewing a processing chain, and C2PA manifest generation that chains modifications into the output manifest's ingredients.

*(Add more as they come up.)*

# Provenance Tracker, phase 2: from asset ledger to signed, explainable output

Feature spec for design planning. Written 2026-11-02 against commit b1cb77f (v0.1.0). Scope is the features only; schedule and funding context live elsewhere.

## 1. Goal

Phase 1 answers "what assets do I have and where did they come from." Phase 2 answers "what went into this finished video, how much of it is what, and how do I say so in a form machines and people can check." Concretely, for one produced output:

1. Ingest the output video and its source assets, including video files.
2. Read the edit timeline and map every segment of the output back to a tracked asset.
3. Classify each segment by origin and compute share of screen time by origin.
4. Write a signed C2PA manifest for the output whose ingredients are the matched assets and which carries a creator's statement.
5. Export a JSON record that a public page can render as a timeline visualisation.

The first user is Origen Story on its own productions. The design should not assume a single user forever, but nothing in this phase needs multi-user support.

## 2. User story

As a producer finishing a mixed-source video (signed camera capture, archival stills, AI-upscaled archival, AI-generated motion graphics, AI voice), I export the edit from my NLE as XML, point the tracker at the XML and the output file, and get back: a timeline of segments with origin classes, a percentage breakdown, a signed manifest embedded in or sidecar to the output, and a JSON export I can publish next to the video.

## 3. Current state (what phase 2 builds on)

- Import by upload, folder scan, path and URL; SHA-256 dedupe; managed storage.
- Extraction: EXIF (exiftool-vendored), C2PA read (c2pa-node, `extractC2pa` in `src/server/lib/extraction/c2pa.js`), PNG chunks; platform parsers for ComfyUI, MidJourney, Freepik, Firefly, ElevenLabs, Topaz Video AI, Meta.ai, each a pure `(exifTags, chunks) -> normalized` function with unit tests.
- Three asset tables (`assets` for AI, `archival_assets`, `produced_assets`) plus `generation_params`, `asset_metadata`, `asset_relationships` (AI assets only), and an empty `manifests` table.
- Enrichment tracking, Wikimedia archive search with job queue, optional Notion sync.
- Stubs: Manifest Builder page, Export page.
- Not present: any video-specific extraction, any timeline concept, any signing, any origin classification across asset types.

## 4. Features

### F1. Video ingest for produced assets

Produced assets today are records with little extraction. Phase 2 makes video a first-class input.

- On import of a video file (mp4, mov, mxf as a minimum), run an ffprobe pass and store: container, video codec, audio codec, duration, frame rate, resolution, creation time, and the raw ffprobe JSON in `asset_metadata`.
- Run the existing C2PA read on the file. c2pa-node reads BMFF containers; confirm mp4 and mov on real files from a Pixel 10 Pro and from Premiere and Resolve exports. Record whether a manifest was found and, if so, the claim generator, signer and ingredients, as today for images.
- Camera capture detection: if a C2PA manifest is present and its claim generator or signer identifies a capture device, flag the asset `capture_signed`. This is the input to origin classification (F3).
- Acceptance: importing a Pixel 10 Pro clip, a Premiere export and a plain phone clip produces three produced-asset records with correct duration, codec and C2PA status, and the one with a capture manifest is flagged.

### F2. Timeline ingestion

Parse one NLE interchange format and map the output's timeline to tracked assets.

- Format: FCPXML (both Resolve and Premiere can export it). Other formats (EDL, Premiere's own project XML, AAF) are out of scope for this phase; design the parser as the first entry in a registry so a second format is a new module, not a rewrite.
- Input: an FCPXML file plus the produced output asset it describes. Store the raw XML in managed storage.
- Output: a `timeline` record and ordered `timeline_segments`, each with start and end in output time (frames and seconds), the source clip reference from the XML (file path or name, source in and out), track or layer, and a match to a tracked asset.
- Matching, in order: exact managed-storage path; filename plus file size; SHA-256 of the file at the referenced path if reachable; filename only, flagged as weak. Unmatched segments are kept and flagged, never dropped, so the breakdown can show "unknown".
- Composite segments: a point in output time can have more than one source (picture plus a lower third plus voice). Segments are per track; the breakdown in F3 is computed on the primary picture track by default, with an option to include overlays. Audio tracks are stored and classified but reported separately.
- Acceptance: for a test project with ten clips across three tracks, every segment in the XML appears in the tracker, at least nine match by path or hash, and the one deliberately renamed clip is flagged weak.

### F3. Origin classification and screen-time breakdown

Give every asset, and therefore every segment, one origin class, then compute the breakdown.

Origin classes (one per asset; stored, not derived at query time, so a user can correct it):

- `captured_signed`: camera capture with a C2PA capture manifest.
- `captured`: camera or microphone capture without a manifest.
- `archival`: third-party or historical source material, unmodified.
- `archival_enhanced`: archival material passed through an AI modifier (upscale, restoration, colourisation). Detected when a Topaz or similar parser fires on an asset whose `asset_relationships` parent is archival, or set by hand.
- `generated`: AI-generated image, video, audio or motion graphics.
- `composited`: an asset built from more than one of the above (a motion-graphics render that includes archival stills, for example). Carries a list of its ingredient classes.
- `unknown`: no evidence and no user decision.

Rules:

- Default class is proposed by the extraction layer (capture manifest, platform parser, archival module) and shown as a suggestion; the user confirms or overrides. Enrichment tracking treats an unconfirmed class as a missing field.
- `asset_relationships` is extended to link across all three asset tables, so an `archival_enhanced` asset points at its archival parent. This is the minimum slice of the planned "modification chain tracking" and should be designed so the full version (ordered modification events) can land later without a migration of the links.
- Breakdown: for the primary picture track, seconds and percentage of output duration per origin class; the same for audio tracks; a separate count of segments and assets per class. Stored on the timeline record and recomputed when segments or classes change.
- Acceptance: the test project reports a breakdown whose percentages sum to 100, matches a hand count to within one frame per segment, and changes correctly when one asset's class is overridden.

### F4. Manifest builder (replace the stub)

Produce a real, signed C2PA manifest for a produced output.

- Inputs: the output asset, its timeline (F2), the confirmed origin classes (F3), and a creator's statement (F5).
- Ingredients: one ingredient per matched asset in the timeline, with relationship `componentOf`, the asset's own manifest embedded where one exists (capture or generator manifests), and the asset's hash. Unmatched segments are not ingredients; the manifest notes them in the actions assertion as unresolved.
- Assertions, at minimum: `c2pa.actions` listing the edit and the AI-involved steps (generation, enhancement, voice synthesis) with the tool recorded by the parsers; a digital source type assertion consistent with the breakdown; the creator's statement as a custom assertion under an Origen Story namespace (for example `com.origenstory.creator_statement`), with the schema documented in the repo; the training and data-mining assertion from CAWG so the preference is explicit.
- Signing: c2pa-node with a certificate and key from `.env`. Phase 2 uses a self-signed or test certificate. The UI must show the verify result honestly, including "unrecognized issuer" when the certificate is not on a trust list. Trust-list certification is out of scope.
- Output: embedded manifest in a copy of the output file in managed storage, and a sidecar `.c2pa` file. The original output is never modified in place.
- The `manifests` table is populated: manifest JSON, type, signed time, output path, and a link to the timeline.
- UI: the Manifest Builder page lists produced outputs with a timeline, shows the proposed ingredients and assertions, lets the user edit the creator's statement, signs, and shows the verify result read back from the signed file.
- Acceptance: signing the test output yields a file that `c2patool` and the tracker's own reader both open, listing the expected ingredients and assertions; re-signing after an origin class change updates the manifest.

### F5. Creator's statement

A short structured statement of ethics and usage attached to a project and overridable per output.

- Fields: who made it; what was captured, what was archival, what was generated, what was AI-modified, in plain language; what AI tools were used and for what; what was not done (for example no synthetic people, no altered testimony); the disclosure wording used on screen; a free-text ethics note; a link to a fuller policy if one exists.
- Stored on the project with a per-output override. Rendered into the manifest (F4) and into the export (F6).
- The breakdown numbers from F3 can be inserted into the statement automatically so the human text and the machine data never disagree.
- Acceptance: editing the statement and re-signing changes the custom assertion; the export carries the same text.

### F6. Export (replace the stub)

One JSON document per produced output, built for publishing.

- Contents: output identity and hashes; the timeline segments with start, end, origin class, asset reference and a short asset description; the breakdown; the creator's statement; a manifest summary (signer, time, verify status, ingredient count) and a link to the sidecar; the list of tools recorded; a generated-at timestamp and a schema version.
- No managed-storage paths, no local file paths, no prompts or seeds unless the user ticks "include generation parameters". The export is meant to be public.
- Also a project-level export (all assets and their provenance) as JSON, which was the original intent of the stub. Keep it simple: the existing tables serialised with paths stripped.
- Acceptance: the export for the test output validates against a committed JSON schema and contains nothing that identifies the local machine.

### F7. Public timeline visualisation (outside the tracker)

A static page that renders an F6 export next to the published video.

- Not part of the Express app. A standalone HTML page or a small component that takes the export JSON by URL and draws: a horizontal bar the length of the video, coloured by origin class per segment; the percentage breakdown; on hover or tap, the segment's asset description and class; the creator's statement; the manifest verify status with a link to the sidecar; a legend that explains the classes in one line each.
- Design tokens from the Origen Story brand system; must work at phone width.
- Should play nicely with the video element (optional: highlight the current segment as the video plays, driven by `timeupdate`).
- Acceptance: the page renders the test export with no network calls other than the JSON and the video, and is legible at 375 px wide.

## 5. Data model changes

- `produced_assets`: add `duration_seconds`, `frame_rate`, `width`, `height`, `container`, `video_codec`, `audio_codec`, `capture_signed` (boolean), `origin_class`, `origin_class_confirmed` (boolean).
- `assets` and `archival_assets`: add `origin_class`, `origin_class_confirmed`.
- `asset_relationships`: generalise to reference any asset table (either a polymorphic pair of `asset_type` and `asset_id` columns on each side, or a unified `asset_refs` table that the three tables point at). Decide in the design session; the second is cleaner for the later modification-chain work.
- New `timelines`: id, project id, produced asset id, source format, raw file path, primary track id, breakdown JSON, created and updated times.
- New `timeline_segments`: id, timeline id, track, start and end (frames and seconds), source reference from the XML, matched asset type and id, match method, match confidence, origin class (denormalised from the asset at compute time, so historical breakdowns stay stable).
- `manifests`: add `timeline_id`, `verify_status`, `verify_detail` JSON, `sidecar_path`, `certificate_fingerprint`.
- New `creator_statements`: id, project id, produced asset id (nullable for the project default), the fields in F5, updated time.

## 6. API surface (new or changed routes)

- `POST /api/produced/:id/timeline` upload FCPXML, parse, match, compute breakdown.
- `GET /api/timelines/:id` and `GET /api/timelines/:id/segments`.
- `PATCH /api/timelines/:id/segments/:segId` fix a match by hand.
- `PATCH /api/assets/:type/:id/origin` set or confirm origin class.
- `GET` and `PUT /api/projects/:id/creator-statement` and the per-output variant.
- `POST /api/manifests/build` for a produced asset; `POST /api/manifests/:id/sign`; `GET /api/manifests/:id/verify`.
- `GET /api/produced/:id/export` the public JSON; `GET /api/projects/:id/export` the project dump.

## 7. UI changes

- Produced asset detail: video metadata panel, C2PA status, origin class control, "Import timeline" action.
- New Timeline page per produced asset: segment table with match status and class, breakdown panel, "fix match" and "set class" inline.
- Manifest Builder: as in F4.
- Creator's statement editor on project settings, with per-output override on the produced asset.
- Export: download buttons for the public JSON and the project dump; a preview of the public JSON with sensitive fields visibly stripped.

## 8. Non-goals for this phase

- More than one timeline format. The registry pattern is the only concession.
- Full modification chain tracking (ordered events). Only the parent link needed for `archival_enhanced`.
- Watermark detection (SynthID or others). Leave a hook in the extraction layer; no implementation.
- Perceptual hashing or content matching for edits with no XML.
- Trust-list certification or any production signing identity.
- A browser extension or a reusable web component beyond the single static page in F7.
- Multi-user, auth, or remote deployment.
- Replacing Notion sync.

## 9. Open questions for the design session

1. FCPXML version and dialect: Resolve and Premiere differ in how they reference media (`<asset>` with `src` file URLs) and in frame-rate representation. Choose the test exports first, then write the parser against them.
2. Where origin class lives for composited assets: on the asset as a class plus ingredient list, or as a relationship graph only.
3. Whether the primary-track breakdown should count overlays that cover more than a threshold of the frame, or ignore overlays entirely in this phase.
4. Creator's statement schema: how much structure versus free text, and whether to align with any existing CAWG or IPTC vocabulary now or later.
5. Signing key handling: `.env` only, or a small keystore abstraction so a real certificate can be dropped in later without code change.
6. Whether the F7 page is hand-written HTML in the Origen Story site repo or a tiny package in this repo with the site embedding it.

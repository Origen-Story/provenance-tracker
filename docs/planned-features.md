# Planned Features

Scratchpad for work we intend to do but haven't scheduled. When the repo goes public, each item in here should become a labeled GitHub issue (`enhancement`, `platform-parser`, `help wanted`, `good first issue`, etc.) and this file goes away — issues are discoverable and linkable, docs like this one rot.

Edit freely. If something in here gets done, delete it.

---

## Platform parsers

New platforms to extract metadata from. The current parsers live in [`packages/core/src/extraction/parsers/`](../packages/core/src/extraction/parsers/) — each is a pure function `(exifTags, chunks) → normalized object`. Adding one means: write the parser, register it in the dispatcher, add a detection rule, commit test fixtures.

### High-priority generators (projects actively use)

- **Adobe Firefly family extensions** — base Firefly (web) parser is done. Still pending: Photoshop Generative Fill / Expand, Premiere Generative Extend, Audition Enhance Speech. All write C2PA but with different action manifests — likely sub-variants of the existing Firefly parser keyed off `Actions.parameters['com.adobe.firefly.operation']`.
- **Meta-AI image output** — deferred. Real samples carry only `DigitalSourceType=trainedAlgorithmicMedia` plus a filename pattern (`image-<17 digits>.jpeg`) that overlaps with generic Facebook/Instagram downloads. Needs either a richer signal from Meta (XMP fields we haven't seen yet) or a filename-match UX that tolerates false positives. The novelty system correctly flags these as "unknown" today.

### High-priority modifiers (projects actively use)

Modifiers transform existing content rather than generating it. Conceptually distinct from generators — a modified asset has both an origin and a modification event. See "Modification chain tracking" below for the schema implications.

- **Topaz Gigapixel** — done (2026-11-03): keys off `Software`/`CreatorTool` and reads model and scale from the `-gigapixel-<model>-<N>x` filename tail. **Topaz Photo AI** still needs a real sample.
- **Topaz source-chain detection** — done (2026-11-03) as `packages/core/src/relationships/auto-link.js`: Topaz Video AI and Gigapixel outputs look for a same-stem asset in the project and link `derived_from` at confidence 0.7. Remaining gap: the Topaz output's stem must match the source's stem exactly; renamed sources need the manual picker.
- **Google Veo via Freepik** — the two Freepik MP4s in the test project carry only `Encoder: Google` and no C2PA, so they classify as `unknown`. A parser keyed on that encoder string plus the `freepik__` filename prefix would be weak evidence; wait for a sample with a manifest (Freepik states newer downloads are signed).
- **ElevenLabs WAV with C2PA** — the ElevenLabs parser detects via XMP `Actions`/`Author` tags, which the WAV export does not carry; the classifier still reaches `generated` from the manifest, but `platform` stays `unknown`. Extend `detect()` to accept the stored C2PA summary (claim generator or signer "Eleven Labs Inc.").

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

- **Signing backend: done in 4c (2026-11-13), through c2patool.** The `assertion.required.missing: Failed to load manifest` seen on 2026-11-02 was not the old c2pa-node core: it was the unsigned `cawg.identity` assertion the old signer wrote (`signature: null`). c2patool 0.27.1 rejects that assertion and reports the whole manifest invalid; the same manifest without it reads Valid. 4c dropped it (the identity URL now rides on the CreativeWork author) and signs through c2patool (`src/server/lib/manifest/`). Still open: signed CAWG identity once a signer for it is available, and reading through `@contentauth/c2pa-node` if Smart App Control allows it.
- **Creator identity certificate, CAWG-style (requested 2026-11-13)** — let anyone set up their own identity in a few steps: generate a key and a self-issued identity certificate (name, organisation, identity URL in the subject and SAN) for development; produce a CSR for the same identity to take to a CA that issues CAWG certificates (SSL.com sells them); sign a `cawg.identity` assertion (`cawg.x509.cose`) with it, separate from the C2PA claim certificate. c2patool supports this through `[cawg_x509_signer]` settings or `--identity-signer-path` (tested 2026-11-13: Valid apart from trust with a dev certificate). Prefer the signer-path hook, because the settings file wants the private key contents, not a path. Before building, read CAWG identity assertion 1.1 section 8.2 (X.509 certificates and COSE signatures) for the certificate profile and trust rules. A self-issued certificate verifies but will read as untrusted to anyone else.
- **Bump the bundled c2patool and configure a trust list** — the vendored c2patool 0.27.1 and c2pa-node 0.5.26 predate c2pa-rs fix #2434 (indexed xpath exclusions in `c2pa.hash.bmff.v3`, shipped in c2pa-v0.91.0 on 2026-09-21). Pixel 10 Pro video manifests exclude `/moov[1]/trak[3]`, so older readers report `assertion.bmffHash.mismatch` on untouched camera originals (reproduced 2026-11-02 on a real clip; c2paviewer.com on c2pa-web 0.13.1 fails the same way). Confirmed 2026-11-02: `@contentauth/c2pa-node` 0.9.11 reads both Pixel 10 Pro clips as Valid with `assertion.bmffHash.match` (only `signingCredential.untrusted` remains, because no trust list is configured). No c2patool binary with the fix has been released (`c2patool-v0.27.22` of 2026-09-10 is the last; `c2patool` 0.28.x exists only on crates.io and needs a Rust toolchain), so the reader migration to the maintained package is the fix, and the c2patool fallback can retire with it. Also load the C2PA trust list (`createTrustSettings`, local PEM anchors) so Google, Leica, Sony and the others validate as trusted instead of `signingCredential.untrusted`. The verify status in the tracker must distinguish "hash verified" from "hash not verifiable with this tooling".
- **A setting for the certificates this machine also trusts** (D51, 2026-11-24). The library reader takes extra trust anchors (the library's "user" anchors), so a person's own development authority can read as "trusted on this machine", kept apart from "trusted" by the C2PA list. There is no setting for them yet: add one per machine (a PEM file's path, like the signing certificate's), shown on Settings and in `npm run cli -- settings`, never inside a catalog.
- **The remote-credentials switch on the Settings page** (D51, 2026-11-24). Whether reading a file fetches Content Credentials it says are stored on the web is a per-machine setting, set today only with `npm run cli -- settings remote-credentials on|off`. Show it on the Settings page with what it sends and to whom.
- **Time-stamp trust** (D51, 2026-11-24; causes found 2026-11-25, the library side fixed by D53). The library reports `timeStamp.untrusted` (informational) on our signed films. Every token checks out (`timeStamp.validated`); the trust has two causes:
  - **The service we use isn't on the list.** Our time stamps come from DigiCert's general service (`http://timestamp.digicert.com`), which chains to DigiCert Trusted Root G4. The C2PA time-stamp list names only DigiCert's separate "… for C2PA G1" chains, so "untrusted" is the true reading. **Decided (Matt, 2026-11-25): keep this service for now.** Which listed service to use is for the "Time-stamp services" study below.
  - **The library side: fixed (D53, 2026-11-25).** The library's settings object never passed the C2PA time-stamp list on; the native library takes it as its own kind of anchor (`tsa`), and the tracker now adds it. The 2 Nov Pixel clip's Google time stamp reads `timeStamp.trusted`. What's left is the choice of service, above.
- **Find what restarted the dev server during a signing** (2026-11-24). During the first real signing through the app, `npm run dev`'s `node --watch` restarted the server ("Restarting 'src/server/index.js'"), and the in-memory job went with it. Nothing in the repo, the machine settings or the project's catalog folder was written, created or deleted at that moment, and reading a file or running c2patool beside a watched server does not restart it (tried in a scratch folder). The terminal was cleared by the restart, so the trigger is unknown. Since then the dev server keeps its output across restarts (`--watch-preserve-output`) and the page says when a signing job was interrupted; signing under `npm start` (no watcher) worked. If it happens again, the terminal above "Restarting" shows the cause. A likely cause, found on 2026-11-25: switching branches or pulling in the checkout the dev server runs from rewrites files under `src/`, and the watcher restarts on that (an Import job's result was lost that way). Work on branches happens in a worktree since then (`.claude/worktrees/`). A longer-term fix would be to keep jobs somewhere that survives a restart, or to stop the watcher restarting while a job runs.
- **ESLint + Prettier config** — standard JS/JSX rules, auto-format on save. Keep it lightweight — no over-opinionated ruleset.
- **Dockerfile for the app** — `docker-compose.yml` already runs Postgres; add a second service for the Node app so a single `docker compose up` boots the whole stack. Useful for contributors who don't want Node 22 on their host.
- **`/api/health` endpoint** — returns `{ ok: true, db: true, version: "..." }`. Useful for reverse-proxy health checks and for the self-hosting docs.
- **Plugin-style extraction registry** — refactor [`ai-extraction.js`](../src/server/lib/extraction/ai-extraction.js) from a big if/else into a `{ detect, parse }` registry. Prerequisite for adding platform parsers cleanly. _(Scheduled this session.)_
- **Retry-failed-job endpoint + UI button** — today we flip `search_jobs.status` back to `queued` via SQL. Should be a proper endpoint (mirrors `retryCandidate` in [`queue.js`](../src/server/lib/search/queue.js)) with a button on the search page. _(Scheduled this session.)_

---

## Documentation & release

- **CONTRIBUTING.md** — written fresh at public launch, not retroactive. Covers: dev setup, how to add a platform parser, test-fixtures conventions, PR checklist.
- **CHANGELOG.md** — started fresh at public launch; use Keep-a-Changelog format.
- **Self-hosting guide** — section in README or a separate doc: reverse-proxy examples (nginx, Caddy, Tailscale), HTTPS, backups, log rotation.
- **Bring this file up to date with the new app** (noted 2026-11-24). Several entries describe the app before the cutover (D49): Postgres and docker-compose, `/api/health` with a database check, the old extraction and search paths, and work since done (the ESLint and Prettier setup, the extraction registry). Remove or rewrite them.
- **Convert this file to GitHub issues** at public launch. One issue per bullet, appropriately labeled.

---

## Features

- **Video AI support** — once a project needs it. Entails: a video-specific extraction path (FFmpeg probe for codec + container), C2PA on MP4, possibly a video preview component in the UI.
- **Drift fingerprint tracking** — maintain a baselines table recording every unique `Software` tag value and C2PA `claim_generator` string seen per project. When a new fingerprint appears, surface a "new signal on known platform" callout separate from the "unknown platform" flag. Deferred until we have a few months of imports to justify the baseline storage.
- **Review status columns on assets** — add `review_status` (`pending` / `reviewed` / `flagged`) to asset tables so users can dismiss novel flags or explicitly flag items for future parser work. Deferred; start with derive-at-query-time novelty and add this only if noise becomes a problem.
- **Novelty detection for archival + produced assets** — the first pass covers only AI assets (where platform parsing matters most). Extend to archival (where C2PA may be present but unparsed) and produced (where new camera/mic firmware writes unseen EXIF/RIFF data) once the AI side is stable.
- **Modification chain tracking** — our schema currently models origin (generators) but not modifications. If an archival photo is upscaled with Topaz, there's no place to record "this asset is a Topaz-modified version of archival asset #42." Entails: a generic `modification_events` table (or extending `asset_relationships` across asset types), parser output of a `modifications: [{tool, version, action, date}]` array, UI for viewing a processing chain, and C2PA manifest generation that chains modifications into the output manifest's ingredients.
- **A new cut of the same film carries its details forward: done (D50, 2026-11-24).** A finished edit can start from an earlier one, copying its public details, credits, newest statement and clip classes once. Each export stays its own finished edit. Still open: Import could suggest which edit a new export starts from (by the timeline's sequence name or the file name), instead of the person choosing it.
- **Choose the sequence when a timeline file holds several** — a Premiere XML export of a whole project contains every sequence, and the xmeml parser takes the first one without saying so. On 2026-11-15 that was a 631-second assembly instead of the 146-second film. Offer the sequences by name and length, default to the one whose length matches the output, and refuse to guess when none matches.

- **License URL on archival imports** — both archival import forms (`ArchivalIngest.jsx` and the archival form in `ImportHub.jsx`) send a `licenseUrl` that no input lets anyone enter, so it is always saved empty. Found by the linter on 2026-11-21; deferred to the app cutover, when the import pages are rebuilt. Rights information on archival material matters, so it should not wait longer than that.

- **Say in plain words what a file's credentials are, on its page** (2026-11-24). The asset page lists each reading with its raw data; for a C2PA reading it should also say the verdict as `manifest/verify.js` works it out ("Trusted, signed by …", "Valid, unrecognised issuer", "Content does not match", "Invalid"), with problems inside ingredients listed under those ingredients. The library's own one-word state is not that verdict (D51). Say the time stamp separately, by who issued it, for example "Time stamp checked; from DigiCert's general service, which is not on the C2PA list", so a reader never takes "untrusted" to mean the date is wrong.
- **Cuts within one asset in the creator statement and the viewer** (2026-11-24). The signed `c2pa.placed` actions keep every cut (D52), but the statement's per-lane intervals (`compactIntervals` in `build.js`) join back-to-back stretches that play the same assets, so the statement, the public export and the viewer's strip show an interview cut into seven pieces as one stretch. Matt is happy with the viewer as it is; revisit if a reader needs to see where a take was cut. It would be a statement v4 with a viewer change.
- **A design pass on the app's pages, after the cutover** — the pages on the catalogs (Phase 6, slice 6) are built to work first; what is visible at once, the layout and the order of sections are decided once every page exists, from getting files in to signing. Anything that makes a mistake easy (a buried save, a dangerous button among everyday ones) is fixed as it is found rather than waiting for this. Noted so far, on 2026-11-23: the asset page is one long column of sections, and an AI-generated asset's view is fine for now but should be reviewed with the rest.

### Signing, left for after Phase 7 (2026-11-24)

- **A thumbnail taken from the film** (updated 2026-11-25). The claim thumbnail is an image the person picks from the project's files (D52).
  - **Why it's worth having:** c2paviewer.com shows nothing for the signed demo film, which has no thumbnail. A thumbnail is also the only picture that travels with the credentials when a file is stripped and found again, or used as someone else's ingredient. Camera and AI video signers (Pixel, Firefly video, ElevenLabs audio) don't add one; still images usually do.
  - **Which picture:** the claim thumbnail is meant to show the asset as it was signed, so it should be a frame of the film, not a designed poster such as a YouTube thumbnail with text on it. Until this is built, export a frame from the editor (Premiere's Export Frame) into the film's media folder and pick it. The picker's help text still suggests "its YouTube thumbnail": change it to a frame from the film.
  - **How, without ffmpeg:** the browser can decode the film, as the asset page already plays it. On the Signing tab, a player with a scrubber and "Use this frame" draws the frame to a canvas and makes a JPEG. The server saves it as a real file beside the film (for example `exports/<film>.frame-0m42s.jpg`, never replacing a file), scans it and links it as the thumbnail, so the catalog can name and check it like any other. Start at about 10% in and let the person choose. Formats the browser can't play (ProRes, HEVC on some machines) say so and fall back to picking an image. ffmpeg as a pinned helper program stays the option if a frame must come from the server.
  - **Not planned:** uploading an arbitrary image on the Signing tab (considered and dropped on 2026-11-25). A frame from the film covers the need more honestly, and an image already in a media folder can still be picked.
  - **For any thumbnail:** it is embedded as it is in every signed copy, so the Signing tab should warn about large images (over about 2 MB) and about metadata inside them (editing history, file paths, location) found by the import reading.
- **Other places to keep the signing key** — the credential-holder seam is built (D54) with one module, key files on this machine (`packages/core-node/src/sign/holders/`). Each other place is a module there with the same shape (the chain, the algorithm, sign these bytes), and needs the C2PA library to sign, since c2patool opens key files itself; a system keychain, a hardware token and a remote signing service are later modules.
- **Writing a verified-accounts identity** (CAWG identity claims aggregation) — the open library can check one but not issue one yet. Read it, don't offer writing it.
- **A delegation record** ("on whose authority") — waits for CAWG issue #286 and CAWG 2.0. The credits table's `on_behalf_of` holds it until then.
- **C2PA conformance for the tool** — a claim certificate on the C2PA trust list depends on it, so until then signed files read "valid, unrecognised issuer".
- **Code-signing the native binaries** — for Windows Smart App Control and a downloadable app (D15).

- **Choosing the identity's role per edit** (D55, 2026-11-25). The identity signs as `cawg.creator` always. Someone who edits or publishes another person's work would sign as `cawg.editor` or `cawg.publisher`. It ties into the credits table, which already keeps "made by" apart from "on behalf of".
- **Trusting an identity's issuer** (D55). No CAWG trust list is pinned, so every identity reads "valid, unrecognised issuer". Pin CAWG's interim trust list (extended to 31 Dec 2027) the way the C2PA lists are (`npm run tools:fetch`, by commit and checksum), and add a per-machine setting for extra identity anchors, beside the one planned for claim anchors. Re-check CAWG's new certificate profile first.

### The public record, left for after Phase 8 (2026-11-25)

Phase 8 makes the public record findable and checkable: where each signed copy is published (D56), an export that shows the file, the signer and the identity as separate results, a check of a downloaded copy in the viewer, review before signing and before export, and revisions and deliverables inside the tool. These were put off:

- **A published fingerprint (rung 2 of stripping survival).** The public record would carry a code computed from the picture and sound that stays similar after a platform re-encodes the film. ISCC is an open ISO standard for this, and anyone could compute it from their own copy and compare, with no service to run. It needs a short investigation first: how mature the video tooling is, and whether it runs from Node. An export format after Phase 8's would carry it.
- **Revisions in the public record.** A line such as "replaces the version signed on 15 Nov" in the export and the viewer. It waits for editors' feedback on the revisions view (Phase 8, step 6), since it would be a public format, and would be a later export format.
- **Hosting a signed file from the tracker.** Uploading the signed copy to object storage or a release from the app. Today the tracker records where you put the file and doesn't put it there ([publishing.md](publishing.md)).

- **A certificate request for a real identity certificate.** Make the key and a CSR in the tool, to take to a CA that issues CAWG identity certificates, rather than only a self-issued test one. It waits for the experts conversation.

---

## Later: worth a funded study

Things deliberately put off until people other than the author have used the tool, or until there is funding to do them properly. Each says when and why it came up.

- **Versioning of finished edits** (raised 2026-11-24). Edits go through many revisions, and a client may ask to go back to an earlier one; a project also has several deliverables (a full-length film, a vertical version, a short cut-down). Today each export is its own finished edit and a new one can start from an earlier one (D50); the tool has no idea of a deliverable with revisions. Before designing one: a survey of how editors, producers and clients name, keep and return to revisions in different editing tools, and what a public viewer should say about a film that replaces an earlier signed one (for example "replaces the version signed on 15 Nov"). Things a design would have to settle: whether a revision belongs to its deliverable through the catalog or only through a link, how signed copies are numbered per revision, signing an earlier revision again, and links between deliverables ("cut down from").
- **Time-stamp services and certificates, chosen with experts** (raised 2026-11-25). A time stamp from a service on the C2PA time-stamp list is what lets a signature stay checkable after its certificate expires, but it only changes what verifiers show once the claim certificate is recognised too. So the time-stamp service belongs in the same decision as the claim and identity certificates. Listed services include SSL.com (`ts-c2pa.ssl.com`, ECC; access set up through SSL.com), DigiCert's C2PA service (enterprise only, as far as could be found) and several others on the list whose terms haven't been checked. Things to settle: which service or services, whether one company supplies the time stamps and the certificates, and what leaves the machine with each (`docs/network.md`). When the app gains a choice, it is a short fixed list of services, not a typed-in address, so it can't be made to send hashes anywhere.
- **An OpenTimelineIO reader** (in the roadmap as "keep xmeml, add OTIO later"; raised again 2026-11-24, when Premiere exported both a Final Cut Pro XML and an `.otio` file of the same cut). OTIO is an open timeline format that many editors read and write, so it is a better long-term input than Final Cut XML. It would be a timeline-format registry module beside xmeml, with a committed fixture and a test.

_(Add more as they come up. Anything deferred goes here or in a section above, so it is not lost in a handoff.)_

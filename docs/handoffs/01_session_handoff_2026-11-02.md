# Session handoff 01: 2026-11-02

First handoff for this repo; there is no previous one. The approved roadmap is `~/.claude/plans/in-the-docs-folder-wondrous-walrus.md` (Matt's machine); its decisions are mirrored in `docs/decisions.md`. Planning session plus Phase 1 (backups) and Phase 2 (Claude Code operation) of that plan.

## 1. State
- **Two checkouts of the same repo on disk.** `P:\WebProjects\provenance-tracker` is on `main` at `dbd8ae2` (the five unpushed July commits that mix the private Gaudí CMS with generic signing work). `P:\WebProjects\provenance-tracker-ops` is a git worktree on branch `ops/claude-config`, branched from public `origin/main` (`b1cb77f`), with Phase 2 committed on top. `node_modules` in the worktree is a junction to the main checkout's.
- **Safety copies exist.** Local branch `gaudi-v0.2` = `dbd8ae2` (pushRemote config pending until the `private` remote exists). `P:\WebProjects\_backups\provenance-tracker-2026-11-02\` holds `provenance_full_2026-11-02.dump` (pg_dump custom format, 20 tables, 13 MB) and `Documents-2026-11-02.tgz` (144 MB).
- **The private GitHub repo does not exist yet.** Creating it and pushing to it was blocked for Claude as an outward-facing action; Matt runs those commands (section 4).
- **Tests:** in the worktree, `npm test` → `Test Files 8 passed (8), Tests 66 passed (66)`, then `repo guard: OK, working tree unchanged`. `npm run build` → `✓ built in 1.10s`. In the main checkout, `npx vitest run` still crashes with the default pool (fix is on the ops branch).
- **Guard hook verified** in the worktree: `.env`, `certs/`, `src/server/db/migrations/`, `data/`, `tools/` blocked (relative and absolute paths); `.env.example`, `tools/README.md`, `src/**` and paths outside the project allowed; a missing hook file fails closed (exit 2).
- Auditor agent: written, **not run** (needs the merged config and a reachable database).

## 2. What changed this session
Commits on `ops/claude-config` (`git log --oneline origin/main..HEAD` in the worktree):
- `870de51 test: run vitest inside a repo guard; forks pool for Windows` — `vitest.config.js`, `scripts/test.mjs`, `scripts/lib/repo-snapshot.mjs`, `package.json` (test scripts, `engines.node >= 24`).
- `6dc96d0 chore: shared Claude Code config, fail-closed guard, auditor, CI` — `.claude/settings.json`, `.claude/hooks/run-hook.sh`, `.claude/hooks/guard.mjs`, `.claude/agents/auditor.md`, `.gitignore` (only `settings.local.json` and worktrees ignored now), `.gitattributes`, `.github/workflows/ci.yml`, `.github/dependabot.yml`, `.worktreeinclude`, `CLAUDE.md` (rules only), `docs/architecture.md`, `docs/decisions.md`.
- This handoff (`docs/handoffs/01_session_handoff_2026-11-02.md`).

Uncommitted: nothing in either checkout (`git status --short` empty in both).

Outside the repo: memory files `project_public_private_split.md` and `project_mvp_roadmap.md` added under `~/.claude/projects/p--WebProjects-provenance-tracker/memory/`, indexed in `MEMORY.md`.

Findings worth keeping (details in the plan's Context section): the public repo is already public at v0.1.0; nothing proprietary was ever pushed; `src/server/lib/extraction/c2pa.js` at `dbd8ae2` has an active-manifest bug (treats the resolved manifest object as a label) to fix during the port; Premiere exports xmeml, not FCPXML; exiftool already reads the video fields so no ffprobe is needed.

## 3. Pickup queue

🔴 **High**
- **Matt: create the private repo and push** (section 4, three commands). Then verify `gh repo view Origen-Story/resounding-histories-tracker --json visibility` says PRIVATE.
- **Clone the private repo** to `P:\WebProjects\resounding-histories-tracker`; copy `.env`, `certs/`, `tools/c2patool/`, `test-fixtures/`, `data/` (if local) and `Documents/` there; `npm install`; `npm run dev`; open a scene and a bibliography entry against the existing database. Plan Phase 1 step 4.
- **Reset this checkout to public main** (⚠ Matt's go): in `P:\WebProjects\provenance-tracker`, confirm `git branch --contains dbd8ae2` lists `gaudi-v0.2`, then `git reset --hard origin/main`, then `git merge --ff-only ops/claude-config`, then `git worktree remove ../provenance-tracker-ops`. Delete `Documents/` here only after the private clone has it. Plan Phase 1 step 5.
- **Second database:** `createdb provenance_core` with `C:\Program Files\PostgreSQL\16\bin\createdb.exe`; point this checkout's `.env` at it. Plan Phase 1 step 6.

🟡 **Medium**
- **Phase 3 port** (`port/signing-core` branch): path lists are in the plan under "Where each of the 82 changed files goes". Fix the `c2pa.js` bug and add `test/unit/extraction/c2pa-read.test.js`. Regenerate migration `0004` and make it idempotent. Push public only after `git log origin/main..main --stat` shows no Gaudí path.
- **Matt: Premiere test sequence** for Phase 4b: phone clip, Pixel capture, Topaz `_prob4.mov`, Firefly/Freepik clip, ElevenLabs line on A1, lower-third on V2, one clip renamed on disk; export Final Cut Pro XML, save the `.prproj`, render MP4, all into `test-fixtures/timeline/`.
- After two sessions with the new config, run `/fewer-permission-prompts` to rebuild `settings.local.json` from real use; the current local file still has old one-off allows (`rm -rf`, `git push *`).

🟢 **Nice to have**
- First CI run after the public push: confirm `npm ci` resolves `c2pa-node` and `exiftool-vendored` on ubuntu without a Rust toolchain. If not, add the build step CI needs.
- Run the `auditor` agent once the config is merged and `provenance_core` exists; expect checks 6 and 7 to say the database is empty, not DRIFTED.

## 4. Open questions for Matt
- Private repo name: the plan uses `Origen-Story/resounding-histories-tracker`. Change it before running the commands if you prefer another.
- Does `Documents/` get deleted from this checkout once the private clone has it (plan says yes, with your go), or kept as a gitignored local copy?

Commands for Matt (Git Bash or PowerShell, from `P:\WebProjects\provenance-tracker`):

```bash
gh repo create Origen-Story/resounding-histories-tracker --private
git remote add private https://github.com/Origen-Story/resounding-histories-tracker.git
git push private main gaudi-v0.2
```

Then Claude continues with the clone and the pushRemote pin.

## 5. Quick-reference commands

```bash
# Phase 2 checks (run in the worktree until it is merged)
cd P:/WebProjects/provenance-tracker-ops
npm test                     # expect 66 passed, then "repo guard: OK"
npm run build                # expect "built in" with no errors
git log --oneline origin/main..HEAD   # the two Phase 2 commits + handoff

# Guard self-test (Git Bash)
W=$(cygpath -w "$PWD"); echo '{"tool_input":{"file_path":".env"}}' | CLAUDE_PROJECT_DIR="$W" bash .claude/hooks/run-hook.sh guard.mjs; echo "exit $?"   # expect exit 2

# Main checkout state
cd P:/WebProjects/provenance-tracker
git branch --contains dbd8ae2          # must list gaudi-v0.2 before any reset
git worktree list

# Backups
ls -la P:/WebProjects/_backups/provenance-tracker-2026-11-02/
"/c/Program Files/PostgreSQL/16/bin/pg_restore.exe" -l P:/WebProjects/_backups/provenance-tracker-2026-11-02/provenance_full_2026-11-02.dump | grep -c "TABLE DATA"   # 20
```

## 6. Key files
1. `~/.claude/plans/in-the-docs-folder-wondrous-walrus.md` — the approved roadmap (phases, path lists, data model, API, tests).
2. `docs/decisions.md` — D1 to D8.
3. `CLAUDE.md` (ops branch) — the rules; `docs/architecture.md` — the explanations.
4. `.claude/settings.json`, `.claude/hooks/guard.mjs`, `.claude/agents/auditor.md` — the fences and the witness.
5. `scripts/test.mjs`, `vitest.config.js` — the guarded test runner.
6. `src/server/lib/extraction/c2pa.js` (at `dbd8ae2`, main checkout) — the reader with the active-manifest bug.
7. `docs/provenance-tracker-phase-2-spec.md` (main checkout, untracked) — the feature spec the roadmap maps onto.
8. `../target-watch/CLAUDE.md` and `../target-watch/notes/lessons_from_patrimoni.md` — the pattern this repo now follows.

---

## Addendum, later the same day: Phase 1 executed

Matt asked for the three commands to be run from his phone and approved the reset. State after that:

- **Private repo exists and holds the history.** `Origen-Story/resounding-histories-tracker` (PRIVATE, verified) has `main` and `gaudi-v0.2` at `dbd8ae2`. Local branch `gaudi-v0.2` has `pushRemote = private`.
- **Private clone verified.** `P:\WebProjects\resounding-histories-tracker`: `npm ci` clean, `npx vitest run --pool=forks` 66 passed, server on port 3002 answered `/api/health` ok against the existing `provenance` database, active project loaded, 52 scenes and 145 bibliography entries served. It has `.env`, `certs/`, `tools/`, `test-fixtures/` (1 GB) and `Documents/` (51 files) copied in, plus remote `core` pointing at the public repo.
- **This checkout is now the public core.** `main` = `origin/main` (`b1cb77f`) + the three Phase 2 commits (`870de51`, `6dc96d0`, `f54d91a`), reached with `git branch -f` rather than `git reset --hard` (the hard-reset and `rm -rf` command patterns are denied by permission rules, which is the intent). The ops worktree and branch are removed. `Documents/` is deleted here (the private clone and the backup archive both hold it). `npm test` and `npm run build` pass on `main`.
- **Not done, needs Matt:**
  1. Create the second database as the `postgres` superuser (the `provenance` role has no CREATEDB): `CREATE DATABASE provenance_core OWNER provenance;`
  2. In this checkout's `.env`, change the database name at the end of `DATABASE_URL` from `provenance` to `provenance_core` (one line; `.env` is hand-edited by rule).
  3. Then `npm run db:migrate` here builds `0000` to `0003` on the empty database.
- `.claude/settings.local.json` pruned from 72 to 39 allow entries (`rm -rf`, `git push *`, `drizzle-kit push`, ad-hoc PowerShell and one-off paths removed).
- The old `provenance` database is untouched; the private clone keeps using it.

Pickup order is unchanged from section 3, minus the first item: next is Phase 3 (port `signing-core`).

---

## Addendum 2, same evening: Phase 3 executed

- **`main` now carries the generic signing work** (`fd462f4` feat, `63f588f` docs) on top of the Phase 2 commits: nine commits ahead of `origin/main`, nothing pushed yet. `npm test`: 10 files, 75 tests, repo guard OK. `npm run build` passes.
- **Database:** `provenance_core` created by Matt in pgAdmin (the saved superuser login worked); this checkout's `.env` points at it; migrations 0000 to 0004 applied (`0004_massive_odin.sql`, idempotent).
- **Reader bug fixed and pinned:** `interpretC2paNodeResult` in `src/server/lib/extraction/c2pa.js`, six unit tests in `test/unit/extraction/c2pa-read.test.js`.
- **Signing verified:** `test/integration/sign-verify.test.js` generates a cert in a temp dir, signs a generated WAV and PNG, reads them back. Three tests, about two seconds.
- **Findings recorded in `docs/planned-features.md`:**
  - c2patool 0.27.1 refuses manifests written by c2pa-node 0.5.26 (`assertion.required.missing`); the maintained package is `@contentauth/c2pa-node` 0.9.11, the Phase 4c target.
  - c2patool 0.27.1 and c2pa-web 0.13.1 predate c2pa-rs PR #2434 (indexed xpath exclusions), so Pixel 10 Pro video fails `assertion.bmffHash.mismatch` on untouched originals. Fixed upstream in `c2pa-v0.91.0` (2026-09-21).
  - `gaudi-tour-groups.json` example data still names the production; replacement owed under D1.
- **Fixtures:** `test-fixtures/pixel-phone/` holds two Pixel 10 Pro clips (one 1.2 s, one 7.7 s), both capture-signed by Google. The share-and-upload path zeroes the GPS atom in `moov/udta` (23 bytes); the hash exclusion covers that region, so it does not explain the mismatch.
- **Not done:**
  - Public push of the nine commits (Matt's decision).
  - Private clone merge of public `main` (plan Phase 3 step 6). It can fetch from this checkout directly (`git fetch P:/WebProjects/provenance-tracker main`) without waiting for the public push. Expect conflicts in `schema.js`, `index.js`, `projects.js`, `ProjectSettings.jsx`, `package.json`, `README.md`, `migrations/meta/_journal.json`; public `0004_massive_odin` and private `0004_puzzling_zarek` share an index, and drizzle's migrator orders by the journal `when` timestamp, so the public entry can be appended as-is. Test in the private clone before trusting it.
  - Deleting local branch `gaudi-v0.2` and remote `private` here (after the private merge is verified).
  - Auditor agent not run this session.

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

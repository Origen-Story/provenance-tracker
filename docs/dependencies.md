# Dependency policy

A tool that signs files is worth attacking through its dependencies: a tampered package or binary could sign whatever it likes, or leak the key. So the project keeps few dependencies, knows exactly which versions it runs, and lets new releases age before taking them. Decision D20 in [decisions.md](decisions.md) records this policy.

## Rules

1. **Few packages.** A new runtime dependency (anything in `dependencies`, or a helper program the app runs) needs a stated reason in the decisions log: what it does, why the standard library or an existing dependency cannot, and roughly how much code it brings with it. Development-only tools still need a reason in the pull request.
2. **Exact versions.** `package.json` names exact versions (`5.3.0`, never `^5.3.0`), and `.npmrc` sets `save-exact` so `npm install <pkg>` keeps it that way. The lockfile is committed, and CI installs strictly from it with `npm ci`, which also checks every package against the integrity hash the lockfile records.
3. **New releases wait 14 days.** Renovate proposes a release only once it is 14 days old ([shared config](https://github.com/indieglo/renovate-config)), so a compromised release is usually found and pulled by others first. Minor and patch updates arrive as one grouped weekly pull request; a major waits on the Dependency Dashboard issue until approved. Upgrades made by hand follow the same rule: pick the newest release at least 14 days old. A package that arrives with another, at a release younger than that, is held back with an exact `overrides` entry in `package.json`, removed once the release has aged.
4. **Helper programs are pinned and checksummed.** Programs the app runs that do not come from npm are downloaded by `npm run tools:fetch` at the version in [`scripts/lib/pinned-tools.mjs`](../scripts/lib/pinned-tools.mjs), and each download must match the SHA-256 recorded there. A bump changes the version and every checksum in one commit. ExifTool arrives through the `exiftool-vendored` npm package, so rule 2 covers it.
5. **GitHub Actions are pinned to commits**, with the version in a comment; Renovate updates both together.

## What is due to go

These are already recorded and leave as the roadmap reaches them, not in a clean-up pass:

| Package                            | Why it goes                                                                                                                                              | When          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `pg`, `drizzle-orm`, `drizzle-kit` | The catalog moves to SQLite on Node's built-in `node:sqlite` with plain SQL (D14)                                                                        | App cutover   |
| `@notionhq/client`                 | Notion sync is parked at `v0.2.0`                                                                                                                        | App cutover   |
| `c2pa-node` 0.5.26                 | Replaced by `@contentauth/c2pa-node` (D15); it also brings the `sharp` advisories allowed in `scripts/audit.mjs` and a runtime copy of `@changesets/cli` | Signing seams |

`png-chunk-text` and `png-chunks-extract` were removed with this policy: nothing imported them (`src/server/lib/extraction/png-chunks.js` reads PNG chunks itself).

## When adding the C2PA library

`@contentauth/c2pa-node` downloads its native binary during `npm install` without checking a checksum (D15). It will be installed with `SKIP_BINARY_DOWNLOAD=1`, and its binary added to `pinned-tools.mjs` and supplied through `C2PA_LIBRARY_PATH`, so rule 4 covers it like c2patool.

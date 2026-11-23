# tools/

Helper programs the tracker runs. Everything here except this README is gitignored.

## Install

```bash
npm run tools:fetch
```

This downloads each tool at the version pinned in [`scripts/lib/pinned-tools.mjs`](../scripts/lib/pinned-tools.mjs), refuses the download unless its SHA-256 matches the one recorded there, and installs it here. Run it again at any time: it confirms what is installed and changes nothing. If an installed copy reports a different version, it stops and says so; `npm run tools:fetch -- --force` replaces it. The policy behind this is in [docs/dependencies.md](../docs/dependencies.md).

## c2patool

The C2PA command-line tool (`tools/c2patool/c2patool`, `.exe` on Windows). The tracker reads credentials with it (`packages/core-node/src/extract/c2patool.ts`) and signs with it (`packages/core-node/src/sign/c2patool-sign.ts`).

Every c2patool release up to 0.27.23 misreads genuine Pixel video as invalid (`assertion.bmffHash.mismatch`), because it is built on an older version of the C2PA library than the fix for that (decision D15). So c2patool's verdict on a camera file is not to be trusted until a release built on c2pa-rs 0.91 or later exists; its reading of the tracker's own signed outputs is fine.

### A machine with no pinned download

Pinned downloads exist for Windows x64, macOS (Intel and Apple silicon) and Linux x64. Elsewhere, get the matching release from <https://github.com/contentauth/c2pa-rs/releases>, check it against the release's published SHA-256, and set `C2PATOOL_PATH=/absolute/path/to/c2patool` in `.env`. `C2PATOOL_PATH` also overrides the location on any machine.

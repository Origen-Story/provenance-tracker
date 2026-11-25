# tools/

Helper programs the tracker runs, the C2PA library's native binary, and the C2PA trust lists. Everything here except this README is gitignored.

## Install

```bash
npm run tools:fetch
```

This downloads each tool at the version pinned in [`scripts/lib/pinned-tools.mjs`](../scripts/lib/pinned-tools.mjs), refuses the download unless its SHA-256 matches the one recorded there, and installs it here. Run it again at any time: it confirms what is installed and changes nothing. If an installed copy reports a different version, it stops and says so; `npm run tools:fetch -- --force` replaces it. The policy behind this is in [docs/dependencies.md](../docs/dependencies.md).

## c2patool

The C2PA command-line tool (`tools/c2patool/c2patool`, `.exe` on Windows). It is the signing fallback: the C2PA library below signs by default, and a machine signs with c2patool only when set to (`npm run cli -- settings signing-engine c2patool`, or `sign --engine c2patool`; `packages/core-node/src/sign/engines/c2patool.ts`, D53). It then reads back what it has just signed.

It no longer reads files for the catalog: every c2patool release up to 0.27.23 misreads genuine Pixel video as invalid (`assertion.bmffHash.mismatch`), because it is built on an older version of the C2PA library than the fix for that (decision D15). The C2PA library below reads instead.

## c2pa-node

The native part of the C2PA library, `@contentauth/c2pa-node` (`tools/c2pa-node/index.node`, with `index.node.pinned.json` recording its version and SHA-256). The tracker reads every file's Content Credentials with it (`packages/core-node/src/extract/c2pa-library.ts`, D51), and loads only this copy: the one the package's own install script may have downloaded is unchecked (docs/dependencies.md). `C2PA_LIBRARY_PATH` overrides the location. Pinned downloads exist for Windows x64, macOS (Intel and Apple silicon) and Linux (x64 and arm64).

## trust-lists

The C2PA trust list (`C2PA-TRUST-LIST.pem`: the certificate authorities whose signers C2PA recognises) and its list of time-stamp authorities (`C2PA-TSA-TRUST-LIST.pem`), from `c2pa-org/conformance-public` at the commit named in `scripts/lib/pinned-tools.mjs`, licensed CC BY 4.0 by their authors. A file signed under one of these authorities reads as trusted; one signed with a certificate no list knows (a development certificate) reads as valid with an unrecognised issuer.

### A machine with no pinned download

Pinned downloads exist for Windows x64, macOS (Intel and Apple silicon) and Linux x64. Elsewhere, get the matching release from <https://github.com/contentauth/c2pa-rs/releases>, check it against the release's published SHA-256, and set `C2PATOOL_PATH=/absolute/path/to/c2patool` in `.env`. `C2PATOOL_PATH` also overrides the location on any machine.

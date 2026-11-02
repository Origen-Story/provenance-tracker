# tools/

Local binaries the tracker shells out to. Not committed — everything except
this README is gitignored. Install/re-install per the notes below.

## c2patool

Adobe's Rust CLI for reading and writing C2PA manifests. Used by
[`src/server/lib/extraction/c2pa.js`](../src/server/lib/extraction/c2pa.js)
as the fallback reader when `c2pa-node` (the Node bindings we vendor via npm)
can't decode a newer-spec manifest. Every image whose manifest is present but
unparseable by c2pa-node is retried through c2patool; both readers absent
means the file has no C2PA at all.

### Install (Windows)

```bash
# From the repo root:
mkdir -p tools/c2patool
curl -L -o tools/c2patool/c2patool.zip \
  https://github.com/contentauth/c2pa-rs/releases/latest/download/c2patool-v0.27.1-x86_64-pc-windows-msvc.zip
# (bump the version tag if a newer release exists — see the releases page)
unzip tools/c2patool/c2patool.zip -d tools/c2patool/
mv tools/c2patool/c2patool/c2patool.exe tools/c2patool/
rm -rf tools/c2patool/c2patool tools/c2patool/c2patool.zip
tools/c2patool/c2patool.exe --version   # should print e.g. c2patool 0.27.1
```

### Install (macOS / Linux)

Grab the matching asset (`c2patool-vX.Y.Z-universal-apple-darwin.zip` or
`-x86_64-unknown-linux-gnu.tar.gz`) from
<https://github.com/contentauth/c2pa-rs/releases> and drop the binary at
`tools/c2patool/c2patool` (no `.exe`).

### Override the resolved path

Set `C2PATOOL_PATH=/absolute/path/to/c2patool` in `.env` if the binary lives
somewhere other than `tools/c2patool/`. Falls through to bare `c2patool` on
PATH as a last resort.

### Why bother with a fallback

`c2pa-node` (npm) trails the C2PA spec — the current release rejects
`c2pa.actions.v2` assertions carrying a `description` field, which every
Google-signed AI image now includes. Reading such a manifest through
`c2pa-node` alone returns an empty manifest set, silently losing provenance
data. c2patool is the reference implementation, updated in lockstep with the
spec, and reads what c2pa-node can't. The extractor prefers c2pa-node for
speed (in-process, no subprocess spawn) and falls back to c2patool only when
that path fails.

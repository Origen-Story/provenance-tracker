# Provenance Tracker

A local web tool that records where the material in a film came from (camera, archive, AI generation, AI enhancement) and signs the finished edit with C2PA Content Credentials that say so, clip by clip.

## What it does

1. **A project is a folder.** Its catalog is one SQLite file inside it (`.provenancetracker/catalog.sqlite`), so the folder can be copied, archived or moved whole. Media folders can be inside it or on other drives.
2. **Records every file** in the media folders by its SHA-256: new files, moves, re-renders (a new version of the same asset) and duplicates.
3. **Reads what each file says**: ExifTool metadata, embedded C2PA manifests, PNG text, `.xmp` and `.c2pa` sidecars, and the generation details of AI platforms (prompt, model, seed).
4. **Classifies each asset** by how it was made (captured, generated, enhanced, composite, ...), from what its file says. Every class a person sets or confirms is kept in the history.
5. **Reads the edit's timeline** (Final Cut Pro XML from Premiere or Resolve), matches each clip to its asset, and works out the film's composition moment by moment.
6. **Signs a new copy of the finished edit**, with every asset it uses as an ingredient, its class, and your creator statement; and signs source files into `.c2pa` sidecars.
7. **Exports a public record** of a signed copy (`<name>.provenance.json`) that the [public viewer](public-viewer/README.md) shows on any web page.

## Quick start

You need Node.js 24 and Git.

```bash
git clone https://github.com/Origen-Story/provenance-tracker.git
cd provenance-tracker
npm ci

# c2patool at its pinned version, checksum-verified (needed to sign and to read credentials)
npm run tools:fetch

# Optional: a throwaway signing certificate, for trying signing out
npm run cert:generate

npm run dev
```

Open [http://localhost:5173](http://localhost:5173). A `.env` file is optional (see Environment).

## How to use

1. **Projects.** Set your name once (every change is recorded under it), then make a new project in a folder, or open a project folder that already has a catalog.
2. **Media.** Add the project's media folders, or add files to one (dropped, chosen or downloaded; they are copied in). **Import** records the files, reads them and classifies them. Run it again after adding or re-rendering files.
3. **Assets.** One list of everything, filtered by kind, class or position. Each asset's page holds its class (set or confirm it), credits, generation details, links to other assets, its files and versions, and what each file said.
4. **Finished edits.** Mark the cut as "A finished edit" on its page (importing a timeline does it too). On its page:
   - **Composition**: import the timeline; check each file is matched to the right asset, and give a clip a class of its own where it needs one. A re-export of the edit is imported again, and clip classes carry over.
   - **Statement**: your words and the film's public title, beside exactly what will be signed.
   - **Signing**: sign a new copy, `<name>.signed.v<N>.<ext>`, beside the cut. The cut itself is never changed.
   - **Export**: the public record of a signed copy, to download.
5. **Settings.** The project's name, its creator and identity link, and the certificate and key that sign it on this machine (kept in this machine's settings, never in the project, so they are entered once per machine).

To update a film: render the new cut **over the same file**, run Import (it becomes a new version of the same finished edit), import the timeline again, check the statement, sign, and export.

### Signing certificates

Signing needs a certificate and its private key, as PEM files. `npm run cert:generate` makes a throwaway pair in `./certs/` for trying it out; for real use, a CA-issued certificate. Enter their full paths on the project's Settings page (or with `npm run cli -- signing`). Signing runs through the bundled `c2patool`, with an optional trusted time stamp from DigiCert.

**About the dev certificate.**

The generator produces a two-step chain (a self-issued root CA + an end-entity signing cert) because c2pa-rs rejects fully self-signed leaves. Signatures from this cert verify cryptographically but won't appear as "trusted publisher" on contentcredentials.org — so the tracker reports them as "Valid, unrecognised issuer". For production use a CA-issued cert.

## Deployment notes

Provenance Tracker is a **local, single-user tool** with no login. What keeps it private is that only your own machine can reach it:

- The server listens on `127.0.0.1` only, and so does the Vite dev server. Another device on the same network cannot connect.
- The API answers only the tracker's own pages. A request whose `Host` is not this machine, whose `Origin` is another page, or that the browser labels cross-site gets a 403. This stops a web page you happen to visit from driving the local API.
- The file preview serves image, video and audio files only, by their hash.

What this does and does not protect is set out in [docs/threat-model.md](docs/threat-model.md). What the tracker sends off your machine (a time-stamp request when signing, and a file you ask it to download) is listed in [docs/network.md](docs/network.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).

For single-user local work, `npm run dev` (development) or `npm start` (production build served from `dist/`) is the intended usage pattern.

**Reaching it from another machine.** Not the intended use, and there is still no login, so you must add one. Put the app behind a reverse proxy that authenticates (nginx with basic auth, Cloudflare Access, Tailscale Serve), serve it over HTTPS, and then:

- Set `HOST` to the address to listen on (`0.0.0.0` for every interface).
- Set `ALLOWED_HOSTS` to the host name people type, for example `tracker.example.net`. Without it every request from outside is refused. It names a host; it is not a password.
- Have the proxy pass the `Host` header through unchanged. The API compares it with `Origin`.

Never expose port 3001 directly to the internet.

## What gets extracted automatically

| Platform       | What's extracted                                                                             | What you'll need to add        |
| -------------- | -------------------------------------------------------------------------------------------- | ------------------------------ |
| **ComfyUI**    | Full prompt, negative prompt, model, seed, steps, CFG, sampler, scheduler, dimensions, LoRAs | Description, generation date   |
| **MidJourney** | Full prompt, model version, seed, stylize, aspect ratio, C2PA timestamp                      | Description                    |
| **Freepik**    | C2PA manifest, digital source type (XMP)                                                     | Prompt, model, generation date |
| **Other**      | EXIF data, file hash, dimensions                                                             | Most fields                    |

Adobe Firefly, ElevenLabs, Topaz Video AI and Topaz Gigapixel files are recognised too; each parser is one module under `packages/core/src/extraction/parsers/`. There is no Meta.ai parser: those files fall under "Other", and a digital source type in their XMP is still read by the classifier.

## Tech stack and layout

Node 24 with its built-in SQLite, TypeScript, Express 5, React 19, TanStack Query, Tailwind 4 and Vite. ExifTool and c2patool read and sign files.

```
packages/core/        # pure logic: the catalog format and its SQL, classification, timelines, manifests (no file access)
packages/core-node/   # what touches the machine: project folders, scanning, reading files, signing, the command line
src/server/           # the local API (/api) over the catalogs
src/client/           # the pages (src/client/catalog/)
public-viewer/        # static page section for a signed film's public record; see its README
spec/                 # the formats others rely on, with their schemas (spec/README.md)
docs/                 # architecture, decisions, threat model, network use
```

```bash
npm run dev              # the server and the pages, reloading on change
npm test                 # the tests, inside the repo guard
npm run lint && npm run typecheck
npm run cli -- help      # the command line (below)
```

## Command line

What the app does to a project, the command line does too, on the same catalog. See [D26](docs/decisions.md) and [D28](docs/decisions.md).

```bash
npm run cli -- settings person "Your Name"              # once per machine: the name your edits are recorded under
npm run cli -- init "D:\Projects\Film" --name "Film"     # a new project
npm run cli -- roots add footage "E:\Footage" --project "D:\Projects\Film"
npm run cli -- roots --project "D:\Projects\Film"        # the roots, and where each is on this machine
npm run cli -- scan --project "D:\Projects\Film"         # record every file: hashes, moves, new versions, duplicates
npm run cli -- extract --project "D:\Projects\Film"      # read what each file says: ExifTool, C2PA, PNG text, .xmp and .c2pa sidecars
npm run cli -- classify --dry-run --project "D:\Projects\Film"  # what each asset is, from what its file said; without --dry-run, record it
npm run cli -- signing --certificate "D:\keys\cert.pem" --key "D:\keys\key.pem"  # which certificate and key sign this project on this machine
npm run cli -- sign 12 --project "D:\Projects\Film"         # sign output 12: a new signed copy beside its file
npm run cli -- verify --hash --project "D:\Projects\Film"  # the catalog is sound and every file's bytes are unchanged
npm run cli -- show "E:\Footage\day 1\clip.mov"             # everything known about one file
```

A rescan reads only files that are new or changed; a moved file keeps everything known about it, and a drive that is not plugged in is skipped, never marked gone. Ctrl+C stops a scan cleanly.

Archiving a project, restoring it, or moving it to another computer: copy the project folder. Its catalog is inside it, in `.provenancetracker\`, and a root inside the project folder is recorded relative to it, so the copy finds those roots wherever it lands. A root outside the project folder (a footage drive, say) is placed per machine, in `%LOCALAPPDATA%\provenancetracker\settings.json` on Windows; on another computer point it at its folder there with `roots locate <name> <folder>`. `init` puts a `.gitignore` in `.provenancetracker\`, so a project folder that is also a git repository leaves the catalog out of git.

A project folder inside OneDrive, Dropbox, Google Drive, iCloud or Syncthing is refused: a sync client can corrupt the catalog while it is being written. Media roots there are allowed, with a warning.

### Moving a project from the old Postgres app

The migration reads the Postgres dumps the backup task writes (a `.dump` with its `.sha256` beside it); it never connects to Postgres and needs no password, only `pg_restore` from the Postgres client tools. Say where each project goes in a layout file kept outside the repository:

```json
{
	"dumps": "D:/backups/postgres",
	"dump": {
		"file": "provenance-tracker_2026-11-21_223001.dump",
		"sha256": "<the SHA-256 in its .sha256 file>"
	},
	"projects": [
		{
			"legacy": "Film",
			"folder": "D:/Projects/Film",
			"roots": {
				"footage": "D:/Projects/Film/footage",
				"archive": "E:/Archive"
			}
		}
	]
}
```

`dump` names the backup of record: the dump whose off-machine copy was restored and matched to its `.sha256`.

```bash
npm run cli -- migrate --dry-run --layout layout.json --report dry-run.json
npm run cli -- migrate --write --layout layout.json --report migrated.json
```

The dry run checks the dump (the one `dump` names, or else the newest) against its `.sha256`, builds each project's catalog in a throwaway folder, and reports: every file Postgres names, found in a root with the bytes Postgres recorded; the catalog check; each timeline's breakdown recomputed from the catalog; each signed output's public export rebuilt byte for byte; technical values read fresh by ExifTool against Postgres's; and a scan of the roots (files Postgres never had are listed). Then it deletes what it built. Project folders, media and this machine's settings are only read. Exit code 0 when everything checked is sound.

`--write` is the real run. It reads only the dump `dump` names, and stops if a newer dump in the folder holds other data (Postgres changed since the backup). It runs the same checks, and only if every check of every project holds, and no project folder has a catalog yet, does it put each catalog in its project folder: its timeline files in `.provenancetracker\timelines\`, then the catalog, then the roots outside the project folder in this machine's settings. It never replaces a catalog, and Postgres is not changed. Then run `scan`, `extract` and `verify --hash` in each project. The app itself has run on the catalogs since D49. See [D33](docs/decisions.md), [D34](docs/decisions.md) and [D35](docs/decisions.md).

## Environment

All optional. Put them in `.env` in the repository root, or in the environment:

| Variable        | Description                                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`          | The server's port (default: 3001)                                                                                                              |
| `HOST`          | Address the server listens on (default: `127.0.0.1`, this machine only). Change it only behind a proxy that adds a login; see Deployment notes |
| `ALLOWED_HOSTS` | Comma-separated host names the API answers to beside `localhost`, for use with `HOST`                                                          |
| `APP_CONTACT`   | Email or URL sent in the User-Agent when the tracker downloads a file you asked for (default: the project's web address)                       |
| `NODE_ENV`      | Set to `production` to serve the built pages from `dist/` (`npm run build`, then `npm start`)                                                  |
| `LOG_LEVEL`     | Server log verbosity: `debug`, `info`, `warn`, `error` (default: `info`)                                                                       |

## License

Licensed under the [Apache License 2.0](LICENSE). Copyright 2026 Origen Story.

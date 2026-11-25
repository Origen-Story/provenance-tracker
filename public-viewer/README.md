# Public viewer

A page section that shows a signed film with how it was made: a strip of the timeline coloured by how much generative AI is in each moment, what is playing now, the creator's statement, every tracked source with its credentials, and how to check the signed file yourself.

It reads one file, the **public export** the tracker writes on an output's **Export** tab (`<name>.provenance.json`, format in [`spec/public-export.v1.schema.json`](../spec/public-export.v1.schema.json)). It needs no server, no build step and no dependencies: three ES modules and one stylesheet.

## Try it

```sh
npx serve public-viewer     # or any static server; ES modules do not load from file://
```

Open the printed address. The demo plays a made-up film (`example/example.provenance.json`) on a clock, with no video. Query options:

| Option          | Effect                                                           |
| --------------- | ---------------------------------------------------------------- |
| `?theme=light`  | light palette, for a light page section                          |
| `?youtube=<id>` | drive the strip from a YouTube video                             |
| `?src=<url>`    | drive it from a video file                                       |
| `?export=<url>` | show another export, such as one you downloaded from the tracker |

`node public-viewer/example/make-example.mjs` regenerates the example through the tracker's real builders.

## Put it on a page

Copy `src/` and `viewer.css` into the site (pin a commit), then:

```html
<link rel="stylesheet" href="/provenance/viewer.css" />
<section id="film"></section>
<script type="module">
	import { mountViewer } from "/provenance/src/viewer.js";
	mountViewer(document.getElementById("film"), {
		exportUrl: "/credentials/my-film.provenance.json",
		video: { youtubeId: "xxxxxxxxxxx" }, // or { src: 'film.mp4', poster: 'still.jpg' }, or leave out
		download: { url: "https://example.com/my-film.signed.v1.mp4" }, // or leave out to use the address the export records
		theme: "dark", // or 'light'
	});
</script>
```

- **Fonts** come from the page: the viewer uses `--font-heading` and `--font-body` when the page defines them (a Tailwind v4 theme does), and falls back to Fraunces and Instrument Sans, which the page has to load itself.
- **Colours** are CSS custom properties on `.ptv`: `--ptv-bg`, `--ptv-text`, `--ptv-heading` and so on, and the six spectrum colours `--pt-origin-captured`, `-digital`, `-assisted`, `-hybrid`, `-synthetic` and `-unknown` (decision D11). Override them on `.ptv` or a parent.
- **YouTube** is loaded from `youtube-nocookie.com` through the IFrame API. YouTube re-encodes uploads and removes Content Credentials, so the page says so and links the signed file; the YouTube copy is for watching, the signed file is the proof.
- **The signed file** needs a host that serves large files: a GitHub release asset (up to 2 GB) or object storage such as Cloudflare R2. After uploading, download it once and compare its SHA-256 with `signedFile.sha256` in the export: the page tells visitors to do the same.

## What it trusts

Everything shown comes from the export file. The viewer sets text only as text (never `innerHTML`), so an export cannot inject markup or scripts. The only links it makes are the ones the page passes in, the IPTC source-type URIs in the export, Content Credentials Verify, and the signed file's and page's addresses an export records, used only when they are whole https addresses (`safeLink` in `model.js`). The export records how the signature read back when the tracker signed the file; the viewer does not check the signature itself. Visitors check it with the download, the hash and an independent reader.

**Checking a copy (D58).** Under "Check it yourself", a visitor can pick a copy of the film from their own device. The viewer reads it a slice at a time, works out its SHA-256 with its own code (`src/sha256.js`; the browser's built-in hash wants the whole file in memory at once), and compares it with the record's. The file is read on the visitor's device and never uploaded, and a copy of another size is answered at once. A match says the copy is the file this record describes, byte for byte. It does not make the record true: a record someone else made could carry the fingerprint of any file. So it is worth as much as the place the record came from, normally the creator's own page. The signed 354 MB demo film took about 3 seconds in a desktop browser.

**Formats.** The viewer reads export formats 1 and 2. Format 2 (D57) shows what the signature says as separate results, never one badge: the film (did its content match what was signed), the signer (whether a reader recognises the certificate, and who issued the time stamp), and the creator's identity when the file carries one, marked self-declared when no recognised issuer vouches for it. Each result says its tone in words as well as colour. A format 1 record has one signature block and no identity, so the viewer shows the film and the signer and says nothing about an identity. A viewer older than format 2 refuses a format 2 export with "This viewer reads export format 1, not 2": update a site's copy of `src/` before publishing a format 2 export ([docs/publishing.md](../docs/publishing.md)).

## Files

| File             |                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/model.js`   | pure: sections, shares, the plain-language sentences, the verdict wording. Tested in `test/unit/public-viewer/` |
| `src/sha256.js`  | pure: SHA-256 a piece at a time, for checking a copy a visitor picks (D58). Tested against Node's own hash      |
| `src/players.js` | adapters for a `<video>`, a YouTube embed, and a clock with no video                                            |
| `src/viewer.js`  | builds the page section                                                                                         |
| `viewer.css`     | all styles, scoped under `.ptv`                                                                                 |
| `index.html`     | the demo                                                                                                        |
| `example/`       | the made-up export and the script that makes it                                                                 |

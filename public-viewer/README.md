# Public viewer

A page section that shows a signed film with how it was made: a strip of the timeline coloured by how much generative AI is in each moment, what is playing now, the creator's statement, every tracked source with its credentials, and how to check the signed file yourself.

It reads one file, the **public export** the tracker writes on an output's **Export** tab (`<name>.provenance.json`, format in [`schemas/public-export.v1.schema.json`](../schemas/public-export.v1.schema.json)). It needs no server, no build step and no dependencies: three ES modules and one stylesheet.

## Try it

```sh
npx serve public-viewer     # or any static server; ES modules do not load from file://
```

Open the printed address. The demo plays a made-up film (`example/example.provenance.json`) on a clock, with no video. Query options:

| Option | Effect |
|---|---|
| `?theme=light` | light palette, for a light page section |
| `?youtube=<id>` | drive the strip from a YouTube video |
| `?src=<url>` | drive it from a video file |
| `?export=<url>` | show another export, such as one you downloaded from the tracker |

`node public-viewer/example/make-example.mjs` regenerates the example through the tracker's real builders.

## Put it on a page

Copy `src/` and `viewer.css` into the site (pin a commit), then:

```html
<link rel="stylesheet" href="/provenance/viewer.css">
<section id="film"></section>
<script type="module">
  import { mountViewer } from '/provenance/src/viewer.js';
  mountViewer(document.getElementById('film'), {
    exportUrl: '/credentials/my-film.provenance.json',
    video: { youtubeId: 'xxxxxxxxxxx' },          // or { src: 'film.mp4', poster: 'still.jpg' }, or leave out
    download: { url: 'https://example.com/my-film.signed.v1.mp4' },
    theme: 'dark'                                  // or 'light'
  });
</script>
```

- **Fonts** come from the page: the viewer uses `--font-heading` and `--font-body` when the page defines them (a Tailwind v4 theme does), and falls back to Fraunces and Instrument Sans, which the page has to load itself.
- **Colours** are CSS custom properties on `.ptv`: `--ptv-bg`, `--ptv-text`, `--ptv-heading` and so on, and the six spectrum colours `--pt-origin-captured`, `-digital`, `-assisted`, `-hybrid`, `-synthetic` and `-unknown` (decision D11). Override them on `.ptv` or a parent.
- **YouTube** is loaded from `youtube-nocookie.com` through the IFrame API. YouTube re-encodes uploads and removes Content Credentials, so the page says so and links the signed file; the YouTube copy is for watching, the signed file is the proof.
- **The signed file** needs a host that serves large files: a GitHub release asset (up to 2 GB) or object storage such as Cloudflare R2. After uploading, download it once and compare its SHA-256 with `signedFile.sha256` in the export: the page tells visitors to do the same.

## What it trusts

Everything shown comes from the export file. The viewer sets text only as text (never `innerHTML`), so an export cannot inject markup or scripts; the only links it makes are the ones the page passes in, the IPTC source-type URIs in the export, and Content Credentials Verify. The export records how the signature read back when the tracker signed the file; the viewer does not check the signature itself. Visitors check it with the download, the hash and an independent reader.

## Files

| File | |
|---|---|
| `src/model.js` | pure: sections, shares, the plain-language sentences, the verdict wording. Tested in `test/unit/public-viewer/` |
| `src/players.js` | adapters for a `<video>`, a YouTube embed, and a clock with no video |
| `src/viewer.js` | builds the page section |
| `viewer.css` | all styles, scoped under `.ptv` |
| `index.html` | the demo |
| `example/` | the made-up export and the script that makes it |

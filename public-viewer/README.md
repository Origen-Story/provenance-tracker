# Public viewer

A page section that shows a signed film with how it was made: a strip of the timeline coloured by how much generative AI is in each moment, what is playing now, the creator's statement, every tracked source with its credentials, and how to check the signed file yourself.

It reads one file, the **public export** the tracker writes on an output's **Export** tab (`<name>.provenance.json`, format 3 in [`spec/public-export.v3.schema.json`](../spec/public-export.v3.schema.json); formats 1 and 2, which it also reads, beside it). It needs no build step and no dependencies: five ES modules and one stylesheet, served by any static server.

## Try it

```sh
npx serve public-viewer     # or any static server; ES modules do not load from file://
```

Open the printed address. The demo plays a made-up film (`example/example.provenance.json`) on a clock, with no video. `index.html` is a demo for a local server, not a page to host as it is: it takes a video and an export only from its own address, so a link to it cannot show someone else's record there (D71). Query options:

| Option          | Effect                                                      |
| --------------- | ----------------------------------------------------------- |
| `?theme=light`  | light palette, for a light page section                     |
| `?youtube=<id>` | drive the strip from a YouTube video                        |
| `?src=<url>`    | drive it from a video file served from the same address     |
| `?export=<url>` | show another export, put beside the demo and served with it |

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

Everything shown comes from the export file. The viewer sets text only as text (never `innerHTML`), so an export cannot inject markup or scripts. Its numbers, lists and kinds of material are checked once, on load, and an export that fails is refused with a sentence (`assertViewable` in `model.js`). Every link is checked before it is made: the ones the page passes in (https, or the page's own origin), a source type only when it is an IPTC vocabulary address, Content Credentials Verify, and the signed file's and page's addresses an export records, used only when they are whole https addresses (`pageLink`, `sourceTypeLink` and `safeLink` in `model.js`). The commands a visitor is told to paste carry the export's file name only when it is a plain one. The export records how the signature read back when the tracker signed the file; the viewer does not check the signature itself, and words those three results as what the record says, never as its own findings (D71). Visitors check it with the download, the hash and an independent reader.

**Checking a copy (D58).** Under "Check it yourself", a visitor can pick a copy of the film from their own device. The viewer reads it a slice at a time, works out its SHA-256 with its own code (`src/sha256.js`; the browser's built-in hash wants the whole file in memory at once), and compares it with the record's. The file is read on the visitor's device and never uploaded, and a copy of another size is answered at once. A match says the copy is the file this record describes, byte for byte. It does not make the record true: a record someone else made could carry the fingerprint of any file. So it is worth as much as the place the record came from, normally the creator's own page. The signed 354 MB demo film took about 3 seconds in a desktop browser.

**Reading the credentials inside a copy (D61, optional).** A page can also have the viewer read the Content Credentials inside the copy a visitor picks, independently of this record, by passing `readCredentials`: a function that takes the file and returns a C2PA reader's report, or `null` when the file has none. The viewer has no build step, so it does not bundle a C2PA reader itself; a site that has a bundler builds one with [`@contentauth/c2pa-web`](https://www.npmjs.com/package/@contentauth/c2pa-web) and passes it in. The viewer then shows a second card, "Its Content Credentials": signed by whom, whether the content is unchanged, whether the signer is on the trust list, and whether it is the signer this record names. It reads the report the way the tracker reads its own: content first, then the signature, then trust, with the identity's codes left out of the result.

```js
import { createC2pa, Reader, Context } from "@contentauth/c2pa-web";
import wasmSrc from "@contentauth/c2pa-web/resources/c2pa.wasm?url";

const c2pa = await createC2pa({ wasmSrc }); // the site serves the 9 MB .wasm itself
const trust = new Context({
	verify: { verifyTrust: true },
	// The C2PA trust list, hosted by the site (npm run tools:fetch puts a pinned copy in tools/trust-lists/).
	trust: { trustAnchors: await (await fetch("/C2PA-TRUST-LIST.pem")).text() },
});
mountViewer(element, {
	exportUrl: "/credentials/my-film.provenance.json",
	readCredentials: async (file) => {
		const reader = await Reader.fromBlob(
			c2pa,
			file.type || "video/mp4",
			file,
			trust,
		);
		if (!reader) return null;
		try {
			return await reader.json();
		} finally {
			await reader.free();
		}
	},
});
```

In a desktop browser, c2pa-web 0.16.1 read the signed 354 MB demo film in about 2 seconds and gave the tracker's own verdict. A phone is untested. Take the newest c2pa-web release at least 14 days old, as the tracker does with its own dependencies.

**Comparing the certificate (D72).** A format 3 record names the certificate the film was signed with, by its SHA-256 fingerprint. When the page has a reader (`readCredentials`, above) and that reader says the copy's signature validated, the viewer finds the copy's signing certificate with its own code (`src/certificate.js`: MP4, MOV, WAV, PNG and `.c2pa`, read a piece at a time) and compares fingerprints, for the manifest the reader judged. The card then says the copy was signed with the certificate the record names, or with another one, whatever name it carries. A name, an issuer and a serial number can be put into any certificate, which is all a browser reader reports; a fingerprint cannot. The viewer stops, and says the certificates were not compared, whenever a file could be read two ways. Without a reader nothing is compared: a certificate is public, and finding it in a file whose signature nobody checked would show nothing.

**Formats.** The viewer reads export formats 1 to 3. Format 3 (D72) is format 2 with the signing certificate's fingerprint. Format 2 (D57) shows what the signature says as separate results, never one badge: the film (did its content match what was signed), the signer (whether a reader recognises the certificate, and who issued the time stamp), and the creator's identity when the file carries one, marked self-declared when no recognised issuer vouches for it. Each result says its tone in words as well as colour. A format 1 record has one signature block and no identity, so the viewer shows the film and the signer and says nothing about an identity. A viewer older than format 2 refuses a format 2 export with "This viewer reads export format 1, not 2": update a site's copy of `src/` before publishing a format 2 export ([docs/publishing.md](../docs/publishing.md)).

## Files

| File                 |                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/model.js`       | pure: sections, shares, the plain-language sentences, the verdict wording. Tested in `test/unit/public-viewer/`                                    |
| `src/sha256.js`      | pure: SHA-256 a piece at a time, for checking a copy a visitor picks (D58). Tested against Node's own hash                                         |
| `src/certificate.js` | finds the signing certificate inside a copy, to compare its fingerprint with the record's (D72). Tested against files signed with the real library |
| `src/players.js`     | adapters for a `<video>`, a YouTube embed, and a clock with no video                                                                               |
| `src/viewer.js`      | builds the page section                                                                                                                            |
| `viewer.css`         | all styles, scoped under `.ptv`                                                                                                                    |
| `index.html`         | the demo, for a local server; it takes files only from its own address                                                                             |
| `example/`           | the made-up export and the script that makes it                                                                                                    |

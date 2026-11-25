# Publishing a signed film

How a signed film and its public record reach an audience, and stay checkable. Platforms re-encode uploads and usually drop Content Credentials, so the copy most people watch carries none. What connects that copy to the record is a link: the page link in the video's description, the page, and the signed file you host beside it (roadmap, "Stripping survival", rung 1).

## The checklist

1. **Sign the finished edit** on its Signing tab (or `npm run cli -- sign <asset id>`). The signed copy is a new file beside the cut, `<name>.signed.v<N>.<ext>`; the cut is never changed.
2. **Host the signed file** somewhere that serves large files as they are, without re-encoding: object storage such as Cloudflare R2, or a GitHub release asset (up to 2 GB). Not a video platform.
3. **Download it once from where you host it, and compare its SHA-256** with the one on the Export tab (`signedFile.sha256` in the export). If they differ, the host changed the file: host it somewhere else.
4. **Record where it is.** On the Export tab, under "Where v<N> is published", enter the signed file's address and the page's, or use `npm run cli -- publish <asset id> --file <url> --page <url>`. Both are https only. The tracker keeps them with history (D56) and never opens them.
5. **Update the website's copy of the viewer before publishing a new export format.** A page keeps its own copy of `public-viewer/` (pinned to a commit), and an older viewer refuses a newer export with "This viewer reads export format 1, not 2". Copy the new `src/` and `viewer.css` first, then the export.
6. **Download the export** from the Export tab and put it on the page with the viewer (`public-viewer/README.md`, "Put it on a page"). Visitors can then check a copy they have against it on the page itself, under "Check it yourself"; the file stays on their device. A site with a bundler can also let the viewer read the credentials inside that copy (`readCredentials`, in `public-viewer/README.md`).
7. **Put the page link in the video's description** on every platform the film goes to. It is the main route from a platform copy back to the record.

When a copy is taken down, empty its address on the Export tab. The history keeps where it was.

## What platforms do with the credentials

California's AI Transparency Act, as amended by AB 853, requires large online platforms (over 2 million monthly users) to detect C2PA-style provenance in what is uploaded, show whether it was AI-generated or captured, let users inspect it, and not knowingly strip it where that's technically feasible, from 1 January 2027. What platforms actually keep and show is worth testing rather than assuming, once before that date and again after it.

The test: upload one signed film to each platform, download or inspect what the platform serves, and record whether the credential survived and what the platform showed. Record the platform's name, not the film's or the production's.

| Date | Platform | Credential kept? | What the platform showed | How it was checked |
| ---- | -------- | ---------------- | ------------------------ | ------------------ |
|      |          |                  |                          |                    |

# Network statement

Exactly what the tracker sends off your machine, and when. Written from a read of the source after the app moved onto the project catalogs (D49); each row names the code so it can be checked. The companion document is [threat-model.md](threat-model.md).

The short version: **nothing leaves the machine unless you use one of the two features below.** There is no telemetry, no analytics, no update check and no account.

## What listens

| Port | Program                                         | Reachable from                                         |
| ---- | ----------------------------------------------- | ------------------------------------------------------ |
| 3001 | The API (and the built app, in production mode) | This machine only (`127.0.0.1`), unless you set `HOST` |
| 5173 | The Vite dev server, in development             | This machine only                                      |

## What goes out

| When                                                                                                                                                                                                                                                        | Where                                                                             | What is sent                                                                                                                                                                                                                                                                                                                                                                  | Code                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| You sign a file with "Add a trusted time stamp" ticked (the default)                                                                                                                                                                                        | `http://timestamp.digicert.com`, a public time-stamp authority                    | A hash of the signature, so the authority can attest when it existed. Not the file, its name or your statement. The request is made by `c2patool`, over plain HTTP as the time-stamp protocol (RFC 3161) allows; the reply is itself signed. Untick the box to sign with no network use                                                                                       | `TIMESTAMP_URL` in `packages/core-node/src/sign/sign-output.ts`; the API takes only yes or no (D46). The command line's `sign --timestamp <url>` names a server the person types |
| You add a file by its address on the Media page                                                                                                                                                                                                             | The address you typed, and any public address it redirects to                     | A download request with a User-Agent naming the tracker and the contact in `APP_CONTACT`. Only public addresses are fetched, checked again on every redirect; only pictures, video and sound are kept                                                                                                                                                                         | `src/server/api/download.ts`, `src/server/lib/core/public-url.ts`, `src/server/lib/user-agent.js`                                                                                |
| A file says its Content Credentials are stored on the web instead of inside it (Adobe Firefly video does this), when `extract` reads it; and, until signing moves to the C2PA library, when c2patool reads such a file as an ingredient of an edit you sign | The address the file gives, such as `https://cai-manifests.adobe.com/manifests/…` | A request for that manifest. Its address names the manifest, which identifies the file, and the server sees your machine's address. What comes back is kept with the reading in the catalog, so a file is fetched once per reader version. Turn it off with `npm run cli -- settings remote-credentials off`: such a file then reads as unreadable, with the address it gives | `packages/core-node/src/extract/c2pa-library.ts`, the setting in `packages/core-node/src/settings.ts` (D51); c2patool when signing                                               |

Nothing runs in the background: the server makes no requests of its own.

## What stays local

Scanning and importing, metadata extraction (ExifTool), reading credentials (the C2PA library, against the pinned trust lists on disk), classification, timeline import and matching, building the manifest, signing itself, and building the public export all run on your machine. The app's pages load no fonts, scripts or images from other sites.

## Not measured yet

Stated so nobody has to take the table above on trust further than it has been checked.

- **A correction (24 Nov 2026):** some files keep their Content Credentials on the web and carry only an address for them; Adobe Firefly's videos point to `cai-manifests.adobe.com`. Until D51, `c2patool` fetched such a manifest whenever it read the file, at `extract` and, for ingredients, while signing, and this statement did not say so. The request names the manifest, which identifies the file, and comes from your machine's address. It was found by checking the bytes of a Firefly video that `c2patool` had read in full: it contains no manifest, only the address.
- A C2PA reader may also check a certificate's revocation online (OCSP), and could fetch a trust list given to it as an address. The C2PA library that now reads files does neither: OCSP is off, the trust lists are given to it as text, and it is handed a fetch function that refuses every request it would make for a trust list (`packages/core-node/src/extract/c2pa-library.ts`, D51). Credentials stored on the web, in the table above, are the one thing it fetches. That is from its settings and code, not yet from watching the network.
- This statement comes from reading the code, not from a packet capture.

## The public viewer is a separate thing

`public-viewer/` is a web page you host for your audience. It is not part of the local tool and sends nothing from your machine. A visitor's browser, on that page, loads fonts from Google Fonts, loads YouTube's player script and plays through `youtube-nocookie.com` if you embed a YouTube video, and offers a link to `contentcredentials.org/verify`. See `public-viewer/README.md`.

## Development

`npm install` downloads packages from the npm registry. The C2PA library's install script also downloads its native binary from `github.com`, unchecked, unless `SKIP_RUST_BUILD=1` is set (CI sets it); the tracker never loads that copy. `npm run tools:fetch` downloads each pinned helper program and the C2PA library's native binary from `github.com` release pages, and the C2PA trust lists from `raw.githubusercontent.com` at a pinned commit, and checks each against a recorded SHA-256; it sends nothing but the request for that file. Tests use no network. CI and Renovate run on GitHub, not on your machine.

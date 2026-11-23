# Network statement

Exactly what the tracker sends off your machine, and when. Written from a read of the source after the app moved onto the project catalogs (D49); each row names the code so it can be checked. The companion document is [threat-model.md](threat-model.md).

The short version: **nothing leaves the machine unless you use one of the two features below.** There is no telemetry, no analytics, no update check and no account.

## What listens

| Port | Program                                         | Reachable from                                         |
| ---- | ----------------------------------------------- | ------------------------------------------------------ |
| 3001 | The API (and the built app, in production mode) | This machine only (`127.0.0.1`), unless you set `HOST` |
| 5173 | The Vite dev server, in development             | This machine only                                      |

## What goes out

| When                                                                 | Where                                                          | What is sent                                                                                                                                                                                                                                                                            | Code                                                                                                                                                                             |
| -------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| You sign a file with "Add a trusted time stamp" ticked (the default) | `http://timestamp.digicert.com`, a public time-stamp authority | A hash of the signature, so the authority can attest when it existed. Not the file, its name or your statement. The request is made by `c2patool`, over plain HTTP as the time-stamp protocol (RFC 3161) allows; the reply is itself signed. Untick the box to sign with no network use | `TIMESTAMP_URL` in `packages/core-node/src/sign/sign-output.ts`; the API takes only yes or no (D46). The command line's `sign --timestamp <url>` names a server the person types |
| You add a file by its address on the Media page                      | The address you typed, and any public address it redirects to  | A download request with a User-Agent naming the tracker and the contact in `APP_CONTACT`. Only public addresses are fetched, checked again on every redirect; only pictures, video and sound are kept                                                                                   | `src/server/api/download.ts`, `src/server/lib/core/public-url.ts`, `src/server/lib/user-agent.js`                                                                                |

Nothing runs in the background: the server makes no requests of its own.

## What stays local

Scanning and importing, metadata extraction (ExifTool), reading credentials (c2patool), classification, timeline import and matching, building the manifest, signing itself, and building the public export all run on your machine. The app's pages load no fonts, scripts or images from other sites.

## Not measured yet

Stated so nobody has to take the table above on trust further than it has been checked.

- The C2PA reader may fetch a manifest from the web when a file's metadata points to one stored remotely instead of inside the file. Whether `c2patool` does so with the options the tracker uses has not been measured. It will be, with the network watched, when the signing engine is reworked.
- This statement comes from reading the code, not from a packet capture.

## The public viewer is a separate thing

`public-viewer/` is a web page you host for your audience. It is not part of the local tool and sends nothing from your machine. A visitor's browser, on that page, loads fonts from Google Fonts, loads YouTube's player script and plays through `youtube-nocookie.com` if you embed a YouTube video, and offers a link to `contentcredentials.org/verify`. See `public-viewer/README.md`.

## Development

`npm install` downloads packages from the npm registry. `npm run tools:fetch` downloads each pinned helper program (today c2patool) from `github.com` release pages and checks it against a recorded SHA-256; it sends nothing but the request for that file. Tests use no network. CI and Renovate run on GitHub, not on your machine.

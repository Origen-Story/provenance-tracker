# @provenancetracker/core

The pure logic of Provenance Tracker: the origin vocabulary and classifier, platform parsers, timeline formats, matching and composition, the C2PA manifest builder and the public export.

No HTTP, no database, no file access: every function takes data and returns data, so each is tested on its own (`test/`). The app (`src/` at the repository root) does the reading and writing and calls into this package. A lint rule stops this package from importing the app.

Not published to npm yet (docs/decisions.md D20, D24); the app uses it from the repository through npm workspaces.

## Adding a platform parser

One module in `src/extraction/parsers/`, registered in `src/extraction/parsers/index.js`, with a fixture and a test in `test/extraction/parsers/`.

# @provenancetracker/core

The pure logic of Provenance Tracker: the origin vocabulary and classifier, platform parsers, timeline formats, matching and composition, the C2PA manifest builder and the public export.

No HTTP and no file access: every function takes data and returns data, so each is tested on its own (`test/`). The catalog's own logic is here too (`src/catalog/`): the format's SQL, upgrades, reading, edits with history. It runs SQL on a database it is handed and never opens one; opening a catalog file, like everything else that touches the machine, is `@provenancetracker/core-node`. The app (`src/` at the repository root) calls into both. Lint rules stop this package from importing the app or reaching the file system.

Not published to npm yet: that waits for a first outside adopter (docs/decisions.md D78). The app uses it from the repository through npm workspaces.

## Adding a platform parser

One module in `src/extraction/parsers/`, registered in `src/extraction/parsers/index.js`, with a fixture and a test in `test/extraction/parsers/`.

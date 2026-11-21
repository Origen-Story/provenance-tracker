# spec/

The formats that other people's software relies on. Each has a version number, each version has its own schema file, and an older version's file stays here after a newer one arrives, so anything written in that version can still be read and checked.

| Format                                                                                                                   | Version | Schema                                                                 | Written by                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------ | ------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Creator statement: the data of the C2PA assertion `org.provenancetracker.creator_statement`, signed into a finished film | 3       | [`creator-statement.v3.schema.json`](creator-statement.v3.schema.json) | `buildCreatorStatement` in [`packages/core/src/manifest/build.js`](../packages/core/src/manifest/build.js)             |
| Public export: `<name>.provenance.json`, what the public viewer reads                                                    | 1       | [`public-export.v1.schema.json`](public-export.v1.schema.json)         | `buildPublicExport` in [`packages/core/src/manifest/public-export.js`](../packages/core/src/manifest/public-export.js) |

The origin classes used in both are IPTC Digital Source Type codes or `unknown`; their definitions and colours are in [`docs/vocabulary.md`](../docs/vocabulary.md).

## How the schemas are kept true

Tests build each format from fixtures and validate it against its schema, which forbids fields it does not describe (`additionalProperties: false`), so a builder and its schema cannot drift apart without a failing test. The statements signed into the project's own films were also checked against the creator statement schema when it was written (docs/decisions.md D25).

## Changing a format

A change that a reader of the current version could misread (a field removed, renamed or given a new meaning) is a new version: bump the version constant in the builder, add a new schema file, and leave the old one. Adding an optional field is not a new version.

## Addresses

The label `org.provenancetracker.creator_statement` is the reverse of `provenancetracker.org`, a domain the project holds (D5, D18). Each schema's `$id` is its GitHub address until that domain serves the schemas at stable addresses.

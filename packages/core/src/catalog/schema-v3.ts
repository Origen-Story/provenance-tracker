// The catalog's SQL, format 3 (D75): format 2 plus who saved a statement, an
// identifier for a credited person, a file's path folded for search, and the
// identity link held to https by the catalog itself.
// spec/catalog/catalog.v3.sql is a copy of CATALOG_V3_SQL, written by `npm run
// catalog:write` and checked by the tests.
//
// Format 3 is released (CATALOG_FORMAT_STATUS in format.ts): from the day it
// reaches main, opening a format 2 catalog upgrades it, so this text never
// changes. A change becomes format 4, with an upgrade step of its own.
//
// A new catalog and an upgraded one must be the same, down to the text SQLite
// keeps for each table (schema-check.ts refuses a catalog whose schema is
// worded any other way, D68). So format 3 only adds: CATALOG_V3_SQL is format
// 2's text with the step's statements before the closing pragmas, and a new
// catalog runs the very ALTER TABLE statements an upgraded one ran.

import type { DatabaseSync } from "node:sqlite";
import { foldForSearch } from "./fields.ts";
import { CATALOG_V2_SQL } from "./schema-v2.ts";

/** What format 3 adds. Run inside the upgrade's transaction. */
export const FORMAT_3_SQL = `-- Format 3 (D75). Columns are added, never reworded, so a catalog made new
-- and one upgraded from format 2 hold the same text for every table.

-- Who saved a statement: the words that get signed. The person's name (or
-- the tool's, with its version) and which of the two, as history records an
-- actor. Both empty on a statement saved before format 3: nobody recorded it.
ALTER TABLE statements ADD COLUMN saved_by TEXT NOT NULL DEFAULT '';
ALTER TABLE statements ADD COLUMN saved_by_kind TEXT NOT NULL DEFAULT '' CHECK (
	saved_by_kind IN ('', 'person', 'tool', 'legacy') AND (saved_by = '') = (saved_by_kind = '')
);

-- An identifier for who is credited, beside the name: the identifier itself
-- and the scheme it belongs to ("orcid", "isni", "wikidata", "url"). The
-- scheme is text, not a fixed list, so a new one needs no new format. An
-- identifier always has its scheme. Both are editable, with history
-- (packages/core/src/catalog/fields.ts).
ALTER TABLE credits ADD COLUMN identifier_scheme TEXT NOT NULL DEFAULT '';
ALTER TABLE credits ADD COLUMN identifier TEXT NOT NULL DEFAULT '' CHECK (
	identifier = '' OR identifier_scheme <> ''
);

-- A file's path with accents removed and lower-cased, as the other *_folded
-- columns are, so a search for "pena" finds Peña.jpg. Written with the path
-- by whatever records the place; SQLite cannot fold accents itself.
ALTER TABLE locations ADD COLUMN path_folded TEXT NOT NULL DEFAULT '';

-- The identity link (the project setting cawg_identity_url) is signed into
-- every file as where the creator's identity is published. It is an https
-- address or empty, whoever writes it.
CREATE TRIGGER meta_identity_link_set BEFORE INSERT ON meta
WHEN new.key = 'cawg_identity_url' AND new.value <> '' AND new.value NOT GLOB 'https://?*'
BEGIN
	SELECT RAISE(ABORT, 'the identity link is a web address starting https://, or empty');
END;

CREATE TRIGGER meta_identity_link_changed BEFORE UPDATE ON meta
WHEN new.key = 'cawg_identity_url' AND new.value <> '' AND new.value NOT GLOB 'https://?*'
BEGIN
	SELECT RAISE(ABORT, 'the identity link is a web address starting https://, or empty');
END;

`;

/** Format 2 to format 3: the additions, then the format number. */
export const UPGRADE_2_TO_3_SQL = `${FORMAT_3_SQL}PRAGMA user_version = 3;\n`;

/**
 * The part of the step SQL cannot do: give every place a file already has
 * its folded path. Run in the same transaction as the step's SQL. A new
 * catalog has no places yet.
 */
export function fillFoldedPaths(db: DatabaseSync): void {
	const rows = db.prepare("SELECT id, path FROM locations").all() as Array<{
		id: number;
		path: string;
	}>;
	const set = db.prepare("UPDATE locations SET path_folded = ? WHERE id = ?");
	for (const row of rows) set.run(foldForSearch(row.path), row.id);
}

function replaceOnce(text: string, from: string, to: string): string {
	const at = text.indexOf(from);
	if (at < 0 || text.indexOf(from, at + 1) >= 0)
		throw new Error(`Format 2's SQL no longer reads as expected: ${from}`);
	return text.slice(0, at) + to + text.slice(at + from.length);
}

export const CATALOG_V3_SQL = [
	[
		"-- Provenance Tracker catalog, format 2.\n",
		"-- Provenance Tracker catalog, format 3.\n",
	],
	[
		"PRAGMA application_id = 1349932146;\nPRAGMA user_version = 2;\n",
		`${FORMAT_3_SQL}PRAGMA application_id = 1349932146;\nPRAGMA user_version = 3;\n`,
	],
].reduce((sql, [from, to]) => replaceOnce(sql, from, to), CATALOG_V2_SQL);

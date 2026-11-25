// The catalog's SQL, format 2 (D56): format 1 plus where a signed copy is
// published. spec/catalog/catalog.v2.sql is a copy of CATALOG_V2_SQL, written
// by `npm run catalog:write` and checked by the tests.
//
// Format 2 is released (CATALOG_FORMAT_STATUS in format.ts): from the day it
// reaches main, opening a format 1 catalog upgrades it, so this text never
// changes. A change becomes format 3, with an upgrade step of its own.
//
// A new catalog and an upgraded one must be the same: CATALOG_V2_SQL is
// format 1's text with the step's tables added before the closing pragmas,
// and the tests compare the schema a new catalog gets with what format 1's
// sample becomes after the upgrade.

import { CATALOG_V1_SQL } from "./schema-v1.ts";

/** The tables format 2 adds. Run inside the upgrade's transaction. */
export const PUBLICATIONS_SQL = `-- Where a signed copy is published (format 2, D56). One row per signing that
-- has been published: the web address of the signed file, the page that shows
-- it, and what its public export leaves out. Both addresses are https only,
-- or empty. A row is never deleted: emptying both addresses says the copy is
-- no longer published, and history keeps where it was. The signing a row
-- belongs to never changes. Its editable fields are listed in
-- packages/core/src/catalog/fields.ts.
CREATE TABLE publications (
	id INTEGER PRIMARY KEY,
	signature_id INTEGER NOT NULL UNIQUE REFERENCES signatures (id),
	file_url TEXT NOT NULL DEFAULT '' CHECK (file_url = '' OR file_url GLOB 'https://?*'),
	page_url TEXT NOT NULL DEFAULT '' CHECK (page_url = '' OR page_url GLOB 'https://?*'),
	-- What the public export leaves out (Phase 8 step 5): a JSON array of
	-- names such as "ingredient.note" or "ingredient.note:ing-3".
	withheld TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(withheld) AND json_type(withheld) = 'array'),
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
) STRICT;

CREATE TRIGGER publications_signing_fixed BEFORE UPDATE OF signature_id ON publications
WHEN new.signature_id IS NOT old.signature_id
BEGIN
	SELECT RAISE(ABORT, 'a publication always belongs to the signing it was made for');
END;

CREATE TRIGGER publications_kept BEFORE DELETE ON publications
BEGIN
	SELECT RAISE(ABORT, 'a publication is never deleted; empty its addresses instead');
END;

`;

/** Format 1 to format 2: the new table, then the format number. */
export const UPGRADE_1_TO_2_SQL = `${PUBLICATIONS_SQL}PRAGMA user_version = 2;\n`;

function replaceOnce(text: string, from: string, to: string): string {
	const at = text.indexOf(from);
	if (at < 0 || text.indexOf(from, at + 1) >= 0)
		throw new Error(`Format 1's SQL no longer reads as expected: ${from}`);
	return text.slice(0, at) + to + text.slice(at + from.length);
}

export const CATALOG_V2_SQL = [
	[
		"-- Provenance Tracker catalog, format 1.\n",
		"-- Provenance Tracker catalog, format 2.\n",
	],
	[
		"locations, relationships, timelines) are ordinary rows;",
		"locations, relationships, timelines, publications) are ordinary rows;",
	],
	[
		"PRAGMA application_id = 1349932146;\nPRAGMA user_version = 1;\n",
		`${PUBLICATIONS_SQL}PRAGMA application_id = 1349932146;\nPRAGMA user_version = 2;\n`,
	],
].reduce((sql, [from, to]) => replaceOnce(sql, from, to), CATALOG_V1_SQL);

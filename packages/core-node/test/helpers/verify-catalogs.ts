// The catalog check after every test that touches a disk (roadmap: the
// history check "runs in every catalog test"). Core's own tests get it from
// catalogsForTests(); these are the tests that make real project folders:
// core-node's, and the API's and the pages' over HTTP. After each test,
// every catalog left under the test's temp folders is opened read-only and
// held to verifyCatalog, so an edit that reached a row without its history
// entry, or a place written without its folded path, fails the test that
// made it, whatever the test was about.
//
// A catalog the tracker itself would refuse is not checked: one of another
// format (a backup from before an upgrade, a made-up newer one), or one whose
// structure is not its format's (a test that tampers on purpose).

import { expect } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
	inspectCatalog,
	prepareConnection,
} from "@provenancetracker/core/catalog/format.ts";
import { verifyCatalog } from "@provenancetracker/core/catalog/verify.ts";
import { structureRefusal } from "../../src/catalog-file.ts";

/** Every catalog file under a folder: a project's own, and its backups. */
export function catalogsUnder(dir: string, depth = 8): string[] {
	if (depth < 0 || !existsSync(dir)) return [];
	const found: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules") continue;
			found.push(...catalogsUnder(full, depth - 1));
		} else if (
			entry.isFile() &&
			entry.name.endsWith(".sqlite") &&
			full.split(path.sep).includes(".provenancetracker")
		)
			found.push(full);
	}
	return found;
}

/**
 * Hold every current catalog under these folders to verifyCatalog.
 * @param except catalog files a test changed around the edit functions on
 *   purpose (it says so by naming them)
 */
export function expectSoundCatalogs(
	dirs: readonly string[],
	except: ReadonlySet<string> = new Set(),
): void {
	for (const dir of dirs)
		for (const file of catalogsUnder(dir)) {
			if (except.has(path.resolve(file))) continue;
			let db: DatabaseSync;
			try {
				db = new DatabaseSync(file, { readOnly: true });
			} catch {
				continue; // not a database at all: a test wrote it so
			}
			try {
				prepareConnection(db);
				const state = inspectCatalog(db);
				if (state.state !== "current") continue;
				if (structureRefusal(db, state.format)) continue;
				expect(verifyCatalog(db), `verifyCatalog on ${file}`).toEqual([]);
			} catch (err) {
				// A file that is not readable as a catalog is one a test made that
				// way; an assertion is the check itself.
				if ((err as Error).name === "AssertionError") throw err;
			} finally {
				if (db.isOpen) db.close();
			}
		}
}

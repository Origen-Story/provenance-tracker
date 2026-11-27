// Test-file bookkeeping for catalogs: open, check, close, clean up.
// Kept apart from catalog.ts, which npm run catalog:write loads outside vitest.

import { afterEach, expect } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspectCatalog } from "../../src/catalog/format.ts";
import { verifyCatalog } from "../../src/catalog/verify.ts";
import { fillSample, memoryCatalog } from "./catalog.ts";

/**
 * Catalogs a test file opens, closed after each test, with their temp
 * folders removed. Before closing, every catalog is checked with
 * verifyCatalog (roadmap: the history check "runs in every catalog test"), so
 * a test that edits around edit.ts fails unless it says it means to.
 */
export function catalogsForTests() {
	const open: Array<{ db: DatabaseSync; verify: boolean }> = [];
	const temps: string[] = [];
	afterEach(() => {
		try {
			for (const { db, verify } of open) {
				if (!verify || !db.isOpen) continue;
				// verifyCatalog checks a catalog of the current format: one a test
				// left at an earlier format (or made newer) has other columns.
				if (inspectCatalog(db).state !== "current") continue;
				expect(verifyCatalog(db), "verifyCatalog after the test").toEqual([]);
			}
		} finally {
			for (const { db } of open.splice(0)) if (db.isOpen) db.close();
			for (const dir of temps.splice(0))
				rmSync(dir, { recursive: true, force: true });
		}
	});
	const track = (db: DatabaseSync, opts: { verify?: boolean } = {}) => {
		open.push({ db, verify: opts.verify ?? true });
		return db;
	};
	return {
		track,
		catalog: (opts?: { verify?: boolean }) => track(memoryCatalog(), opts),
		sample: (opts?: { verify?: boolean }) => {
			const db = track(memoryCatalog(), opts);
			fillSample(db);
			return db;
		},
		tempDir: () => {
			const dir = mkdtempSync(path.join(tmpdir(), "pt-catalog-"));
			temps.push(dir);
			return dir;
		},
	};
}

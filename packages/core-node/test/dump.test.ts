import { describe, it, expect, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	checkDump,
	expectedSha256,
	listDumps,
	pgRestorePath,
	restoreToText,
} from "../src/legacy/dump.ts";

const temps: string[] = [];
afterEach(() => {
	for (const dir of temps.splice(0))
		rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
	const dir = mkdtempSync(path.join(tmpdir(), "pt-dump-"));
	temps.push(dir);
	return dir;
}

const hex = (bytes: string) => createHash("sha256").update(bytes).digest("hex");

/** A made-up dump with its .sha256, as the backup task writes them. */
function writeDump(
	dir: string,
	name: string,
	bytes = `dump ${name}`,
	sum?: string,
) {
	const file = path.join(dir, name);
	writeFileSync(file, bytes);
	writeFileSync(`${file}.sha256`, sum ?? `${hex(bytes)}  ${name}\n`);
	return file;
}

describe("listDumps", () => {
	it("lists one database's finished dumps, newest first", () => {
		const dir = tempDir();
		writeDump(dir, "provenance-tracker_2026-11-20_223001.dump");
		writeDump(dir, "provenance-tracker_2026-11-21_223001.dump");
		writeDump(dir, "provenance-tracker_2026-11-21_164143.dump");
		// Another database's, one still being written, and one with no checksum.
		writeDump(dir, "other-tracker_2026-11-22_223001.dump");
		writeFileSync(
			path.join(dir, "provenance-tracker_2026-11-23_094518.dump.partial"),
			"",
		);
		writeFileSync(
			path.join(dir, "provenance-tracker_2026-11-23_100000.dump"),
			"no sum",
		);
		expect(listDumps(dir).map((d) => [d.name, d.stamp])).toEqual([
			["provenance-tracker_2026-11-21_223001.dump", "2026-11-21 223001"],
			["provenance-tracker_2026-11-21_164143.dump", "2026-11-21 164143"],
			["provenance-tracker_2026-11-20_223001.dump", "2026-11-20 223001"],
		]);
		expect(listDumps(dir, "other-tracker").map((d) => d.name)).toEqual([
			"other-tracker_2026-11-22_223001.dump",
		]);
	});
});

describe("checking a dump against its .sha256", () => {
	it("passes a dump that matches, in either sha256sum form", async () => {
		const dir = tempDir();
		const a = writeDump(dir, "provenance-tracker_2026-11-21_223001.dump");
		expect(await checkDump(a)).toBe(
			hex("dump provenance-tracker_2026-11-21_223001.dump"),
		);
		const bytes = "binary mode";
		const b = writeDump(
			dir,
			"provenance-tracker_2026-11-22_223001.dump",
			bytes,
			`${hex(bytes).toUpperCase()} *provenance-tracker_2026-11-22_223001.dump`,
		);
		expect(expectedSha256(b)).toBe(hex(bytes));
		expect(await checkDump(b)).toBe(hex(bytes));
	});

	it("refuses a dump whose bytes differ", async () => {
		const dir = tempDir();
		const file = writeDump(
			dir,
			"provenance-tracker_2026-11-21_223001.dump",
			"the bytes",
			`${hex("other bytes")}  provenance-tracker_2026-11-21_223001.dump`,
		);
		await expect(checkDump(file)).rejects.toThrow(
			/does not match its \.sha256/,
		);
	});

	it("refuses a .sha256 for another file, or not in the sha256sum form", () => {
		const dir = tempDir();
		const file = writeDump(
			dir,
			"provenance-tracker_2026-11-21_223001.dump",
			"x",
			`${hex("x")}  provenance-tracker_2026-11-20_223001.dump`,
		);
		expect(() => expectedSha256(file)).toThrow(
			/is for provenance-tracker_2026-11-20/,
		);
		writeFileSync(`${file}.sha256`, "not a checksum");
		expect(() => expectedSha256(file)).toThrow(
			'is not "<sha256>  <file name>"',
		);
	});
});

describe("pg_restore", () => {
	it("is PG_RESTORE when set, else the newest Postgres under Program Files, else the one on PATH", () => {
		expect(
			pgRestorePath({ PG_RESTORE: "X:/tools/pg_restore.exe" }, "win32"),
		).toBe("X:/tools/pg_restore.exe");
		const programFiles = tempDir();
		for (const v of ["9.6", "16", "17", "notes"]) {
			const bin = path.join(programFiles, "PostgreSQL", v, "bin");
			mkdirSync(bin, { recursive: true });
			if (v !== "17") writeFileSync(path.join(bin, "pg_restore.exe"), "");
		}
		// 17 has no pg_restore (a server-only install), so 16 is used.
		expect(pgRestorePath({ ProgramFiles: programFiles }, "win32")).toBe(
			path.join(programFiles, "PostgreSQL", "16", "bin", "pg_restore.exe"),
		);
		expect(pgRestorePath({ ProgramFiles: tempDir() }, "win32")).toBe(
			"pg_restore",
		);
		expect(pgRestorePath({}, "linux")).toBe("pg_restore");
	});

	it("says so when it cannot run, or fails", async () => {
		const dir = tempDir();
		const out = path.join(dir, "out.sql");
		await expect(
			restoreToText(path.join(dir, "x.dump"), out, {
				pgRestore: path.join(dir, "no-such-pg_restore"),
			}),
		).rejects.toThrow(/pg_restore could not be run/);
		// Node stands in for a pg_restore that refuses its arguments.
		await expect(
			restoreToText(path.join(dir, "x.dump"), out, {
				pgRestore: process.execPath,
			}),
		).rejects.toThrow(/pg_restore failed/);
	});
});

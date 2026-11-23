// Find the newest Postgres dump of the app's database, check it against the
// .sha256 beside it, and turn it into plain SQL with pg_restore. Phase 5 only
// reads dumps the backup task wrote into its folder; it never runs
// pg_dump and never connects to a database, so it needs no password.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	createReadStream,
	existsSync,
	readdirSync,
	readFileSync,
} from "node:fs";
import path from "node:path";

/** The database whose dumps the migration reads. */
export const LEGACY_DATABASE = "provenance-tracker";

/** "<database>_YYYY-MM-DD_HHMMSS.dump", as the backup task names them. */
const DUMP_NAME = /^(.+)_(\d{4}-\d{2}-\d{2})_(\d{6})\.dump$/;

export interface DumpFile {
	file: string;
	name: string;
	/** "2026-11-21 223001": sorts by when it was written. */
	stamp: string;
}

/**
 * The dumps of one database in a folder, newest first. A dump without its
 * .sha256 beside it (one still being written, or one that failed) is left out.
 */
export function listDumps(
	folder: string,
	database = LEGACY_DATABASE,
): DumpFile[] {
	const out: DumpFile[] = [];
	for (const name of readdirSync(folder)) {
		const m = DUMP_NAME.exec(name);
		if (!m || m[1] !== database) continue;
		const file = path.join(folder, name);
		if (!existsSync(`${file}.sha256`)) continue;
		out.push({ file, name, stamp: `${m[2]} ${m[3]}` });
	}
	return out.sort((a, b) =>
		a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0,
	);
}

export async function sha256OfFile(file: string): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(file, { highWaterMark: 1 << 20 }))
		hash.update(chunk as Buffer);
	return hash.digest("hex");
}

/**
 * The hash a .sha256 file gives for its dump. The file is one line in the
 * sha256sum form, "<hex>  <name>", or "<hex> *<name>"; the name must be the dump's.
 */
export function expectedSha256(dump: string): string {
	const text = readFileSync(`${dump}.sha256`, "utf8").trim();
	const m = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(text);
	if (!m)
		throw new Error(
			`${path.basename(dump)}.sha256 is not "<sha256>  <file name>"`,
		);
	if (m[2].trim() !== path.basename(dump))
		throw new Error(
			`${path.basename(dump)}.sha256 is for ${m[2].trim()}, not for this dump`,
		);
	return m[1].toLowerCase();
}

/** Hash the dump and compare it with its .sha256. Throws when they differ. */
export async function checkDump(dump: string): Promise<string> {
	const expected = expectedSha256(dump);
	const actual = await sha256OfFile(dump);
	if (actual !== expected)
		throw new Error(
			`${path.basename(dump)} does not match its .sha256 (${actual.slice(0, 12)}…, expected ${expected.slice(0, 12)}…); it is not used`,
		);
	return actual;
}

/**
 * pg_restore on this machine: PG_RESTORE if set, else the newest
 * Postgres install under Program Files on Windows, else the one on PATH.
 */
export function pgRestorePath(
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
): string {
	if (env.PG_RESTORE) return env.PG_RESTORE;
	if (platform === "win32") {
		const base = path.join(
			env.ProgramFiles ?? "C:\\Program Files",
			"PostgreSQL",
		);
		if (existsSync(base)) {
			const versions = readdirSync(base)
				.filter((v) => /^\d+(\.\d+)?$/.test(v))
				.sort((a, b) => Number(b) - Number(a));
			for (const v of versions) {
				const exe = path.join(base, v, "bin", "pg_restore.exe");
				if (existsSync(exe)) return exe;
			}
		}
	}
	return "pg_restore";
}

/**
 * Write the dump's data as plain SQL (COPY blocks) to out. pg_restore reads
 * the file only: with -f it writes a script and never connects to a server.
 */
export function restoreToText(
	dump: string,
	out: string,
	opts: { pgRestore?: string } = {},
): Promise<void> {
	const exe = opts.pgRestore ?? pgRestorePath();
	return new Promise((resolve, reject) => {
		const child = spawn(exe, ["--data-only", "--no-owner", "-f", out, dump], {
			stdio: ["ignore", "ignore", "pipe"],
			windowsHide: true,
		});
		let stderr = "";
		child.stderr.on("data", (d: Buffer) => {
			stderr += d.toString();
		});
		child.on("error", (err) =>
			reject(
				new Error(
					`pg_restore could not be run (${exe}): ${err.message}. Install the Postgres client tools or set PG_RESTORE.`,
				),
			),
		);
		child.on("close", (code) =>
			code === 0
				? resolve()
				: reject(new Error(`pg_restore failed (${code}): ${stderr.trim()}`)),
		);
	});
}

// verify: is the catalog sound, and are its files where it says, as they
// were? Changes nothing (D31).
//
// - The catalog: SQLite's integrity and foreign-key checks, every editable
//   field against its history, required settings (core/catalog/verify.ts).
// - Each live file in the roots on this machine: still there, same size and
//   modified time as the last scan. With --hash, its bytes are read again and
//   must give the SHA-256 the catalog has: the only check that catches bytes
//   changed without the size or time changing (a failing disk, a tool that
//   restores the time).

import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import {
	verifyCatalog,
	type Problem,
} from "@provenancetracker/core/catalog/verify.ts";
import type { Machine } from "./machine.ts";
import type { OpenProject } from "./project.ts";
import { listRoots } from "./roots.ts";

export interface FileProblem {
	root: string;
	path: string;
	problem:
		| "missing"
		| "changed since the last scan"
		| "bytes differ from the catalog's hash";
	detail?: string;
}

export interface VerifyReport {
	catalog: Problem[];
	/** Live files checked on this machine. */
	checked: number;
	/** Of those, read in full (--hash). */
	hashed: number;
	files: FileProblem[];
	/** Roots whose files could not be checked here, and why. */
	notChecked: Array<{ root: string; reason: string; files: number }>;
	outcome: "ok" | "cancelled";
}

async function sha256Of(file: string): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(file, { highWaterMark: 1 << 20 }))
		hash.update(chunk as Buffer);
	return hash.digest("hex");
}

export async function verifyProject(
	project: OpenProject,
	machine: Machine,
	opts: {
		hash?: boolean;
		roots?: string[];
		signal?: AbortSignal;
		onProgress?: (p: { done: number; total: number; file: string }) => void;
	} = {},
): Promise<VerifyReport> {
	const { db } = project;
	const all = listRoots(project, machine);
	if (opts.roots) {
		const unknown = opts.roots.find((n) => !all.some((r) => r.name === n));
		if (unknown)
			throw new Error(`This project has no root called "${unknown}"`);
	}
	const chosen = opts.roots
		? all.filter((r) => opts.roots!.includes(r.name))
		: all;
	const report: VerifyReport = {
		catalog: verifyCatalog(db),
		checked: 0,
		hashed: 0,
		files: [],
		notChecked: [],
		outcome: "ok",
	};
	const live = db
		.prepare(
			`SELECT l.root_id AS rootId, l.path, l.modified_ms AS modifiedMs, c.size, c.sha256
			 FROM locations l JOIN contents c ON c.sha256 = l.content_sha256
			 WHERE l.gone_run_id IS NULL ORDER BY l.root_id, l.path`,
		)
		.all() as unknown as Array<{
		rootId: number;
		path: string;
		modifiedMs: number;
		size: number;
		sha256: string;
	}>;
	const jobs: Array<{ root: string; abs: string } & (typeof live)[number]> = [];
	for (const root of chosen) {
		const files = live.filter((l) => l.rootId === root.id);
		if (root.status !== "ok" || root.folder === null) {
			if (files.length)
				report.notChecked.push({
					root: root.name,
					reason: root.status,
					files: files.length,
				});
			continue;
		}
		for (const f of files)
			jobs.push({
				...f,
				root: root.name,
				abs: path.join(root.folder, ...f.path.split("/")),
			});
	}
	let done = 0;
	for (const job of jobs) {
		opts.onProgress?.({
			done,
			total: jobs.length,
			file: `${job.root}/${job.path}`,
		});
		if (opts.signal?.aborted) {
			report.outcome = "cancelled";
			break;
		}
		done++;
		report.checked++;
		let stats;
		try {
			stats = statSync(job.abs);
		} catch {
			report.files.push({ root: job.root, path: job.path, problem: "missing" });
			continue;
		}
		const sameStat =
			stats.size === job.size && Math.floor(stats.mtimeMs) === job.modifiedMs;
		if (!opts.hash) {
			if (!sameStat)
				report.files.push({
					root: job.root,
					path: job.path,
					problem: "changed since the last scan",
				});
			continue;
		}
		let sha: string;
		try {
			sha = await sha256Of(job.abs);
		} catch (err) {
			report.files.push({
				root: job.root,
				path: job.path,
				problem: "missing",
				detail: `could not be read (${(err as NodeJS.ErrnoException).code})`,
			});
			continue;
		}
		report.hashed++;
		if (sha === job.sha256) {
			// Same bytes; a new time alone is for the next scan to record.
			if (!sameStat)
				report.files.push({
					root: job.root,
					path: job.path,
					problem: "changed since the last scan",
					detail: "same bytes, new modified time",
				});
		} else if (sameStat) {
			report.files.push({
				root: job.root,
				path: job.path,
				problem: "bytes differ from the catalog's hash",
				detail: "size and modified time are unchanged",
			});
		} else {
			report.files.push({
				root: job.root,
				path: job.path,
				problem: "changed since the last scan",
				detail: "new bytes",
			});
		}
	}
	return report;
}

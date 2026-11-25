// A fingerprint of the working tree for "tests never modify the repo".
//
// git status lists every tracked file that differs from HEAD and every
// untracked file; hashing each listed file's content as well catches a test
// that edits a file that was already dirty before the run. Gitignored paths
// (node_modules, data/, test-fixtures/) are not covered, except the two that
// hold secrets: certs/ and .env files. A test must never create, change or
// remove anything there (CLAUDE.md), and on 2026-11-25 a test wrote
// throwaway keys into certs/ unseen, because the folder is gitignored. Those
// are fingerprinted by name, size and modification time only: the guard never
// opens them.
// Pattern copied from target-watch (scripts/lib/repo-snapshot.mjs).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Every file under certs/ and every .env file at the root, by name, size and time. */
function secretPaths(root) {
	const out = new Map();
	const add = (abs) => {
		const st = statSync(abs);
		out.set(
			`(secret) ${relative(root, abs).replaceAll("\\", "/")}`,
			`${st.size} ${st.mtimeMs}`,
		);
	};
	const certs = join(root, "certs");
	if (existsSync(certs))
		for (const e of readdirSync(certs, {
			recursive: true,
			withFileTypes: true,
		}))
			if (e.isFile()) add(join(e.parentPath, e.name));
	for (const e of readdirSync(root, { withFileTypes: true }))
		if (e.isFile() && /^.env(..*)?$/.test(e.name)) add(join(root, e.name));
	return out;
}

export function snapshot(root) {
	const r = spawnSync(
		"git",
		["status", "--porcelain=v1", "-z", "--untracked-files=all"],
		{ cwd: root, encoding: "utf8" },
	);
	if (r.error || r.status !== 0) {
		throw new Error(
			`repo guard needs git and a git checkout at ${root}: ${r.error?.message ?? r.stderr}`,
		);
	}
	const entries = r.stdout.split("\0").filter(Boolean);
	const snap = new Map();
	for (let i = 0; i < entries.length; i++) {
		const status = entries[i].slice(0, 2);
		const path = entries[i].slice(3);
		if (status[0] === "R" || status[0] === "C") i++; // -z puts the original path next
		const abs = join(root, path);
		let content = "missing";
		if (existsSync(abs)) {
			content = statSync(abs).isDirectory()
				? "dir"
				: createHash("sha256").update(readFileSync(abs)).digest("hex");
		}
		snap.set(path, `${status} ${content}`);
	}
	for (const [path, fingerprint] of secretPaths(root))
		snap.set(path, fingerprint);
	return snap;
}

// Paths whose status or content differ between two snapshots.
export function changedPaths(before, after) {
	const paths = new Set([...before.keys(), ...after.keys()]);
	return [...paths].filter((p) => before.get(p) !== after.get(p)).sort();
}

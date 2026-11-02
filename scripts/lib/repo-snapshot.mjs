// A fingerprint of the working tree for "tests never modify the repo".
//
// git status lists every tracked file that differs from HEAD and every
// untracked file; hashing each listed file's content as well catches a test
// that edits a file that was already dirty before the run. Gitignored paths
// (node_modules, .env, data/, test-fixtures/) are not covered on purpose.
// Pattern copied from target-watch (scripts/lib/repo-snapshot.mjs).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function snapshot(root) {
	const r = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: root, encoding: 'utf8' });
	if (r.error || r.status !== 0) {
		throw new Error(`repo guard needs git and a git checkout at ${root}: ${r.error?.message ?? r.stderr}`);
	}
	const entries = r.stdout.split('\0').filter(Boolean);
	const snap = new Map();
	for (let i = 0; i < entries.length; i++) {
		const status = entries[i].slice(0, 2);
		const path = entries[i].slice(3);
		if (status[0] === 'R' || status[0] === 'C') i++; // -z puts the original path next
		const abs = join(root, path);
		let content = 'missing';
		if (existsSync(abs)) {
			content = statSync(abs).isDirectory() ? 'dir' : createHash('sha256').update(readFileSync(abs)).digest('hex');
		}
		snap.set(path, `${status} ${content}`);
	}
	return snap;
}

// Paths whose status or content differ between two snapshots.
export function changedPaths(before, after) {
	const paths = new Set([...before.keys(), ...after.keys()]);
	return [...paths].filter((p) => before.get(p) !== after.get(p)).sort();
}

// `npm test`: run vitest inside the repo guard.
//
// The guard snapshots the working tree before and after the run and fails if
// any test changed it. Tests are pure or write to temp directories only; the
// database, managed storage and certs/ are never touched by a test.
//
//   npm test                                   all tests
//   npm test -- test/unit/parsers/freepik.test.js   one file
//   npm run test:watch                         vitest in watch mode (no guard)
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { changedPaths, snapshot } from './lib/repo-snapshot.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const BUDGET_SECONDS = 60;
const vitest = resolve(ROOT, 'node_modules', 'vitest', 'vitest.mjs');

const args = process.argv.slice(2);
const before = snapshot(ROOT);
const started = performance.now();
const run = spawnSync(process.execPath, [vitest, 'run', ...args], { cwd: ROOT, stdio: 'inherit' });
const seconds = ((performance.now() - started) / 1000).toFixed(1);
const after = snapshot(ROOT);

const changed = changedPaths(before, after);
console.log(`\nrepo guard: tests took ${seconds}s (budget ${BUDGET_SECONDS}s)`);
if (changed.length) {
	console.error(`repo guard: FAIL, the test run changed the repo:\n  ${changed.join('\n  ')}`);
	console.error('Tests must write to temp directories only. Restore these files and fix the test.');
	process.exit(1);
}
console.log('repo guard: OK, working tree unchanged');
if (Number(seconds) > BUDGET_SECONDS) {
	console.error(`repo guard: FAIL, the suite took ${seconds}s, over the ${BUDGET_SECONDS}s budget`);
	process.exit(1);
}
process.exit(run.status ?? 1);

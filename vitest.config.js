import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: [
			"test/unit/**/*.test.{js,ts}",
			"packages/*/test/**/*.test.{js,ts}",
		],
		// Server-only tests today; the React tree would need a DOM env if/when we add it.
		globals: false,
		// A safety net under core-node's rule that tests pass a machine of their
		// own: anything that reaches for this machine's settings file gets a
		// throwaway one instead. The repo guard cannot see the real file, which
		// lives outside the checkout.
		env: {
			PROVENANCETRACKER_SETTINGS: path.join(
				tmpdir(),
				"provenancetracker-tests",
				"settings.json",
			),
		},
		// vitest 4's default worker pool crashes on Windows at worker bootstrap with
		// "Cannot read properties of undefined (reading 'config')" before any test
		// runs. 'forks' (child processes) and 'threads' both work; forks is the
		// safer default for tests that spawn exiftool or c2patool.
		pool: "forks",
		// Test files run in parallel (vitest's default). They ran one at a time from
		// April 2026, for a Windows worker start-up crash that the forks pool above
		// avoids. By November the suite had grown to 64 files, many starting real
		// programs, and serial running took 55 s on a GitHub Windows runner, 78 s
		// on a busy one, against the repo guard's 60 s (in parallel on Windows
		// here: about 9 s instead of 38 s). Parallel is safe because every test
		// works in a temporary folder of its own and none uses a fixed path.
		// Some tests run the whole pipeline on real disk: temporary catalogs, scans,
		// reads, child processes. On a GitHub Windows runner that took 8.6 s for one
		// test (virus scanning of new files is the likely cost) against the 5 s
		// default. 30 s still stops a hang; the repo guard keeps the suite under 60 s
		// (180 s in CI, scripts/lib/test-budget.mjs).
		testTimeout: 30_000,
	},
});

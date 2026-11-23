import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: [
			"test/unit/**/*.test.{js,ts}",
			"packages/*/test/**/*.test.{js,ts}",
			"test/integration/**/*.test.{js,ts}",
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
		// Parallel file execution also flaked on Windows. The suite is small; serial
		// adds well under a second.
		fileParallelism: false,
		// Some tests run the whole pipeline on real disk: temporary catalogs, scans,
		// reads, child processes. On a GitHub Windows runner that took 8.6 s for one
		// test (virus scanning of new files is the likely cost) against the 5 s
		// default. 30 s still stops a hang; the repo guard keeps the suite under 60 s.
		testTimeout: 30_000,
	},
});

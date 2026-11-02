import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['test/unit/**/*.test.js', 'test/integration/**/*.test.js'],
		// Server-only tests today; the React tree would need a DOM env if/when we add it.
		globals: false,
		// vitest 4's default worker pool crashes on Windows at worker bootstrap with
		// "Cannot read properties of undefined (reading 'config')" before any test
		// runs. 'forks' (child processes) and 'threads' both work; forks is the
		// safer default for tests that spawn exiftool or c2patool.
		pool: 'forks',
		// Parallel file execution also flaked on Windows. The suite is small; serial
		// adds well under a second.
		fileParallelism: false
	}
});

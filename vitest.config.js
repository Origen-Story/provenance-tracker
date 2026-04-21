import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['test/**/*.test.js'],
		// Server-only tests today; the React tree would need a DOM env if/when we add it.
		globals: false,
		// Parallel file execution intermittently fails on Windows with "Cannot read
		// properties of undefined (reading 'config')" from the worker bootstrap. The
		// suite is tiny — serial adds ~0.5s and fixes the flake.
		fileParallelism: false
	}
});

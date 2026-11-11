import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	root: 'src/client',
	build: {
		outDir: '../../dist',
		emptyOutDir: true
	},
	plugins: [react(), tailwindcss()],
	server: {
		port: 5173,
		// The client imports the vocabulary from src/shared, outside `root`.
		fs: { allow: [path.join(repoRoot, 'src'), path.join(repoRoot, 'node_modules')] },
		proxy: {
			'/api': 'http://localhost:3001'
		}
	}
});

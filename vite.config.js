import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	root: "src/client",
	build: {
		outDir: "../../dist",
		emptyOutDir: true,
	},
	plugins: [react(), tailwindcss()],
	server: {
		port: 5173,
		// The client imports the vocabulary from src/shared, outside `root`.
		fs: {
			allow: [path.join(repoRoot, "src"), path.join(repoRoot, "node_modules")],
		},
		// The API listens on 127.0.0.1 only, so name the address, not "localhost",
		// which Windows may resolve to ::1 first.
		//
		// changeOrigin must stay false. The API refuses a request whose Origin
		// differs from its Host header (src/server/lib/core/local-only.js). With
		// false, the proxy forwards the browser's Host (localhost:5173) and the
		// two agree. Vite's short form ('/api': 'http://...') sets it to true,
		// which rewrites Host to the target and gets every POST refused with 403.
		proxy: {
			"/api": { target: "http://127.0.0.1:3001", changeOrigin: false },
		},
	},
});

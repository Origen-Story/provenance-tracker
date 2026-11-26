// The server: the catalog API on /api (createApp), and in production the
// built pages. Each project is a folder with its catalog inside it, so there
// is no database server to reach and nothing runs in the background.

import express from "express";
import path from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { thisMachine } from "@provenancetracker/core-node/machine.ts";
import { createApp } from "./app.ts";
import { createLogger } from "./lib/logger.js";
import {
	allowedHostnames,
	listenHost,
	isLoopbackHost,
} from "./lib/core/local-only.js";

const log = createLogger("server");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
// Loopback unless HOST says otherwise: there is no login, so being reachable
// only from this machine is the access control (docs/threat-model.md).
const HOST = listenHost(process.env);

const pkg = JSON.parse(
	readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"),
);

const app = createApp({
	env: process.env,
	machine: thisMachine(),
	mount: (app) => {
		// Liveness probe, for anyone running the tracker behind a supervisor.
		app.get("/api/health", (_req, res) => {
			res.json({ ok: true, version: pkg.version });
		});

		// Serve the built pages in production.
		if (process.env.NODE_ENV === "production") {
			const distPath = path.resolve(__dirname, "../../dist");
			app.use(express.static(distPath));
			// Express 5 path syntax: a bare "*" is no longer valid; a named splat is.
			app.get("/{*splat}", (req, res) => {
				res.sendFile(path.join(distPath, "index.html"));
			});
		}
	},
});

app.listen(PORT, HOST, () => {
	log.info(
		`✓ Provenance Tracker API listening on http://${HOST.includes(":") ? `[${HOST}]` : HOST}:${PORT}`,
	);
	if (!isLoopbackHost(HOST)) {
		const allowed = allowedHostnames(process.env);
		log.warn(
			`HOST=${HOST}: the API is listening beyond this machine, and it has no login. A request from another machine is answered only when its Host header is ${allowed.length ? `one of: ${allowed.join(", ")}` : "listed in ALLOWED_HOSTS (nothing is, so every one is refused)"}; whoever can reach this port can send that header, so put a login in front. "Host: localhost" is accepted from this machine only. If you did not set HOST, another program did: unset it. See README, "Deployment notes".`,
		);
	}
});

// Surface crashes instead of hanging silently. uncaughtException may leave state
// corrupt, so exit and let the supervisor (node --watch, pm2, systemd) restart.
// unhandledRejection is logged but non-fatal.
process.on("uncaughtException", (err) => {
	log.error("uncaught exception (fatal):", err);
	process.exit(1);
});
process.on("unhandledRejection", (reason) => {
	log.warn("unhandled promise rejection:", reason);
});

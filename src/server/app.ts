// The Express app, made from what it needs (the environment and the machine),
// so tests build the same app the server runs, against a machine of their own.
// The request guard comes first and the JSON error answer last, whatever is
// mounted between them.

import express, {
	type Express,
	type NextFunction,
	type Request,
	type Response,
} from "express";
import type { Machine } from "@provenancetracker/core-node/machine.ts";
import { catalogApi } from "./api/next.ts";
import { allowedHostnames, localOnly } from "./lib/core/local-only.js";
import { createLogger } from "./lib/logger.js";

const log = createLogger("server");

export function createApp(opts: {
	env: NodeJS.ProcessEnv;
	machine: Machine;
	/** The routes still on Postgres, mounted after the catalog API (until the cutover). */
	mount?: (app: Express) => void;
}): Express {
	const app = express();

	// Before any body is parsed: refuse API requests that do not come from the
	// tracker's own pages on this machine (another site's form, DNS rebinding).
	app.use(
		"/api",
		localOnly({
			allowedHosts: allowedHostnames(opts.env),
			onRefuse: (req: Request, reason: string) =>
				log.warn(
					`refused ${req.method} ${req.originalUrl.split("?")[0]}: ${reason}`,
				),
		}),
	);

	app.use(express.json({ limit: "10mb" }));
	// Express 5 leaves req.body undefined when a request carries no JSON body
	// (Express 4 gave {}). Routes destructure req.body, so keep the old shape.
	app.use((req: Request, _res: Response, next: NextFunction) => {
		if (req.body === undefined) req.body = {};
		next();
	});

	app.use("/api/next", catalogApi({ machine: opts.machine }));
	opts.mount?.(app);

	// Express 5 forwards rejected promises from async routes here. Answer in JSON
	// so the client never gets an HTML stack page. A status below 500 is the
	// caller's to fix and is not logged as a server error.
	app.use(
		(
			err: Error & { status?: number },
			_req: Request,
			res: Response,
			_next: NextFunction,
		) => {
			const status = err.status ?? 500;
			if (status >= 500) log.error(err.stack || err.message);
			res.status(status).json({ error: err.message || "Internal error" });
		},
	);
	return app;
}

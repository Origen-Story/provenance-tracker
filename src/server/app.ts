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
import { catalogApi, type CatalogApiOptions } from "./api/catalog.ts";
import { allowedHostnames, localOnly } from "./lib/core/local-only.js";
import { createLogger } from "./lib/logger.js";

const log = createLogger("server");

/**
 * Headers on everything the app sends, pages and API alike (D85). The pages
 * load nothing from anywhere else and nothing else has any business showing
 * them, so both are said outright:
 * - no other site can put the app in a frame (clickjacking);
 * - a page runs scripts only from the app itself, and nothing inline;
 * - a file is never guessed to be a type the server did not say;
 * - no address of the app is sent on to a site a link leads to;
 * - no other site's page can embed what the app serves, a project's pictures
 *   and films included.
 * Styles may be inline: the pages set a few by attribute (a bar's width).
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
	"Content-Security-Policy": [
		"default-src 'self'",
		"script-src 'self'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"media-src 'self' blob:",
		"connect-src 'self'",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"frame-ancestors 'none'",
	].join("; "),
	"X-Frame-Options": "DENY",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "no-referrer",
	"Cross-Origin-Resource-Policy": "same-origin",
};

export function createApp(opts: {
	env: NodeJS.ProcessEnv;
	machine: Machine;
	/** More routes, mounted after the catalog API: the health probe and, in production, the built pages. */
	mount?: (app: Express) => void;
	/** The catalog API's jobs, readers and network (tests give their own). */
	catalog?: Omit<CatalogApiOptions, "machine">;
}): Express {
	const app = express();
	app.disable("x-powered-by");
	app.use((_req: Request, res: Response, next: NextFunction) => {
		for (const [name, value] of Object.entries(SECURITY_HEADERS))
			res.setHeader(name, value);
		next();
	});

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

	app.use("/api", catalogApi({ ...opts.catalog, machine: opts.machine }));
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

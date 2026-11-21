// Loads the optional c2pa-node native binding on first use.
//
// c2pa-node ships an unsigned native module. Windows Smart App Control (and
// other application-control policies) can refuse to load it, and a static
// `import ... from 'c2pa-node'` then takes the whole server down at startup.
// The binding is a fast path, not a requirement: reading falls back to the
// pinned c2patool, so a blocked binding must cost speed, never the app.
import { createRequire } from "node:module";
import { createLogger } from "../logger.js";

const log = createLogger("c2pa");

// Promise<{ module: object|null, reason: string|null, version: string|null }>
let attempt = null;

function installedVersion() {
	try {
		return createRequire(import.meta.url)("c2pa-node/package.json").version;
	} catch {
		return null;
	}
}

export function loadC2paNode() {
	if (!attempt) {
		const version = installedVersion();
		attempt = import("c2pa-node")
			.then((module) => ({
				module: module.default?.createC2pa ? module.default : module,
				reason: null,
				version,
			}))
			.catch((err) => {
				const reason = String(err?.message || err).split("\n")[0];
				log.warn(
					`c2pa-node native binding unavailable (${reason}). Using c2patool for C2PA reads.`,
				);
				return { module: null, reason, version };
			});
	}
	return attempt;
}

// Local-only guard for the API (pure: no IO, no Express import).
//
// The tracker has no login. What keeps it private is that only this machine
// can reach it, and that takes two things:
//
//   1. The server listens on the loopback address (listenHost), so other
//      devices on the network cannot connect at all.
//   2. Each API request is checked (checkLocalRequest), because a web page
//      open in the browser on this machine CAN connect. Two attacks:
//        - A page on another site posts a form to http://localhost:3001.
//          The browser sends it, with an Origin header naming that site.
//        - DNS rebinding: a site points its own name at 127.0.0.1, so the
//          browser treats the API as that site's own. The Host header then
//          carries the attacker's name, not localhost.
//
// The rules: the Host header must name this machine; an Origin header, when
// the browser sends one, must be the same host and port as Host; and a request
// the browser itself labels cross-site is refused. In development the browser
// talks to Vite on 5173, whose proxy is configured to forward /api with the
// Host header unchanged (vite.config.js, changeOrigin: false), so Host and
// Origin still agree and no port list is needed.

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);
const WILDCARD = new Set(["0.0.0.0", "::"]);

export const DEFAULT_HOST = "127.0.0.1";

const clean = (name) =>
	String(name || "")
		.trim()
		.toLowerCase()
		.replace(/^\[|\]$/g, "")
		.replace(/\.$/, "");

// The address to listen on: loopback unless HOST says otherwise.
export function listenHost(env = {}) {
	return String(env.HOST || "").trim() || DEFAULT_HOST;
}

export function isLoopbackHost(host) {
	return LOOPBACK.has(clean(host));
}

/**
 * Host names accepted beside the loopback ones: a specific HOST address, plus
 * the comma-separated ALLOWED_HOSTS (for a reverse proxy that adds its own
 * login). A wildcard HOST adds nothing, so listening on every interface
 * without naming a host still refuses every non-local request.
 */
export function allowedHostnames(env = {}) {
	const names = String(env.ALLOWED_HOSTS || "")
		.split(",")
		.map(clean)
		.filter(Boolean);
	const host = clean(listenHost(env));
	if (!WILDCARD.has(host) && !LOOPBACK.has(host)) names.push(host);
	return [...new Set(names)];
}

// "localhost:3001" or "[::1]:3001" to { hostname, host }, or null when it is
// not a plain host[:port].
function parseHost(value) {
	const raw = String(value || "").trim();
	if (!raw || /[\s/@?#\\]/.test(raw)) return null;
	try {
		const url = new URL(`http://${raw}`);
		return { hostname: clean(url.hostname), host: url.host.toLowerCase() };
	} catch {
		return null;
	}
}

/**
 * @param {object} request
 * @param {string} [request.host] the Host header
 * @param {string} [request.origin] the Origin header, when sent
 * @param {string} [request.secFetchSite] the Sec-Fetch-Site header, when sent
 * @param {string[]} [request.allowedHosts] from allowedHostnames()
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkLocalRequest({
	host,
	origin,
	secFetchSite,
	allowedHosts = [],
} = {}) {
	const target = parseHost(host);
	if (!target) return { ok: false, reason: "missing or malformed Host header" };
	if (
		!LOOPBACK.has(target.hostname) &&
		!allowedHosts.includes(target.hostname)
	) {
		return {
			ok: false,
			reason: `Host "${target.hostname}" is not this machine`,
		};
	}
	if (origin !== undefined && origin !== "") {
		let from;
		try {
			from = new URL(origin);
		} catch {
			from = null;
		}
		if (!from || !/^https?:$/.test(from.protocol))
			return { ok: false, reason: "Origin is not a web address" };
		if (from.host.toLowerCase() !== target.host)
			return {
				ok: false,
				reason: `Origin "${from.host}" is not the page this server serves`,
			};
	}
	if (String(secFetchSite || "").toLowerCase() === "cross-site") {
		return { ok: false, reason: "the browser marked the request cross-site" };
	}
	return { ok: true };
}

/**
 * Express middleware around checkLocalRequest. `onRefuse(req, reason)` is for
 * logging; the response never repeats the reason's detail back to the caller.
 * @param {{ allowedHosts?: string[], onRefuse?: (req: any, reason: string) => void }} [options]
 */
export function localOnly({ allowedHosts = [], onRefuse } = {}) {
	return (req, res, next) => {
		const verdict = checkLocalRequest({
			host: req.headers.host,
			origin: req.headers.origin,
			secFetchSite: req.headers["sec-fetch-site"],
			allowedHosts,
		});
		if (verdict.ok) return next();
		onRefuse?.(req, verdict.reason);
		res.status(403).json({
			error: "This API only answers the tracker's own pages on this machine.",
		});
	};
}

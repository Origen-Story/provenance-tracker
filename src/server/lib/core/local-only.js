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
//
// A Host header is the caller's word, and any client can write "Host:
// localhost". So a loopback name counts as this machine only when the
// connection also came from this machine (D66). That matters when HOST makes
// the server listen beyond loopback: without it, every device that can reach
// the port would have the whole API by naming localhost. A host listed in
// ALLOWED_HOSTS is accepted from anywhere, which is why a login has to sit in
// front of it; listing a name is not authentication.

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
 * True for the address of a connection from this machine itself: 127.0.0.0/8
 * or ::1, also when IPv4 is written inside IPv6 ("::ffff:127.0.0.1", as a
 * socket listening on both reports it).
 */
export function isLoopbackAddress(address) {
	const a = clean(address).replace(/^::ffff:/, "");
	if (a === "::1") return true;
	const parts = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
	return !!parts && parts[1] === "127" && parts.slice(1).every((n) => n <= 255);
}

/**
 * Host names accepted from any address: a specific HOST address, plus the
 * comma-separated ALLOWED_HOSTS (for a reverse proxy that adds its own
 * login). An entry may be written with a port ("tracker.example.net:8443");
 * the name is what is compared. A wildcard HOST adds nothing, so listening on
 * every interface without naming a host still refuses every request that
 * does not come from this machine. A loopback name is never taken from the
 * list: "localhost" from another machine is always a lie.
 */
export function allowedHostnames(env = {}) {
	const names = String(env.ALLOWED_HOSTS || "")
		.split(",")
		.map(
			(entry) =>
				// A bare IPv6 address is written without its brackets.
				(parseHost(entry) ?? parseHost(`[${entry.trim()}]`))?.hostname ?? "",
		)
		.filter((name) => name && !LOOPBACK.has(name));
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
 * @param {string} [request.remoteAddress] the address the connection came
 *   from (the socket's, never a header); without one, no loopback name passes
 * @param {string[]} [request.allowedHosts] from allowedHostnames()
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkLocalRequest({
	host,
	origin,
	secFetchSite,
	remoteAddress,
	allowedHosts = [],
} = {}) {
	const target = parseHost(host);
	if (!target) return { ok: false, reason: "missing or malformed Host header" };
	if (!allowedHosts.includes(target.hostname)) {
		if (!LOOPBACK.has(target.hostname))
			return {
				ok: false,
				reason: `Host "${target.hostname}" is not this machine`,
			};
		// "Host: localhost" is this machine only when the caller is too.
		if (!isLoopbackAddress(remoteAddress))
			return {
				ok: false,
				reason: `Host "${target.hostname}" from ${clean(remoteAddress) || "an unknown address"}, which is not this machine`,
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
	// What the browser itself says about where the request came from. The
	// tracker's own pages are same-origin (the dev pages reach the API through
	// their own server), and an address typed or a link followed is "none".
	// "same-site" is a page on another port of this machine: some other
	// program's page, not the tracker's. A request with no such header is not
	// from a browser page at all (a script, the command line), which the Host
	// rules above already hold to this machine.
	const site = String(secFetchSite || "").toLowerCase();
	if (site === "cross-site")
		return { ok: false, reason: "the browser marked the request cross-site" };
	if (site === "same-site")
		return {
			ok: false,
			reason:
				"the browser marked the request same-site: a page on this machine that is not the tracker's",
		};
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
			// The socket's own word, not X-Forwarded-For: a header proves nothing.
			remoteAddress: req.socket?.remoteAddress,
			allowedHosts,
		});
		if (verdict.ok) return next();
		onRefuse?.(req, verdict.reason);
		res.status(403).json({
			error: "This API only answers the tracker's own pages on this machine.",
		});
	};
}

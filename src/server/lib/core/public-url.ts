// Fetch a web address only if it leads to the public internet.
//
// The tracker downloads images from addresses a person types (URL import) or
// that Wikimedia returns (the parked download queue). Without a check, such an
// address could point the server at this machine or the local network
// ("server-side request forgery"): http://localhost:5432, a router's admin
// page, a cloud metadata address. The API only answers this machine
// (local-only.js), so only the person at the keyboard can send one; this is
// the second line, and it is what CodeQL's js/request-forgery asks for.
//
// What it checks, on the first request and on every redirect: the scheme is
// http or https, the address carries no user name or password, and every
// address the host name resolves to is public. What it cannot rule out: fetch
// resolves the name again when it connects, so a hostile DNS server could
// answer differently the second time (DNS rebinding). Closing that needs an
// HTTP client that connects to the address checked here, which Node's
// built-in fetch does not offer without an extra package (docs/threat-model.md).
import { BlockList, isIP } from "node:net";

// Addresses that are not the public internet: this machine, private networks,
// shared and link-local ranges, documentation and benchmark ranges, multicast
// and reserved space (IANA special-purpose registries).
const blocked = new BlockList();
for (const [net, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.88.99.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
] as const)
	blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
	["::", 128],
	["::1", 128],
	["100::", 64],
	["2001:db8::", 32],
	["fc00::", 7],
	["fe80::", 10],
	["ff00::", 8],
] as const)
	blocked.addSubnet(net, prefix, "ipv6");

// IPv6 forms that carry an IPv4 address inside them.
const EMBEDDED_V4 =
	/^(?:::ffff:|::ffff:0:|64:ff9b::)(\d{1,3}(?:\.\d{1,3}){3})$/i;

/** True when an IP address is on the public internet. Anything unparseable is not. */
export function isPublicAddress(address: string): boolean {
	const a = String(address)
		.trim()
		.replace(/^\[|\]$/g, "")
		.split("%")[0];
	const family = isIP(a);
	if (family === 4) return !blocked.check(a, "ipv4");
	if (family !== 6) return false;
	const v4 = a.match(EMBEDDED_V4);
	if (v4) return isPublicAddress(v4[1]);
	return !blocked.check(a, "ipv6");
}

/** The URL, if it is an http(s) address without credentials; otherwise an error saying why. */
export function parsePublicUrl(raw: string): URL {
	let url: URL;
	try {
		url = new URL(String(raw).trim());
	} catch {
		throw new Error("That is not a web address.");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:")
		throw new Error(
			`Only http and https addresses can be imported, not ${url.protocol}`,
		);
	if (url.username || url.password)
		throw new Error("Addresses with a user name or password are refused.");
	return url;
}

type Lookup = (hostname: string) => Promise<Array<{ address: string }>>;
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Throws unless every address the URL's host resolves to is public. */
export async function assertPublicHost(
	url: URL,
	lookup: Lookup,
): Promise<void> {
	const host = url.hostname.replace(/^\[|\]$/g, "");
	const addresses = isIP(host)
		? [host]
		: (await lookup(host)).map((r) => r.address);
	if (addresses.length === 0)
		throw new Error(`${host} does not resolve to any address.`);
	const local = addresses.find((a) => !isPublicAddress(a));
	if (local)
		throw new Error(
			`${url.hostname} points to ${local}, which is not on the public internet. Refused.`,
		);
}

/**
 * fetch(), refusing any address (first or redirected) that is not public.
 * `lookup` and `fetchImpl` are injectable for tests.
 */
export async function fetchPublic(
	raw: string,
	init: RequestInit = {},
	{
		lookup,
		fetchImpl = fetch,
		maxRedirects = 5,
	}: { lookup: Lookup; fetchImpl?: Fetch; maxRedirects?: number },
): Promise<Response> {
	let url = parsePublicUrl(raw);
	for (let hop = 0; ; hop++) {
		await assertPublicHost(url, lookup);
		const res = await fetchImpl(url.href, { ...init, redirect: "manual" });
		const location =
			res.status >= 300 && res.status < 400
				? res.headers.get("location")
				: null;
		if (!location) return res;
		if (hop >= maxRedirects)
			throw new Error(
				`More than ${maxRedirects} redirects; stopped at ${url.href}`,
			);
		url = parsePublicUrl(new URL(location, url).href);
	}
}

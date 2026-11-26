// Fetch a web address only if it leads to the public internet.
//
// The tracker downloads a file from an address a person types (adding a file
// by its address). Without a check, such an address could point the server
// at this machine or the local network ("server-side request forgery"):
// http://localhost:5432, a router's admin page, a cloud metadata address. The
// API only answers this machine (local-only.js), so only the person at the
// keyboard can send one; this is the second line, and it is what CodeQL's
// js/request-forgery asks for.
//
// What it checks, on the first request and on every redirect: the scheme is
// http or https, the address carries no user name or password, and every
// address the host name resolves to is public. The request is then made to
// one of the addresses that were checked, not to the name (D70): asking for
// the name again when connecting would let a hostile DNS server give a public
// address to the check and a local one to the connection (DNS rebinding).
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";

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
	// Local-use translation, discard-only, and Teredo tunnels: none is a
	// plain public address.
	["64:ff9b:1::", 48],
	["100::", 64],
	["2001::", 32],
	["2001:db8::", 32],
	["fc00::", 7],
	["fe80::", 10],
	// Site-local: withdrawn, and still routed inside some networks.
	["fec0::", 10],
	["ff00::", 8],
] as const)
	blocked.addSubnet(net, prefix, "ipv6");

/** The sixteen bytes of an IPv6 address in any of its written forms; null when it is not one. */
function ipv6Bytes(address: string): number[] | null {
	if (isIP(address) !== 6) return null;
	let text = address;
	// A dotted IPv4 tail ("::ffff:10.0.0.1") is two more groups.
	const tail = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
	if (tail) {
		const [a, b, c, d] = tail.slice(2).map(Number);
		text = `${tail[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
	}
	const [head, rest] = text.split("::");
	const left = head ? head.split(":") : [];
	const right = rest ? rest.split(":") : [];
	const gap = text.includes("::") ? 8 - left.length - right.length : 0;
	const groups = [...left, ...Array<string>(gap).fill("0"), ...right];
	if (groups.length !== 8) return null;
	return groups.flatMap((g) => {
		const n = parseInt(g, 16);
		return [n >> 8, n & 0xff];
	});
}

/**
 * The IPv4 address an IPv6 address stands for, when it is one of the forms
 * that carry one: such an address leads wherever the IPv4 one does, so it is
 * public only if that is. Mapped (::ffff:a.b.c.d), translated
 * (::ffff:0:a.b.c.d), NAT64 (64:ff9b::/96), 6to4 (2002:AABB:CCDD::/16) and
 * the old IPv4-compatible form (::a.b.c.d), written with dots or in hex.
 */
function embeddedIpv4(bytes: number[]): string | null {
	const zero = (from: number, to: number) =>
		bytes.slice(from, to).every((b) => b === 0);
	const at = (i: number) => bytes.slice(i, i + 4).join(".");
	if (zero(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return at(12);
	if (zero(0, 8) && bytes[8] === 0xff && bytes[9] === 0xff && zero(10, 12))
		return at(12);
	if (
		bytes[0] === 0x00 &&
		bytes[1] === 0x64 &&
		bytes[2] === 0xff &&
		bytes[3] === 0x9b &&
		zero(4, 12)
	)
		return at(12);
	if (bytes[0] === 0x20 && bytes[1] === 0x02) return at(2);
	// ::a.b.c.d, but not :: or ::1, which are addresses of their own.
	if (zero(0, 12) && !(zero(12, 15) && bytes[15] <= 1)) return at(12);
	return null;
}

/** True when an IP address is on the public internet. Anything unparseable is not. */
export function isPublicAddress(address: string): boolean {
	const a = String(address)
		.trim()
		.replace(/^\[|\]$/g, "")
		.split("%")[0];
	const family = isIP(a);
	if (family === 4) return !blocked.check(a, "ipv4");
	if (family !== 6) return false;
	const bytes = ipv6Bytes(a);
	if (!bytes) return false;
	const v4 = embeddedIpv4(bytes);
	if (v4) return isPublicAddress(v4);
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

/**
 * Makes one request, to `address` and no other: the address that was
 * checked. The URL still says which host and path to ask for.
 */
export type FetchAt = (
	url: string,
	init: RequestInit,
	address: string,
) => Promise<Response>;

/**
 * Throws unless every address the URL's host resolves to is public.
 * @returns the addresses that were checked, in the order they were given
 */
export async function assertPublicHost(
	url: URL,
	lookup: Lookup,
): Promise<string[]> {
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
	return addresses;
}

/**
 * One GET with Node's own client, connected to `address` whatever the URL's
 * host name would resolve to now. The name is still what the server is asked
 * for, and what an https certificate is checked against. Redirects are not
 * followed: the caller checks each one.
 */
export const requestAt: FetchAt = (href, init, address) =>
	new Promise<Response>((resolve, reject) => {
		const url = new URL(href);
		const family = isIP(address);
		if (!family) {
			reject(new Error(`${address} is not an address`));
			return;
		}
		const client = url.protocol === "https:" ? https : http;
		const headers: Record<string, string> = {
			// The bytes are saved as they come: no encoding to undo.
			"Accept-Encoding": "identity",
		};
		new Headers(init.headers ?? {}).forEach((value, name) => {
			headers[name] = value;
		});
		const req = client.request(
			url,
			{
				method: "GET",
				headers,
				// Its own connection, made here and not kept for another request.
				agent: false,
				signal: init.signal ?? undefined,
				// Never asks DNS: the answer is the address that was checked. Node
				// asks for one address or for all of them, depending on its version.
				lookup: (_hostname, options, callback) => {
					const all =
						typeof options === "object" && options !== null && options.all;
					if (all)
						(
							callback as unknown as (
								err: null,
								addresses: Array<{ address: string; family: number }>,
							) => void
						)(null, [{ address, family }]);
					else callback(null, address, family);
				},
			},
			(incoming) => {
				const status = incoming.statusCode ?? 0;
				const out = new Headers();
				for (const [name, value] of Object.entries(incoming.headers))
					for (const v of Array.isArray(value) ? value : [value])
						if (v !== undefined) out.append(name, v);
				// A Response may carry a body only for some statuses; a redirect's
				// is not wanted either.
				const bodiless = status < 200 || status === 204 || status === 304;
				const redirect = status >= 300 && status < 400;
				if (bodiless || redirect) incoming.resume();
				if (status < 200 || status > 599) {
					reject(new Error(`The address answered with status ${status}`));
					return;
				}
				resolve(
					new Response(
						bodiless || redirect
							? null
							: (Readable.toWeb(incoming) as unknown as ConstructorParameters<
									typeof Response
								>[0]),
						{ status, statusText: incoming.statusMessage ?? "", headers: out },
					),
				);
			},
		);
		req.on("error", reject);
		req.end();
	});

/**
 * Fetch a web address, refusing any address (first or redirected) that is
 * not public, and connecting to the address that was checked. `lookup` and
 * `fetchImpl` are injectable for tests.
 */
export async function fetchPublic(
	raw: string,
	init: RequestInit = {},
	{
		lookup,
		fetchImpl = requestAt,
		maxRedirects = 5,
	}: { lookup: Lookup; fetchImpl?: FetchAt; maxRedirects?: number },
): Promise<Response> {
	let url = parsePublicUrl(raw);
	for (let hop = 0; ; hop++) {
		const [address] = await assertPublicHost(url, lookup);
		const res = await fetchImpl(
			url.href,
			{ ...init, redirect: "manual" },
			address,
		);
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

import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
	isPublicAddress,
	parsePublicUrl,
	assertPublicHost,
	fetchPublic,
	requestAt,
} from "../../../src/server/lib/core/public-url.ts";

describe("isPublicAddress", () => {
	it.each([
		"127.0.0.1",
		"127.8.8.8",
		"10.0.0.5",
		"172.16.0.1",
		"172.31.255.255",
		"192.168.1.1",
		"169.254.169.254", // cloud metadata
		"100.64.0.1",
		"0.0.0.0",
		"224.0.0.1",
		"255.255.255.255",
		"::1",
		"::",
		"fe80::1",
		"fd12:3456::1",
		"ff02::1",
		"::ffff:127.0.0.1",
		"::ffff:192.168.0.10",
		"64:ff9b::10.0.0.1",
		"[::1]",
		"fe80::1%eth0",
		// IPv6 forms that carry an IPv4 address, written in hex (D70): each
		// leads where the IPv4 address does.
		"::ffff:7f00:1", // mapped 127.0.0.1
		"::ffff:0:7f00:1", // translated 127.0.0.1
		"64:ff9b::7f00:1", // NAT64 to 127.0.0.1
		"64:ff9b::a9fe:a9fe", // NAT64 to 169.254.169.254
		"2002:7f00:1::", // 6to4 of 127.0.0.1
		"2002:c0a8:101::1", // 6to4 of 192.168.1.1
		"::7f00:1", // IPv4-compatible 127.0.0.1
		"::10.0.0.1",
		"0:0:0:0:0:ffff:c0a8:0101", // mapped 192.168.1.1, written out
		// Ranges that are not plain public addresses.
		"fec0::1", // site-local
		"64:ff9b:1::1", // local-use translation
		"2001::1", // Teredo
	])("refuses %s", (a) => expect(isPublicAddress(a)).toBe(false));

	it.each([
		"93.184.215.14",
		"8.8.8.8",
		"172.32.0.1",
		"2606:4700:4700::1111",
		"::ffff:8.8.8.8",
		"::ffff:808:808",
		"64:ff9b::808:808",
		"2002:808:808::1",
		"2001:4860:4860::8888",
	])("accepts %s", (a) => expect(isPublicAddress(a)).toBe(true));

	it("refuses anything that is not an address", () => {
		expect(isPublicAddress("localhost")).toBe(false);
		expect(isPublicAddress("")).toBe(false);
	});
});

describe("parsePublicUrl", () => {
	it("accepts http and https", () => {
		expect(
			parsePublicUrl(" https://upload.wikimedia.org/a.jpg ").hostname,
		).toBe("upload.wikimedia.org");
	});

	it("refuses other schemes and embedded credentials, saying why", () => {
		expect(() => parsePublicUrl("file:///etc/passwd")).toThrow(
			/Only http and https/,
		);
		expect(() => parsePublicUrl("ftp://example.org/x")).toThrow(
			/Only http and https/,
		);
		expect(() => parsePublicUrl("https://user:pw@example.org/x")).toThrow(
			/user name or password/,
		);
		expect(() => parsePublicUrl("not a url")).toThrow(/not a web address/);
	});
});

describe("assertPublicHost", () => {
	const resolvesTo =
		(...addresses: string[]) =>
		async () =>
			addresses.map((address) => ({ address }));

	it("refuses a name that resolves to this machine, even if another address is public", async () => {
		await expect(
			assertPublicHost(new URL("http://localhost/"), resolvesTo("127.0.0.1")),
		).rejects.toThrow(/not on the public internet/);
		await expect(
			assertPublicHost(
				new URL("http://mixed.example/"),
				resolvesTo("8.8.8.8", "10.0.0.1"),
			),
		).rejects.toThrow(/10\.0\.0\.1/);
	});

	it("checks an address in the URL without looking it up", async () => {
		const never = async () => {
			throw new Error("lookup should not run");
		};
		await expect(
			assertPublicHost(new URL("http://[::1]:5432/"), never),
		).rejects.toThrow(/not on the public internet/);
		await expect(
			assertPublicHost(new URL("http://8.8.8.8/"), never),
		).resolves.toEqual(["8.8.8.8"]);
	});

	it("answers with the addresses it checked, for the request to be made to", async () => {
		await expect(
			assertPublicHost(
				new URL("https://images.example/a.jpg"),
				resolvesTo("93.184.215.14", "2606:4700:4700::1111"),
			),
		).resolves.toEqual(["93.184.215.14", "2606:4700:4700::1111"]);
	});

	it("refuses a name that resolves to nothing", async () => {
		await expect(
			assertPublicHost(new URL("http://nowhere.example/"), resolvesTo()),
		).rejects.toThrow(/does not resolve/);
	});
});

describe("fetchPublic", () => {
	const dns: Record<string, string> = {
		"images.example": "93.184.215.14",
		"intranet.example": "192.168.1.20",
	};
	const lookup = async (host: string) =>
		dns[host] ? [{ address: dns[host] }] : [];
	const response = (status: number, location?: string) =>
		new Response(status === 200 ? "image bytes" : null, {
			status,
			headers: location ? { location } : {},
		});

	it("fetches a public address, asking fetch not to follow redirects itself", async () => {
		const seen: RequestInit[] = [];
		const res = await fetchPublic(
			"https://images.example/a.jpg",
			{ headers: { "User-Agent": "t" } },
			{
				lookup,
				fetchImpl: async (_url, init) => {
					seen.push(init);
					return response(200);
				},
			},
		);
		expect(res.status).toBe(200);
		expect(seen[0]).toMatchObject({
			redirect: "manual",
			headers: { "User-Agent": "t" },
		});
	});

	it("re-checks every redirect, so a public page cannot bounce the server to the local network", async () => {
		const fetched: string[] = [];
		const fetchImpl = async (url: string) => {
			fetched.push(url);
			return url.includes("images.example")
				? response(302, "http://intranet.example/admin")
				: response(200);
		};
		await expect(
			fetchPublic("https://images.example/a.jpg", {}, { lookup, fetchImpl }),
		).rejects.toThrow(/192\.168\.1\.20/);
		expect(fetched).toEqual(["https://images.example/a.jpg"]);
	});

	it("follows a relative redirect on the same public host, and stops after too many", async () => {
		const fetchImpl = async (url: string) =>
			url.endsWith("/a.jpg") ? response(301, "/b.jpg") : response(200);
		expect(
			(
				await fetchPublic(
					"https://images.example/a.jpg",
					{},
					{ lookup, fetchImpl },
				)
			).status,
		).toBe(200);

		const loop = async () => response(302, "/again");
		await expect(
			fetchPublic(
				"https://images.example/x",
				{},
				{ lookup, fetchImpl: loop, maxRedirects: 3 },
			),
		).rejects.toThrow(/More than 3 redirects/);
	});
});

describe("the request goes to the address that was checked (D70)", () => {
	it("hands the checked address to the request, and never asks for the name twice", async () => {
		// A hostile DNS server: public the first time it is asked, this machine
		// from then on. Asking again when connecting is how rebinding works.
		let asked = 0;
		const rebinding = async () => [
			{ address: asked++ === 0 ? "93.184.215.14" : "127.0.0.1" },
		];
		const connected: string[] = [];
		const res = await fetchPublic(
			"http://rebind.example/a.jpg",
			{},
			{
				lookup: rebinding,
				fetchImpl: async (_url, _init, address) => {
					connected.push(address);
					return new Response("bytes");
				},
			},
		);
		expect(res.status).toBe(200);
		expect(asked).toBe(1);
		expect(connected).toEqual(["93.184.215.14"]);
	});

	it("checks each redirect's host afresh and connects to that check's address", async () => {
		const dns: Record<string, string> = {
			"a.example": "93.184.215.14",
			"b.example": "8.8.8.8",
		};
		const connected: Array<[string, string]> = [];
		await fetchPublic(
			"https://a.example/x",
			{},
			{
				lookup: async (host) => [{ address: dns[host] }],
				fetchImpl: async (url, _init, address) => {
					connected.push([new URL(url).hostname, address]);
					return url.includes("a.example")
						? new Response(null, {
								status: 302,
								headers: { location: "https://b.example/y" },
							})
						: new Response("bytes");
				},
			},
		);
		expect(connected).toEqual([
			["a.example", "93.184.215.14"],
			["b.example", "8.8.8.8"],
		]);
	});

	describe("requestAt, against a server on this machine", () => {
		let server: Server;
		let port = 0;
		const seen: Array<{ host?: string; agent?: string; encoding?: string }> =
			[];
		beforeAll(async () => {
			server = createServer((req, res) => {
				seen.push({
					host: req.headers.host,
					agent: req.headers["user-agent"],
					encoding: req.headers["accept-encoding"] as string,
				});
				if (req.url === "/moved") {
					res.writeHead(302, { location: "/there" }).end("gone");
					return;
				}
				res.writeHead(200, { "content-type": "image/png" }).end("png bytes");
			}).listen(0, "127.0.0.1");
			await new Promise((r) => server.once("listening", r));
			port = (server.address() as AddressInfo).port;
		});
		afterAll(() => new Promise((r) => server.close(r)));

		it("connects to the address it is given, whatever the name would resolve to", async () => {
			// The name resolves nowhere; the connection goes to the address.
			const res = await requestAt(
				`http://no-such-host.invalid:${port}/a.png`,
				{ headers: { "User-Agent": "tracker-test" } },
				"127.0.0.1",
			);
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toBe("image/png");
			expect(await res.text()).toBe("png bytes");
			// The server is still asked for the name, and for the bytes as they are.
			expect(seen.at(-1)).toEqual({
				host: `no-such-host.invalid:${port}`,
				agent: "tracker-test",
				encoding: "identity",
			});
		});

		it("does not follow a redirect itself: the caller checks where it leads", async () => {
			const res = await requestAt(
				`http://no-such-host.invalid:${port}/moved`,
				{},
				"127.0.0.1",
			);
			expect(res.status).toBe(302);
			expect(res.headers.get("location")).toBe("/there");
		});

		it("fails as an error, not a crash, when nothing answers at the address", async () => {
			const closed = createServer().listen(0, "127.0.0.1");
			await new Promise((r) => closed.once("listening", r));
			const free = (closed.address() as AddressInfo).port;
			await new Promise((r) => closed.close(r));
			await expect(
				requestAt(`http://no-such-host.invalid:${free}/`, {}, "127.0.0.1"),
			).rejects.toThrow(/ECONNREFUSED/);
			await expect(
				requestAt("http://no-such-host.invalid/", {}, "not an address"),
			).rejects.toThrow(/is not an address/);
		});
	});
});

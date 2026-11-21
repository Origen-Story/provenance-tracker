import { describe, it, expect } from "vitest";
import {
	isPublicAddress,
	parsePublicUrl,
	assertPublicHost,
	fetchPublic,
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
	])("refuses %s", (a) => expect(isPublicAddress(a)).toBe(false));

	it.each([
		"93.184.215.14",
		"8.8.8.8",
		"172.32.0.1",
		"2606:4700:4700::1111",
		"::ffff:8.8.8.8",
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
		).resolves.toBeUndefined();
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

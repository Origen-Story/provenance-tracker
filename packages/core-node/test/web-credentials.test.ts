// This machine's fetch for Content Credentials a file keeps on the web
// (D74): what it asks the network for under each setting, and what it never
// asks. The network is a stand-in; no test makes a request.

import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { FetchAt } from "../src/public-url.ts";
import {
	decideWebCredentialHost,
	setWebCredentialMode,
	updateSettings,
	webCredentialChoiceOf,
	readSettings,
} from "../src/settings.ts";
import { neverFetch, webCredentialsFor } from "../src/web-credentials.ts";
import type { Machine } from "../src/machine.ts";
import { machinesForTests } from "./helpers/machine.ts";

const t = machinesForTests();

const ADOBE = "https://cai-manifests.adobe.com/manifests/abc-123";
const OTHER = "https://credentials.example.org/m/1.c2pa";
const BYTES = Buffer.from(
	"not really a manifest store, but bytes all the same",
);

/** A network that answers every public name, and records what it was asked. */
function network(
	answer: (url: string) => Response = () => new Response(BYTES),
	addresses: Record<string, string> = {},
) {
	const asked: string[] = [];
	const looked: string[] = [];
	const fetchImpl: FetchAt = async (url, _init, address) => {
		asked.push(`${url} at ${address}`);
		return answer(url);
	};
	const lookup = async (host: string) => {
		looked.push(host);
		return [{ address: addresses[host] ?? "93.184.216.34" }];
	};
	return { asked, looked, deps: { fetchImpl, lookup } };
}

const held = async (m: Machine, address: string, n = network()) => {
	const got = await webCredentialsFor(m, n.deps)(address);
	if (!("onTheWeb" in got)) throw new Error("it was fetched");
	return { ...got.onTheWeb, asked: n.asked, looked: n.looked };
};

describe("webCredentialsFor (D74)", () => {
	it("asks the network for nothing until the person has chosen", async () => {
		const m = t.machine();
		expect(await held(m, ADOBE)).toEqual({
			address: ADOBE,
			host: "cai-manifests.adobe.com",
			outcome: "not-chosen",
			asked: [],
			looked: [],
		});
	});

	it("asks for nothing when told never", async () => {
		const m = t.machine();
		updateSettings(m.settingsPath, (s) => setWebCredentialMode(s, "never"));
		expect(await held(m, ADOBE)).toMatchObject({
			outcome: "never",
			asked: [],
			looked: [],
		});
	});

	it("with the list in force, fetches from a listed host and not even looks up another", async () => {
		const m = t.machine();
		updateSettings(m.settingsPath, (s) => setWebCredentialMode(s, "listed"));
		const n = network();
		const fetch = webCredentialsFor(m, n.deps);
		expect(await fetch(ADOBE)).toEqual({ bytes: BYTES });
		expect(n.asked).toEqual([`${ADOBE} at 93.184.216.34`]);
		expect(await held(m, OTHER)).toMatchObject({
			host: "credentials.example.org",
			outcome: "not-listed",
			asked: [],
			looked: [],
		});
	});

	it("reads the setting each time it is asked, so allowing or leaving a host holds for the next file", async () => {
		const m = t.machine();
		updateSettings(m.settingsPath, (s) => setWebCredentialMode(s, "listed"));
		const n = network();
		const fetch = webCredentialsFor(m, n.deps);
		expect(await fetch(OTHER)).toMatchObject({
			onTheWeb: { outcome: "not-listed" },
		});
		updateSettings(m.settingsPath, (s) =>
			decideWebCredentialHost(s, "credentials.example.org", "allow"),
		);
		expect(await fetch(OTHER)).toEqual({ bytes: BYTES });
		updateSettings(m.settingsPath, (s) =>
			decideWebCredentialHost(s, "credentials.example.org", "leave"),
		);
		expect(await fetch(OTHER)).toMatchObject({ onTheWeb: { outcome: "left" } });
		expect(n.asked).toHaveLength(1);
		updateSettings(m.settingsPath, (s) =>
			decideWebCredentialHost(s, "credentials.example.org", "forget"),
		);
		expect(await fetch(OTHER)).toMatchObject({
			onTheWeb: { outcome: "not-listed" },
		});
	});

	it("fetches from any https host when told any, and still from no other kind of address", async () => {
		const m = t.machine();
		updateSettings(m.settingsPath, (s) => setWebCredentialMode(s, "any"));
		const n = network();
		expect(await webCredentialsFor(m, n.deps)(OTHER)).toEqual({ bytes: BYTES });
		expect(
			await held(m, "http://credentials.example.org/m/1.c2pa"),
		).toMatchObject({ host: null, outcome: "refused", asked: [] });
	});

	it("never asks an address on this machine or the local network, whatever a file says", async () => {
		const m = t.machine();
		updateSettings(m.settingsPath, (s) => setWebCredentialMode(s, "any"));
		for (const local of ["127.0.0.1", "10.0.0.5", "169.254.169.254", "::1"]) {
			const n = network(undefined, { "credentials.example.org": local });
			const w = await held(m, OTHER, n);
			expect(w, local).toMatchObject({ outcome: "failed", asked: [] });
			expect(w.detail).toMatch(/not on the public internet/);
		}
	});

	it("holds a redirect to the same list: a listed host cannot hand the request on", async () => {
		const m = t.machine();
		updateSettings(m.settingsPath, (s) => setWebCredentialMode(s, "listed"));
		const n = network((url) =>
			url.startsWith("https://cai-manifests.adobe.com")
				? new Response(null, {
						status: 302,
						headers: { location: "https://elsewhere.example.net/m" },
					})
				: new Response(BYTES),
		);
		const w = await held(m, ADOBE, n);
		expect(w).toMatchObject({ outcome: "failed" });
		expect(w.detail).toMatch(/leads to elsewhere\.example\.net/);
		expect(n.asked).toEqual([`${ADOBE} at 93.184.216.34`]);
		expect(n.looked).toEqual(["cai-manifests.adobe.com"]);
		// To plain http: refused under every mode.
		updateSettings(m.settingsPath, (s) => setWebCredentialMode(s, "any"));
		const down = network((url) =>
			url.startsWith("https://")
				? new Response(null, {
						status: 301,
						headers: { location: "http://cai-manifests.adobe.com/m" },
					})
				: new Response(BYTES),
		);
		expect((await held(m, ADOBE, down)).detail).toMatch(/only https/);
		expect(down.asked).toHaveLength(1);
	});

	it("follows a redirect that stays on the list", async () => {
		const m = t.machine();
		updateSettings(m.settingsPath, (s) => setWebCredentialMode(s, "listed"));
		const n = network((url) =>
			url.endsWith("/abc-123")
				? new Response(null, {
						status: 302,
						headers: { location: "/manifests/abc-123.c2pa" },
					})
				: new Response(BYTES),
		);
		expect(await webCredentialsFor(m, n.deps)(ADOBE)).toEqual({ bytes: BYTES });
		expect(n.asked).toHaveLength(2);
	});

	it("says what went wrong when the address does not give credentials", async () => {
		const m = t.machine();
		updateSettings(m.settingsPath, (s) => setWebCredentialMode(s, "any"));
		expect(
			await held(
				m,
				ADOBE,
				network(() => new Response("gone", { status: 404 })),
			),
		).toMatchObject({
			outcome: "failed",
			detail: "the server answered with status 404",
		});
		expect(
			await held(
				m,
				ADOBE,
				network(() => new Response(null, { status: 200 })),
			),
		).toMatchObject({ outcome: "failed", detail: "the server sent nothing" });
		const down = network(() => {
			throw new Error("connect ECONNREFUSED");
		});
		expect(await held(m, ADOBE, down)).toMatchObject({
			outcome: "failed",
			detail: "connect ECONNREFUSED",
		});
	});

	it("takes no more than its size limit, declared or not", async () => {
		const m = t.machine();
		updateSettings(m.settingsPath, (s) => setWebCredentialMode(s, "any"));
		const limits = { wholeMs: 5000, maxBytes: 16 };
		const declared = network(
			() => new Response("x", { headers: { "content-length": "999999" } }),
		);
		expect(
			await webCredentialsFor(m, { ...declared.deps, limits })(ADOBE),
		).toMatchObject({
			onTheWeb: {
				outcome: "failed",
				detail: expect.stringMatching(/offers 999999 bytes/),
			},
		});
		const silent = network(() => new Response(Buffer.alloc(64)));
		expect(
			await webCredentialsFor(m, { ...silent.deps, limits })(ADOBE),
		).toMatchObject({
			onTheWeb: {
				outcome: "failed",
				detail: expect.stringMatching(/more than the 16 bytes/),
			},
		});
		const fits = network(() => new Response(Buffer.alloc(16)));
		expect(await webCredentialsFor(m, { ...fits.deps, limits })(ADOBE)).toEqual(
			{ bytes: Buffer.alloc(16) },
		);
	});

	it("stops a server that never answers", async () => {
		const m = t.machine();
		updateSettings(m.settingsPath, (s) => setWebCredentialMode(s, "any"));
		const fetchImpl: FetchAt = (_url, init) =>
			new Promise((_resolve, reject) => {
				init.signal?.addEventListener("abort", () =>
					reject(init.signal?.reason ?? new Error("aborted")),
				);
			});
		const got = await webCredentialsFor(m, {
			fetchImpl,
			lookup: async () => [{ address: "93.184.216.34" }],
			limits: { wholeMs: 50, maxBytes: 1024 },
		})(ADOBE);
		expect(got).toMatchObject({
			onTheWeb: {
				outcome: "failed",
				detail: "it was not done within 0.05 seconds",
			},
		});
	});

	it("sends a request that names the tracker and nothing about the person", async () => {
		const m = t.machine();
		updateSettings(m.settingsPath, (s) => {
			s.person = "A. Maker";
			setWebCredentialMode(s, "any");
		});
		let headers = new Headers();
		const fetchImpl: FetchAt = async (_url, init) => {
			headers = new Headers(init.headers);
			return new Response(BYTES);
		};
		await webCredentialsFor(m, {
			fetchImpl,
			lookup: async () => [{ address: "93.184.216.34" }],
		})(ADOBE);
		expect(headers.get("user-agent")).toMatch(/^provenancetracker\/\d/);
		expect([...headers.keys()].sort()).toEqual(["accept", "user-agent"]);
		expect(JSON.stringify([...headers])).not.toContain("Maker");
	});
});

describe("the switch from before D74", () => {
	const legacy = (m: Machine, value: boolean) => {
		mkdirSync(path.dirname(m.settingsPath), { recursive: true });
		writeFileSync(
			m.settingsPath,
			JSON.stringify({ format: 1, remoteCredentials: value, projects: {} }),
		);
	};

	it("still means never when it was off", async () => {
		const m = t.machine();
		legacy(m, false);
		expect(webCredentialChoiceOf(readSettings(m.settingsPath)).mode).toBe(
			"never",
		);
		expect(await held(m, ADOBE)).toMatchObject({ outcome: "never", asked: [] });
	});

	it("no longer means fetch from anywhere when it was on: the person is asked", async () => {
		const m = t.machine();
		legacy(m, true);
		expect(webCredentialChoiceOf(readSettings(m.settingsPath)).mode).toBeNull();
		expect(await held(m, ADOBE)).toMatchObject({
			outcome: "not-chosen",
			asked: [],
		});
	});

	it("is taken out when a mode is set", () => {
		const m = t.machine();
		legacy(m, false);
		const s = updateSettings(m.settingsPath, (s) =>
			setWebCredentialMode(s, "listed"),
		);
		expect(s.remoteCredentials).toBeUndefined();
		expect(readSettings(m.settingsPath).credentialsOnTheWeb).toEqual({
			mode: "listed",
		});
	});
});

describe("neverFetch", () => {
	it("holds every address back", async () => {
		expect(await neverFetch(ADOBE)).toEqual({
			onTheWeb: {
				address: ADOBE,
				host: "cai-manifests.adobe.com",
				outcome: "never",
			},
		});
		expect(await neverFetch("ftp://x")).toMatchObject({
			onTheWeb: { outcome: "refused" },
		});
	});
});

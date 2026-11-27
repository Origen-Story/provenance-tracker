// Pure tests for the local-only guard: which requests the API answers.
import { describe, it, expect } from "vitest";
import {
	checkLocalRequest,
	listenHost,
	allowedHostnames,
	isLoopbackAddress,
	isLoopbackHost,
	localOnly,
} from "../../../src/server/lib/core/local-only.js";

// Each request comes from this machine unless it says where from.
const from = (r) => ({ remoteAddress: "127.0.0.1", ...r });
const ok = (r) => expect(checkLocalRequest(from(r))).toEqual({ ok: true });
const refused = (r) => expect(checkLocalRequest(from(r)).ok).toBe(false);

describe("listenHost", () => {
	it("is loopback unless HOST is set", () => {
		expect(listenHost({})).toBe("127.0.0.1");
		expect(listenHost({ HOST: "  " })).toBe("127.0.0.1");
		expect(listenHost({ HOST: "0.0.0.0" })).toBe("0.0.0.0");
	});
});

describe("allowedHostnames", () => {
	it("is empty by default and for a wildcard HOST", () => {
		expect(allowedHostnames({})).toEqual([]);
		expect(allowedHostnames({ HOST: "0.0.0.0" })).toEqual([]);
		expect(allowedHostnames({ HOST: "::" })).toEqual([]);
	});

	it("adds a specific HOST address and the ALLOWED_HOSTS list", () => {
		expect(allowedHostnames({ HOST: "192.168.1.20" })).toEqual([
			"192.168.1.20",
		]);
		expect(
			allowedHostnames({
				HOST: "0.0.0.0",
				ALLOWED_HOSTS: "Tracker.example.net, tracker.example.net ,",
			}),
		).toEqual(["tracker.example.net"]);
	});

	it("takes the name from an entry written with a port, and a bare IPv6 address", () => {
		expect(
			allowedHostnames({
				ALLOWED_HOSTS:
					"tracker.example.net:8443, [2001:db8::1]:3001, 2001:db8::2",
			}),
		).toEqual(["tracker.example.net", "2001:db8::1", "2001:db8::2"]);
	});

	it("never takes a loopback name: localhost from another machine is always a lie", () => {
		expect(
			allowedHostnames({
				HOST: "0.0.0.0",
				ALLOWED_HOSTS: "localhost, 127.0.0.1, ::1, LocalHost:3001, not a host",
			}),
		).toEqual([]);
	});
});

describe("isLoopbackAddress", () => {
	it("knows a connection from this machine, also IPv4 written inside IPv6", () => {
		for (const a of ["127.0.0.1", "127.8.9.10", "::1", "::ffff:127.0.0.1"])
			expect(isLoopbackAddress(a), a).toBe(true);
	});
	it("refuses every other address, and no address at all", () => {
		for (const a of [
			"192.168.1.20",
			"10.0.0.1",
			"::ffff:192.168.1.20",
			"128.0.0.1",
			"127.0.0.1.example.com",
			"127.0.0",
			"127.0.0.999",
			"fe80::1",
			"localhost",
			"",
			undefined,
		])
			expect(isLoopbackAddress(a), String(a)).toBe(false);
	});
});

describe("isLoopbackHost", () => {
	it("knows the three loopback names", () => {
		for (const h of ["localhost", "127.0.0.1", "::1", "[::1]", "LOCALHOST"])
			expect(isLoopbackHost(h)).toBe(true);
		for (const h of ["0.0.0.0", "192.168.1.20", "example.com", ""])
			expect(isLoopbackHost(h)).toBe(false);
	});
});

describe("checkLocalRequest", () => {
	it("accepts the API port and the Vite dev port under any loopback name", () => {
		ok({ host: "localhost:3001" });
		ok({ host: "127.0.0.1:3001" });
		ok({ host: "[::1]:3001" });
		ok({ host: "LocalHost:5173" });
		ok({ host: "localhost.:3001" });
	});

	it("accepts a same-origin request, as the browser sends through the Vite proxy", () => {
		ok({
			host: "localhost:5173",
			origin: "http://localhost:5173",
			secFetchSite: "same-origin",
		});
		ok({ host: "127.0.0.1:3001", origin: "http://127.0.0.1:3001" });
		ok({ host: "localhost", origin: "http://localhost" });
	});

	it("refuses a Host that is not this machine (DNS rebinding, a LAN address)", () => {
		refused({ host: "example.com" });
		refused({ host: "attacker.example:3001" });
		refused({ host: "192.168.1.20:3001" });
		refused({ host: "localhost.example.com:3001" });
		refused({ host: "127.0.0.1.example.com" });
	});

	it("refuses a missing or malformed Host", () => {
		refused({});
		refused({ host: "" });
		refused({ host: "localhost:3001/evil" });
		refused({ host: "user@localhost:3001" });
		refused({ host: "local host" });
	});

	it("refuses another site posting to the local API", () => {
		refused({ host: "localhost:3001", origin: "https://attacker.example" });
		refused({ host: "127.0.0.1:3001", origin: "null" });
		refused({ host: "localhost:3001", origin: "file://" });
	});

	it("refuses another local page: Origin must match Host, port included", () => {
		refused({ host: "localhost:3001", origin: "http://localhost:8080" });
		refused({ host: "localhost:3001", origin: "http://127.0.0.1:3001" });
	});

	it("refuses what the browser labels cross-site, even with no Origin (an <img> or a link on another site)", () => {
		refused({ host: "localhost:3001", secFetchSite: "cross-site" });
		ok({ host: "localhost:3001", secFetchSite: "none" });
		// A page on another port of this machine is some other program's page:
		// the tracker's own are same-origin (D85).
		refused({ host: "localhost:3001", secFetchSite: "same-site" });
		refused({
			host: "localhost:3001",
			origin: "http://localhost:3001",
			secFetchSite: "Same-Site",
		});
		ok({ host: "localhost:3001", secFetchSite: "same-origin" });
		// An address typed, or a link followed from outside a page.
		ok({ host: "localhost:3001", secFetchSite: "none" });
		// No such header: not a browser page (a script, the command line).
		ok({ host: "localhost:3001" });
	});

	it("accepts a named host only when it is on the allowed list", () => {
		const allowedHosts = ["tracker.example.net"];
		ok({
			host: "tracker.example.net",
			origin: "https://tracker.example.net",
			allowedHosts,
		});
		refused({
			host: "tracker.example.net",
			origin: "https://other.example.net",
			allowedHosts,
		});
		refused({ host: "other.example.net", allowedHosts });
	});
});

describe("a loopback Host name is this machine only from this machine (D66)", () => {
	it("refuses Host: localhost on a connection from another machine, whatever else it says", () => {
		for (const host of ["localhost:3001", "127.0.0.1:3001", "[::1]:3001"])
			for (const remoteAddress of [
				"192.168.1.20",
				"::ffff:192.168.1.20",
				"203.0.113.9",
				"",
				undefined,
			]) {
				const verdict = checkLocalRequest({
					host,
					origin: `http://${host}`,
					secFetchSite: "same-origin",
					remoteAddress,
				});
				expect(verdict.ok, `${host} from ${remoteAddress}`).toBe(false);
			}
		expect(
			checkLocalRequest({ host: "localhost:3001", remoteAddress: "10.0.0.7" })
				.reason,
		).toBe('Host "localhost" from 10.0.0.7, which is not this machine');
	});

	it("still refuses it when HOST or ALLOWED_HOSTS name something else", () => {
		const allowedHosts = allowedHostnames({
			HOST: "192.168.1.5",
			ALLOWED_HOSTS: "tracker.example.net, localhost",
		});
		refused({
			host: "localhost:3001",
			remoteAddress: "192.168.1.20",
			allowedHosts,
		});
		// A listed name is answered from anywhere: that is what a login in
		// front of it is for.
		ok({
			host: "tracker.example.net",
			remoteAddress: "192.168.1.20",
			allowedHosts,
		});
		ok({
			host: "192.168.1.5:3001",
			remoteAddress: "192.168.1.20",
			allowedHosts,
		});
	});

	it("accepts it from this machine: the browser, the dev proxy, a proxy on the same machine", () => {
		ok({ host: "localhost:3001", remoteAddress: "::1" });
		ok({ host: "localhost:5173", remoteAddress: "::ffff:127.0.0.1" });
	});
});

describe("localOnly middleware", () => {
	function run(headers, remoteAddress = "127.0.0.1") {
		const res = {
			code: 200,
			body: null,
			status(c) {
				this.code = c;
				return this;
			},
			json(b) {
				this.body = b;
				return this;
			},
		};
		let passed = false;
		const refusals = [];
		localOnly({ onRefuse: (_req, reason) => refusals.push(reason) })(
			{ headers, socket: { remoteAddress } },
			res,
			() => {
				passed = true;
			},
		);
		return { res, passed, refusals };
	}

	it("passes a local request on", () => {
		const r = run({ host: "localhost:3001" });
		expect(r.passed).toBe(true);
		expect(r.refusals).toEqual([]);
	});

	it("answers 403 without echoing the header back, and reports the reason to the logger", () => {
		const r = run({
			host: "attacker.example",
			origin: "https://attacker.example",
		});
		expect(r.passed).toBe(false);
		expect(r.res.code).toBe(403);
		expect(JSON.stringify(r.res.body)).not.toContain("attacker");
		expect(r.refusals).toHaveLength(1);
	});

	it("reads where the connection came from off the socket, never a header", () => {
		const r = run(
			{ host: "localhost:3001", "x-forwarded-for": "127.0.0.1" },
			"192.168.1.20",
		);
		expect(r.passed).toBe(false);
		expect(r.res.code).toBe(403);
	});
});

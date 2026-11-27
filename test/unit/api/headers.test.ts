// The headers on everything the app sends (D85): its pages and its API
// alike say that no other site may frame them, that scripts come only from
// the app, and that a file is the type the server says. Over real HTTP.

import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp, SECURITY_HEADERS } from "../../../src/server/app.ts";

const temps: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
	for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
	for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function serve() {
	const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "pt-hdr-")));
	temps.push(dir);
	mkdirSync(path.join(dir, "home"));
	const server = createApp({
		env: {},
		machine: {
			platform: process.platform,
			env: {},
			home: path.join(dir, "home"),
			settingsPath: path.join(dir, "settings.json"),
		},
		// A page, as the built pages are mounted in production.
		mount: (app) => {
			app.get("/", (_req, res) => {
				res.type("html").send("<!doctype html><title>page</title>");
			});
		},
	}).listen(0, "127.0.0.1");
	servers.push(server);
	await new Promise((r) => server.once("listening", r));
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("what every answer carries (D85)", () => {
	it("is the same on a page, an API answer, a refusal and a missing address", async () => {
		const base = await serve();
		const answers = [
			await fetch(`${base}/`),
			await fetch(`${base}/api/projects`),
			// Refused by the request guard: another site's page.
			await fetch(`${base}/api/projects`, {
				headers: { "sec-fetch-site": "cross-site" },
			}),
			await fetch(`${base}/api/projects/not-a-project`),
		];
		expect(answers.map((r) => r.status)).toEqual([200, 200, 403, 404]);
		for (const r of answers) {
			for (const [name, value] of Object.entries(SECURITY_HEADERS))
				expect(r.headers.get(name), `${r.url} ${name}`).toBe(value);
			// What the server is built with is nobody's business.
			expect(r.headers.get("x-powered-by")).toBeNull();
		}
	});

	it("lets no other site frame the app, and runs no script but the app's own", () => {
		const csp = SECURITY_HEADERS["Content-Security-Policy"];
		expect(csp).toContain("frame-ancestors 'none'");
		expect(csp).toContain("script-src 'self'");
		expect(csp).toContain("object-src 'none'");
		// No script may be inline or built from text, and nothing loads from another site.
		const scripts = /script-src ([^;]+)/.exec(csp)![1];
		expect(scripts).not.toMatch(/unsafe-inline|unsafe-eval|https?:|\*/);
		expect(csp).not.toMatch(/https?:\/\/|\*/);
		expect(SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
		expect(SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
	});
});

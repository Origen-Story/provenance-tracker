// What the pages make of Content Credentials kept on the web (D74): what a
// project is waiting on, sorted into what the person is asked and what they
// are only told.

import { describe, expect, it } from "vitest";
import type {
	WaitingHost,
	WebCredentials,
} from "../../../src/client/catalog/api.ts";
import {
	MODES,
	filesWord,
	hasNotice,
	hostName,
	hostsInForce,
	modeSentence,
	noticeOf,
} from "../../../src/client/catalog/web-credentials.ts";

const waiting = (
	host: string | null,
	state: WaitingHost["state"],
	more: Partial<WaitingHost> = {},
): WaitingHost => ({
	host,
	address: host ? null : "http://plain.example.org/m",
	files: 2,
	state,
	outcome: "not-chosen",
	detail: null,
	...more,
});

describe("noticeOf", () => {
	it("shows nothing when nothing waits", () => {
		expect(hasNotice(noticeOf([]))).toBe(false);
	});

	it("asks once for a mode, whatever number of hosts wait on it", () => {
		const n = noticeOf([
			waiting("cai-manifests.adobe.com", "choose"),
			waiting("credentials.example.org", "choose"),
		]);
		expect(n.choose.map((w) => w.host)).toEqual([
			"cai-manifests.adobe.com",
			"credentials.example.org",
		]);
		expect(n.ask).toEqual([]);
		expect(n.read).toEqual([]);
		expect(n.told).toEqual([]);
		expect(hasNotice(n)).toBe(true);
	});

	it("asks about a host not on the list, offers to read what would be fetched now, and only tells the rest", () => {
		const n = noticeOf([
			waiting("credentials.example.org", "ask"),
			waiting("cai-manifests.adobe.com", "read", {
				outcome: "failed",
				detail: "the server answered with status 503",
			}),
			waiting("left.example.org", "left"),
			waiting("never.example.org", "never"),
			waiting(null, "cannot", {
				outcome: "refused",
				detail: "only https addresses are fetched, and this one is http",
			}),
		]);
		expect(n.ask.map((w) => w.host)).toEqual(["credentials.example.org"]);
		expect(n.read.map((w) => w.host)).toEqual(["cai-manifests.adobe.com"]);
		expect(n.told.map((t) => [hostName(t.host), t.why])).toEqual([
			["left.example.org", "you told this machine to leave that host"],
			["never.example.org", "this machine never fetches them"],
			[
				"http://plain.example.org/m",
				"only https addresses are fetched, and this one is http",
			],
		]);
	});
});

describe("the list as the page shows it", () => {
	const c = (more: Partial<WebCredentials>): WebCredentials => ({
		mode: "listed",
		builtIn: ["cai-manifests.adobe.com"],
		hosts: [],
		left: [],
		...more,
	});

	it("is the built-in hosts and the person's, less any they left", () => {
		expect(hostsInForce(c({ hosts: ["a.example.org"] }))).toEqual([
			"cai-manifests.adobe.com",
			"a.example.org",
		]);
		expect(
			hostsInForce(
				c({ hosts: ["a.example.org"], left: ["cai-manifests.adobe.com"] }),
			),
		).toEqual(["a.example.org"]);
	});

	it("offers the three modes, the list first and recommended", () => {
		expect(MODES.map((m) => m.mode)).toEqual(["listed", "any", "never"]);
		expect(MODES.filter((m) => m.recommended).map((m) => m.mode)).toEqual([
			"listed",
		]);
	});

	it("says each mode, and that nothing is fetched until one is chosen", () => {
		expect(modeSentence(null)).toMatch(/fetches nothing/);
		expect(modeSentence("never")).toBe("never fetches them");
		expect(modeSentence("listed")).toMatch(/only from the hosts on its list/);
		expect(modeSentence("any")).toMatch(/any host/);
		expect(filesWord(1)).toBe("1 file");
		expect(filesWord(3)).toBe("3 files");
	});
});

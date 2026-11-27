import { describe, expect, it } from "vitest";
import { libraryObservation } from "../../src/extraction/c2pa-library-read.ts";
import { makeObservation } from "../../src/extraction/observation.ts";
import {
	BUILT_IN_HOSTS,
	decideFetch,
	hostOfAddress,
	hostStateNow,
	hostsOnList,
	listedHost,
	notFetchedWords,
	onTheWebOfReading,
	remoteAddressOf,
	type OnTheWeb,
	type WebCredentialChoice,
} from "../../src/extraction/web-credentials.ts";

const ADOBE = "https://cai-manifests.adobe.com/manifests/abc-123";
const OTHER = "https://credentials.example.org/m/1.c2pa";

const choice = (
	mode: WebCredentialChoice["mode"],
	hosts: string[] = [],
	left: string[] = [],
): WebCredentialChoice => ({ mode, hosts, left });

describe("listedHost", () => {
	it("keeps a host name in lower case, with its port only when it is not 443", () => {
		expect(listedHost("  CAI-Manifests.Adobe.com ")).toBe(
			"cai-manifests.adobe.com",
		);
		expect(listedHost("example.org:443")).toBe("example.org");
		expect(listedHost("example.org:8443")).toBe("example.org:8443");
		expect(listedHost("https://Example.org/some/path?x=1")).toBe("example.org");
	});

	it.each([
		"",
		"localhost",
		"intranet",
		"10.0.0.1",
		"[::1]",
		"http://example.org/x",
		"exa mple.org",
		"example.org/path",
		"-bad.example.org",
		"user@example.org",
		"*.example.org",
	])("refuses %j", (text) => {
		expect(listedHost(text)).toBeNull();
	});
});

describe("hostOfAddress", () => {
	it("gives the host of an https address", () => {
		expect(hostOfAddress(ADOBE)).toEqual({ host: "cai-manifests.adobe.com" });
		expect(hostOfAddress("https://example.org:8443/x")).toEqual({
			host: "example.org:8443",
		});
	});

	it("says why no setting would fetch anything else", () => {
		const refused = (a: string) =>
			(hostOfAddress(a) as { refused: string }).refused;
		expect(refused("http://example.org/x")).toMatch(/only https/);
		expect(refused("file:///etc/passwd")).toMatch(/only https/);
		expect(refused("not an address")).toMatch(/not a web address/);
		expect(refused("https://user:pw@example.org/x")).toMatch(
			/user name or password/,
		);
		expect(refused("https://127.0.0.1/x")).toMatch(/not a host name/);
		expect(refused("https://localhost/x")).toMatch(/not a host name/);
	});
});

describe("decideFetch (D74)", () => {
	it("fetches nothing until the person has chosen", () => {
		expect(decideFetch(choice(null), ADOBE)).toEqual({
			fetch: false,
			onTheWeb: {
				address: ADOBE,
				host: "cai-manifests.adobe.com",
				outcome: "not-chosen",
			},
		});
	});

	it("never fetches when told never, and fetches any https host when told any", () => {
		expect(decideFetch(choice("never", ["example.org"]), ADOBE)).toMatchObject({
			fetch: false,
			onTheWeb: { outcome: "never" },
		});
		expect(decideFetch(choice("any"), OTHER)).toEqual({
			fetch: true,
			host: "credentials.example.org",
		});
	});

	it("with the list in force, fetches from a built-in or added host and no other", () => {
		expect(BUILT_IN_HOSTS).toContain("cai-manifests.adobe.com");
		expect(decideFetch(choice("listed"), ADOBE)).toMatchObject({ fetch: true });
		expect(decideFetch(choice("listed"), OTHER)).toMatchObject({
			fetch: false,
			onTheWeb: { host: "credentials.example.org", outcome: "not-listed" },
		});
		expect(
			decideFetch(choice("listed", ["credentials.example.org"]), OTHER),
		).toMatchObject({ fetch: true });
		// A host on the list is that host, not its neighbours or another port.
		expect(
			decideFetch(
				choice("listed", ["example.org"]),
				"https://evil.example.org/x",
			),
		).toMatchObject({ fetch: false });
		expect(
			decideFetch(
				choice("listed", ["example.org"]),
				"https://example.org:8443/x",
			),
		).toMatchObject({ fetch: false });
		expect(hostsOnList(choice("listed", ["example.org"]))).toEqual([
			"cai-manifests.adobe.com",
			"example.org",
		]);
	});

	it("leaves a host the person left, even a built-in one", () => {
		expect(
			decideFetch(choice("listed", [], ["cai-manifests.adobe.com"]), ADOBE),
		).toMatchObject({ fetch: false, onTheWeb: { outcome: "left" } });
	});

	it("fetches no address that is not https, whatever the mode", () => {
		for (const mode of ["any", "listed", "never", null] as const)
			expect(
				decideFetch(choice(mode), "http://cai-manifests.adobe.com/m"),
			).toMatchObject({
				fetch: false,
				onTheWeb: { host: null, outcome: "refused" },
			});
	});
});

describe("hostStateNow", () => {
	it("says what the person can do about a host as the machine is set now", () => {
		expect(hostStateNow(choice(null), OTHER)).toBe("choose");
		expect(hostStateNow(choice("never"), OTHER)).toBe("never");
		expect(hostStateNow(choice("listed"), OTHER)).toBe("ask");
		expect(
			hostStateNow(choice("listed", [], ["credentials.example.org"]), OTHER),
		).toBe("left");
		expect(hostStateNow(choice("listed"), ADOBE)).toBe("read");
		expect(hostStateNow(choice("any"), OTHER)).toBe("read");
		expect(hostStateNow(choice("any"), "http://example.org/x")).toBe("cannot");
	});
});

describe("remoteAddressOf", () => {
	it("reads the address out of what the library throws, and out of nothing else", () => {
		expect(
			remoteAddressOf({
				message: `must fetch remote manifests from url ${ADOBE}`,
			}),
		).toBe(ADOBE);
		expect(
			remoteAddressOf({
				message: "something else",
				name: `C2pa(RemoteManifestUrl("${OTHER}"))`,
			}),
		).toBe(OTHER);
		expect(
			remoteAddressOf({ message: "asset could not be parsed" }),
		).toBeNull();
		expect(remoteAddressOf(null)).toBeNull();
	});
});

describe("a reading of credentials that were not fetched", () => {
	const cases: OnTheWeb[] = [
		{ address: ADOBE, host: "cai-manifests.adobe.com", outcome: "not-chosen" },
		{ address: ADOBE, host: "cai-manifests.adobe.com", outcome: "never" },
		{
			address: OTHER,
			host: "credentials.example.org",
			outcome: "not-listed",
		},
		{ address: OTHER, host: "credentials.example.org", outcome: "left" },
		{
			address: "http://example.org/x",
			host: null,
			outcome: "refused",
			detail: "only https addresses are fetched, and this one is http",
		},
		{
			address: OTHER,
			host: "credentials.example.org",
			outcome: "failed",
			detail: "the server answered with status 404",
		},
	];

	it.each(cases)("is unreadable, in words, and kept as data: $outcome", (w) => {
		const o = libraryObservation({ kind: "c2pa", version: "1", onTheWeb: w });
		expect(o.status).toBe("unreadable");
		expect(o.error).toBe(notFetchedWords(w));
		expect(o.error).toContain(w.address);
		expect(o.data).toEqual({ onTheWeb: w });
		// What was stored reads back as what was said.
		expect(
			onTheWebOfReading({
				status: o.status,
				data: JSON.parse(JSON.stringify(o.data)),
				error: o.error,
			}),
		).toEqual(w);
	});

	it("names the host where the person decides by host", () => {
		expect(notFetchedWords(cases[2])).toMatch(
			/credentials\.example\.org is not on this machine's list/,
		);
		expect(notFetchedWords(cases[3])).toMatch(/told to leave/);
		expect(notFetchedWords(cases[5])).toMatch(
			/could not be fetched: the server answered with status 404\.$/,
		);
	});

	it("is read out of a reading made before D74, with fetching switched off", () => {
		expect(
			onTheWebOfReading({
				status: "unreadable",
				data: null,
				error: `C2PA library: must fetch remote manifests from url ${ADOBE}`,
			}),
		).toEqual({
			address: ADOBE,
			host: "cai-manifests.adobe.com",
			outcome: "never",
		});
	});

	it("is nothing for any other reading", () => {
		expect(
			onTheWebOfReading({
				status: "unreadable",
				data: null,
				error: "C2PA library: asset could not be parsed",
			}),
		).toBeNull();
		expect(
			onTheWebOfReading({ status: "ok", data: { onTheWeb: cases[0] } }),
		).toBeNull();
		expect(
			onTheWebOfReading({
				status: "unreadable",
				data: { onTheWeb: { address: 1, outcome: "nonsense" } },
				error: null,
			}),
		).toBeNull();
	});

	it("is said only by an unreadable reading of a file's own credentials", () => {
		const w = cases[0];
		expect(() =>
			makeObservation({
				kind: "c2pa-sidecar",
				extractor: "c2pa-node",
				status: "unreadable",
				onTheWeb: w,
			}),
		).toThrow(/Only an unreadable C2PA reading/);
		expect(() =>
			makeObservation({
				kind: "c2pa",
				extractor: "c2pa-node",
				status: "absent",
				onTheWeb: w,
			}),
		).toThrow(/Only an unreadable C2PA reading/);
	});
});

describe("a reading of credentials that were fetched", () => {
	it("says where they came from, beside what they say", () => {
		const store = {
			active_manifest: "urn:m",
			manifests: { "urn:m": { title: "clip.mp4" } },
			validation_state: "Valid",
		};
		const o = libraryObservation({
			kind: "c2pa",
			version: "1",
			store,
			fetchedFrom: ADOBE,
		});
		expect(o.status).toBe("ok");
		expect(o.data).toEqual(store);
		expect(o.warnings).toEqual([
			`These Content Credentials are not inside the file: they were fetched from ${ADOBE}`,
		]);
		expect(
			libraryObservation({ kind: "c2pa", version: "1", store }).warnings,
		).toEqual([]);
	});
});

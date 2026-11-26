import { describe, it, expect } from "vitest";
import {
	assertionUri,
	carryWithheld,
	checkWithhold,
	rememberRedactions,
	revealOf,
	sameReveal,
} from "../../src/manifest/reveal.ts";

// A source's manifest store in the shape the C2PA library reads (made up):
// an AI image, with an identity, an author, a prompt, a location and a serial.
const store = {
	active_manifest: "urn:c2pa:gen",
	manifests: {
		"urn:c2pa:gen": {
			signature_info: {
				common_name: "Example Generator",
				issuer: "Example CA",
			},
			assertions: [
				{ label: "c2pa.hash.data", data: { hash: "abc" } },
				{
					label: "c2pa.actions.v2",
					data: {
						actions: [
							{
								action: "c2pa.created",
								parameters: { "com.example.details": "a harbour at dawn" },
							},
						],
					},
				},
				{
					label: "cawg.identity",
					data: {
						verifiedIdentities: [
							{
								name: "A. Person",
								username: "aperson",
								uri: "https://social.example/aperson",
								provider: { id: "https://social.example", name: "Social" },
							},
						],
					},
				},
				{
					label: "stds.schema-org.CreativeWork",
					data: { author: [{ "@type": "Person", name: "A. Person" }] },
				},
				{
					label: "stds.exif",
					data: { "exif:GPSLatitude": "41.40", "exif:Make": "Example" },
				},
				{ label: "stds.exif__1", data: { "exif:BodySerialNumber": "SN123" } },
				{ label: "stds.exif__2", data: { "exif:Make": "Example" } },
			],
		},
		"urn:c2pa:inner": {
			signature_info: { common_name: "Example Phone" },
			assertions: [
				{
					label: "c2pa.actions.v2",
					data: { actions: [{ action: "c2pa.created" }] },
				},
			],
		},
	},
};

describe("revealOf (D62)", () => {
	it("lists what says something about a person, a place or a device, each with its redaction address", () => {
		const r = revealOf(store);
		expect(r.manifests).toBe(2);
		expect(r.signers).toEqual(["Example Generator", "Example Phone"]);
		expect(r.items.map((i) => [i.label, i.kind, i.redactable])).toEqual([
			["c2pa.actions.v2", "generation", false],
			["cawg.identity", "identity", true],
			["stds.schema-org.CreativeWork", "author", true],
			["stds.exif", "location", true],
			["stds.exif__1", "device", true],
		]);
		expect(r.items[1].values).toEqual([
			"A. Person",
			"aperson",
			"https://social.example/aperson",
			"https://social.example",
			"Social",
		]);
		expect(r.items[0].values).toEqual(["a harbour at dawn"]);
		expect(r.items[3].uri).toBe(
			"self#jumbf=/c2pa/urn:c2pa:gen/c2pa.assertions/stds.exif",
		);
		// The hash, a plain exif and the inner manifest's plain action say nothing personal.
		expect(r.otherAssertions).toBe(3);
	});

	it("finds nothing in a file without credentials", () => {
		expect(revealOf(null)).toEqual({
			manifests: 0,
			signers: [],
			items: [],
			otherAssertions: 0,
		});
	});
});

describe("descriptive metadata (D62)", () => {
	it("lists its values, never the vocabularies its @context declares", () => {
		const r = revealOf({
			manifests: {
				"urn:c2pa:m": {
					assertions: [
						{
							label: "cawg.metadata",
							data: {
								"@context": { dc: "http://purl.org/dc/elements/1.1/" },
								"dc:creator": ["A. Person"],
							},
						},
					],
				},
			},
		});
		expect(r.items[0]).toMatchObject({
			kind: "metadata",
			values: ["A. Person"],
		});
	});
});

describe("checkWithhold (D62)", () => {
	const sources = [
		{ assetId: 7, reveal: revealOf(store) },
		{ assetId: 9, reveal: revealOf(null) },
	];
	it("takes a redactable address and a source that carries credentials", () => {
		expect(
			checkWithhold(
				{
					redact: [assertionUri("urn:c2pa:gen", "cawg.identity")],
					leaveOut: [7],
				},
				sources,
			),
		).toEqual([]);
	});
	it("refuses an action (not redactable), an unknown address, and a source with no credentials", () => {
		expect(
			checkWithhold(
				{
					redact: [
						assertionUri("urn:c2pa:gen", "c2pa.actions.v2"),
						assertionUri("urn:c2pa:other", "cawg.identity"),
					],
					leaveOut: [9, 12],
				},
				sources,
			),
		).toHaveLength(4);
	});
});

describe("carrying the last signing's choices to the sources as they are now (D63)", () => {
	const identity = assertionUri("urn:c2pa:gen", "cawg.identity");
	const film = { assetId: 7, title: "film.mp4", reveal: revealOf(store) };
	// The same file rendered and signed again: every manifest label is new.
	const rerendered = {
		assetId: 7,
		title: "film.mp4",
		reveal: revealOf({
			manifests: {
				"urn:c2pa:gen-2": store.manifests["urn:c2pa:gen"],
				"urn:c2pa:inner-2": store.manifests["urn:c2pa:inner"],
			},
		}),
	};
	const remembered = rememberRedactions([identity], [film]);

	it("remembers a redaction by its source, assertion and kind as well as its address", () => {
		expect(remembered).toEqual([
			{
				assetId: 7,
				title: "film.mp4",
				label: "cawg.identity",
				kind: "identity",
				uri: identity,
			},
		]);
		// An address no source has is still kept, by its address alone.
		expect(
			rememberRedactions(
				["self#jumbf=/c2pa/urn:x/c2pa.assertions/a.b"],
				[film],
			),
		).toEqual([
			{
				assetId: null,
				title: "",
				label: "a.b",
				kind: null,
				uri: "self#jumbf=/c2pa/urn:x/c2pa.assertions/a.b",
			},
		]);
	});

	it("keeps a choice whose address is still there, and says nothing", () => {
		expect(
			carryWithheld({ redact: remembered, leaveOut: [7] }, [film]),
		).toEqual({
			withhold: { redact: [identity], leaveOut: [7] },
			redactions: [
				{ assetId: 7, what: "an identity in film.mp4", now: [identity] },
			],
			notes: [],
		});
	});

	it("finds a redaction again in a re-rendered source, and says so", () => {
		const now = assertionUri("urn:c2pa:gen-2", "cawg.identity");
		const other = {
			assetId: 9,
			title: "other.wav",
			reveal: revealOf({
				manifests: { "urn:c2pa:other": store.manifests["urn:c2pa:gen"] },
			}),
		};
		const carried = carryWithheld({ redact: remembered, leaveOut: [] }, [
			rerendered,
			other,
		]);
		// Only in the source it was in: another source's identity is not touched.
		expect(carried.withhold).toEqual({ redact: [now], leaveOut: [] });
		expect(carried.redactions).toEqual([
			{ assetId: 7, what: "an identity in film.mp4", now: [now] },
		]);
		expect(carried.notes).toEqual([
			"The last signed copy kept out an identity in film.mp4. The file has changed since, so it was looked for again and is kept out of this copy too (1 item).",
		]);
	});

	it("still looks in the re-rendered source when another source holds the old address", () => {
		// A still, and a cut that used it, hold the same manifest: the address
		// remembered for the cut is still found in the still.
		const still = { assetId: 9, title: "still.png", reveal: revealOf(store) };
		const carried = carryWithheld({ redact: remembered, leaveOut: [] }, [
			rerendered,
			still,
		]);
		expect(carried.withhold.redact).toEqual([
			identity,
			assertionUri("urn:c2pa:gen-2", "cawg.identity"),
		]);
		expect(carried.notes).toHaveLength(1);
	});

	it("keeps out every match when the kind is there under another label: more, when in doubt", () => {
		const author = rememberRedactions(
			[assertionUri("urn:c2pa:gen", "stds.schema-org.CreativeWork")],
			[film],
		);
		const moved = {
			assetId: 7,
			title: "film.mp4",
			reveal: revealOf({
				manifests: {
					"urn:c2pa:new": {
						assertions: [
							{
								label: "stds.schema-org.CreativeWork__1",
								data: { author: [{ name: "A. Person" }] },
							},
							{ label: "cawg.identity", data: { verifiedIdentities: [] } },
						],
					},
				},
			}),
		};
		expect(
			carryWithheld({ redact: author, leaveOut: [] }, [moved]).withhold.redact,
		).toEqual([
			assertionUri("urn:c2pa:new", "stds.schema-org.CreativeWork__1"),
		]);
	});

	it("drops what the sources no longer carry, and says what and why", () => {
		const bare = { assetId: 7, title: "film.mp4", reveal: revealOf(null) };
		expect(
			carryWithheld({ redact: remembered, leaveOut: [7, 12] }, [bare]),
		).toEqual({
			withhold: { redact: [], leaveOut: [] },
			redactions: [{ assetId: 7, what: "an identity in film.mp4", now: [] }],
			notes: [
				"The last signed copy kept out an identity in film.mp4. The file no longer carries it, so there is nothing to keep out.",
				"The last signed copy left out all of film.mp4's own credentials. The file carries none now, so there is nothing to leave out.",
				"The last signed copy left out the credentials of asset 12. It is no longer a source of this edit.",
			],
		});
		expect(
			carryWithheld({ redact: remembered, leaveOut: [] }, []).notes,
		).toEqual([
			"The last signed copy kept out an identity in film.mp4. That file is no longer a source of this edit, so there is nothing to keep out.",
		]);
	});

	it("looks in every source for a record that names none (one made before D63)", () => {
		const old = rememberRedactions([identity], []);
		expect(old[0]).toMatchObject({ assetId: null, kind: null });
		expect(
			carryWithheld({ redact: old, leaveOut: [] }, [rerendered]).withhold
				.redact,
		).toEqual([assertionUri("urn:c2pa:gen-2", "cawg.identity")]);
	});
});

describe("what signing compares with the review (D63)", () => {
	it("is the same when the same things would travel, and different when anything would not", () => {
		expect(sameReveal(revealOf(store), revealOf(structuredClone(store)))).toBe(
			true,
		);
		const changed = structuredClone(store);
		changed.manifests["urn:c2pa:gen"].assertions[3] = {
			label: "stds.schema-org.CreativeWork",
			data: { author: [{ "@type": "Person", name: "Someone Else" }] },
		};
		expect(sameReveal(revealOf(store), revealOf(changed))).toBe(false);
		expect(sameReveal(revealOf(store), revealOf(null))).toBe(false);
		expect(
			sameReveal(revealOf(null), { ...revealOf(null), unreadable: "broken" }),
		).toBe(false);
	});

	it("lets credentials that could not be read travel only when they are left out", () => {
		const sources = [
			{
				assetId: 7,
				title: "clip.mov",
				reveal: { ...revealOf(null), unreadable: "a broken manifest" },
			},
		];
		expect(checkWithhold({ redact: [], leaveOut: [] }, sources)).toEqual([
			"clip.mov has Content Credentials that could not be read (a broken manifest), so what they say cannot be shown. Leave its credentials out to sign",
		]);
		expect(checkWithhold({ redact: [], leaveOut: [7] }, sources)).toEqual([]);
	});
});

import { describe, it, expect } from "vitest";
import {
	assertionUri,
	checkWithhold,
	revealOf,
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

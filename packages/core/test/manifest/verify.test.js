import { describe, it, expect } from "vitest";
import { interpretReport, UNCHECKED } from "../../src/manifest/verify.js";

// Reports shaped like c2patool 0.27.1 output, trimmed to the fields read.
const URN = "urn:c2pa:00000000-0000-0000-0000-000000000001";
const UNTRUSTED = {
	code: "signingCredential.untrusted",
	explanation: "signing certificate untrusted",
};
const TRUSTED = { code: "signingCredential.trusted" };
const report = ({
	failure = [UNTRUSTED],
	success = [{ code: "assertion.bmffHash.match" }],
	ingredients = [],
	deltas = [],
	time,
} = {}) => ({
	active_manifest: URN,
	manifests: {
		[URN]: {
			ingredients,
			signature_info: {
				issuer: "Example Org",
				common_name: "Example Dev Cert",
				alg: "Es256",
				...(time ? { time } : {}),
			},
		},
		"urn:c2pa:other": {},
	},
	validation_results: {
		activeManifest: { success, failure },
		ingredientDeltas: deltas,
	},
	validation_state: failure.length ? "Invalid" : "Valid",
});

describe("interpretReport", () => {
	it("reads no report as no credentials", () => {
		expect(interpretReport(null)).toMatchObject({
			status: "absent",
			label: "No Content Credentials",
			manifests: 0,
		});
	});

	it("reads a dev-certificate signature as valid with an unrecognised issuer", () => {
		const v = interpretReport(report());
		expect(v).toMatchObject({
			status: "unrecognised_issuer",
			label: "Valid, unrecognised issuer",
			untrusted: true,
			hashVerified: true,
			timestamped: false,
			manifests: 2,
		});
		expect(v.signer).toEqual({
			issuer: "Example Org",
			commonName: "Example Dev Cert",
			time: null,
			alg: "Es256",
		});
	});

	it("reads a trusted, timestamped signature as valid", () => {
		expect(
			interpretReport(
				report({
					failure: [],
					success: [{ code: "assertion.bmffHash.match" }, TRUSTED],
					time: "2026-11-13T10:00:00+00:00",
				}),
			),
		).toMatchObject({
			status: "valid",
			claim: "trusted",
			timestamped: true,
			untrusted: false,
		});
	});

	it("calls a signer trusted only when the reader said so, never because it said nothing (D67)", () => {
		// No complaint, and no word that the signer is on a trust list.
		const silent = interpretReport(report({ failure: [] }));
		expect(silent).toMatchObject({
			status: "invalid",
			claim: "invalid",
			untrusted: false,
		});
		expect(silent.failures).toEqual([UNCHECKED]);
		// No results at all: the same, not "valid".
		const bare = report();
		delete bare.validation_results;
		expect(interpretReport(bare)).toMatchObject({
			status: "invalid",
			claim: "invalid",
		});
		// An older report lists failures only: untrusted is still read from it.
		expect(
			interpretReport({ ...bare, validation_status: [UNTRUSTED] }).status,
		).toBe("unrecognised_issuer");
		// Both said (a reader that contradicts itself) is not trusted.
		expect(
			interpretReport(report({ failure: [UNTRUSTED], success: [TRUSTED] }))
				.status,
		).toBe("unrecognised_issuer");
	});

	it("separates a content-hash mismatch from other failures", () => {
		expect(
			interpretReport(
				report({
					failure: [UNTRUSTED, { code: "assertion.bmffHash.mismatch" }],
					success: [],
				}),
			).status,
		).toBe("hash_mismatch");
		expect(
			interpretReport(
				report({
					failure: [
						{
							code: "assertion.required.missing",
							explanation: "Failed to load manifest",
						},
					],
				}),
			).status,
		).toBe("invalid");
	});

	it("leaves the creator's identity out of the claim's verdict (D55)", () => {
		expect(
			interpretReport(
				report({
					failure: [
						UNTRUSTED,
						{ code: "cawg.x509.credential.untrusted" },
						{ code: "cawg.x509.signature.mismatch" },
					],
				}),
			),
		).toMatchObject({ status: "unrecognised_issuer", failures: [UNTRUSTED] });
	});

	it("counts an ingredient's recorded problems as well as later deltas, once each (D53)", () => {
		const EKU = {
			code: "signingCredential.invalid",
			explanation: "certificate missing required EKU",
		};
		const ingredient = (extra) => ({
			title: "music.wav",
			relationship: "componentOf",
			label: "c2pa.ingredient.v3__1",
			active_manifest: "urn:c2pa:other",
			...extra,
		});
		const delta = {
			ingredientAssertionURI: `self#jumbf=/c2pa/${URN}/c2pa.assertions/c2pa.ingredient.v3__1`,
			validationDeltas: { failure: [EKU] },
		};
		const problemsOf = (r) =>
			interpretReport(r).ingredients[0].problems.map((p) => p.code);
		// Signed in by the library: the problem is in the ingredient's record.
		expect(
			problemsOf(
				report({
					ingredients: [
						ingredient({
							validation_results: {
								activeManifest: { failure: [UNTRUSTED, EKU] },
							},
						}),
					],
				}),
			),
		).toEqual(["signingCredential.invalid"]);
		// Signed in by c2patool: recorded as fine, found later as a delta.
		expect(
			problemsOf(
				report({
					ingredients: [
						ingredient({
							validation_results: { activeManifest: { failure: [UNTRUSTED] } },
						}),
					],
					deltas: [delta],
				}),
			),
		).toEqual(["signingCredential.invalid"]);
		// Both: listed once.
		expect(
			problemsOf(
				report({
					ingredients: [
						ingredient({
							validation_results: { activeManifest: { failure: [EKU] } },
						}),
					],
					deltas: [delta],
				}),
			),
		).toEqual(["signingCredential.invalid"]);
	});

	it("lists ingredients with whether they carry credentials and their own problems", () => {
		const v = interpretReport(
			report({
				ingredients: [
					{
						title: "final.mp4",
						relationship: "parentOf",
						label: "c2pa.ingredient.v3",
					},
					{
						title: "take.mp4",
						relationship: "componentOf",
						label: "c2pa.ingredient.v3__1",
					},
					{
						title: "clip.mp4",
						relationship: "componentOf",
						label: "c2pa.ingredient.v3__2",
						active_manifest: "urn:c2pa:other",
					},
				],
				deltas: [
					{
						ingredientAssertionURI: `self#jumbf=/c2pa/${URN}/c2pa.assertions/c2pa.ingredient.v3__2`,
						validationDeltas: {
							failure: [
								UNTRUSTED,
								{ code: "assertion.bmffHash.mismatch", explanation: "x" },
							],
						},
					},
				],
			}),
		);
		expect(
			v.ingredients.map((i) => [
				i.title,
				i.relationship,
				i.credentials,
				i.problems.map((p) => p.code),
			]),
		).toEqual([
			["final.mp4", "parentOf", "none", []],
			["take.mp4", "componentOf", "none", []],
			["clip.mp4", "componentOf", "present", ["assertion.bmffHash.mismatch"]],
		]);
	});

	it("falls back to validation_status on older reports", () => {
		const r = report();
		delete r.validation_results;
		r.validation_status = [UNTRUSTED];
		expect(interpretReport(r).status).toBe("unrecognised_issuer");
	});
});

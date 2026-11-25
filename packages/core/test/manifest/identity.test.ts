import { describe, expect, it } from "vitest";
import {
	IDENTITY_COVERS,
	identityReferences,
	readIdentity,
} from "../../src/manifest/identity.ts";

const URN = "urn:c2pa:00000000-0000-0000-0000-000000000001";
const ref = (label: string) => ({
	url: `self#jumbf=/c2pa/${URN}/c2pa.assertions/${label}`,
});
const report = (
	codes: { success?: string[]; failure?: string[] },
	withIdentity = true,
) => ({
	active_manifest: URN,
	manifests: {
		[URN]: {
			assertions: withIdentity
				? [
						{ label: "c2pa.actions.v2", data: {} },
						{
							label: "cawg.identity",
							data: {
								signer_payload: {
									referenced_assertions: [
										ref("c2pa.hash.bmff.v3"),
										ref("c2pa.actions.v2"),
									],
									sig_type: "cawg.x509.cose",
									role: ["cawg.creator"],
								},
								signature_info: {
									common_name: "Test Person",
									issuer: "Test Studio",
								},
							},
						},
					]
				: [{ label: "c2pa.actions.v2", data: {} }],
		},
	},
	validation_results: {
		activeManifest: {
			success: (codes.success ?? []).map((code) => ({ code })),
			failure: (codes.failure ?? []).map((code) => ({ code })),
		},
	},
});

describe("readIdentity", () => {
	it("reads who signed, as what, and what it vouches for", () => {
		expect(
			readIdentity(
				report({
					success: [
						"cawg.identity.well-formed",
						"cawg.x509.signature.validated",
						"cawg.x509.credential.trusted",
					],
				}),
			),
		).toEqual({
			status: "trusted",
			name: "Test Person",
			issuer: "Test Studio",
			roles: ["cawg.creator"],
			covers: ["c2pa.hash.bmff.v3", "c2pa.actions.v2"],
			failures: [],
		});
	});

	it("says an identity whose issuer is not trusted here is valid with an unrecognised issuer", () => {
		expect(
			readIdentity(
				report({
					success: [
						"cawg.identity.well-formed",
						"cawg.x509.signature.validated",
					],
					failure: [
						"signingCredential.untrusted",
						"cawg.x509.credential.untrusted",
					],
				}),
			),
		).toMatchObject({
			status: "unrecognised_issuer",
			failures: [{ code: "cawg.x509.credential.untrusted" }],
		});
	});

	it("says a forged identity is invalid, whatever the claim says", () => {
		expect(
			readIdentity(report({ failure: ["cawg.x509.signature.mismatch"] }))
				?.status,
		).toBe("invalid");
	});

	it("is null for a file without an identity, or without credentials", () => {
		expect(readIdentity(report({}, false))).toBeNull();
		expect(readIdentity(null)).toBeNull();
	});
});

describe("identityReferences", () => {
	it("covers what the definition carries of what the identity vouches for, in order", () => {
		expect(
			identityReferences({
				assertions: [
					{ label: "c2pa.training-mining" },
					{ label: "c2pa.actions.v2" },
					{ label: "org.example.other" },
				],
			}),
		).toEqual(["c2pa.actions.v2", "c2pa.training-mining"]);
		expect(
			identityReferences({
				assertions: IDENTITY_COVERS.map((label) => ({ label })),
			}),
		).toEqual([...IDENTITY_COVERS]);
	});
});

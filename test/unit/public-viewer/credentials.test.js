// Reading the Content Credentials inside a visitor's copy (D61), from a C2PA
// reader's report as @contentauth/c2pa-web gives it. Made-up reports, in the
// shape the spike read from a real signed film on 25 Nov 2026.
import { describe, it, expect } from "vitest";
import {
	readCopyCredentials,
	credentialVerdict,
	shouldCompareCertificate,
	compareCertificate,
} from "../../../public-viewer/src/model.js";

const report = ({
	success = [],
	failure = [],
	signer = "Example Studio",
} = {}) => ({
	active_manifest: "urn:c2pa:film",
	manifests: {
		"urn:c2pa:film": {
			signature_info: { common_name: signer, issuer: "Example CA" },
		},
	},
	validation_results: {
		activeManifest: {
			success: success.map((code) => ({ code })),
			failure: failure.map((code) => ({ code })),
		},
	},
});
const record = { formatVersion: 2, signer: { commonName: "Example Studio" } };

describe("readCopyCredentials", () => {
	it("reads a copy whose content matches and whose signer is not on the list", () => {
		const r = readCopyCredentials(
			report({
				success: ["claimSignature.validated", "assertion.bmffHash.match"],
				failure: ["signingCredential.untrusted"],
			}),
		);
		expect(r).toEqual({
			status: "unrecognised_issuer",
			signer: "Example Studio",
			issuer: "Example CA",
			contentChecked: true,
			failures: [],
			label: "urn:c2pa:film",
		});
	});

	it("keeps the identity's codes out of the result, as the tracker does", () => {
		expect(
			readCopyCredentials(
				report({
					success: ["assertion.bmffHash.match", "signingCredential.trusted"],
					failure: ["cawg.x509.credential.untrusted"],
				}),
			).status,
		).toBe("trusted");
	});

	it("calls a signer trusted only when the reader said so, never because no failure is listed (D71)", () => {
		const silent = readCopyCredentials(
			report({
				success: ["claimSignature.validated", "assertion.bmffHash.match"],
			}),
		);
		expect(silent.status).toBe("unchecked");
		expect(credentialVerdict(silent, record)).toMatchObject({
			tone: "caution",
			headline:
				"Signed by Example Studio, and unchanged; certificate not checked",
		});
		// A report with no results at all says nothing about trust either.
		expect(readCopyCredentials(report()).status).toBe("unchecked");
		expect(
			readCopyCredentials({
				active_manifest: "urn:c2pa:film",
				manifests: { "urn:c2pa:film": {} },
			}).status,
		).toBe("unchecked");
	});

	it("tells a changed copy from a broken signature, and a copy with none", () => {
		expect(
			readCopyCredentials(
				report({
					failure: [
						"assertion.bmffHash.mismatch",
						"signingCredential.untrusted",
					],
				}),
			).status,
		).toBe("changed");
		expect(
			readCopyCredentials(report({ failure: ["claimSignature.mismatch"] })),
		).toMatchObject({
			status: "invalid",
			failures: ["claimSignature.mismatch"],
		});
		expect(readCopyCredentials(null).status).toBe("none");
		expect(readCopyCredentials({}).status).toBe("none");
	});
});

describe("credentialVerdict", () => {
	it("says the copy is unchanged only when the reader said its content matched", () => {
		const checked = credentialVerdict(
			readCopyCredentials(
				report({
					success: ["assertion.bmffHash.match"],
					failure: ["signingCredential.untrusted"],
				}),
			),
			record,
		);
		expect(checked).toMatchObject({
			tone: "caution",
			headline:
				"Signed by Example Studio, and unchanged; signer not on the trust list",
		});
		// Names are compared, and for a signer no one vouches for, a name shows nothing.
		expect(checked.detail).toMatch(
			/That is the name this record gives for the signer\. A name alone does not show it is the same signer/,
		);
		expect(checked.detail).not.toMatch(/That is the signer/);
		const unchecked = credentialVerdict(
			readCopyCredentials(
				report({
					success: ["claimSignature.validated", "signingCredential.trusted"],
				}),
			),
			record,
		);
		// On the trust list, someone vouches for the name: no caveat.
		expect(unchecked.detail).toMatch(
			/That is the name this record gives for the signer\.$/,
		);
		expect(unchecked.headline).toBe(
			"Signed by Example Studio, a recognised signer",
		);
		expect(unchecked.tone).toBe("caution");
		expect(unchecked.detail).toMatch(/did not say whether the content matches/);
	});

	it("says when the copy was signed by someone other than the record names", () => {
		const v = credentialVerdict(
			readCopyCredentials(
				report({
					success: ["assertion.bmffHash.match", "signingCredential.trusted"],
					signer: "Someone Else",
				}),
			),
			record,
		);
		expect(v.tone).toBe("good");
		expect(v.detail).toMatch(
			/This record names Example Studio, not Someone Else\./,
		);
		// A format 1 record names its signer in its single signature block.
		expect(
			credentialVerdict(
				readCopyCredentials(report({ signer: "Someone Else" })),
				{
					formatVersion: 1,
					signature: { signer: { commonName: "Example Studio" } },
				},
			).detail,
		).toMatch(/not Someone Else/);
	});

	it("explains a copy with no credentials, such as one from a video platform", () => {
		expect(credentialVerdict(readCopyCredentials(null), record)).toMatchObject({
			tone: "bad",
			headline: "No Content Credentials in this copy",
		});
	});
});

describe("the certificate itself, against the one the record names (D72)", () => {
	const RECORDED = "ab".repeat(32);
	const OTHER = "cd".repeat(32);
	const v3 = {
		formatVersion: 3,
		signer: { commonName: "Example Studio", certificateSha256: RECORDED },
	};
	const valid = readCopyCredentials(
		report({
			success: ["assertion.bmffHash.match"],
			failure: ["signingCredential.untrusted"],
		}),
	);
	const found = (sha256, label = "urn:c2pa:film") => ({ label, sha256 });

	it("is compared only when the record names one and the reader said the signature validated", () => {
		expect(shouldCompareCertificate(valid, v3)).toBe(true);
		// An older record names no certificate.
		expect(shouldCompareCertificate(valid, record)).toBe(false);
		expect(compareCertificate(valid, found(RECORDED), record)).toEqual({
			status: "none",
		});
		// A certificate can be pasted into any file: without a signature that
		// validated, finding it there says nothing.
		for (const failure of [
			"claimSignature.mismatch",
			"assertion.bmffHash.mismatch",
		]) {
			const broken = readCopyCredentials(report({ failure: [failure] }));
			expect(shouldCompareCertificate(broken, v3)).toBe(false);
			expect(compareCertificate(broken, found(RECORDED), v3)).toEqual({
				status: "none",
			});
		}
		expect(shouldCompareCertificate(readCopyCredentials(null), v3)).toBe(false);
	});

	it("says same or different by the fingerprint, and only for the manifest the reader judged", () => {
		expect(compareCertificate(valid, found(RECORDED), v3)).toEqual({
			status: "same",
		});
		expect(compareCertificate(valid, found(OTHER), v3)).toEqual({
			status: "different",
		});
		// The page found a certificate, but in another manifest than the one
		// the reader validated: the reader's word is not about it.
		expect(
			compareCertificate(valid, found(RECORDED, "urn:c2pa:another"), v3),
		).toMatchObject({
			status: "unsure",
			reason: /disagree about which manifest/,
		});
		expect(
			compareCertificate(
				valid,
				{ error: "the file holds more than one set of credentials" },
				v3,
			),
		).toEqual({
			status: "unsure",
			reason: "the file holds more than one set of credentials",
		});
		expect(compareCertificate(valid, null, v3).status).toBe("unsure");
		expect(compareCertificate(valid, found("nonsense"), v3).status).toBe(
			"unsure",
		);
	});

	it("puts the result in words: a matching certificate, a matching name on another certificate, or not compared", () => {
		const same = credentialVerdict(valid, v3, { status: "same" });
		expect(same.detail).toMatch(
			/It was signed with the certificate this record names, compared by the certificate's fingerprint and not by its name\.$/,
		);
		// The caveat about names is gone: the certificate was compared.
		expect(same.detail).not.toMatch(/A name alone/);

		const impostor = credentialVerdict(valid, v3, { status: "different" });
		expect(impostor.detail).toMatch(
			/It carries the name this record gives for the signer, but it was signed with a different certificate\. Either the creator has changed certificate since this record was made, or someone else signed this copy\.$/,
		);
		expect(impostor.detail).not.toMatch(/That is the name this record gives/);

		// On the trust list, with matching content, a different certificate
		// still does not "check out" against this record.
		const trusted = readCopyCredentials(
			report({
				success: ["assertion.bmffHash.match", "signingCredential.trusted"],
			}),
		);
		expect(credentialVerdict(trusted, v3, { status: "same" }).tone).toBe(
			"good",
		);
		expect(credentialVerdict(trusted, v3, { status: "different" }).tone).toBe(
			"caution",
		);

		const other = credentialVerdict(
			readCopyCredentials(
				report({
					success: ["assertion.bmffHash.match"],
					failure: ["signingCredential.untrusted"],
					signer: "Someone Else",
				}),
			),
			v3,
			{ status: "different" },
		);
		expect(other.detail).toMatch(
			/This record names Example Studio, not Someone Else\. It was signed with a different certificate from the one this record names\.$/,
		);

		const unsure = credentialVerdict(valid, v3, {
			status: "unsure",
			reason: "the file holds more than one set of credentials",
		});
		expect(unsure.detail).toMatch(
			/A name alone does not show it is the same signer/,
		);
		expect(unsure.detail).toMatch(
			/The certificates themselves could not be compared: the file holds more than one set of credentials\.$/,
		);
		// Not compared at all: the words are as before.
		expect(credentialVerdict(valid, v3, { status: "none" })).toEqual(
			credentialVerdict(valid, v3),
		);
	});
});

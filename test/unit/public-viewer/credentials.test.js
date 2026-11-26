// Reading the Content Credentials inside a visitor's copy (D61), from a C2PA
// reader's report as @contentauth/c2pa-web gives it. Made-up reports, in the
// shape the spike read from a real signed film on 25 Nov 2026.
import { describe, it, expect } from "vitest";
import {
	readCopyCredentials,
	credentialVerdict,
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

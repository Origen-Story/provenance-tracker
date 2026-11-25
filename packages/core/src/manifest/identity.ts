// The creator's identity in a signed file (D55): a CAWG identity assertion
// (identity assertion 1.3, the X.509 kind, `cawg.x509.cose`), signed with the
// creator's own identity certificate, separate from the claim signature.
// What it vouches for, and how a reading of it is told apart from the
// claim's verdict. Pure: given a definition or a report, no files.

import { STATEMENT_LABEL } from "./build.js";

/** The one role this version signs as (Phase 7 decision 5b); choosing it per edit is planned. */
export const IDENTITY_ROLE = "cawg.creator";

/**
 * What the identity vouches for (decision 5b): everything the tracker writes,
 * so nothing in the record sits outside it. The library adds the hard binding
 * (the file's hash) by itself.
 */
export const IDENTITY_COVERS = [
	STATEMENT_LABEL,
	"stds.schema-org.CreativeWork",
	"c2pa.actions.v2",
	"c2pa.training-mining",
] as const;

/** The labels from IDENTITY_COVERS that a definition carries, in that order. */
export function identityReferences(definition: {
	assertions?: Array<{ label?: string }>;
}): string[] {
	const present = new Set((definition.assertions ?? []).map((a) => a.label));
	return IDENTITY_COVERS.filter((l) => present.has(l));
}

type Code = { code: string; explanation?: string };
type Report = {
	active_manifest?: string;
	manifests?: Record<
		string,
		{ assertions?: Array<{ label?: string; data?: unknown }> }
	>;
	validation_results?: {
		activeManifest?: { success?: Code[]; failure?: Code[] };
	};
};

export interface IdentityReading {
	/** trusted: the identity certificate chains to a trusted anchor; unrecognised_issuer: valid, signed, issuer not trusted here; invalid: the identity's signature or shape fails. */
	status: "trusted" | "unrecognised_issuer" | "invalid";
	/** The certificate's subject name and its organisation, as the reader gives them. */
	name: string;
	issuer: string;
	roles: string[];
	/** The labels it vouches for, as signed (the hard binding included). */
	covers: string[];
	/** The cawg.* failures, when there are any. */
	failures: Code[];
}

const labelOf = (url: string) => url.split("/").pop() ?? url;

/**
 * The identity a report carries, or null when it has none. Its verdict
 * comes from the cawg.* codes and never changes the claim's (the library's
 * one-word state does not drop for a forged identity, found 2026-11-25).
 */
export function readIdentity(report: Report | null): IdentityReading | null {
	if (!report?.active_manifest || !report.manifests) return null;
	const active = report.manifests[report.active_manifest];
	const assertion = active?.assertions?.find((a) =>
		String(a.label ?? "").startsWith("cawg.identity"),
	);
	if (!assertion) return null;
	const data = (assertion.data ?? {}) as {
		signer_payload?: {
			referenced_assertions?: Array<{ url?: string }>;
			role?: string[];
		};
		signature_info?: { common_name?: string; issuer?: string };
	};
	const results = report.validation_results?.activeManifest ?? {};
	const cawg = (list?: Code[]) =>
		(list ?? []).filter((c) => c.code.startsWith("cawg."));
	const failures = cawg(results.failure);
	const successes = cawg(results.success);
	const untrusted = failures.some(
		(f) => f.code === "cawg.x509.credential.untrusted",
	);
	const blocking = failures.filter(
		(f) => f.code !== "cawg.x509.credential.untrusted",
	);
	const status = blocking.length
		? "invalid"
		: untrusted ||
			  !successes.some((s) => s.code === "cawg.x509.credential.trusted")
			? "unrecognised_issuer"
			: "trusted";
	return {
		status,
		name: data.signature_info?.common_name ?? "",
		issuer: data.signature_info?.issuer ?? "",
		roles: data.signer_payload?.role ?? [],
		covers: (data.signer_payload?.referenced_assertions ?? []).map((r) =>
			labelOf(String(r.url ?? "")),
		),
		failures,
	};
}

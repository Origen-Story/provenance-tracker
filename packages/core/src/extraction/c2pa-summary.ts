// The short form of a C2PA manifest that the classifier and the old app read
// (the app's c2paJson): title, format, claim generator, assertions,
// ingredients and who signed it, from a manifest store's active manifest.
// One implementation, used by the app's extraction and by classify.

import { interpretReport } from "../manifest/verify.js";
import { activeManifestOf } from "./c2patool-read.ts";
import type { Observation } from "./observation.ts";

export interface C2paSummary {
	title: string | null;
	format: string | null;
	claimGenerator: string | null;
	assertions: Array<{ label: unknown; data: unknown }>;
	ingredients: Array<{
		title: unknown;
		format: unknown;
		relationship: unknown;
	}>;
	signatureInfo: {
		issuer: string | null;
		commonName: string | null;
		time: string | null;
		alg: string | null;
	} | null;
	validation?: {
		state: string | null;
		failures: unknown[];
		statuses: unknown[];
		/**
		 * What the reading's codes come to (manifest/verify.js): "valid" (the
		 * reader said the signer is on its trust list), "unrecognised_issuer",
		 * "hash_mismatch" or "invalid". The classifier names a signer only from
		 * a claim that verified, and a device only from a trusted one (D67).
		 */
		verdict?: string;
	};
}

type Manifest = {
	title?: string;
	format?: string;
	claim_generator?: string;
	claim_generator_info?: Array<{ name?: string }>;
	assertions?: Array<{ label?: unknown; data?: unknown }>;
	ingredients?: Array<{
		title?: unknown;
		format?: unknown;
		relationship?: unknown;
	}>;
	signature_info?: {
		issuer?: string;
		common_name?: string;
		time?: string;
		alg?: string;
	};
};

/** The summary of one manifest (a store's active manifest). */
export function c2paSummary(manifest: Record<string, unknown>): C2paSummary {
	const active = manifest as Manifest;
	return {
		title: active.title || null,
		format: active.format || null,
		claimGenerator:
			active.claim_generator || active.claim_generator_info?.[0]?.name || null,
		assertions: (active.assertions ?? []).map((a) => ({
			label: a.label,
			data: a.data,
		})),
		ingredients: (active.ingredients ?? []).map((i) => ({
			title: i.title,
			format: i.format,
			relationship: i.relationship,
		})),
		signatureInfo: active.signature_info
			? {
					issuer: active.signature_info.issuer || null,
					commonName: active.signature_info.common_name || null,
					time: active.signature_info.time || null,
					alg: active.signature_info.alg || null,
				}
			: null,
	};
}

/**
 * What a C2PA reading says, as the classifier takes it: the summary of a
 * manifest that was read (with its validation); a read error when a manifest
 * was there but could not be read, so the sign that credentials exist is not
 * lost; null when the file has none or nothing could look.
 */
export function c2paSummaryOf(
	observation: Pick<
		Observation,
		"status" | "data" | "error" | "validation"
	> | null,
):
	| (
			| C2paSummary
			| {
					_readError: true;
					_reason: string | null;
					validationStatus: unknown[];
			  }
	  )
	| null {
	if (!observation) return null;
	if (observation.status === "ok") {
		const active = activeManifestOf(observation.data);
		if (!active) return null;
		return {
			...c2paSummary(active),
			validation: {
				state: observation.validation?.state ?? null,
				failures: observation.validation?.failures ?? [],
				statuses: observation.validation?.statuses ?? [],
				verdict: (
					interpretReport(observation.data as object) as { status: string }
				).status,
			},
		};
	}
	if (observation.status === "unreadable")
		return {
			_readError: true,
			_reason: observation.error ?? null,
			validationStatus: observation.validation?.statuses ?? [],
		};
	return null;
}

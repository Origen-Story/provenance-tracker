// One shape for everything an extractor reads from a file: an observation.
//
// What a file says is evidence, so it is kept whole and never edited. An
// observation records which program read it and at what version, whether the
// read worked, and the full data, made safe to store as JSON. The catalog
// (roadmap Phase 4) stores these as rows that never change; until then the
// old app derives its existing columns from them.
//
// Pure: no file or process access here.
import { createHash } from "node:crypto";

/**
 * exif          ExifTool on the file: EXIF, XMP, IPTC, container and technical tags
 * c2pa          a C2PA manifest store in the file
 * png-text      a PNG's text chunks (prompts and settings)
 * xmp-sidecar   ExifTool on an .xmp file beside the file
 * c2pa-sidecar  a .c2pa manifest store beside the file, checked against it
 */
export type ObservationKind =
	"exif" | "c2pa" | "png-text" | "xmp-sidecar" | "c2pa-sidecar";

/**
 * ok          the reader ran and found data
 * absent      the reader ran and the file has none of this kind
 * unreadable  the data is there (or may be), but the reader failed on it
 * unavailable the reader could not run on this machine
 */
export type ObservationStatus = "ok" | "absent" | "unreadable" | "unavailable";

/** What a C2PA reader said about the credential's integrity and signer. */
export interface C2paValidation {
	/** As the reader reported it ("Trusted", "Valid", "Invalid"); null when it reports none. */
	state: string | null;
	/** Failure codes on the active manifest, e.g. "signingCredential.untrusted". */
	failures: string[];
	/** The reader's validation_status list, unchanged. */
	statuses: unknown[];
	/** The reader's validation_results object, unchanged; null when absent. */
	results: unknown;
}

export interface Observation {
	kind: ObservationKind;
	/** The program that read the file: "exiftool", "c2pa-node", "c2patool", "provenance-tracker". */
	extractor: string;
	/** That program's version; "unknown" only when it cannot be asked. */
	version: string;
	status: ObservationStatus;
	/** The full data read, JSON-safe (see toJsonSafe); null unless status is "ok". */
	data: unknown;
	/** Why the read failed; null when it did not. */
	error: string | null;
	/** Reader warnings that did not stop the read. */
	warnings: string[];
	/** C2PA observations only. */
	validation?: C2paValidation | null;
}

const STATUSES: readonly ObservationStatus[] = [
	"ok",
	"absent",
	"unreadable",
	"unavailable",
];

export function makeObservation(fields: {
	kind: ObservationKind;
	extractor: string;
	version?: string | null;
	status: ObservationStatus;
	data?: unknown;
	error?: string | null;
	warnings?: string[];
	validation?: C2paValidation | null;
}): Observation {
	if (!STATUSES.includes(fields.status))
		throw new Error(`Unknown observation status "${fields.status}"`);
	const ok = fields.status === "ok";
	const obs: Observation = {
		kind: fields.kind,
		extractor: fields.extractor,
		version: fields.version || "unknown",
		status: fields.status,
		data: ok ? toJsonSafe(fields.data ?? null) : null,
		error: ok ? null : (fields.error ?? null),
		warnings: fields.warnings ?? [],
	};
	if (fields.kind === "c2pa" || fields.kind === "c2pa-sidecar")
		obs.validation = fields.validation ?? null;
	return obs;
}

/**
 * A deep copy that JSON.stringify keeps exactly. Binary data (a Buffer, a
 * typed array) becomes { binary: true, bytes, sha256 }, so a thumbnail is
 * evidenced without being stored; values with a toJSON method (ExifTool's
 * dates keep their raw text this way) and Dates are converted; undefined and
 * functions are dropped; an object that contains itself is cut at the repeat.
 */
export function toJsonSafe(
	value: unknown,
	ancestors: WeakSet<object> = new WeakSet(),
): unknown {
	if (value === null || typeof value === "boolean" || typeof value === "string")
		return value;
	if (typeof value === "number")
		return Number.isFinite(value) ? value : String(value);
	if (typeof value === "bigint") return value.toString();
	if (typeof value !== "object") return undefined;
	if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
		const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
		return {
			binary: true,
			bytes: bytes.byteLength,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		};
	}
	if (value instanceof Date)
		return Number.isNaN(value.getTime()) ? null : value.toISOString();
	// Only an object that contains itself is cut short. The same object reached
	// by two paths is copied in full both times: c2pa-node 0.5.x returns
	// active_manifest as the very object stored under manifests[label].
	if (ancestors.has(value)) return { circular: true };
	ancestors.add(value);
	try {
		const withToJson = value as { toJSON?: () => unknown };
		if (typeof withToJson.toJSON === "function")
			return toJsonSafe(withToJson.toJSON(), ancestors);
		if (Array.isArray(value))
			return value.map((v) => toJsonSafe(v, ancestors) ?? null);
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) {
			const safe = toJsonSafe(v, ancestors);
			if (safe !== undefined) out[k] = safe;
		}
		return out;
	} finally {
		ancestors.delete(value);
	}
}

/**
 * What a C2PA manifest store says about its own validity. Readers report it
 * differently: newer ones give validation_state and validation_results, older
 * ones only a validation_status list of failures.
 */
export function c2paValidation(store: unknown): C2paValidation {
	const s = (store ?? {}) as {
		validation_state?: unknown;
		validation_status?: unknown;
		validation_results?: {
			activeManifest?: { failure?: Array<{ code?: unknown }> };
		};
	};
	const statuses = Array.isArray(s.validation_status)
		? s.validation_status
		: [];
	const fromResults = s.validation_results?.activeManifest?.failure;
	const failures = (
		Array.isArray(fromResults)
			? fromResults
			: (statuses as Array<{ code?: unknown }>)
	)
		.map((f) => (f && typeof f.code === "string" ? f.code : null))
		.filter((c): c is string => c !== null);
	return {
		state: typeof s.validation_state === "string" ? s.validation_state : null,
		failures,
		statuses: toJsonSafe(statuses) as unknown[],
		results: s.validation_results ? toJsonSafe(s.validation_results) : null,
	};
}

// ExifTool tags that describe where a file sits, not what it contains. They
// differ between two copies of the same bytes (and FileAccessDate changes on
// every read), so they belong to a file's location, not to an observation of
// its content.
export const LOCATION_TAGS: ReadonlySet<string> = new Set([
	"SourceFile",
	"FileName",
	"Directory",
	"FileModifyDate",
	"FileAccessDate",
	"FileCreateDate",
	"FileInodeChangeDate",
	"FilePermissions",
	"FileAttributes",
]);

/** ExifTool's tags for an observation: everything except location tags and its own error list. */
export function exifObservationFields(
	tags: Record<string, unknown> | null | undefined,
): {
	data: Record<string, unknown>;
	warnings: string[];
} {
	const data: Record<string, unknown> = {};
	const warnings: string[] = [];
	for (const [k, v] of Object.entries(tags ?? {})) {
		if (k === "errors" || k === "warnings") {
			if (Array.isArray(v)) warnings.push(...v.map(String));
			continue;
		}
		if (!LOCATION_TAGS.has(k)) data[k] = v;
	}
	return { data, warnings };
}

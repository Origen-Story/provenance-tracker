// What a reading by the C2PA library (@contentauth/c2pa-node) means, as an
// observation (D51). Pure: the caller runs the library and passes what it
// returned or threw.
//
// The library is the reader that may judge camera files (D15). It reports an
// untrusted signer as validation_state "Invalid"; the state is kept as read,
// and what it means is worked out from the codes (manifest/verify.js), so a
// file signed with a certificate no list knows still reads as valid with an
// unrecognised issuer.

import { activeManifestOf } from "./c2patool-read.ts";
import {
	c2paValidation,
	makeObservation,
	type Observation,
} from "./observation.ts";

export const LIBRARY_EXTRACTOR = "c2pa-node";

export interface LibraryRun {
	kind: "c2pa" | "c2pa-sidecar";
	/** The library's version; null when it could not be loaded here. */
	version: string | null;
	/** The manifest store the reader returned; null when the file has none. */
	store?: unknown;
	/** What the library threw, if it threw. */
	error?: { message?: string; code?: string } | null;
	/** Why the library is not available here, when it is not. */
	unavailable?: string;
}

/** A library reading (or its absence, or its failure) as an observation. */
export function libraryObservation(run: LibraryRun): Observation {
	const base = {
		kind: run.kind,
		extractor: LIBRARY_EXTRACTOR,
		version: run.version,
	};
	if (run.unavailable)
		return makeObservation({
			...base,
			status: "unavailable",
			error: run.unavailable,
		});
	if (run.error) {
		const message = String(run.error.message ?? "").trim();
		// A format C2PA cannot be embedded in: nothing to read, not a failure.
		if (/type is unsupported/i.test(message))
			return makeObservation({
				...base,
				status: "absent",
				error: `The C2PA library does not read this file type (${message})`,
			});
		return makeObservation({
			...base,
			status: "unreadable",
			error: `C2PA library: ${message || "unknown error"}`,
		});
	}
	if (!run.store || !activeManifestOf(run.store))
		return makeObservation({ ...base, status: "absent" });
	return makeObservation({
		...base,
		status: "ok",
		data: run.store,
		validation: c2paValidation(run.store),
	});
}

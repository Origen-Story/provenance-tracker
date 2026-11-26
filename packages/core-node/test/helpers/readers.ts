// Readers for tests that sign: signing a finished edit compares what each
// source carries with what `extract` stored for it, so a test project's
// files have to have been read, as a real project's are.

import { LIBRARY_EXTRACTOR } from "@provenancetracker/core/extraction/c2pa-library-read.ts";
import { makeObservation } from "@provenancetracker/core/extraction/observation.ts";
import {
	readC2paWithLibrary,
	readStore,
	type LoadedLibrary,
} from "../../src/extract/c2pa-library.ts";
import type { Reader } from "../../src/extract.ts";

/** A stand-in reader: every file read, none carrying credentials. No program runs. */
export const noCredentials: Reader = {
	kind: "c2pa",
	extractor: "stub",
	version: "1.0",
	read: async () =>
		makeObservation({
			kind: "c2pa",
			extractor: "stub",
			version: "1.0",
			status: "absent",
		}),
};

/** The C2PA library as `extract` uses it, for files and for .c2pa sidecars. */
export function libraryReaders(loaded: LoadedLibrary): Reader[] {
	const reader = {
		version: loaded.version,
		read: (file: string, sidecar?: string) => readStore(loaded, file, sidecar),
	};
	return (["c2pa", "c2pa-sidecar"] as const).map((kind) => ({
		kind,
		extractor: LIBRARY_EXTRACTOR,
		version: loaded.version,
		read: (file: string, sidecar?: string) =>
			readC2paWithLibrary(reader, file, sidecar),
	}));
}

/**
 * What a stand-in engine reads back from the copy it "signed": a signature
 * that verifies, by a signer no trust list knows. Signing keeps a copy only
 * when its read-back is sound.
 */
export const soundReport = (): Record<string, unknown> => ({
	active_manifest: "urn:c2pa:stub",
	manifests: { "urn:c2pa:stub": { assertions: [] } },
	validation_results: {
		activeManifest: {
			success: [{ code: "claimSignature.validated" }],
			failure: [{ code: "signingCredential.untrusted" }],
		},
	},
});

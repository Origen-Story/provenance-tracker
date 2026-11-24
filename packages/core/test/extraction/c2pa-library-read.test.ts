import { describe, expect, it } from "vitest";
import {
	LIBRARY_EXTRACTOR,
	libraryObservation,
} from "../../src/extraction/c2pa-library-read.ts";

const store = {
	active_manifest: "urn:m",
	manifests: { "urn:m": { title: "film.mp4" } },
	validation_state: "Invalid",
	validation_results: {
		activeManifest: {
			success: [{ code: "claimSignature.validated" }],
			failure: [{ code: "signingCredential.untrusted" }],
		},
	},
};

describe("libraryObservation (D51)", () => {
	it("keeps a reading with its validation, the library's state as it said it", () => {
		const o = libraryObservation({ kind: "c2pa", version: "0.10.1", store });
		expect(o).toMatchObject({
			kind: "c2pa",
			extractor: LIBRARY_EXTRACTOR,
			version: "0.10.1",
			status: "ok",
			error: null,
		});
		expect(o.validation).toMatchObject({
			state: "Invalid",
			failures: ["signingCredential.untrusted"],
		});
	});

	it("reads no manifest as absent, and a sidecar reading under its own kind", () => {
		expect(
			libraryObservation({ kind: "c2pa", version: "1", store: null }).status,
		).toBe("absent");
		expect(
			libraryObservation({ kind: "c2pa-sidecar", version: "1", store }),
		).toMatchObject({ kind: "c2pa-sidecar", status: "ok" });
	});

	it("tells a file type C2PA cannot hold (absent) from a file it could not read", () => {
		const unsupported = libraryObservation({
			kind: "c2pa",
			version: "1",
			error: { message: "type is unsupported" },
		});
		expect(unsupported.status).toBe("absent");
		expect(unsupported.error).toMatch(/does not read this file type/);
		const broken = libraryObservation({
			kind: "c2pa",
			version: "1",
			error: {
				message:
					"asset could not be parsed: Box size extends beyond asset bounds",
			},
		});
		expect(broken).toMatchObject({
			status: "unreadable",
			error:
				"C2PA library: asset could not be parsed: Box size extends beyond asset bounds",
		});
	});

	it("says why the library is not available here", () => {
		expect(
			libraryObservation({
				kind: "c2pa",
				version: null,
				unavailable: "Run npm run tools:fetch.",
			}),
		).toMatchObject({
			status: "unavailable",
			version: "unknown",
			error: "Run npm run tools:fetch.",
		});
	});
});

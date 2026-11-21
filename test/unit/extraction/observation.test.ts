import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
	makeObservation,
	toJsonSafe,
	c2paValidation,
	exifObservationFields,
	LOCATION_TAGS,
	type ObservationStatus,
} from "../../../src/server/lib/extraction/observation.ts";

describe("makeObservation", () => {
	it("keeps data only when the read worked, and an error only when it did not", () => {
		const ok = makeObservation({
			kind: "exif",
			extractor: "exiftool",
			version: "13.60",
			status: "ok",
			data: { A: 1 },
			error: "ignored",
		});
		expect(ok).toEqual({
			kind: "exif",
			extractor: "exiftool",
			version: "13.60",
			status: "ok",
			data: { A: 1 },
			error: null,
			warnings: [],
		});

		const failed = makeObservation({
			kind: "exif",
			extractor: "exiftool",
			status: "unreadable",
			data: { A: 1 },
			error: "timeout",
		});
		expect(failed.data).toBeNull();
		expect(failed.error).toBe("timeout");
		expect(failed.version).toBe("unknown");
	});

	it("gives C2PA observations a validation field and other kinds none", () => {
		expect(
			makeObservation({
				kind: "c2pa",
				extractor: "c2patool",
				status: "absent",
			}),
		).toHaveProperty("validation", null);
		expect(
			makeObservation({ kind: "png-text", extractor: "x", status: "absent" }),
		).not.toHaveProperty("validation");
	});

	it("refuses a status it does not know", () => {
		const status = "maybe" as unknown as ObservationStatus; // deliberately invalid
		expect(() =>
			makeObservation({ kind: "exif", extractor: "x", status }),
		).toThrow(/Unknown observation status/);
	});

	it("stores what JSON keeps: the data survives a round trip unchanged", () => {
		const obs = makeObservation({
			kind: "c2pa",
			extractor: "c2pa-node",
			status: "ok",
			data: {
				thumb: Buffer.from("jpeg"),
				when: new Date("2026-11-21T10:00:00Z"),
			},
		});
		expect(JSON.parse(JSON.stringify(obs))).toEqual(obs);
	});
});

describe("toJsonSafe", () => {
	it("replaces binary data with its size and SHA-256", () => {
		const bytes = Buffer.from("thumbnail bytes");
		const sha256 = createHash("sha256").update(bytes).digest("hex");
		expect(
			toJsonSafe({ thumbnail: { format: "image/jpeg", data: bytes } }),
		).toEqual({
			thumbnail: {
				format: "image/jpeg",
				data: { binary: true, bytes: bytes.length, sha256 },
			},
		});
		expect(toJsonSafe(new Uint8Array([1, 2, 3]))).toMatchObject({
			binary: true,
			bytes: 3,
		});
	});

	it("uses toJSON where a value has one (ExifTool dates keep their raw text this way)", () => {
		const exifDate = {
			toJSON: () => ({
				_ctor: "ExifDateTime",
				rawValue: "2026:11:02 18:01:11",
			}),
		};
		expect(toJsonSafe({ DateTimeOriginal: exifDate })).toEqual({
			DateTimeOriginal: {
				_ctor: "ExifDateTime",
				rawValue: "2026:11:02 18:01:11",
			},
		});
	});

	it("drops undefined and functions, keeps null, and makes odd numbers strings", () => {
		expect(
			toJsonSafe({
				a: undefined,
				b: () => 1,
				c: null,
				d: Number.NaN,
				e: 10n,
				f: [undefined, 1],
			}),
		).toEqual({ c: null, d: "NaN", e: "10", f: [null, 1] });
	});

	it("copies an object reached by two paths in full both times", () => {
		// c2pa-node 0.5.x: active_manifest is the same object as manifests[label].
		const m = { title: "clip.mp4", signature_info: { issuer: "Google LLC" } };
		expect(
			toJsonSafe({ active_manifest: m, manifests: { "urn:x": m } }),
		).toEqual({
			active_manifest: m,
			manifests: { "urn:x": m },
		});
	});

	it("survives an object that contains itself", () => {
		const loop: Record<string, unknown> = { name: "loop" };
		loop.self = loop;
		expect(toJsonSafe(loop)).toEqual({
			name: "loop",
			self: { circular: true },
		});
	});
});

describe("c2paValidation", () => {
	it("takes state and failures from a reader that reports validation_results", () => {
		const v = c2paValidation({
			validation_state: "Valid",
			validation_status: [{ code: "signingCredential.untrusted" }],
			validation_results: {
				activeManifest: {
					failure: [{ code: "signingCredential.untrusted" }],
					success: [{ code: "claimSignature.validated" }],
				},
			},
		});
		expect(v.state).toBe("Valid");
		expect(v.failures).toEqual(["signingCredential.untrusted"]);
		expect(v.results).toMatchObject({
			activeManifest: { success: [{ code: "claimSignature.validated" }] },
		});
	});

	it("falls back to validation_status for older readers, and reports no state rather than guess one", () => {
		const v = c2paValidation({
			validation_status: [
				{ code: "assertion.bmffHash.mismatch", explanation: "hash mismatch" },
			],
		});
		expect(v.state).toBeNull();
		expect(v.failures).toEqual(["assertion.bmffHash.mismatch"]);
		expect(v.results).toBeNull();
	});

	it("handles an empty or missing store", () => {
		expect(c2paValidation(null)).toEqual({
			state: null,
			failures: [],
			statuses: [],
			results: null,
		});
	});
});

describe("exifObservationFields", () => {
	it("keeps every content tag, including the object-valued ones the old summary dropped", () => {
		const date = { toJSON: () => ({ rawValue: "2026:11:02 18:01:11" }) };
		const { data } = exifObservationFields({
			Make: "Google",
			DateTimeOriginal: date,
			Keywords: ["a", "b"],
			FileType: "MP4",
		});
		expect(Object.keys(data)).toEqual([
			"Make",
			"DateTimeOriginal",
			"Keywords",
			"FileType",
		]);
	});

	it("leaves out where the file sits, and turns ExifTool's error list into warnings", () => {
		const tags: Record<string, unknown> = {
			Make: "Google",
			errors: ["Truncated atom"],
		};
		for (const k of LOCATION_TAGS) tags[k] = "x";
		const { data, warnings } = exifObservationFields(tags);
		expect(data).toEqual({ Make: "Google" });
		expect(warnings).toEqual(["Truncated atom"]);
	});
});

import { describe, expect, it } from "vitest";
import {
	activeManifestOf,
	parseToolVersion,
} from "../../src/extraction/c2patool-read.ts";

describe("parseToolVersion", () => {
	it("reads the version out of what the tool prints, or nothing", () => {
		expect(parseToolVersion("c2patool 0.27.1\n")).toBe("0.27.1");
		expect(parseToolVersion("c2patool v0.28.0-rc.1")).toBe("0.28.0-rc.1");
		expect(parseToolVersion("no number here")).toBeNull();
		expect(parseToolVersion(undefined)).toBeNull();
	});
});

describe("activeManifestOf", () => {
	const manifest = { title: "film.mp4" };

	it("follows a label into the store's manifests, as current readers give it", () => {
		expect(
			activeManifestOf({
				active_manifest: "urn:m",
				manifests: { "urn:m": manifest },
			}),
		).toBe(manifest);
	});

	it("takes the manifest itself, as an older reader gave it", () => {
		expect(activeManifestOf({ active_manifest: manifest })).toBe(manifest);
	});

	it("is nothing for a store with no active manifest, a label that leads nowhere, or no store", () => {
		expect(activeManifestOf({ manifests: { "urn:m": manifest } })).toBeNull();
		expect(
			activeManifestOf({ active_manifest: "urn:x", manifests: {} }),
		).toBeNull();
		expect(activeManifestOf(null)).toBeNull();
		expect(activeManifestOf("text")).toBeNull();
	});
});

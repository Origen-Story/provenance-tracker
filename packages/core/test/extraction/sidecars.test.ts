import { describe, expect, it } from "vitest";
import { pairSidecars, sidecarKind } from "../../src/extraction/sidecars.ts";

describe("sidecarKind", () => {
	it("knows .xmp and .c2pa in any case, and nothing else", () => {
		expect(sidecarKind("a/IMG_1.XMP")).toBe("xmp");
		expect(sidecarKind("clip.mov.xmp")).toBe("xmp");
		expect(sidecarKind("still.c2pa")).toBe("c2pa");
		expect(sidecarKind("clip.mov")).toBeNull();
		expect(sidecarKind("xmp")).toBeNull();
	});
});

describe("pairSidecars", () => {
	it("pairs both naming conventions, in the same folder only", () => {
		expect(
			pairSidecars([
				"day 1/IMG_1.CR2",
				"day 1/IMG_1.xmp",
				"day 1/clip.mov",
				"day 1/clip.mov.xmp",
				"day 1/still.jpg",
				"day 1/still.c2pa",
				"day 2/IMG_1.xmp",
			]),
		).toEqual([
			{ sidecar: "day 1/IMG_1.xmp", kind: "xmp", files: ["day 1/IMG_1.CR2"] },
			{ sidecar: "day 1/clip.mov.xmp", kind: "xmp", files: ["day 1/clip.mov"] },
			{ sidecar: "day 1/still.c2pa", kind: "c2pa", files: ["day 1/still.jpg"] },
		]);
	});

	it("gives a sidecar every file it could describe, ignoring case", () => {
		expect(pairSidecars(["IMG_1.CR2", "img_1.jpg", "IMG_1.XMP"])).toEqual([
			{ sidecar: "IMG_1.XMP", kind: "xmp", files: ["IMG_1.CR2", "img_1.jpg"] },
		]);
	});

	it("leaves a sidecar with no file beside it, and never pairs sidecars with each other", () => {
		expect(pairSidecars(["notes.xmp", "a.xmp", "a.c2pa"])).toEqual([]);
	});

	it("pairs a file with no extension", () => {
		expect(pairSidecars(["scan001", "scan001.xmp"])).toEqual([
			{ sidecar: "scan001.xmp", kind: "xmp", files: ["scan001"] },
		]);
	});
});

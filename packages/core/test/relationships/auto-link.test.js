import { describe, it, expect } from "vitest";
import {
	topazSourceBasename,
	findSourceCandidates,
	stripExtension,
	searchTerms,
} from "../../src/relationships/auto-link.js";

describe("topazSourceBasename", () => {
	it("strips Topaz Video AI model suffixes", () => {
		expect(topazSourceBasename("clip_prob4.mov")).toBe("clip");
		expect(topazSourceBasename("Scene 12 wide_iris2.mp4")).toBe(
			"Scene 12 wide",
		);
		expect(topazSourceBasename("photo_1920s_street_thm2_2x.mov")).toBe(
			"photo_1920s_street",
		);
	});
	it("strips the Gigapixel tail", () => {
		expect(
			topazSourceBasename(
				"freepik__wide-shot__86475-gigapixel-redefine-realistic-2x-faceai v2.png",
			),
		).toBe("freepik__wide-shot__86475");
	});
	it("matches the Gigapixel tail in any case, and cuts at the first one", () => {
		expect(topazSourceBasename("Harbour-GIGAPIXEL-standard-4x.png")).toBe(
			"Harbour",
		);
		expect(topazSourceBasename("a-gigapixel-x-gigapixel-y.png")).toBe("a");
	});
	it("stays fast on a hostile name (the old regex took ~500 ms here, growing with the square of the length)", () => {
		// Many tails then a line break: /-gigapixel-.*$/ retried from every one.
		const hostile = "a" + "-gigapixel-".repeat(8000) + "\nb.png";
		const t0 = performance.now();
		expect(topazSourceBasename(hostile)).toBe("a");
		expect(performance.now() - t0).toBeLessThan(50);
	});
	it("returns null for ordinary names", () => {
		expect(topazSourceBasename("PXL_20261102_180109038.mp4")).toBeNull();
		expect(topazSourceBasename("interview_take3.wav")).toBeNull();
		expect(topazSourceBasename("")).toBeNull();
	});
});

describe("findSourceCandidates", () => {
	const index = [
		{
			ref: "archival:1",
			type: "archival",
			id: 1,
			filename: "photo_1920s_street.jpg",
		},
		{
			ref: "ai:7",
			type: "ai",
			id: 7,
			filename: "photo_1920s_street_thm2_2x.mov",
		},
		{ ref: "produced:3", type: "produced", id: 3, filename: "Clip.MP4" },
		{ ref: "ai:9", type: "ai", id: 9, filename: "clip_prob4.mov" },
	];
	it("matches on the stem, case-insensitively, across extensions", () => {
		expect(findSourceCandidates("photo_1920s_street", index)).toEqual([
			index[0],
		]);
		expect(findSourceCandidates("clip", index, { ref: "ai:9" })).toEqual([
			index[2],
		]);
	});
	it("excludes the asset itself and returns empty for no match", () => {
		expect(findSourceCandidates("clip", [index[3]], { ref: "ai:9" })).toEqual(
			[],
		);
		expect(findSourceCandidates(null, index)).toEqual([]);
	});
	it("stripExtension leaves dotted stems alone", () => {
		expect(stripExtension("Catalan_Echoes_2026-04-30T142200.wav")).toBe(
			"Catalan_Echoes_2026-04-30T142200",
		);
		expect(stripExtension("archive.tar.gz")).toBe("archive.tar");
	});
});

describe("searchTerms", () => {
	it("splits on spaces, underscores and hyphens so a clip name finds its file", () => {
		expect(searchTerms("Harbour Sunrise_Wide")).toEqual([
			"%harbour%",
			"%sunrise%",
			"%wide%",
		]);
		expect(searchTerms("the-children  cheer")).toEqual([
			"%the%",
			"%children%",
			"%cheer%",
		]);
		expect(searchTerms("VPT-001")).toEqual(["%vpt%", "%001%"]);
	});
	it("escapes LIKE wildcards and caps the number of terms", () => {
		expect(searchTerms("100% a\\b")).toEqual(["%100\\%%", "%a\\\\b%"]);
		expect(searchTerms("a b c d e f g h").length).toBe(6);
	});
	it("returns no terms for a blank query", () => {
		expect(searchTerms("   ")).toEqual([]);
		expect(searchTerms(undefined)).toEqual([]);
	});
});

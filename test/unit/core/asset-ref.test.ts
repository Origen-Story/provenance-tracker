import { describe, it, expect } from "vitest";
import {
	legacyAssetRef,
	parseLegacyAssetRef,
	withLegacyLayerRefs,
} from "../../../src/server/lib/core/asset-ref.ts";

describe("legacyAssetRef", () => {
	it("is the text the manifest builder's assetKey() made, so ingredient order cannot change", () => {
		expect(legacyAssetRef("produced", 12)).toBe("produced:12");
		expect(legacyAssetRef("archival", "7")).toBe("archival:7");
	});

	it("is null when either half is missing", () => {
		expect(legacyAssetRef(null, 1)).toBeNull();
		expect(legacyAssetRef("ai", null)).toBeNull();
		expect(legacyAssetRef("ai", "")).toBeNull();
	});
});

describe("parseLegacyAssetRef", () => {
	it("gives back the table and row", () => {
		expect(parseLegacyAssetRef("ai:9")).toEqual({ type: "ai", id: 9 });
	});

	it("refuses anything that is not a ref it made", () => {
		for (const bad of [
			"",
			null,
			"ai",
			"ai:",
			"ai:x",
			"users:1",
			"produced:1:2",
			" produced:1",
		])
			expect(parseLegacyAssetRef(bad)).toBeNull();
	});
});

describe("withLegacyLayerRefs", () => {
	it("adds refs to layers and track clips cached before refs existed", () => {
		const cached = {
			composition: {
				picture: {
					intervals: [
						{
							layers: [
								{ matchedAssetType: "produced", matchedAssetId: 11 },
								{ matchedAssetType: null, matchedAssetId: null },
							],
						},
					],
					tracks: [{ clips: [{ matchedAssetType: "ai", matchedAssetId: 21 }] }],
				},
				audio: null,
			},
		};
		const b = withLegacyLayerRefs(cached);
		expect(
			b.composition.picture.intervals[0].layers.map(
				(l: Record<string, unknown>) => l.matchedAssetRef,
			),
		).toEqual(["produced:11", null]);
		expect(b.composition.picture.tracks[0].clips[0]).toMatchObject({
			matchedAssetRef: "ai:21",
		});
	});

	it("leaves a ref that is already there alone, and passes anything without a composition through", () => {
		const fresh = {
			composition: {
				picture: {
					intervals: [{ layers: [{ matchedAssetRef: "archival:3" }] }],
				},
			},
		};
		expect(
			withLegacyLayerRefs(fresh).composition.picture.intervals[0].layers[0]
				.matchedAssetRef,
		).toBe("archival:3");
		expect(withLegacyLayerRefs(null)).toBeNull();
		expect(withLegacyLayerRefs({ counts: {} })).toEqual({ counts: {} });
	});
});

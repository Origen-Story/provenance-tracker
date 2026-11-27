// One opaque reference to an asset.
//
// The pure modules (matching, composition, breakdown, the manifest builder,
// auto-linking) name an asset by its `ref` and nothing else: they compare
// refs, use them as map keys and never look inside. Where a ref comes from is
// the caller's business.
//
// In a catalog every asset has one stable id, and that id, as text, is its
// ref (catalog/timelines.ts, core-node's signing). Before the catalogs the
// app kept assets in three tables, and a ref was "<table kind>:<row id>"
// ("produced:12"): the Postgres migration and its tests still read refs of
// that shape, which is what the functions below are for.

export type AssetRef = string;

export type LegacyAssetType = "produced" | "archival" | "ai";

const LEGACY_TYPES: readonly string[] = ["produced", "archival", "ai"];

/** The ref for a row of the old app's asset tables; null when either half is missing. */
export function legacyAssetRef(
	type: string | null | undefined,
	id: number | string | null | undefined,
): AssetRef | null {
	if (!type || id === null || id === undefined || id === "") return null;
	return `${type}:${id}`;
}

/** The table and row behind a ref made by legacyAssetRef; null for anything else. */
export function parseLegacyAssetRef(
	ref: AssetRef | null | undefined,
): { type: LegacyAssetType; id: number } | null {
	const m = /^([a-z]+):(\d+)$/.exec(String(ref ?? ""));
	if (!m || !LEGACY_TYPES.includes(m[1])) return null;
	return { type: m[1] as LegacyAssetType, id: Number(m[2]) };
}

/**
 * A breakdown cached before refs existed names each layer's asset as
 * matchedAssetType and matchedAssetId. Add the ref, so the pure modules read
 * one shape whether the cache is old or new. No recompute, no write.
 */
export function withLegacyLayerRefs<T>(breakdown: T): T {
	type Layer = Record<string, unknown>;
	type Lane = {
		intervals?: Array<{ layers?: Layer[] }>;
		tracks?: Array<{ clips?: Layer[] }>;
	};
	const lanes = (
		breakdown as { composition?: Record<string, Lane | null> } | null
	)?.composition;
	if (!lanes || typeof lanes !== "object") return breakdown;
	const addRef = (layer: Layer) => {
		if (layer.matchedAssetRef === undefined)
			layer.matchedAssetRef = legacyAssetRef(
				layer.matchedAssetType as string | null,
				layer.matchedAssetId as number | null,
			);
	};
	for (const lane of Object.values(lanes)) {
		if (!lane || typeof lane !== "object") continue;
		for (const iv of lane.intervals ?? [])
			for (const layer of iv.layers ?? []) addRef(layer);
		for (const track of lane.tracks ?? [])
			for (const clip of track.clips ?? []) addRef(clip);
	}
	return breakdown;
}

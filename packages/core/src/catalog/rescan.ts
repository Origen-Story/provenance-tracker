// What changed in a project's folders since the last scan, worked out from
// what the catalog knows and what the folders hold now. Pure: the caller
// lists the folders, hashes the files this asks for, and writes the result.
//
// The rules (roadmap Phase 4, goal 1):
// - A file whose size and modified time match its last scan is not hashed
//   again.
// - Identity is the SHA-256 of the bytes. The same bytes at a new path are
//   the same content, so a moved file keeps everything known about it.
// - A path that now holds other bytes is a new version of the same asset
//   (a re-render), unless those bytes are already known.
// - A known path that is not there any more is gone, but only when its
//   folder was listed in full. A root that is not on this machine, or a
//   folder that could not be read, says nothing about the files in it.

/** A live location as the catalog has it. */
export interface KnownLocation {
	id: number;
	rootId: number;
	path: string;
	sha256: string;
	size: number;
	modifiedMs: number;
}

/** A file as the folder holds it now. */
export interface SeenFile {
	rootId: number;
	path: string;
	size: number;
	modifiedMs: number;
}

export interface RescanPlan {
	/** Same path, size and modified time: not hashed, only marked as seen. */
	unchanged: KnownLocation[];
	/** New paths, and known paths whose size or time changed. */
	toHash: Array<SeenFile & { previous: KnownLocation | null }>;
	/** Known paths in the listed folders that are not there now. */
	missing: KnownLocation[];
}

const keyOf = (rootId: number, path: string) => `${rootId}\u0000${path}`;

/**
 * Compare the catalog with the folders.
 * @param listed whether a known location's folder was listed in full; a
 *   location outside the listed folders is neither unchanged nor missing.
 */
export function planRescan(
	known: readonly KnownLocation[],
	seen: readonly SeenFile[],
	listed: (location: KnownLocation) => boolean,
): RescanPlan {
	const byPath = new Map(known.map((k) => [keyOf(k.rootId, k.path), k]));
	const seenKeys = new Set<string>();
	const plan: RescanPlan = { unchanged: [], toHash: [], missing: [] };
	for (const file of seen) {
		const key = keyOf(file.rootId, file.path);
		seenKeys.add(key);
		const previous = byPath.get(key) ?? null;
		if (
			previous &&
			previous.size === file.size &&
			previous.modifiedMs === file.modifiedMs
		)
			plan.unchanged.push(previous);
		else plan.toHash.push({ ...file, previous });
	}
	for (const k of known)
		if (!seenKeys.has(keyOf(k.rootId, k.path)) && listed(k))
			plan.missing.push(k);
	return plan;
}

/** What to do with one hashed file. */
export type FileChange =
	/** Same bytes at the same path; only its modified time moved. */
	| { kind: "touched"; previous: KnownLocation }
	/** A path that now holds other bytes: the old location is gone. */
	| { kind: "replaced"; previous: KnownLocation; content: ContentChoice }
	/** A path the catalog did not have. */
	| { kind: "added"; content: ContentChoice; movedFrom: KnownLocation | null };

export type ContentChoice =
	/** Bytes the catalog already has, belonging to that asset. */
	| { kind: "known"; assetId: number }
	/** New bytes, a new version of this asset (a re-render in place). */
	| { kind: "new-version"; assetId: number }
	/** New bytes and a new asset. */
	| { kind: "new-asset" };

/**
 * Decide what one hashed file is. Moves are paired with missing files of
 * the same bytes, each missing file used once, in the order given.
 */
export function classifyFile(
	file: SeenFile & { previous: KnownLocation | null; sha256: string },
	lookup: {
		/** The asset the catalog's content with these bytes belongs to. */
		assetOf: (sha256: string) => number | undefined;
		/** Missing locations not yet paired with a move; the chosen one is removed. */
		missing: KnownLocation[];
	},
): FileChange {
	const { previous, sha256 } = file;
	if (previous && previous.sha256 === sha256)
		return { kind: "touched", previous };
	const knownAsset = lookup.assetOf(sha256);
	const content: ContentChoice =
		knownAsset !== undefined
			? { kind: "known", assetId: knownAsset }
			: previous
				? { kind: "new-version", assetId: lookup.assetOf(previous.sha256)! }
				: { kind: "new-asset" };
	if (previous) return { kind: "replaced", previous, content };
	const i = lookup.missing.findIndex((m) => m.sha256 === sha256);
	const movedFrom = i >= 0 ? lookup.missing.splice(i, 1)[0] : null;
	return { kind: "added", content, movedFrom };
}

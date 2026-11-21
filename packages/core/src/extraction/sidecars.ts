// Which files are sidecars, and which file each one describes. Pure: catalog
// paths in, pairs out.
//
// The two conventions in use, for both .xmp and .c2pa:
// - same name, other extension: IMG_1.CR2 + IMG_1.xmp (Lightroom, Bridge;
//   C2PA's own rule for a sidecar manifest)
// - full name plus extension: clip.mov + clip.mov.xmp (darktable and others)
// A sidecar matching several files (IMG_1.CR2 and IMG_1.JPG) describes each.
// A sidecar with no file beside it is left alone: it is just a file.

export type SidecarKind = "xmp" | "c2pa";

export interface SidecarPair {
	sidecar: string;
	kind: SidecarKind;
	/** The files it describes, in path order. */
	files: string[];
}

function split(p: string): { dir: string; name: string } {
	const i = p.lastIndexOf("/");
	return {
		dir: i < 0 ? "" : p.slice(0, i + 1),
		name: i < 0 ? p : p.slice(i + 1),
	};
}

/** The sidecar kind of a path, by extension in any case; null for any other file. */
export function sidecarKind(p: string): SidecarKind | null {
	const lower = p.toLowerCase();
	if (lower.endsWith(".xmp")) return "xmp";
	if (lower.endsWith(".c2pa")) return "c2pa";
	return null;
}

function stem(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(0, dot) : name;
}

/** Pair every sidecar in `paths` (one root's catalog paths) with the files it describes. */
export function pairSidecars(paths: readonly string[]): SidecarPair[] {
	// Files that are not sidecars, by folder, by lower-cased name and stem.
	const byName = new Map<string, string>();
	const byStem = new Map<string, string[]>();
	for (const p of paths) {
		if (sidecarKind(p)) continue;
		const { dir, name } = split(p);
		byName.set((dir + name).toLowerCase(), p);
		const key = (dir + stem(name)).toLowerCase();
		byStem.set(key, [...(byStem.get(key) ?? []), p]);
	}
	const pairs: SidecarPair[] = [];
	for (const p of [...paths].sort()) {
		const kind = sidecarKind(p);
		if (!kind) continue;
		const { dir, name } = split(p);
		const base = (dir + stem(name)).toLowerCase();
		const files = new Set<string>();
		// clip.mov.xmp → clip.mov
		const full = byName.get(base);
		if (full) files.add(full);
		// IMG_1.xmp → IMG_1.CR2, IMG_1.JPG
		for (const f of byStem.get(base) ?? []) files.add(f);
		if (files.size) pairs.push({ sidecar: p, kind, files: [...files].sort() });
	}
	return pairs;
}

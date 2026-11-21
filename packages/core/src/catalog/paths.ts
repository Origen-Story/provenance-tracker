// A file in a catalog is a root and a path inside it (D26): "root 3,
// interviews/street.mov". Which folder root 3 is comes from the project folder
// (for a root inside it) or this machine's settings (D32), so the same catalog
// works on a laptop with other drive letters.
// These functions turn one form into the other. They never touch the disk:
// the caller resolves symlinks and checks that folders exist.

import path from "node:path";

/** The operating system whose path rules apply ("win32", "darwin", "linux"…). */
export type Platform = NodeJS.Platform;

function rules(platform: Platform) {
	return {
		path: platform === "win32" ? path.win32 : path.posix,
		// Windows and macOS treat "Media" and "media" as one folder by default.
		// Comparing without case there refuses more overlaps, never fewer.
		foldCase: platform === "win32" || platform === "darwin",
	};
}

function comparable(p: string, foldCase: boolean): string {
	return foldCase ? p.toLowerCase() : p;
}

/**
 * True for a path that names one place on its own: on Windows a drive letter
 * or a network share ("\\media" alone depends on the current drive).
 */
export function isFullPath(p: string, platform: Platform): boolean {
	if (platform === "win32") return /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/])/.test(p);
	return p.startsWith("/");
}

/**
 * True for a path the catalog stores: relative, "/" between folders, no
 * empty, "." or ".." parts, no drive letter. The catalog's own CHECK refuses
 * less than this; this is the one form scans write.
 */
export function isCatalogPath(rel: string): boolean {
	if (rel === "" || rel.includes("\\")) return false;
	if (/^[A-Za-z]:/.test(rel)) return false;
	return rel
		.split("/")
		.every((part) => part !== "" && part !== "." && part !== "..");
}

/**
 * The path of `file` inside `root`, in catalog form, or null when the file
 * is not inside the root (or is the root itself).
 */
export function toCatalogPath(
	root: string,
	file: string,
	platform: Platform,
): string | null {
	const r = rules(platform);
	if (!isFullPath(root, platform) || !isFullPath(file, platform)) return null;
	if (!isWithin(root, file, platform)) return null;
	// isWithin compares without case where the system does; the path keeps
	// the file's own spelling, cut at the root's length.
	const rest = r.path.resolve(file).slice(r.path.resolve(root).length);
	const rel = rest.split(r.path.sep).filter(Boolean).join("/");
	return isCatalogPath(rel) ? rel : null;
}

/** The absolute path of a catalog path under a root on this machine. */
export function fromCatalogPath(
	root: string,
	rel: string,
	platform: Platform,
): string {
	if (!isCatalogPath(rel))
		throw new Error(`Not a catalog path: ${JSON.stringify(rel)}`);
	const r = rules(platform);
	if (!isFullPath(root, platform))
		throw new Error(`A root's folder must be a full path (it is ${root})`);
	return r.path.join(r.path.resolve(root), ...rel.split("/"));
}

/** True when `inner` is `outer` or inside it. */
export function isWithin(
	outer: string,
	inner: string,
	platform: Platform,
): boolean {
	const r = rules(platform);
	if (!isFullPath(outer, platform) || !isFullPath(inner, platform))
		return false;
	const a = comparable(r.path.resolve(outer), r.foldCase);
	const b = comparable(r.path.resolve(inner), r.foldCase);
	if (a === b) return true;
	const rel = r.path.relative(a, b);
	// A folder called "..notes" is inside; only ".." itself leads out.
	const up = rel === ".." || rel.startsWith(`..${r.path.sep}`);
	return rel !== "" && !up && !r.path.isAbsolute(rel);
}

/** True when one folder is the other or contains it. */
export function overlaps(a: string, b: string, platform: Platform): boolean {
	return isWithin(a, b, platform) || isWithin(b, a, platform);
}

export interface RootFolder {
	id: number;
	/** The root's absolute folder on this machine. */
	folder: string;
}

/**
 * Which root a file is in, and its catalog path there. Roots on one machine
 * never overlap (adding one that does is refused), so there is at most one.
 */
export function locateFile(
	roots: readonly RootFolder[],
	file: string,
	platform: Platform,
): { rootId: number; path: string } | null {
	for (const root of roots) {
		const rel = toCatalogPath(root.folder, file, platform);
		if (rel !== null) return { rootId: root.id, path: rel };
	}
	return null;
}

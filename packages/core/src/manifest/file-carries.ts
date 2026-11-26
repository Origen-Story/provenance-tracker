// Pure: what a file carries in its own metadata, outside any Content
// Credentials (D64). A signed copy is the cut's bytes with credentials added,
// and the claim thumbnail is the picked image's bytes, so whatever their
// EXIF, XMP, IPTC and container tags say is published with the film. An
// editor's export commonly holds the project's path, the paths of the files
// it was cut from, and the name of the machine's user.
//
// Read from the stored ExifTool reading of the content (the catalog's exif
// observation: flat tag names, with XMP structures nested). The tracker never
// changes a file, so these are changed where the file is made: the editor's
// export settings, or the camera's.

export type FileDetailKind = "path" | "location" | "person" | "device" | "text";

export interface FileDetail {
	/** The tag as ExifTool names it, with a dot for each level inside a structure. */
	tag: string;
	value: string;
	kind: FileDetailKind;
}

/** The most a review lists for one file; the rest is counted. */
export const MAX_DETAILS = 40;

const LOCATION =
	/^gps(?!versionid)|location|city|state|province|country|sublocation/i;
// "CreatorTool" names a program, not a person.
const PERSON =
	/artist|creator(?!tool)|author|by-?line|owner|copyright|rights|credit|contact|email|publisher|director|producer|writer/i;
const DEVICE =
	/serial|^make$|^model$|lens(make|model|info|id)?$|devicename|hostcomputer|^software$|creatortool|encoder|android/i;
const PATH = /path|directory|folder|^windowsatom|^macatom/i;
const TEXT =
	/title|description|comment|subject|keyword|caption|headline|label|instructions|project|derivedfrom|ingredients|pantry|history/i;

/** A drive letter, a network share, or a home folder: a path on someone's machine. */
const LOOKS_LIKE_PATH =
	/(^|[\s"'(])([A-Za-z]:[\\/]|\\\\[^\\\s]+\\|\/(Users|home|Volumes)\/)/;

function kindOf(leaf: string, value: string): FileDetailKind | null {
	if (LOOKS_LIKE_PATH.test(value) || PATH.test(leaf)) return "path";
	if (LOCATION.test(leaf)) return "location";
	if (PERSON.test(leaf)) return "person";
	if (DEVICE.test(leaf)) return "device";
	if (TEXT.test(leaf)) return "text";
	return null;
}

/**
 * The tags of an ExifTool reading that say something about a person, a
 * place, a device or a machine's folders, in the reading's own order.
 * @returns the details (at most MAX_DETAILS) and how many more there are
 */
export function fileCarries(tags: unknown): {
	details: FileDetail[];
	more: number;
} {
	const details: FileDetail[] = [];
	const seen = new Set<string>();
	let more = 0;
	const walk = (value: unknown, tag: string, telling: boolean) => {
		if (value === null || value === undefined) return;
		if (Array.isArray(value)) {
			for (const v of value) walk(v, tag, telling);
			return;
		}
		if (typeof value === "object") {
			for (const [k, v] of Object.entries(value))
				// Inside a structure whose name tells (History, Ingredients), every
				// text is listed: its leaves are named for their form, not their meaning.
				walk(v, tag ? `${tag}.${k}` : k, telling || kindOf(k, "") !== null);
			return;
		}
		if (typeof value !== "string" && typeof value !== "number") return;
		const text = String(value).trim();
		if (!text) return;
		const leaf = tag.split(".").pop() ?? tag;
		const kind =
			kindOf(leaf, text) ??
			(telling && typeof value === "string" ? "text" : null);
		if (!kind) return;
		const key = `${tag}\n${text}`;
		if (seen.has(key)) return;
		seen.add(key);
		if (details.length >= MAX_DETAILS) more++;
		else
			details.push({
				tag,
				value: text.length > 160 ? `${text.slice(0, 157)}…` : text,
				kind,
			});
	};
	walk(tags && typeof tags === "object" ? tags : {}, "", false);
	return { details, more };
}

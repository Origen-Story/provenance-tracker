// How the new pages name the catalog's values. The values themselves come
// from packages/core (catalog/edits.ts, origin-vocabulary.js).

export const KIND_LABEL: Record<string, string> = {
	produced: "Recorded or made",
	archival: "Archival",
	generated: "AI-generated",
	unsorted: "Not sorted yet",
	sidecar: "Sidecar file",
};

/** The kinds a person may give an asset, in the order the picker offers them. */
export const KINDS = [
	"unsorted",
	"produced",
	"archival",
	"generated",
	"sidecar",
];

/** A link as read from this asset's side. */
export const LINK_LABEL: Record<string, { parent: string; child: string }> = {
	ingredient: { parent: "Is an ingredient of", child: "Is made with" },
	derived_from: {
		parent: "Has an enhanced copy",
		child: "Is an enhanced copy of",
	},
	output_of: { parent: "Used in the edit", child: "Is an edit that used" },
	sidecar_of: { parent: "Has the sidecar", child: "Is the sidecar of" },
	started_from: {
		parent: "A later edit started from it",
		child: "Started from the edit",
	},
};

export const LINK_TYPES = ["ingredient", "derived_from", "output_of"];

const IMAGE = /\.(jpe?g|png|gif|webp|avif|bmp|tiff?|heic|svg)$/i;
const VIDEO = /\.(mp4|m4v|mov|webm|mkv|avi|mxf)$/i;
const AUDIO = /\.(wav|mp3|m4a|aac|flac|ogg|opus|aiff?)$/i;

/** What kind of preview a file can have, from its name. */
export function mediaKind(
	path: string | undefined,
): "image" | "video" | "audio" | null {
	if (!path) return null;
	if (IMAGE.test(path)) return "image";
	if (VIDEO.test(path)) return "video";
	if (AUDIO.test(path)) return "audio";
	return null;
}

export function bytes(n: number): string {
	if (n < 1024) return `${n} B`;
	const units = ["KB", "MB", "GB", "TB"];
	let v = n / 1024;
	let i = 0;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i++;
	}
	return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

/** How a signed copy read back (manifest/verify.js STATUS_LABELS). */
export const SIGNED_STATUS: Record<string, string> = {
	valid: "Valid",
	unrecognised_issuer: "Valid, unrecognised issuer",
	hash_mismatch: "Content does not match the signature",
	invalid: "Invalid",
	absent: "No Content Credentials",
};

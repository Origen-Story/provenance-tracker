// The media type the C2PA library is told a file is, from its name (D53).
// The library's signing calls need one for every file they open: the file
// being signed and each ingredient. These are the types c2pa-rs reads and
// writes Content Credentials in; a file of any other type still goes in as an
// ingredient (with its name, type and hash), just without credentials of its
// own, as c2patool treated it.

const C2PA_TYPES: Readonly<Record<string, string>> = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".gif": "image/gif",
	".webp": "image/webp",
	".tif": "image/tiff",
	".tiff": "image/tiff",
	".dng": "image/x-adobe-dng",
	".heic": "image/heic",
	".heif": "image/heif",
	".avif": "image/avif",
	".svg": "image/svg+xml",
	".mp4": "video/mp4",
	".m4v": "video/mp4",
	".mov": "video/quicktime",
	".avi": "video/x-msvideo",
	".m4a": "audio/mp4",
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
	".pdf": "application/pdf",
	".c2pa": "application/c2pa",
};

/** What any other file is called. */
export const UNKNOWN_TYPE = "application/octet-stream";

/** The file's extension, lower-case with its dot, or "" when it has none. */
function extensionOf(fileName: string): string {
	const base = fileName.split(/[\\/]/).pop() ?? "";
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

/** The C2PA media type of a file, or null when C2PA has none for it. */
export function c2paTypeOf(fileName: string): string | null {
	return C2PA_TYPES[extensionOf(fileName)] ?? null;
}

/** The media type to give the library for a file: its C2PA type, or the unknown type. */
export function mediaTypeForSigning(fileName: string): string {
	return c2paTypeOf(fileName) ?? UNKNOWN_TYPE;
}

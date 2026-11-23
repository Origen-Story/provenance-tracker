// File names for files the tracker adds to a root (an upload, a download).
// Pure. A name from outside (a browser, a server's headers, a URL) is never
// trusted as a path: it is cut to its last part, emptied of what Windows,
// macOS or the catalog cannot hold, and never allowed to replace a file.

/** Characters no common file system allows in a name, and control characters. */
// eslint-disable-next-line no-control-regex -- control characters are what this removes
const FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;

/** Names Windows keeps for devices, with or without an extension. */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

const MAX_STEM = 120;

/**
 * A safe name for a file from what someone else called it: its last path
 * part only, without forbidden characters, leading dots (a hidden file, which
 * a scan passes over) or trailing dots and spaces (Windows drops them), not a
 * reserved device name, and a stem of at most 120 characters so the full
 * path stays well inside Windows' limit. Letters with accents are kept.
 * @param fallback used when nothing is left ("file", "download")
 */
export function safeFileName(raw: string, fallback = "file"): string {
	const last = String(raw ?? "")
		.split(/[\\/]/)
		.at(-1)!
		.normalize("NFC");
	let name = last
		.replace(FORBIDDEN, "_")
		.replace(/^[.\s]+/, "")
		.replace(/[.\s]+$/, "")
		.trim();
	if (!name || /^_+$/.test(name)) name = fallback;
	if (RESERVED.test(name)) name = `_${name}`;
	const dot = name.lastIndexOf(".");
	const [stem, ext] =
		dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
	return stem.length > MAX_STEM
		? `${stem.slice(0, MAX_STEM).trimEnd()}${ext}`
		: name;
}

/**
 * The first of name, "name (2).ext", "name (3).ext", ... that `taken` says is
 * free, so an added file never replaces one already there.
 */
export function freeName(
	name: string,
	taken: (candidate: string) => boolean,
): string {
	if (!taken(name)) return name;
	const dot = name.lastIndexOf(".");
	const [stem, ext] =
		dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
	for (let i = 2; i < 10_000; i++) {
		const candidate = `${stem} (${i})${ext}`;
		if (!taken(candidate)) return candidate;
	}
	throw new Error(`No free name like ${name} is left in this folder`);
}

/**
 * The file name a download offers: Content-Disposition's filename* (RFC 5987)
 * or filename, else the last part of the URL's path, decoded. Not yet safe:
 * pass it through safeFileName.
 */
export function offeredFileName(
	contentDisposition: string | null,
	url: string,
): string {
	const cd = contentDisposition ?? "";
	const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(cd);
	if (star) {
		try {
			return decodeURIComponent(star[2].trim().replace(/^"|"$/g, ""));
		} catch {
			/* fall through to the plain form */
		}
	}
	const plain = /filename\s*=\s*("([^"]*)"|([^;]+))/i.exec(cd);
	if (plain) return (plain[2] ?? plain[3] ?? "").trim();
	let last: string;
	try {
		last = new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "";
	} catch {
		return "";
	}
	try {
		return decodeURIComponent(last);
	} catch {
		return last;
	}
}

/** The extension a media type usually has, for a download whose name has none. */
const EXTENSIONS: Readonly<Record<string, string>> = {
	"image/jpeg": ".jpg",
	"image/png": ".png",
	"image/gif": ".gif",
	"image/webp": ".webp",
	"image/tiff": ".tif",
	"image/svg+xml": ".svg",
	"image/heic": ".heic",
	"video/mp4": ".mp4",
	"video/quicktime": ".mov",
	"video/webm": ".webm",
	"audio/mpeg": ".mp3",
	"audio/wav": ".wav",
	"audio/x-wav": ".wav",
	"audio/flac": ".flac",
	"audio/ogg": ".ogg",
	"audio/mp4": ".m4a",
};

/** Add the media type's usual extension to a name that has none. */
export function withExtension(name: string, mediaType: string): string {
	if (/\.[A-Za-z0-9]{1,5}$/.test(name)) return name;
	return name + (EXTENSIONS[mediaType] ?? "");
}

/** Whether a download's media type is one the tracker takes: pictures, video and sound. */
export function isMediaType(mediaType: string): boolean {
	return /^(image|video|audio)\/[\w.+-]+$/i.test(mediaType);
}

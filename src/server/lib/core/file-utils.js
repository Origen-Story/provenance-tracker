import path from "path";

const MIME_MAP = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".tif": "image/tiff",
	".tiff": "image/tiff",
	".bmp": "image/bmp",
	".svg": "image/svg+xml",
	".avif": "image/avif",
	".heic": "image/heic",
	".heif": "image/heif",
	".mp4": "video/mp4",
	".m4v": "video/mp4",
	".mov": "video/quicktime",
	".avi": "video/x-msvideo",
	".mkv": "video/x-matroska",
	".webm": "video/webm",
	".wav": "audio/wav",
	".mp3": "audio/mpeg",
	".flac": "audio/flac",
	".ogg": "audio/ogg",
	".m4a": "audio/mp4",
	".aac": "audio/aac",
	".aif": "audio/aiff",
	".aiff": "audio/aiff",
	".pdf": "application/pdf",
};

export function getMimeType(filePath) {
	const ext = path.extname(filePath).toLowerCase();
	return MIME_MAP[ext] || "application/octet-stream";
}

// What /api/preview may stream: pictures, video and sound, judged by the
// file's extension. Everything else is refused, so a key, a .env file or a
// document is never served, whatever path is asked for.
export function isPreviewable(filePath) {
	return /^(image|video|audio)\//.test(getMimeType(String(filePath || "")));
}

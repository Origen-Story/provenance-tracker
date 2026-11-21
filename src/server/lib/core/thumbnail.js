// Pure helpers for video thumbnails in the asset grids.
//
// Why on the server: the browser can draw a frame of an H.264 file itself,
// but not ProRes (motion graphics with alpha) and only sometimes HEVC (phone
// footage), so those cards stayed blank. ffmpeg reads all of them. The IO
// (running ffmpeg, the cache folder) lives in routes/preview.js.
import { createHash } from "node:crypto";

export const THUMB_WIDTH = 480;

/**
 * Cache file name for one version of a file. The size and modified time are
 * part of the key, so a re-rendered file gets a fresh frame.
 */
export function thumbnailKey(filePath, { size, mtimeMs }, width = THUMB_WIDTH) {
	const id = [
		String(filePath).replace(/\\/g, "/").toLowerCase(),
		size,
		Math.round(mtimeMs),
		width,
	].join("|");
	return `${createHash("sha256").update(id).digest("hex").slice(0, 32)}.webp`;
}

/**
 * Where to take the frame: a third of the way in, past fade-ins and title
 * builds. Unknown or zero duration falls back to the first frame.
 */
export function frameTime(durationSeconds) {
	const d = Number(durationSeconds);
	if (!Number.isFinite(d) || d <= 0) return 0;
	return Math.round((d / 3) * 100) / 100;
}

/** ffmpeg arguments for one WebP frame. WebP keeps an alpha channel. */
export function frameArgs({ input, output, at = 0, width = THUMB_WIDTH }) {
	return [
		"-v",
		"error",
		"-y",
		...(at > 0 ? ["-ss", String(at)] : []),
		"-i",
		input,
		"-frames:v",
		"1",
		"-vf",
		`scale=${width}:-2`,
		"-c:v",
		"libwebp",
		"-quality",
		"75",
		output,
	];
}

/** ffprobe arguments that print the container duration in seconds. */
export function durationArgs(input) {
	return [
		"-v",
		"error",
		"-show_entries",
		"format=duration",
		"-of",
		"csv=p=0",
		input,
	];
}

// Stream a picture, video or sound to the page, honouring HTTP Range requests
// so <video> and <audio> can seek (the player sends ranges once it knows the
// length; without 206 responses seeking rewinds to the start). The file is
// one the catalog places, never a path from the request.

import { createReadStream, statSync } from "node:fs";
import type { Request, Response } from "express";
import { getMimeType, isPreviewable } from "../lib/core/file-utils.js";

/** Whether a file is one the page may be shown: a picture, video or sound, by its name. */
export const showable = (file: string): boolean => isPreviewable(file);

export function streamFile(req: Request, res: Response, file: string): void {
	const { size } = statSync(file);
	res.setHeader("Content-Type", getMimeType(file));
	// A file opened directly in a tab (an SVG can carry script) runs sandboxed,
	// with no access to the tracker's own origin. <img>, <video> and <audio>
	// ignore this header.
	res.setHeader("Content-Security-Policy", "sandbox");
	res.setHeader("Cache-Control", "private, max-age=3600");
	res.setHeader("Accept-Ranges", "bytes");
	const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
	if (range && size > 0 && (range[1] !== "" || range[2] !== "")) {
		const start =
			range[1] === "" ? Math.max(0, size - Number(range[2])) : Number(range[1]);
		const end =
			range[2] === "" || range[1] === ""
				? size - 1
				: Math.min(Number(range[2]), size - 1);
		if (Number.isNaN(start) || start >= size || start > end) {
			res.setHeader("Content-Range", `bytes */${size}`);
			res.status(416).end();
			return;
		}
		res.status(206);
		res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
		res.setHeader("Content-Length", end - start + 1);
		createReadStream(file, { start, end }).pipe(res);
		return;
	}
	res.setHeader("Content-Length", size);
	createReadStream(file).pipe(res);
}

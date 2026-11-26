// Stream a picture, video or sound to the page, honouring HTTP Range requests
// so <video> and <audio> can seek (the player sends ranges once it knows the
// length; without 206 responses seeking rewinds to the start). The file is
// one the catalog places, never a path from the request.
//
// The file is opened before any header is sent, and the stream's errors are
// caught (D66): a file that is gone, is really a folder, or is held by another
// program is an answer in words, and a read that fails part-way cuts that one
// response short. A stream with no error handler stops the whole server, and
// a scan or a signing running at the time with it.

import { open, stat, type FileHandle } from "node:fs/promises";
import { pipeline } from "node:stream";
import type { Request, Response } from "express";
import { getMimeType, isPreviewable } from "../lib/core/file-utils.js";

/** Whether a file is one the page may be shown: a picture, video or sound, by its name. */
export const showable = (file: string): boolean => isPreviewable(file);

/** An answer in words, with its HTTP status, as the app's error handler sends it. */
const refusal = (status: number, message: string) =>
	Object.assign(new Error(message), { status });

const GONE = new Set(["ENOENT", "ENOTDIR", "EISDIR"]);

/**
 * Why a file could not be opened, without the file's path: gone (404), or
 * there and not readable just now (503).
 */
function notOpened(err: unknown): Error {
	const code = (err as NodeJS.ErrnoException).code ?? "";
	return GONE.has(code)
		? refusal(404, "That file is not on this machine any more")
		: refusal(
				503,
				`That file could not be opened just now${code ? ` (${code})` : ""}: another program may be using it. Try again.`,
			);
}

/**
 * Send a file, or the part of it a Range header asks for. Rejects, before
 * anything is sent, when the file cannot be opened or is not a file; the
 * app's error handler answers.
 */
export async function streamFile(
	req: Request,
	res: Response,
	file: string,
): Promise<void> {
	let handle: FileHandle;
	try {
		handle = await open(file, "r");
	} catch (err) {
		// Windows refuses to open a folder with a code that also means "in use".
		const there = await stat(file).catch(() => null);
		throw there && !there.isFile()
			? refusal(404, "That file is not on this machine any more")
			: notOpened(err);
	}
	let body;
	try {
		const stat = await handle.stat();
		if (!stat.isFile())
			throw refusal(404, "That file is not on this machine any more");
		const { size } = stat;
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
				range[1] === ""
					? Math.max(0, size - Number(range[2]))
					: Number(range[1]);
			const end =
				range[2] === "" || range[1] === ""
					? size - 1
					: Math.min(Number(range[2]), size - 1);
			if (Number.isNaN(start) || start >= size || start > end) {
				res.setHeader("Content-Range", `bytes */${size}`);
				res.status(416).end();
				await handle.close();
				return;
			}
			res.status(206);
			res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
			res.setHeader("Content-Length", end - start + 1);
			body = handle.createReadStream({ start, end });
		} else {
			res.setHeader("Content-Length", size);
			body = handle.createReadStream();
		}
	} catch (err) {
		await handle.close().catch(() => {});
		throw (err as { status?: number }).status ? err : notOpened(err);
	}
	// From here the response is under way. The stream closes the file when it
	// ends; if the read fails, or the page stops listening, the response is
	// cut short and nothing is thrown.
	await new Promise<void>((resolve) =>
		pipeline(body, res, (err) => {
			if (err && !res.destroyed) res.destroy();
			resolve();
		}),
	);
}

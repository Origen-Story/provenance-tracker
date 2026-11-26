// Fetch a picture, video or sound from a web address into the project's
// incoming folder, for placing in a root (core-node/incoming.ts). Only public
// addresses, re-checked on every redirect (lib/core/public-url.ts); only media
// types; at most a set size; written under a temporary name and hashed as it
// arrives. Stops when the job is cancelled.

import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, rmSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import {
	isMediaType,
	offeredFileName,
	safeFileName,
	withExtension,
} from "@provenancetracker/core/files/names.ts";
import { fetchPublic } from "../lib/core/public-url.ts";

type Lookup = (hostname: string) => Promise<Array<{ address: string }>>;

/** A download larger than this is refused (4 GiB). */
export const MAX_DOWNLOAD_BYTES = 4 * 1024 ** 3;

export interface Downloaded {
	/** The file in the incoming folder. */
	file: string;
	/** The name to give it in its root. */
	name: string;
	mediaType: string;
	sha256: string;
	size: number;
}

export async function download(opts: {
	url: string;
	incoming: string;
	userAgent: string;
	lookup: Lookup;
	fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
	signal?: AbortSignal;
	maxBytes?: number;
}): Promise<Downloaded> {
	const max = opts.maxBytes ?? MAX_DOWNLOAD_BYTES;
	const res = await fetchPublic(
		opts.url,
		{ headers: { "User-Agent": opts.userAgent }, signal: opts.signal },
		{ lookup: opts.lookup, fetchImpl: opts.fetchImpl },
	);
	if (!res.ok || !res.body)
		throw new Error(
			`The address answered ${res.status} ${res.statusText}`.trim(),
		);
	const mediaType =
		res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
	if (!isMediaType(mediaType))
		throw new Error(
			`The address gave ${mediaType || "something with no type"}, not a picture, video or sound. Link to the file itself, not a page about it.`,
		);
	const length = Number(res.headers.get("content-length") ?? 0);
	if (length > max)
		throw new Error(`The file is ${length} bytes; the most taken is ${max}`);

	const file = path.join(opts.incoming, `${randomUUID()}.part`);
	const hash = createHash("sha256");
	let size = 0;
	const body = res.body as unknown as AsyncIterable<Uint8Array>;
	// One pipeline, so an error from any part of it is this job's failure: a
	// write stream with no error handler (the folder gone, the disk full)
	// would stop the whole server instead (D66).
	const out = createWriteStream(file, { flags: "wx" });
	try {
		await pipeline(async function* () {
			for await (const chunk of body) {
				if (opts.signal?.aborted) throw new Error("Stopped");
				size += chunk.byteLength;
				if (size > max)
					throw new Error(
						`The file is larger than ${max} bytes; it was not kept`,
					);
				hash.update(chunk);
				yield chunk;
			}
		}, out);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		// The file may still be being opened: it is removed once the stream has
		// let it go, or it would appear again after being removed.
		if (!out.closed)
			await new Promise<void>((resolve) => out.once("close", () => resolve()));
		// "wx" never replaces a file: one already there is not this download's.
		if (code !== "EEXIST") rmSync(file, { force: true });
		// A failure of the disk is said without the folder's path.
		if (
			code &&
			/^E[A-Z]+$/.test(code) &&
			(err as NodeJS.ErrnoException).syscall
		)
			throw new Error(
				`The download could not be saved on this machine (${code})`,
				{ cause: err },
			);
		throw err;
	}
	const name = withExtension(
		safeFileName(
			offeredFileName(res.headers.get("content-disposition"), opts.url),
			"download",
		),
		mediaType,
	);
	return { file, name, mediaType, sha256: hash.digest("hex"), size };
}

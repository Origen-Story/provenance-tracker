// Fetch a picture, video or sound from a web address into the project's
// incoming folder, for placing in a root (core-node/incoming.ts). Only public
// addresses, re-checked on every redirect (lib/core/public-url.ts); only media
// types, kept under a name that ends as media does (D73); at most a set size
// and a set time; written under a temporary name and hashed as it arrives.
// Stops when the job is cancelled.

import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, rmSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import {
	isMediaType,
	mediaFileName,
	offeredFileName,
	safeFileName,
} from "@provenancetracker/core/files/names.ts";
import { fetchPublic } from "../lib/core/public-url.ts";

type Lookup = (hostname: string) => Promise<Array<{ address: string }>>;

/** A download larger than this is refused (4 GiB). */
export const MAX_DOWNLOAD_BYTES = 4 * 1024 ** 3;

/**
 * How long a download may take (D73). Without these a server that answers
 * slowly, or never finishes, holds the project's one job for as long as it
 * likes.
 */
export const DOWNLOAD_LIMITS: Readonly<DownloadLimits> = {
	answerMs: 30_000,
	quietMs: 60_000,
	wholeMs: 6 * 60 * 60_000,
};

export interface DownloadLimits {
	/** The address, and every address it redirects to, must have answered within this. */
	answerMs: number;
	/** The longest wait for the next piece of the file. */
	quietMs: number;
	/** The longest the whole download may take, however steadily it arrives. */
	wholeMs: number;
}

export interface Downloaded {
	/** The file in the incoming folder. */
	file: string;
	/** The name to give it in its root. */
	name: string;
	mediaType: string;
	sha256: string;
	size: number;
}

/** A length of time in words: "30 seconds", "6 hours". */
function span(ms: number): string {
	const say = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
	if (ms >= 3_600_000 && ms % 3_600_000 === 0)
		return say(ms / 3_600_000, "hour");
	if (ms >= 60_000 && ms % 60_000 === 0) return say(ms / 60_000, "minute");
	return say(ms / 1000, "second");
}

export async function download(opts: {
	url: string;
	incoming: string;
	userAgent: string;
	lookup: Lookup;
	fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
	signal?: AbortSignal;
	maxBytes?: number;
	limits?: Partial<DownloadLimits>;
}): Promise<Downloaded> {
	const max = opts.maxBytes ?? MAX_DOWNLOAD_BYTES;
	const limits = { ...DOWNLOAD_LIMITS, ...opts.limits };

	// One signal for the request and the body: the job's own (the person
	// stopped it) or a time limit reached here. `late` says which limit.
	const limit = new AbortController();
	const signal = opts.signal
		? AbortSignal.any([opts.signal, limit.signal])
		: limit.signal;
	let late = "";
	const timers = new Set<NodeJS.Timeout>();
	const within = (ms: number, message: string) => {
		const timer = setTimeout(() => {
			late ||= message;
			limit.abort();
		}, ms);
		timers.add(timer);
		return () => {
			clearTimeout(timer);
			timers.delete(timer);
		};
	};
	// Rejects when the signal fires. Each wait below races it, so a limit holds
	// whether or not what is being waited for listens to the signal.
	const stopped = new Promise<never>((_, reject) => {
		const stop = () => reject(new Error(late || "Stopped"));
		if (signal.aborted) stop();
		else signal.addEventListener("abort", stop, { once: true });
	});
	stopped.catch(() => {});
	const orStopped = async <T>(wait: Promise<T>): Promise<T> => {
		try {
			return await Promise.race([wait, stopped]);
		} catch (err) {
			// The request's own "aborted" error says nothing of why.
			if (late) throw new Error(late, { cause: err });
			throw err;
		}
	};

	try {
		within(
			limits.wholeMs,
			`The download took longer than ${span(limits.wholeMs)} and was stopped. Nothing of it was kept.`,
		);
		const answered = within(
			limits.answerMs,
			`The address did not answer within ${span(limits.answerMs)}.`,
		);
		const res = await orStopped(
			fetchPublic(
				opts.url,
				{ headers: { "User-Agent": opts.userAgent }, signal },
				{ lookup: opts.lookup, fetchImpl: opts.fetchImpl },
			),
		);
		answered();
		if (!res.ok || !res.body)
			throw new Error(
				`The address answered ${res.status} ${res.statusText}`.trim(),
			);
		const mediaType =
			res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ??
			"";
		if (!isMediaType(mediaType))
			throw new Error(
				`The address gave ${mediaType || "something with no type"}, not a picture, video or sound. Link to the file itself, not a page about it.`,
			);
		// The name is settled before a byte is saved: nothing is written of a
		// file that could not be kept under a media ending.
		const offered = safeFileName(
			offeredFileName(res.headers.get("content-disposition"), opts.url),
			"download",
		);
		const name = mediaFileName(offered, mediaType);
		if (!name)
			throw new Error(
				`The address gave ${mediaType} under the name "${offered}", and neither is a kind of picture, video or sound this tool knows an ending for. Download it yourself and add it as a file.`,
			);
		const length = Number(res.headers.get("content-length") ?? 0);
		if (length > max)
			throw new Error(`The file is ${length} bytes; the most taken is ${max}`);

		const file = path.join(opts.incoming, `${randomUUID()}.part`);
		const hash = createHash("sha256");
		let size = 0;
		const pieces = (res.body as unknown as AsyncIterable<Uint8Array>)[
			Symbol.asyncIterator
		]();
		// One pipeline, so an error from any part of it is this job's failure: a
		// write stream with no error handler (the folder gone, the disk full)
		// would stop the whole server instead (D66).
		const out = createWriteStream(file, { flags: "wx" });
		try {
			await pipeline(async function* () {
				try {
					for (;;) {
						const arrived = within(
							limits.quietMs,
							`The download stopped arriving: nothing came for ${span(limits.quietMs)}. Nothing of it was kept.`,
						);
						const piece = await orStopped(pieces.next());
						arrived();
						if (piece.done) break;
						const chunk = piece.value;
						size += chunk.byteLength;
						if (size > max)
							throw new Error(
								`The file is larger than ${max} bytes; it was not kept`,
							);
						hash.update(chunk);
						yield chunk;
					}
				} finally {
					// Let the connection go. Not waited for: a body that never sends
					// its next piece never answers this either.
					void pieces.return?.()?.catch(() => {});
				}
			}, out);
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			// The file may still be being opened: it is removed once the stream has
			// let it go, or it would appear again after being removed.
			if (!out.closed)
				await new Promise<void>((resolve) =>
					out.once("close", () => resolve()),
				);
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
		return { file, name, mediaType, sha256: hash.digest("hex"), size };
	} finally {
		for (const timer of timers) clearTimeout(timer);
		// Whatever the outcome, the connection is not left open: a refusal after
		// the answer has a file still waiting to be sent.
		limit.abort();
	}
}

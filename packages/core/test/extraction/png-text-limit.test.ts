// A PNG's compressed text is inflated only up to a limit (D85): a few
// kilobytes can claim to be gigabytes, and the reader runs on every PNG a
// project holds.

import { describe, expect, it } from "vitest";
import { crc32, deflateSync } from "node:zlib";
import {
	MAX_TEXT_BYTES,
	pngTextChunks,
} from "../../src/extraction/png-text.ts";

function chunk(name: string, data: Buffer): Buffer {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(name, "ascii"), data])));
	return Buffer.concat([len, Buffer.from(name, "ascii"), data, crc]);
}

/** A PNG with compressed international text chunks (iTXt, compression flag 1). */
function png(text: Record<string, Buffer>): Buffer {
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0])),
		...Object.entries(text).map(([keyword, body]) =>
			chunk(
				"iTXt",
				Buffer.concat([
					Buffer.from(`${keyword}\0`, "latin1"),
					Buffer.from([1, 0]), // compressed, method 0
					Buffer.from("\0\0", "latin1"), // no language, no translated keyword
					deflateSync(body),
				]),
			),
		),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

describe("pngTextChunks and compressed text", () => {
	it("reads compressed text of an ordinary size", () => {
		expect(
			pngTextChunks(png({ prompt: Buffer.from("a harbour at dawn") })),
		).toEqual({ prompt: "a harbour at dawn" });
	});

	it("reads text up to the limit, and leaves unread a chunk that inflates past it", () => {
		const atLimit = Buffer.alloc(MAX_TEXT_BYTES, "a");
		const over = Buffer.alloc(MAX_TEXT_BYTES + 1, "a");
		// Both are a few kilobytes on disk.
		const file = png({
			fits: atLimit,
			bomb: over,
			after: Buffer.from("still read"),
		});
		expect(file.length).toBeLessThan(64 * 1024);
		const read = pngTextChunks(file);
		expect(Object.keys(read).sort()).toEqual(["after", "fits"]);
		expect(read.fits.length).toBe(MAX_TEXT_BYTES);
		expect(read.after).toBe("still read");
	});
});

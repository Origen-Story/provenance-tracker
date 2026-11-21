import { describe, it, expect } from "vitest";
import { deflateSync } from "node:zlib";
import {
	pngTextChunks,
	parseITxt,
	observePngText,
} from "../../../src/server/lib/extraction/png-chunks.js";

// A PNG reduced to what the reader looks at: the signature, then chunks of
// length, name, data and a CRC (which the reader does not check).
function png(chunks) {
	const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	const parts = chunks.map(([name, data]) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		return Buffer.concat([
			len,
			Buffer.from(name, "ascii"),
			data,
			Buffer.alloc(4),
		]);
	});
	return Buffer.concat([sig, ...parts]);
}

describe("pngTextChunks", () => {
	it("reads tEXt and iTXt chunks", () => {
		const buf = png([
			["tEXt", Buffer.from("prompt\0a harbour at dawn", "latin1")],
			[
				"iTXt",
				Buffer.from("parameters\0\0\0\0\0Steps: 20, Sampler: Euler", "utf8"),
			],
			["IEND", Buffer.alloc(0)],
		]);
		expect(pngTextChunks(buf)).toEqual({
			prompt: "a harbour at dawn",
			parameters: "Steps: 20, Sampler: Euler",
		});
	});

	it("reads compressed iTXt, and a language tag and translated keyword when present", () => {
		const head = Buffer.from("Description\0", "latin1");
		const compressed = Buffer.concat([
			head,
			Buffer.from([1, 0]),
			Buffer.from("fr\0Légende\0", "utf8"),
			deflateSync(Buffer.from("Harbour at dawn, 1920", "utf8")),
		]);
		expect(pngTextChunks(png([["iTXt", compressed]]))).toEqual({
			Description: "Harbour at dawn, 1920",
		});
	});

	it("skips an iTXt chunk it cannot make sense of instead of storing garbage", () => {
		expect(parseITxt(Buffer.from("no terminator", "latin1"))).toBeNull();
		expect(
			parseITxt(
				Buffer.concat([
					Buffer.from("k\0", "latin1"),
					Buffer.from([1, 0, 0, 0]),
					Buffer.from("not zlib"),
				]),
			),
		).toBeNull();
	});

	it("returns nothing for bytes that are not a PNG", () => {
		expect(pngTextChunks(Buffer.from("GIF89a..."))).toEqual({});
	});
});

describe("observePngText", () => {
	it("reports a file that is not a PNG as absent, without reading it", async () => {
		expect(await observePngText("clip.mp4")).toMatchObject({
			kind: "png-text",
			status: "absent",
			data: null,
		});
	});

	it("reports a missing PNG as unreadable", async () => {
		expect(await observePngText("no-such-file-anywhere.png")).toMatchObject({
			status: "unreadable",
			error: "file not found",
		});
	});
});

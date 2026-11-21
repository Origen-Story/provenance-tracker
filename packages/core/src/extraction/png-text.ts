// The text a PNG carries in its tEXt and iTXt chunks: where ComfyUI, Stable
// Diffusion front ends and others put their prompt and settings. Pure: bytes
// in, { keyword: text } out. Reading the file is core-node's job.

import { inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

interface Chunk {
	name: string;
	data: Buffer;
}

function chunksOf(buffer: Buffer): Chunk[] {
	if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE))
		return [];
	const chunks: Chunk[] = [];
	let offset = 8;
	while (offset + 8 <= buffer.length) {
		const length = buffer.readUInt32BE(offset);
		const name = buffer.subarray(offset + 4, offset + 8).toString("ascii");
		chunks.push({
			name,
			data: buffer.subarray(offset + 8, offset + 8 + length),
		});
		offset += 12 + length; // length, name, data, CRC
		if (name === "IEND") break;
	}
	return chunks;
}

/**
 * One iTXt chunk (PNG specification, section 11.3.3.4): keyword \0,
 * compression flag (1 byte), compression method (1 byte), language tag \0,
 * translated keyword \0, text. The flag and method are single bytes, so an
 * uncompressed chunk has four zero bytes between keyword and text.
 * Compressed text (flag 1, method 0) is zlib data. Null for a malformed chunk.
 */
export function parseITxt(
	data: Buffer,
): { keyword: string; text: string } | null {
	const keywordEnd = data.indexOf(0);
	if (keywordEnd < 1 || keywordEnd + 2 >= data.length) return null;
	const compressed = data[keywordEnd + 1] === 1;
	const method = data[keywordEnd + 2];
	const languageEnd = data.indexOf(0, keywordEnd + 3);
	if (languageEnd === -1) return null;
	const translatedEnd = data.indexOf(0, languageEnd + 1);
	if (translatedEnd === -1) return null;
	const body = data.subarray(translatedEnd + 1);
	let text: string;
	if (!compressed) text = body.toString("utf8");
	else if (method === 0) {
		try {
			text = inflateSync(body).toString("utf8");
		} catch {
			return null;
		}
	} else return null;
	return { keyword: data.subarray(0, keywordEnd).toString("latin1"), text };
}

/** The tEXt and iTXt chunks of a PNG, as { keyword: text }. Bytes that are not a PNG give {}. */
export function pngTextChunks(buffer: Buffer): Record<string, string> {
	const result: Record<string, string> = {};
	for (const chunk of chunksOf(buffer)) {
		if (chunk.name === "tEXt") {
			const text = chunk.data.toString("latin1");
			const sep = text.indexOf("\0");
			if (sep !== -1) result[text.slice(0, sep)] = text.slice(sep + 1);
		} else if (chunk.name === "iTXt") {
			const parsed = parseITxt(chunk.data);
			if (parsed) result[parsed.keyword] = parsed.text;
		}
	}
	return result;
}

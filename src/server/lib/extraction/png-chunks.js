import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { inflateSync } from "node:zlib";
import { makeObservation } from "./observation.ts";
import { GENERATOR } from "../manifest/generator.js";

/**
 * Pure: the tEXt and iTXt chunks of a PNG, as { keyword: value }. Bytes that
 * are not a PNG give {}.
 * @param {Buffer} buffer
 */
export function pngTextChunks(buffer) {
	const result = {};
	for (const chunk of parsePngChunks(buffer)) {
		if (chunk.name === "tEXt") {
			const text = chunk.data.toString("latin1");
			const sep = text.indexOf("\0");
			if (sep !== -1) {
				const keyword = text.slice(0, sep);
				const value = text.slice(sep + 1);
				result[keyword] = value;
			}
		} else if (chunk.name === "iTXt") {
			const parsed = parseITxt(chunk.data);
			if (parsed) result[parsed.keyword] = parsed.text;
		}
	}
	return result;
}

/**
 * Pure: one iTXt chunk (PNG specification, section 11.3.3.4):
 *   keyword \0, compression flag (1 byte), compression method (1 byte),
 *   language tag \0, translated keyword \0, text.
 * The flag and method are single bytes, not terminated strings, so an
 * uncompressed chunk has four zero bytes between keyword and text. Compressed
 * text (flag 1, method 0) is zlib data. Returns null for a malformed chunk.
 * @param {Buffer} data
 */
export function parseITxt(data) {
	const keywordEnd = data.indexOf(0);
	if (keywordEnd < 1 || keywordEnd + 2 >= data.length) return null;
	const compressed = data[keywordEnd + 1] === 1;
	const method = data[keywordEnd + 2];
	const languageEnd = data.indexOf(0, keywordEnd + 3);
	if (languageEnd === -1) return null;
	const translatedEnd = data.indexOf(0, languageEnd + 1);
	if (translatedEnd === -1) return null;
	const body = data.subarray(translatedEnd + 1);
	let text;
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

/**
 * The observation of a PNG's text chunks. The reader is this program's own
 * code, so the extractor is the tracker at its version. A file that is not a
 * PNG, or a PNG with no text chunks, is `absent`.
 * @returns {Promise<import('./observation.ts').Observation>}
 */
export async function observePngText(filePath) {
	const base = {
		kind: "png-text",
		extractor: GENERATOR.name,
		version: GENERATOR.version,
	};
	if (!filePath.toLowerCase().endsWith(".png"))
		return makeObservation({ ...base, status: "absent" });
	if (!existsSync(filePath))
		return makeObservation({
			...base,
			status: "unreadable",
			error: "file not found",
		});
	try {
		const chunks = pngTextChunks(await readFile(filePath));
		return Object.keys(chunks).length
			? makeObservation({ ...base, status: "ok", data: chunks })
			: makeObservation({ ...base, status: "absent" });
	} catch (err) {
		return makeObservation({
			...base,
			status: "unreadable",
			error: err.message,
		});
	}
}

/**
 * Extract tEXt/iTXt chunks from a PNG file.
 * Returns a flat object of { keyword: value } pairs; {} when there are none
 * or the file is not a readable PNG.
 */
export async function extractPngChunks(filePath) {
	const obs = await observePngText(filePath);
	return obs.status === "ok" ? obs.data : {};
}

function parsePngChunks(buffer) {
	// PNG signature is 8 bytes
	const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	if (!buffer.slice(0, 8).equals(PNG_SIG)) return [];

	const chunks = [];
	let offset = 8;

	while (offset < buffer.length) {
		if (offset + 8 > buffer.length) break;
		const length = buffer.readUInt32BE(offset);
		const name = buffer.slice(offset + 4, offset + 8).toString("ascii");
		const data = buffer.slice(offset + 8, offset + 8 + length);
		chunks.push({ name, data });
		offset += 12 + length; // length(4) + name(4) + data(length) + crc(4)
		if (name === "IEND") break;
	}

	return chunks;
}

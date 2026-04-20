import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

/**
 * Extract tEXt/iTXt chunks from a PNG file.
 * Returns a flat object of { keyword: value } pairs.
 */
export async function extractPngChunks(filePath) {
	if (!existsSync(filePath)) return {};
	if (!filePath.toLowerCase().endsWith('.png')) return {};

	try {
		const buffer = await readFile(filePath);
		const chunks = parsePngChunks(buffer);
		const result = {};

		for (const chunk of chunks) {
			if (chunk.name === 'tEXt') {
				const text = chunk.data.toString('latin1');
				const sep = text.indexOf('\0');
				if (sep !== -1) {
					const keyword = text.slice(0, sep);
					const value = text.slice(sep + 1);
					result[keyword] = value;
				}
			} else if (chunk.name === 'iTXt') {
				// iTXt: keyword\0compression\0method\0language\0translated\0text
				const text = chunk.data.toString('utf8');
				const sep = text.indexOf('\0');
				if (sep !== -1) {
					const keyword = text.slice(0, sep);
					// Skip compression flag, method, language, translated keyword
					const rest = text.slice(sep + 1);
					const nulls = [];
					for (let i = 0; i < rest.length; i++) {
						if (rest[i] === '\0') nulls.push(i);
						if (nulls.length === 3) break;
					}
					if (nulls.length >= 3) {
						result[keyword] = rest.slice(nulls[2] + 1);
					}
				}
			}
		}

		return result;
	} catch {
		return {};
	}
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
		const name = buffer.slice(offset + 4, offset + 8).toString('ascii');
		const data = buffer.slice(offset + 8, offset + 8 + length);
		chunks.push({ name, data });
		offset += 12 + length; // length(4) + name(4) + data(length) + crc(4)
		if (name === 'IEND') break;
	}

	return chunks;
}

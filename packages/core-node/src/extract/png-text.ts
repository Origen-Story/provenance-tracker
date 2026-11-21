// A PNG's text chunks as an observation. The reader is this program's own
// code (core/extraction/png-text.ts), so the extractor is the tracker.

import { readFile } from "node:fs/promises";
import {
	makeObservation,
	type Observation,
} from "@provenancetracker/core/extraction/observation.ts";
import { pngTextChunks } from "@provenancetracker/core/extraction/png-text.ts";
import { TOOL } from "../tool.ts";

/**
 * The text chunks of a PNG. A file not named .png, or a PNG with no text,
 * is `absent`.
 * @param reader who to name as the extractor; the tracker by default
 */
export async function observePngText(
	file: string,
	reader: { name: string; version: string } = TOOL,
): Promise<Observation> {
	const base = {
		kind: "png-text" as const,
		extractor: reader.name,
		version: reader.version,
	};
	if (!file.toLowerCase().endsWith(".png"))
		return makeObservation({ ...base, status: "absent" });
	let bytes: Buffer;
	try {
		bytes = await readFile(file);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		return makeObservation({
			...base,
			status: "unreadable",
			error: code === "ENOENT" ? "file not found" : (err as Error).message,
		});
	}
	const chunks = pngTextChunks(bytes);
	return Object.keys(chunks).length
		? makeObservation({ ...base, status: "ok", data: chunks })
		: makeObservation({ ...base, status: "absent" });
}

// ExifTool, through exiftool-vendored: one long-running process, shared, ended
// with endExifTool() so a command can exit. Reads EXIF, XMP, IPTC, container
// and technical tags from hundreds of formats, and .xmp sidecars.

import { ExifTool } from "exiftool-vendored";
import {
	exifObservationFields,
	makeObservation,
	type Observation,
	type ObservationKind,
} from "@provenancetracker/core/extraction/observation.ts";

let instance: ExifTool | null = null;
let version: string | null = null;

function exiftool(): ExifTool {
	instance ??= new ExifTool({ taskTimeoutMillis: 10000 });
	return instance;
}

/** ExifTool's version, or null when it cannot be asked. */
export async function exiftoolVersion(): Promise<string | null> {
	if (!version) {
		try {
			version = await exiftool().version();
		} catch {
			return null;
		}
	}
	return version;
}

/**
 * Read a file with ExifTool, once.
 * @returns ExifTool's tags as it returns them (null on failure), and the
 *   observation of them: every tag except where the file sits (observation.ts)
 */
export async function readExif(
	file: string,
	kind: Extract<ObservationKind, "exif" | "xmp-sidecar"> = "exif",
): Promise<{ tags: Record<string, unknown> | null; observation: Observation }> {
	const base = {
		kind,
		extractor: "exiftool",
		version: await exiftoolVersion(),
	};
	try {
		const tags = (await exiftool().read(file)) as unknown as Record<
			string,
			unknown
		>;
		const { data, warnings } = exifObservationFields(tags);
		return {
			tags,
			observation: makeObservation({ ...base, status: "ok", data, warnings }),
		};
	} catch (err) {
		return {
			tags: null,
			observation: makeObservation({
				...base,
				status: "unreadable",
				error: (err as Error).message,
			}),
		};
	}
}

/** Stop the ExifTool process. Safe to call when none is running. */
export async function endExifTool(): Promise<void> {
	if (instance) {
		const running = instance;
		instance = null;
		await running.end();
	}
}

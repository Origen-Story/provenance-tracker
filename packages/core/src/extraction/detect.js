import { parsers } from "./parsers/index.js";

// Walk the registered parsers in priority order; first detect() match wins.
// Falls back to a generic EXIF-only shape so callers always get the same fields.
//
// Returns `coverage` as a 0–100 integer reflecting how many of the parser's
// declared `coreFields` got populated. Low coverage on a recognized platform
// usually means the source format drifted and the parser needs updating —
// novelty detection uses this plus `platform === 'unknown'` to flag for review.
//
// Exported so re-extraction can replay it against stored raw metadata without
// re-reading the file from disk — the key property that lets parser updates
// flow back to previously-imported assets.
export function detectAndParse(exifTags, chunks) {
	for (const p of parsers) {
		if (p.detect(exifTags, chunks)) {
			const data = p.parse(exifTags, chunks);
			return { platform: p.id, coverage: computeCoverage(p, data), data };
		}
	}
	return {
		platform: "unknown",
		coverage: 0,
		data: {
			platform: "unknown",
			prompt: exifTags?.Description || exifTags?.ImageDescription || "",
			negativePrompt: "",
			modelName: exifTags?.Software || "",
			modelVersion: "",
			seed: "",
			width: exifTags?.ImageWidth || exifTags?.ExifImageWidth || 0,
			height: exifTags?.ImageHeight || exifTags?.ExifImageHeight || 0,
			otherParams: {},
		},
	};
}

function computeCoverage(parser, data) {
	const fields = parser.coreFields || [];
	if (fields.length === 0) return 100;
	const populated = fields.filter((f) => {
		const v = data?.[f];
		return v !== undefined && v !== null && v !== "" && v !== 0;
	}).length;
	return Math.round((populated / fields.length) * 100);
}

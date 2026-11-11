/**
 * Topaz Gigapixel (still-image upscaler).
 *
 * Gigapixel writes its name into XMP CreatorTool / Software and appends the
 * model and scale to the filename ("photo-gigapixel-redefine-realistic-2x-
 * faceai v2.png"). It is a modifier, not a generator: the output's origin
 * class is AI-enhanced once its source is linked, or stays what the source is
 * when the source is itself AI-generated (classify.js, rule 2).
 * The XMP DigitalSourceType it carries is copied from the input and is not
 * evidence about Gigapixel itself.
 */

export const id = 'topaz-gigapixel';

export const coreFields = ['modelName', 'modelVersion', 'width', 'height'];

function toolString(exifTags) {
	return `${exifTags?.Software || ''} ${exifTags?.CreatorTool || ''} ${exifTags?.HistorySoftwareAgent || ''}`;
}

export function detect(exifTags) {
	return /topaz gigapixel/i.test(toolString(exifTags));
}

export function parse(exifTags) {
	const tool = toolString(exifTags);
	const version = tool.match(/Topaz Gigapixel\s+([\d.]+)/i)?.[1] || '';
	const filename = String(exifTags?.FileName || '');
	// "-gigapixel-<model>-<scale>x[-<extras>]"
	const tail = filename.match(/-gigapixel-([a-z0-9-]+?)-(\d+)x(?:-([a-z0-9 ._-]+?))?(?:\.[a-z0-9]+)?$/i);
	const result = {
		platform: id,
		prompt: '',
		negativePrompt: '',
		modelName: 'Topaz Gigapixel',
		modelVersion: tail?.[1] ? `${tail[1]} (app ${version || '?'})` : version,
		seed: '',
		width: exifTags?.ImageWidth || 0,
		height: exifTags?.ImageHeight || 0,
		otherParams: {
			assetClass: 'modifier',
			appVersion: version
		}
	};
	if (tail?.[1]) result.otherParams.model = tail[1];
	if (tail?.[2]) result.otherParams.scale = `${tail[2]}x`;
	if (tail?.[3]) result.otherParams.extras = tail[3].trim();
	return result;
}

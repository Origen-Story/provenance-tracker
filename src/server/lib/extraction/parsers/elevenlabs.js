/**
 * Parse ElevenLabs audio metadata.
 *
 * Some ElevenLabs exports (notably mp3s from the UI) embed a full C2PA manifest
 * — `Actions.softwareAgent === 'ElevenLabs'` and/or `Author.name === 'Eleven Labs Inc.'`.
 *
 * WAV exports and sound-effect library downloads often carry no C2PA, but the
 * filename pattern is reliable (`ElevenLabs_*`, `*-Elevenlabs.*`). We accept
 * that as a secondary signal for audio mime types only to keep false-positive
 * risk low.
 *
 * ElevenLabs does not expose prompt/voice/model data in the file, so coverage
 * stays modest by design — this is a provenance/identification parser, not a
 * generation-parameter parser.
 */

export const id = 'elevenlabs';

// Minimal — ElevenLabs exposes almost nothing beyond identification.
export const coreFields = ['platform', 'modelName'];

function hasC2paSignal(exifTags) {
	if (exifTags?.Actions?.softwareAgent === 'ElevenLabs') return true;
	if (Array.isArray(exifTags?.Actions) && exifTags.Actions.some(a => a?.softwareAgent === 'ElevenLabs')) return true;
	if (exifTags?.Author?.name === 'Eleven Labs Inc.') return true;
	return false;
}

function hasFilenameSignal(exifTags) {
	const name = (exifTags?.FileName || '').toLowerCase();
	if (!name) return false;
	const isAudio = name.endsWith('.mp3') || name.endsWith('.wav') || name.endsWith('.m4a') || name.endsWith('.flac') || name.endsWith('.ogg');
	if (!isAudio) return false;
	return name.includes('elevenlabs');
}

export function detect(exifTags, chunks) {
	if (!exifTags) return false;
	return hasC2paSignal(exifTags) || hasFilenameSignal(exifTags);
}

export function parse(exifTags, chunks) {
	const result = {
		platform: 'elevenlabs',
		prompt: '',
		negativePrompt: '',
		modelName: 'ElevenLabs',
		modelVersion: '',
		seed: '',
		width: 0,
		height: 0,
		otherParams: {}
	};

	// Action records c2pa.created for fresh gens — worth preserving for provenance.
	const action = Array.isArray(exifTags?.Actions)
		? exifTags.Actions.find(a => a?.softwareAgent === 'ElevenLabs')
		: (exifTags?.Actions?.softwareAgent === 'ElevenLabs' ? exifTags.Actions : null);
	if (action?.action) result.otherParams.c2paAction = action.action;
	if (action?.digitalSourceType) result.otherParams.digitalSourceType = action.digitalSourceType;

	if (exifTags?.Author?.name) result.otherParams.author = exifTags.Author.name;

	// Duration is a genuine core attribute for audio, unlike width/height.
	if (exifTags?.Duration != null) result.otherParams.duration = exifTags.Duration;

	if (!hasC2paSignal(exifTags) && hasFilenameSignal(exifTags)) {
		// Flag filename-only matches so UI / re-extraction can show lower confidence.
		result.otherParams.detectionSource = 'filename';
	}

	return result;
}

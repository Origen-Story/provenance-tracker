// Pure: turn exiftool tags for a video or audio file into the handful of
// technical fields the tracker stores. No ffprobe; exiftool-vendored already
// reads these from MP4, MOV, WAV and MP3 containers.
//
// Duration arrives in several shapes depending on container and version:
// a number of seconds (1.2309), "0:00:40", "0:00:40.5", "5.04 s", or an
// object with a rawValue. Dates arrive as ExifDateTime objects. All of that
// is normalised here so callers never see exiftool's variety.

export function parseDurationSeconds(value) {
	if (value == null || value === '') return null;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'object') return parseDurationSeconds(value.rawValue ?? value.toString?.());
	const s = String(value).trim();
	// h:mm:ss(.fraction)
	const clock = s.match(/^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
	if (clock) return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
	// mm:ss(.fraction)
	const short = s.match(/^(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
	if (short) return Number(short[1]) * 60 + Number(short[2]);
	// "5.04 s", "1.23 s", "40 s"
	const secs = s.match(/^(\d+(?:\.\d+)?)\s*s$/i);
	if (secs) return Number(secs[1]);
	const n = Number(s);
	return Number.isFinite(n) ? n : null;
}

function isoDate(value) {
	if (!value) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'object') {
		if (typeof value.toISOString === 'function') {
			try { return value.toISOString(); } catch { /* fall through */ }
		}
		if (value.rawValue) return String(value.rawValue);
		return String(value);
	}
	return String(value);
}

function containerFrom(tags) {
	const brand = String(tags.MajorBrand || '');
	if (/MP4/i.test(brand)) return 'mp4';
	if (/QuickTime|qt/i.test(brand)) return 'mov';
	const ft = String(tags.FileType || tags.FileTypeExtension || '').toLowerCase();
	return ft || '';
}

export function probeVideoTags(tags) {
	const t = tags || {};
	const frameRate = Number(t.VideoFrameRate ?? t.FrameRate ?? 0) || null;
	return {
		durationSeconds: parseDurationSeconds(t.Duration ?? t.MediaDuration ?? t.TrackDuration),
		frameRate,
		width: Number(t.ImageWidth ?? t.SourceImageWidth ?? 0) || 0,
		height: Number(t.ImageHeight ?? t.SourceImageHeight ?? 0) || 0,
		container: containerFrom(t),
		videoCodec: String(t.CompressorID ?? t.CompressorName ?? t.VideoCodec ?? '').trim(),
		audioCodec: String(t.AudioFormat ?? t.AudioCodec ?? t.Encoding ?? '').trim(),
		createdAt: isoDate(t.CreateDate ?? t.MediaCreateDate ?? t.DateTimeOriginal ?? t.TrackCreateDate ?? '')
	};
}

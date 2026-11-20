import { useState } from 'react';

// The picture on an asset card: the image itself, a frame from a video (the
// server pulls it with ffmpeg, see routes/preview.js), or an icon for audio
// and for anything without a picture. A frame that fails falls back to the icon.
export default function AssetThumb({ filePath, mimeType, alt = '' }) {
	const [failed, setFailed] = useState(false);
	const kind = mimeType?.split('/')[0];
	const src = !filePath || failed ? null
		: kind === 'image' ? `/api/preview?path=${encodeURIComponent(filePath)}`
		: kind === 'video' ? `/api/preview/frame?path=${encodeURIComponent(filePath)}`
		: null;

	if (src) {
		return <img src={src} alt={alt} className="w-full h-full object-cover" loading="lazy" onError={() => setFailed(true)} />;
	}
	return (
		<svg className="w-8 h-8 text-text-secondary opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			{kind === 'audio'
				? <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>
				: <><rect x="2" y="2" width="20" height="20" rx="2" /><polygon points="10 8 16 12 10 16 10 8" /></>}
		</svg>
	);
}

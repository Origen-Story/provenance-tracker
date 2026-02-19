import { readFileSync } from 'fs';
import { getMimeType } from '$lib/core/utils/file-utils.js';

/** GET: Serve a local image file as a response (for thumbnails in the browser). */
export function GET({ url }) {
	const filePath = url.searchParams.get('path');

	if (!filePath) {
		return new Response('Missing path parameter', { status: 400 });
	}

	try {
		const buffer = readFileSync(filePath);
		const mimeType = getMimeType(filePath);

		return new Response(buffer, {
			headers: {
				'Content-Type': mimeType,
				'Cache-Control': 'private, max-age=3600'
			}
		});
	} catch {
		return new Response('File not found', { status: 404 });
	}
}

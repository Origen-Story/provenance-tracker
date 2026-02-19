import { json } from '@sveltejs/kit';
import { scanAndExtract } from '$lib/import/import.server.js';

/** POST: Accept a path, scan it, extract metadata, return results for preview. */
export async function POST({ request }) {
	const { path: inputPath } = await request.json();

	if (!inputPath || typeof inputPath !== 'string') {
		return json({ error: 'Path is required' }, { status: 400 });
	}

	try {
		const results = await scanAndExtract(inputPath.trim());
		return json({ results, count: results.length });
	} catch (err) {
		return json({ error: err.message }, { status: 400 });
	}
}

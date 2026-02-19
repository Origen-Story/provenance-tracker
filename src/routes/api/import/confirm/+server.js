import { json } from '@sveltejs/kit';
import { confirmImport } from '$lib/import/import.server.js';
import { shutdownExifTool } from '$lib/extraction/extractors/exif.js';

/** POST: Confirm imports — persist extraction results + user edits to DB. */
export async function POST({ request }) {
	const { imports } = await request.json();

	if (!Array.isArray(imports) || imports.length === 0) {
		return json({ error: 'No imports provided' }, { status: 400 });
	}

	const created = [];
	const errors = [];

	for (const item of imports) {
		try {
			const asset = confirmImport(item.extraction, item.edits || {});
			created.push(asset);
		} catch (err) {
			errors.push({ path: item.extraction?.fileInfo?.path, error: err.message });
		}
	}

	return json({ created, errors, count: created.length });
}

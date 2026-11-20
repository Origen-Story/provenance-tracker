// Which fields of an archival asset an edit may change (pure).
//
// The update route receives a request body. Only the descriptive fields named
// here reach the row; the file's path, hash and size, the project it belongs
// to, the origin class and the sync state each have their own route or are
// set by the server, and a body that names them is ignored.

export const ARCHIVAL_EDITABLE_FIELDS = Object.freeze([
	'name', 'caption', 'sourceUrl', 'accessDate', 'originalDate',
	'creator', 'institution', 'license', 'licenseUrl', 'medium', 'usageNotes'
]);

export function pickArchivalUpdates(body) {
	const updates = {};
	if (!body || typeof body !== 'object') return updates;
	for (const key of ARCHIVAL_EDITABLE_FIELDS) {
		if (Object.hasOwn(body, key) && typeof body[key] === 'string') updates[key] = body[key];
	}
	return updates;
}

// Pure tests: an archival edit changes the named descriptive fields only.
import { describe, it, expect } from 'vitest';
import { pickArchivalUpdates, ARCHIVAL_EDITABLE_FIELDS } from '../../../src/server/lib/archival/fields.js';

describe('pickArchivalUpdates', () => {
	it('keeps the fields the detail form sends', () => {
		const form = {
			name: 'Tower under construction', caption: 'Second platform', sourceUrl: 'https://example.org/item/1',
			accessDate: '2026-11-20', originalDate: 'circa 1888', creator: 'Unknown', institution: 'Example Archive',
			license: 'Public domain', medium: 'photograph', usageNotes: ''
		};
		expect(pickArchivalUpdates(form)).toEqual(form);
	});

	it('drops everything the server owns', () => {
		const body = {
			name: 'ok',
			id: 99, projectId: 2, filePath: 'C:/Windows/win.ini', filename: 'x', inPlace: true,
			fileHash: 'abc', fileSize: 1, mimeType: 'text/html',
			exifJson: '{}', c2paJson: '{}', imageUrl: 'https://example.org/x.jpg',
			originClass: 'digitalCapture', originClassConfirmed: true, originClassSource: 'user',
			publicTitle: 'x', signedBy: 'device', signerName: 'x', aiAssisted: true,
			notionPageId: 'x', notionSyncedAt: 'x', searchGroupId: 'x',
			createdAt: 'x', updatedAt: 'x'
		};
		expect(pickArchivalUpdates(body)).toEqual({ name: 'ok' });
	});

	it('lets an empty string clear a field and ignores values that are not text', () => {
		expect(pickArchivalUpdates({ caption: '', creator: null, license: 7, medium: { a: 1 }, name: ['x'] })).toEqual({ caption: '' });
	});

	it('is safe with no body, and with inherited or unknown keys', () => {
		expect(pickArchivalUpdates(undefined)).toEqual({});
		expect(pickArchivalUpdates('name=x')).toEqual({});
		expect(pickArchivalUpdates(Object.create({ name: 'inherited' }))).toEqual({});
		expect(pickArchivalUpdates({ __proto__: { name: 'x' }, constructor: 'x', unknownField: 'x' })).toEqual({});
	});

	it('names only columns that describe the asset', () => {
		for (const f of ['filePath', 'fileHash', 'projectId', 'id', 'originClass', 'publicTitle']) {
			expect(ARCHIVAL_EDITABLE_FIELDS).not.toContain(f);
		}
	});
});

// Pure tests for the import rules: known modules only, and when a source may be deleted.
import { describe, it, expect } from 'vitest';
import { isImportModule, moduleFolder, mayDeleteSource, IMPORT_MODULES } from '../../../src/server/lib/core/import-rules.js';

describe('import modules', () => {
	it('knows the three modules and their folders', () => {
		expect(IMPORT_MODULES).toEqual(['archival', 'ai-assets', 'produced']);
		expect(moduleFolder('archival')).toBe('archival-images');
		expect(moduleFolder('ai-assets')).toBe('ai-assets');
		expect(moduleFolder('produced')).toBe('produced-assets');
	});

	it('refuses anything else, so a module name is never used as a path', () => {
		for (const m of ['../../outside', '..', 'C:\\Windows', 'archival/../..', 'Archival', 'ai_assets', '', null, undefined, 3, ['archival'], '__proto__', 'constructor', 'toString']) {
			expect(isImportModule(m), String(m)).toBe(false);
			expect(moduleFolder(m), String(m)).toBeNull();
		}
	});
});

describe('mayDeleteSource', () => {
	const copiedImport = { deleteOriginal: true, inPlace: false, duplicate: false, copied: true };

	it('allows deleting a source that was asked for and copied into storage', () => {
		expect(mayDeleteSource(copiedImport)).toBe(true);
	});

	it('never deletes a duplicate: nothing was imported, so the source is the only copy the user chose', () => {
		expect(mayDeleteSource({ ...copiedImport, duplicate: true })).toBe(false);
		expect(mayDeleteSource({ ...copiedImport, duplicate: true, copied: false })).toBe(false);
	});

	it('never deletes a file tracked in place, or one that was not copied', () => {
		expect(mayDeleteSource({ ...copiedImport, inPlace: true })).toBe(false);
		expect(mayDeleteSource({ ...copiedImport, copied: false })).toBe(false);
	});

	it('needs a real true, not a truthy string', () => {
		expect(mayDeleteSource({ ...copiedImport, deleteOriginal: false })).toBe(false);
		expect(mayDeleteSource({ ...copiedImport, deleteOriginal: 'false' })).toBe(false);
		expect(mayDeleteSource({ ...copiedImport, deleteOriginal: undefined })).toBe(false);
	});
});

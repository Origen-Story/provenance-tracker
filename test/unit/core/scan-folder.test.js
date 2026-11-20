// Temp-dir test for the folder walker used by Import > Scan folder.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listImportableFiles, isImportableName } from '../../../src/server/lib/core/scan-folder.js';

let root;
beforeAll(() => {
	root = mkdtempSync(path.join(tmpdir(), 'pt-scan-'));
	const touch = (...p) => { mkdirSync(path.join(root, ...p.slice(0, -1)), { recursive: true }); writeFileSync(path.join(root, ...p), 'x'); };
	touch('take-01.mp4');
	touch('voice.WAV');
	touch('notes.txt');
	touch('.hidden.mp4');
	touch('take-01.signed.v1.mp4');
	touch('take-01.c2pa');
	touch('plates', 'p1.mov');
	touch('plates', 'deeper', 'p2.mov');
	touch('signed', 'take-01.signed.v2.mp4');
	touch('.cache', 'x.mp4');
});
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

describe('isImportableName', () => {
	it('accepts supported media whatever the case, and rejects signed copies, sidecars, hidden files and other types', () => {
		expect(isImportableName('a.MP4')).toBe(true);
		expect(isImportableName('a.signed.v3.wav')).toBe(false);
		expect(isImportableName('a.c2pa')).toBe(false);
		expect(isImportableName('.a.mp4')).toBe(false);
		expect(isImportableName('a.txt')).toBe(false);
	});
});

describe('listImportableFiles', () => {
	it('reads only the top level by default and names the subfolders it skipped', async () => {
		const { files, skippedFolders } = await listImportableFiles(root);
		expect(files.map(f => f.relativePath)).toEqual(['take-01.mp4', 'voice.WAV']);
		expect(skippedFolders).toEqual(['plates']);
	});

	it('walks subfolders when asked, still skipping signed folders and hidden ones', async () => {
		const { files, skippedFolders } = await listImportableFiles(root, { recursive: true });
		expect(files.map(f => f.relativePath)).toEqual([path.join('plates', 'deeper', 'p2.mov'), path.join('plates', 'p1.mov'), 'take-01.mp4', 'voice.WAV']);
		expect(skippedFolders).toEqual([]);
		expect(files.every(f => path.isAbsolute(f.path))).toBe(true);
	});
});

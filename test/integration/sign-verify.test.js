// Integration: sign through c2patool with a throwaway dev certificate and read
// the result back. Everything lives in a temp directory; the repo guard
// confirms nothing in the checkout changes. No time-stamp authority is used,
// so there is no network. Skips when openssl (for the certificate) or a
// runnable c2patool is missing; the bundled binary is Windows-only today.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { signAsset } from '../../src/server/lib/extraction/c2pa-sign.js';
import { extractC2pa, resolveC2patoolPath } from '../../src/server/lib/extraction/c2pa.js';
import { signWithC2patool } from '../../src/server/lib/manifest/c2patool.js';
import { buildOutputManifest, buildAssetManifest, STATEMENT_LABEL } from '../../src/server/lib/manifest/build.js';
import { interpretReport } from '../../src/server/lib/manifest/verify.js';
import { buildPublicExport } from '../../src/server/lib/manifest/public-export.js';
import { validate } from '../helpers/json-schema-lite.js';

const haveOpenssl = spawnSync('openssl', ['version'], { encoding: 'utf8' }).status === 0;
const haveC2patool = spawnSync(resolveC2patoolPath(), ['--version'], { encoding: 'utf8' }).status === 0;
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const GENERATOR = { name: 'provenance-tracker', version: '0.0.0-test' };

function silentWav(file, seconds = 1, sampleRate = 8000) {
	const data = Buffer.alloc(seconds * sampleRate * 2);
	const h = Buffer.alloc(44);
	h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
	h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
	h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
	h.write('data', 36); h.writeUInt32LE(data.length, 40);
	writeFileSync(file, Buffer.concat([h, data]));
}

function tinyPng(file, rgb = [255, 0, 0]) {
	const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return (~c) >>> 0; };
	const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
	const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2;
	const row = [0, ...rgb, ...rgb];
	const raw = Buffer.from([...row, ...row]);
	writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

function readReport(file) {
	const r = spawnSync(resolveC2patoolPath(), [file], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
	return r.status === 0 ? JSON.parse(r.stdout) : null;
}

describe.skipIf(!haveOpenssl || !haveC2patool)('sign and read back through c2patool (dev cert)', () => {
	let dir, certificatePath, privateKeyPath;

	beforeAll(() => {
		dir = mkdtempSync(path.join(tmpdir(), 'pt-sign-'));
		const certDir = path.join(dir, 'certs');
		const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'generate-dev-cert.mjs'), certDir], { encoding: 'utf8' });
		if (r.status !== 0) throw new Error(`cert generation failed: ${r.stderr || r.stdout}`);
		certificatePath = path.join(certDir, 'c2pa-dev-cert.pem');
		privateKeyPath = path.join(certDir, 'c2pa-dev-key.pem');
		silentWav(path.join(dir, 'tone.wav'));
		tinyPng(path.join(dir, 'pixel.png'));
		tinyPng(path.join(dir, 'export.png'), [0, 0, 255]);
		tinyPng(path.join(dir, 'still.png'), [0, 255, 0]);
	}, 60000);

	afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

	for (const name of ['tone.wav', 'pixel.png']) {
		it(`signs ${name} into a .c2pa sidecar, leaves the file byte-for-byte alone, and reads back valid apart from trust`, async () => {
			const inputPath = path.join(dir, name);
			const before = readFileSync(inputPath);
			const r = await signAsset({ inputPath, originClass: 'digitalCapture', creatorName: 'Test Creator', organization: 'Test Org', toolUsed: 'integration test', identityUrl: 'https://example.com/id.json', certificatePath, privateKeyPath });
			expect(readFileSync(inputPath).equals(before)).toBe(true);
			expect(r.sidecarPath).toBe(path.join(dir, name.replace(/.[^.]+$/, '.c2pa')));
			expect(existsSync(r.sidecarPath)).toBe(true);
			expect(r.sidecarSize).toBeLessThan(before.length + 64 * 1024);
			expect(r.verification.status).toBe('unrecognised_issuer');
			expect(r.verification.hashVerified).toBe(true);
			expect(r.definition.private_key).toBeUndefined();
			// No stray signed copy of the asset is left beside it.
			expect(readdirSync(dir).filter(n => n.startsWith(name.replace(/.[^.]+$/, ''))).sort()).toEqual([name, name.replace(/.[^.]+$/, '.c2pa')].sort());

			// A C2PA reader finds the sidecar by name.
			const read = await extractC2pa(inputPath);
			expect(read?._readError).toBeUndefined();
			const labels = read.assertions.map(a => a.label);
			expect(labels).toEqual(expect.arrayContaining(['stds.schema-org.CreativeWork', 'c2pa.training-mining']));
			expect(labels).not.toContain('cawg.identity');
		}, 30000);
	}

	it('refuses to overwrite an existing sidecar', async () => {
		await expect(signAsset({ inputPath: path.join(dir, 'tone.wav'), originClass: 'digitalCapture', creatorName: 'x', certificatePath, privateKeyPath }))
			.rejects.toThrow(/Refusing to overwrite/);
	});

	it('refuses an asset whose class is unknown', async () => {
		tinyPng(path.join(dir, 'unclassified.png'), [9, 9, 9]);
		await expect(signAsset({ inputPath: path.join(dir, 'unclassified.png'), originClass: 'unknown', creatorName: 'x', certificatePath, privateKeyPath }))
			.rejects.toThrow(/origin class/);
	});

	// c2patool can only sidecar-sign such a file against a copy with its
	// credentials stripped, so the sidecar would not match the untouched file.
	it('refuses to sign at ingest a file that already carries its own credentials', async () => {
		// An embedded-signed still stands in for a camera file.
		const still = path.join(dir, 'still.png');
		const embedded = path.join(dir, 'camera.png');
		const { definition } = buildAssetManifest({ title: 'camera.png', originClass: 'computationalCapture', generator: GENERATOR });
		await signWithC2patool({ inputPath: still, outputPath: embedded, definition, certificatePath, privateKeyPath });
		await expect(signAsset({ inputPath: embedded, originClass: 'computationalCapture', creatorName: 'Creator', certificatePath, privateKeyPath }))
			.rejects.toThrow(/already carries its own Content Credentials/);
		expect(existsSync(path.join(dir, 'camera.c2pa'))).toBe(false);
	}, 30000);

	it('signs an output with a parent, a signed ingredient that keeps its credentials, and an unsigned one', async () => {
		const exportPath = path.join(dir, 'export.png');
		const signedStill = path.join(dir, 'camera.png'); // embedded credentials, from the test above
		const tonePath = path.join(dir, 'tone.wav');   // credentials in tone.c2pa beside it
		const assets = new Map([
			['produced:2', { filePath: signedStill, originClass: 'computationalCapture', originClassConfirmed: true, c2paSummary: { claimGenerator: 'x', assertions: [], ingredients: [] } }],
			['produced:3', { filePath: tonePath, originClass: 'digitalCapture', originClassConfirmed: true, originClassNote: 'Recorded without credentials.', c2paSummary: null }]
		]);
		const layer = (type, id) => ({ matchedAssetType: type, matchedAssetId: id });
		const composition = {
			durationSeconds: 2, fps: 30,
			picture: { intervals: [{ startSeconds: 0, endSeconds: 2, positions: ['captured'], layers: [layer('produced', 2)] }], byPosition: { captured: { seconds: 2, percent: 100 } }, mixed: { seconds: 0, percent: 0, combos: {} }, gap: { seconds: 0, percent: 0 } },
			audio: { intervals: [{ startSeconds: 0, endSeconds: 2, positions: ['captured'], layers: [layer('produced', 3)] }], byPosition: { captured: { seconds: 2, percent: 100 } }, mixed: { seconds: 0, percent: 0, combos: {} }, gap: { seconds: 0, percent: 0 } }
		};
		const segments = [
			{ enabled: true, trackKind: 'video', trackIndex: 1, startFrame: 0, endFrame: 60, sourceKind: 'file', matchedAssetType: 'produced', matchedAssetId: 2 },
			{ enabled: true, trackKind: 'audio', trackIndex: 1, startFrame: 0, endFrame: 60, sourceKind: 'file', matchedAssetType: 'produced', matchedAssetId: 3 }
		];
		const { definition, ingredients, statement: signedStatement } = buildOutputManifest({
			output: { type: 'produced', id: 1, filePath: exportPath },
			timeline: { sequenceName: 'Seq', fps: 30 }, composition, segments, assets,
			statement: { text: 'Test statement.', authorName: 'Test Creator' }, statedAt: '2026-01-01T00:00:00Z', generator: GENERATOR
		});
		const outputPath = path.join(dir, 'export.signed.v1.png');
		const { report } = await signWithC2patool({ inputPath: exportPath, outputPath, definition, ingredients, certificatePath, privateKeyPath });
		const v = interpretReport(report);
		expect(v.status).toBe('unrecognised_issuer');
		expect(v.manifests).toBe(3); // ours, camera.png's embedded one, tone.wav's sidecar
		expect(v.ingredients.map(i => [i.title, i.relationship, i.credentials])).toEqual([
			['export.png', 'parentOf', 'none'],
			['camera.png', 'componentOf', 'present'],
			['tone.wav', 'componentOf', 'present']
		]);
		const active = readReport(outputPath).manifests[report.active_manifest];
		const statement = active.assertions.find(a => a.label === STATEMENT_LABEL).data;
		expect(statement.ingredients[1]).toMatchObject({ title: 'tone.wav', note: 'Recorded without credentials.' });

		// The public export from this real read-back matches its schema and
		// sees both ingredients' credentials inside the signed file.
		const schema = JSON.parse(readFileSync(path.join(ROOT, 'schemas', 'public-export.v1.schema.json'), 'utf8'));
		const exported = buildPublicExport({
			signature: { kind: 'output', version: 1, signedPath: outputPath, signedHash: '0'.repeat(64), signedSize: readFileSync(outputPath).length, statement: signedStatement, report, createdAt: new Date() },
			generatedAt: new Date().toISOString(), generator: GENERATOR
		});
		expect(validate(schema, exported)).toEqual([]);
		expect(exported.ingredients.map(i => [i.fileName, i.credentialsInSignedFile])).toEqual([['camera.png', 'present'], ['tone.wav', 'present']]);
		expect(exported.composition.picture.intervals).toEqual([{ start: 0, end: 2, positions: ['captured'], refs: ['ing-1'] }]);
		expect(JSON.stringify(exported)).not.toContain(dir);
	}, 60000);
});

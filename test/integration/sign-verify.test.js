// Integration: generate a throwaway dev cert, sign a WAV and a PNG created
// from code, and read the manifests back with the tracker's own reader.
// Everything lives in a temp directory; the repo guard confirms nothing in
// the checkout changes. Skips when openssl is not on PATH (the cert
// generator shells out to it).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { signAsset } from '../../src/server/lib/extraction/c2pa-sign.js';
import { extractC2pa } from '../../src/server/lib/extraction/c2pa.js';

const haveOpenssl = spawnSync('openssl', ['version'], { encoding: 'utf8' }).status === 0;
const ROOT = path.resolve(import.meta.dirname, '..', '..');

function silentWav(file, seconds = 1, sampleRate = 8000) {
	const data = Buffer.alloc(seconds * sampleRate * 2);
	const h = Buffer.alloc(44);
	h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
	h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
	h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
	h.write('data', 36); h.writeUInt32LE(data.length, 40);
	writeFileSync(file, Buffer.concat([h, data]));
}

function tinyPng(file) {
	const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return (~c) >>> 0; };
	const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
	const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2;
	const raw = Buffer.from([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 0, 255, 255, 0]);
	writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

describe.skipIf(!haveOpenssl)('sign and read back (dev cert)', () => {
	let dir, certificatePath, privateKeyPath;

	beforeAll(() => {
		dir = mkdtempSync(path.join(tmpdir(), 'pt-sign-'));
		const certDir = path.join(dir, 'certs');
		const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'generate-dev-cert.mjs'), certDir], { encoding: 'utf8' });
		if (r.status !== 0) throw new Error(`cert generation failed: ${r.stderr || r.stdout}`);
		certificatePath = path.join(certDir, 'c2pa-dev-cert.pem');
		privateKeyPath = path.join(certDir, 'c2pa-dev-key.pem');
		expect(existsSync(certificatePath)).toBe(true);
		silentWav(path.join(dir, 'tone.wav'));
		tinyPng(path.join(dir, 'pixel.png'));
	}, 60000);

	afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

	for (const name of ['tone.wav', 'pixel.png']) {
		it(`signs ${name}, keeps the original, and the reader sees the assertions`, async () => {
			const inputPath = path.join(dir, name);
			const r = await signAsset({
				inputPath, creatorName: 'Test Creator', organization: 'Test Org', toolUsed: 'integration test',
				isAiGenerated: false, cawgIdentityUrl: 'https://example.com/.well-known/cawg-identity.json', cawgIdentityName: 'Test Creator',
				certificatePath, privateKeyPath
			});
			expect(existsSync(inputPath)).toBe(true);
			expect(r.signedPath).not.toBe(inputPath);
			expect(existsSync(r.signedPath)).toBe(true);
			expect(r.fileHash).toMatch(/^[0-9a-f]{64}$/);

			const read = await extractC2pa(r.signedPath);
			expect(read).not.toBeNull();
			expect(read._readError).toBeUndefined();
			const labels = read.assertions.map(a => a.label);
			expect(labels).toEqual(expect.arrayContaining(['c2pa.actions', 'stds.schema-org.CreativeWork', 'c2pa.training-mining', 'cawg.identity']));
			expect(read.claimGenerator).toMatch(/^provenance-tracker\//);
		}, 30000);
	}

	it('refuses to overwrite an existing signed file', async () => {
		await expect(signAsset({ inputPath: path.join(dir, 'tone.wav'), creatorName: 'x', toolUsed: 'x', certificatePath, privateKeyPath }))
			.rejects.toThrow(/Refusing to overwrite/);
	});
});

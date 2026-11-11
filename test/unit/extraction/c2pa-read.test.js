import { describe, it, expect } from 'vitest';
import { interpretC2paNodeResult, extractC2pa } from '../../../src/server/lib/extraction/c2pa.js';

// Shape of c2pa-node 0.5.x read(): active_manifest is the resolved manifest
// object, manifests is keyed by label, validation_status is an array.
const manifest = {
	title: 'clip.mp4',
	format: 'video/mp4',
	claim_generator_info: [{ name: 'Pixel Camera' }],
	assertions: [{ label: 'c2pa.actions.v2', data: { actions: [{ action: 'c2pa.created' }] } }],
	ingredients: [],
	signature_info: { issuer: 'Google LLC', common_name: 'Pixel Camera', time: '2026-11-02T18:01:13+00:00', alg: 'Es256' }
};

describe('interpretC2paNodeResult', () => {
	it('returns absent for a null read result', () => {
		expect(interpretC2paNodeResult(null)).toEqual({ kind: 'absent' });
	});

	it('reads the active manifest when it is the resolved object (c2pa-node 0.5.x)', () => {
		const r = interpretC2paNodeResult({ active_manifest: manifest, manifests: { 'urn:x': manifest }, validation_status: [] });
		expect(r.kind).toBe('ok');
		expect(r.summary.claimGenerator).toBe('Pixel Camera');
		expect(r.summary.signatureInfo.issuer).toBe('Google LLC');
		expect(r.summary.assertions.map(a => a.label)).toEqual(['c2pa.actions.v2']);
	});

	it('still reads the manifest when validation_status has entries (untrusted cert, hash mismatch)', () => {
		const vs = [{ code: 'signingCredential.untrusted', explanation: 'signing certificate untrusted' }];
		const r = interpretC2paNodeResult({ active_manifest: manifest, manifests: { 'urn:x': manifest }, validation_status: vs });
		expect(r.kind).toBe('ok');
		expect(r.validationStatus).toEqual(vs);
	});

	it('tolerates active_manifest given as a label', () => {
		const r = interpretC2paNodeResult({ active_manifest: 'urn:x', manifests: { 'urn:x': manifest }, validation_status: [] });
		expect(r.kind).toBe('ok');
	});

	it('reports unparseable when manifests are empty but validation_status is not', () => {
		const r = interpretC2paNodeResult({ active_manifest: null, manifests: {}, validation_status: [{ code: 'assertion.unsupported', explanation: 'unknown field' }] });
		expect(r.kind).toBe('unparseable');
		expect(r.reason).toContain('unknown field');
	});

	it('reports absent when nothing was found and nothing was rejected', () => {
		expect(interpretC2paNodeResult({ active_manifest: null, manifests: {}, validation_status: [] })).toEqual({ kind: 'absent' });
	});
});

describe('extractC2pa reader routing', () => {
	const summary = { title: 'clip.mp4', ingredients: [] };
	const reader = (result) => async () => result;

	it('uses the fast reader when it parses the manifest', async () => {
		const r = await extractC2pa('x', { node: reader({ kind: 'ok', summary }), tool: reader({ kind: 'absent' }) });
		expect(r).toEqual(summary);
	});
	it('reads through c2patool when the native binding cannot load', async () => {
		const unavailable = reader({ kind: 'unavailable', reason: 'blocked by policy' });
		expect(await extractC2pa('x', { node: unavailable, tool: reader({ kind: 'ok', summary }) })).toEqual({ ...summary, _readerFallback: 'c2patool' });
		expect(await extractC2pa('x', { node: unavailable, tool: reader({ kind: 'absent' }) })).toBeNull();
		expect(await extractC2pa('x', { node: unavailable, tool: reader({ kind: 'unparseable', reason: 'boom' }) })).toMatchObject({ _readError: true, _fallbackReason: 'boom' });
	});
	it('falls back when the fast reader cannot decode a present manifest', async () => {
		const bad = reader({ kind: 'unparseable', reason: 'unknown field', validationStatus: [{ code: 'x' }] });
		expect(await extractC2pa('x', { node: bad, tool: reader({ kind: 'ok', summary }) })).toEqual({ ...summary, _readerFallback: 'c2patool' });
		expect(await extractC2pa('x', { node: bad, tool: reader({ kind: 'absent' }) })).toMatchObject({ _readError: true, _reason: 'unknown field' });
	});
});

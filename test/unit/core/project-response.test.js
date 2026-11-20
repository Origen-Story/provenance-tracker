// Pure tests: a project response never carries the signing paths.
import { describe, it, expect } from 'vitest';
import { toProjectResponse, isSigningConfigured, signingPathUpdates } from '../../../src/server/lib/core/project-response.js';

const row = {
	id: 3, name: 'Demo film', storagePath: 'P:/media/demo', isActive: true,
	certificatePath: 'C:/keys/chain.pem', privateKeyPath: 'C:/keys/signing.key',
	cawgIdentityUrl: 'https://example.com/me', cawgIdentityName: 'A. Creator'
};

describe('toProjectResponse', () => {
	it('drops both paths and says only whether signing is configured', () => {
		const out = toProjectResponse(row);
		expect(out).not.toHaveProperty('certificatePath');
		expect(out).not.toHaveProperty('privateKeyPath');
		expect(JSON.stringify(out)).not.toContain('C:/keys');
		expect(out.signingConfigured).toBe(true);
	});

	it('keeps every other field and leaves the row untouched', () => {
		const out = toProjectResponse(row);
		expect(out).toMatchObject({ id: 3, name: 'Demo film', storagePath: 'P:/media/demo', isActive: true, cawgIdentityName: 'A. Creator' });
		expect(row.privateKeyPath).toBe('C:/keys/signing.key');
	});

	it('needs both paths to call signing configured', () => {
		expect(toProjectResponse({ ...row, privateKeyPath: '' }).signingConfigured).toBe(false);
		expect(toProjectResponse({ ...row, certificatePath: null }).signingConfigured).toBe(false);
		expect(isSigningConfigured({})).toBe(false);
	});

	it('passes a missing project through as null', () => {
		expect(toProjectResponse(null)).toBeNull();
		expect(toProjectResponse(undefined)).toBeNull();
	});
});

describe('signingPathUpdates', () => {
	it('changes nothing when the form sends no path, or an empty one', () => {
		expect(signingPathUpdates({ name: 'x' })).toEqual({});
		expect(signingPathUpdates({ certificatePath: '', privateKeyPath: '   ' })).toEqual({});
		expect(signingPathUpdates()).toEqual({});
	});

	it('sets only the path that was typed, trimmed', () => {
		expect(signingPathUpdates({ certificatePath: ' certs/new-chain.pem ' })).toEqual({ certificatePath: 'certs/new-chain.pem' });
		expect(signingPathUpdates({ certificatePath: 'a.pem', privateKeyPath: 'a.key' })).toEqual({ certificatePath: 'a.pem', privateKeyPath: 'a.key' });
	});

	it('ignores values that are not text', () => {
		expect(signingPathUpdates({ certificatePath: { $ne: '' }, privateKeyPath: 7 })).toEqual({});
	});

	it('clears both only when asked outright', () => {
		expect(signingPathUpdates({ clearSigning: true, certificatePath: 'ignored.pem' })).toEqual({ certificatePath: '', privateKeyPath: '' });
		expect(signingPathUpdates({ clearSigning: 'true' })).toEqual({});
	});
});

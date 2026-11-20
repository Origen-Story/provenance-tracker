// Pure tests for the local-only guard: which requests the API answers.
import { describe, it, expect } from 'vitest';
import { checkLocalRequest, listenHost, allowedHostnames, isLoopbackHost, localOnly } from '../../../src/server/lib/core/local-only.js';

const ok = (r) => expect(checkLocalRequest(r)).toEqual({ ok: true });
const refused = (r) => expect(checkLocalRequest(r).ok).toBe(false);

describe('listenHost', () => {
	it('is loopback unless HOST is set', () => {
		expect(listenHost({})).toBe('127.0.0.1');
		expect(listenHost({ HOST: '  ' })).toBe('127.0.0.1');
		expect(listenHost({ HOST: '0.0.0.0' })).toBe('0.0.0.0');
	});
});

describe('allowedHostnames', () => {
	it('is empty by default and for a wildcard HOST', () => {
		expect(allowedHostnames({})).toEqual([]);
		expect(allowedHostnames({ HOST: '0.0.0.0' })).toEqual([]);
		expect(allowedHostnames({ HOST: '::' })).toEqual([]);
	});

	it('adds a specific HOST address and the ALLOWED_HOSTS list', () => {
		expect(allowedHostnames({ HOST: '192.168.1.20' })).toEqual(['192.168.1.20']);
		expect(allowedHostnames({ HOST: '0.0.0.0', ALLOWED_HOSTS: 'Tracker.example.net, tracker.example.net ,' })).toEqual(['tracker.example.net']);
	});
});

describe('isLoopbackHost', () => {
	it('knows the three loopback names', () => {
		for (const h of ['localhost', '127.0.0.1', '::1', '[::1]', 'LOCALHOST']) expect(isLoopbackHost(h)).toBe(true);
		for (const h of ['0.0.0.0', '192.168.1.20', 'example.com', '']) expect(isLoopbackHost(h)).toBe(false);
	});
});

describe('checkLocalRequest', () => {
	it('accepts the API port and the Vite dev port under any loopback name', () => {
		ok({ host: 'localhost:3001' });
		ok({ host: '127.0.0.1:3001' });
		ok({ host: '[::1]:3001' });
		ok({ host: 'LocalHost:5173' });
		ok({ host: 'localhost.:3001' });
	});

	it('accepts a same-origin request, as the browser sends through the Vite proxy', () => {
		ok({ host: 'localhost:5173', origin: 'http://localhost:5173', secFetchSite: 'same-origin' });
		ok({ host: '127.0.0.1:3001', origin: 'http://127.0.0.1:3001' });
		ok({ host: 'localhost', origin: 'http://localhost' });
	});

	it('refuses a Host that is not this machine (DNS rebinding, a LAN address)', () => {
		refused({ host: 'example.com' });
		refused({ host: 'attacker.example:3001' });
		refused({ host: '192.168.1.20:3001' });
		refused({ host: 'localhost.example.com:3001' });
		refused({ host: '127.0.0.1.example.com' });
	});

	it('refuses a missing or malformed Host', () => {
		refused({});
		refused({ host: '' });
		refused({ host: 'localhost:3001/evil' });
		refused({ host: 'user@localhost:3001' });
		refused({ host: 'local host' });
	});

	it('refuses another site posting to the local API', () => {
		refused({ host: 'localhost:3001', origin: 'https://attacker.example' });
		refused({ host: '127.0.0.1:3001', origin: 'null' });
		refused({ host: 'localhost:3001', origin: 'file://' });
	});

	it('refuses another local page: Origin must match Host, port included', () => {
		refused({ host: 'localhost:3001', origin: 'http://localhost:8080' });
		refused({ host: 'localhost:3001', origin: 'http://127.0.0.1:3001' });
	});

	it('refuses what the browser labels cross-site, even with no Origin (an <img> or a link on another site)', () => {
		refused({ host: 'localhost:3001', secFetchSite: 'cross-site' });
		ok({ host: 'localhost:3001', secFetchSite: 'none' });
		ok({ host: 'localhost:3001', secFetchSite: 'same-site' });
	});

	it('accepts a named host only when it is on the allowed list', () => {
		const allowedHosts = ['tracker.example.net'];
		ok({ host: 'tracker.example.net', origin: 'https://tracker.example.net', allowedHosts });
		refused({ host: 'tracker.example.net', origin: 'https://other.example.net', allowedHosts });
		refused({ host: 'other.example.net', allowedHosts });
	});
});

describe('localOnly middleware', () => {
	function run(headers) {
		const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
		let passed = false;
		const refusals = [];
		localOnly({ onRefuse: (_req, reason) => refusals.push(reason) })({ headers }, res, () => { passed = true; });
		return { res, passed, refusals };
	}

	it('passes a local request on', () => {
		const r = run({ host: 'localhost:3001' });
		expect(r.passed).toBe(true);
		expect(r.refusals).toEqual([]);
	});

	it('answers 403 without echoing the header back, and reports the reason to the logger', () => {
		const r = run({ host: 'attacker.example', origin: 'https://attacker.example' });
		expect(r.passed).toBe(false);
		expect(r.res.code).toBe(403);
		expect(JSON.stringify(r.res.body)).not.toContain('attacker');
		expect(r.refusals).toHaveLength(1);
	});
});

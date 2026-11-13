// Read a C2PA manifest from a file, using c2pa-node as the fast path and
// c2patool as a fallback for manifests c2pa-node can't parse.
//
// Why the fallback exists: c2pa-node ships behind the C2PA spec's field
// additions — most notably `description` on c2pa.actions.v2 — and returns an
// empty manifest set + validation_status entries when it hits an unknown
// field, silently rejecting real manifests. c2patool is the reference Rust
// implementation, ships in lockstep with the spec, and reads what c2pa-node
// can't. See tools/c2patool/README.md for the bundled binary.
//
// Return shapes (all serializable to JSON for c2paJson storage):
//   null                                       — no C2PA data in the file
//   { title, format, claimGenerator, ... }     — parsed manifest summary
//     · _readerFallback: 'c2patool' present when the fast path failed and
//       the fallback recovered the manifest.
//   { _readError: true, ... }                  — manifest present in the
//     bytes but no reader could parse it. Persisted so we don't silently
//     lose the signal that provenance exists.

import { loadC2paNode } from './c2pa-node-loader.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createLogger } from '../logger.js';

const log = createLogger('c2pa');
const execFileP = promisify(execFile);

// The native binding is loaded on first read and may be unavailable (see
// c2pa-node-loader.js); null means use c2patool.
let c2paNode = null;
async function getC2pa() {
	if (c2paNode) return c2paNode;
	const { module } = await loadC2paNode();
	if (!module) return null;
	c2paNode = module.createC2pa();
	return c2paNode;
}

// ---------- c2patool binary resolution ----------

// Resolved once at module load. Order of preference:
//   1. C2PATOOL_PATH env var (explicit override)
//   2. Bundled binary at <repo>/tools/c2patool/c2patool[.exe]
//   3. `c2patool` on PATH — attempted lazily; if not present, fallback is
//      simply unavailable.
let c2patoolPath = null;
export function resolveC2patoolPath() {
	if (c2patoolPath !== null) return c2patoolPath;

	if (process.env.C2PATOOL_PATH) {
		c2patoolPath = process.env.C2PATOOL_PATH;
		return c2patoolPath;
	}

	// From this file (src/server/lib/extraction/c2pa.js) go up 4 levels to the
	// repo root, then into tools/c2patool/.
	const here = fileURLToPath(import.meta.url);
	const repoRoot = path.resolve(path.dirname(here), '..', '..', '..', '..');
	const exeName = process.platform === 'win32' ? 'c2patool.exe' : 'c2patool';
	const bundled = path.join(repoRoot, 'tools', 'c2patool', exeName);
	if (existsSync(bundled)) {
		c2patoolPath = bundled;
		return c2patoolPath;
	}

	// Last resort: hope it's on PATH. execFile will surface ENOENT if not.
	c2patoolPath = 'c2patool';
	return c2patoolPath;
}

// ---------- summary builder (shared shape for both readers) ----------

function buildSummary(active) {
	const summary = {
		title: active.title || null,
		format: active.format || null,
		claimGenerator: active.claim_generator || (active.claim_generator_info && active.claim_generator_info[0] && active.claim_generator_info[0].name) || null,
		assertions: [],
		ingredients: [],
		signatureInfo: null,
	};
	if (active.assertions) {
		for (const a of active.assertions) summary.assertions.push({ label: a.label, data: a.data });
	}
	if (active.ingredients) {
		for (const ing of active.ingredients) {
			summary.ingredients.push({
				title: ing.title,
				format: ing.format,
				relationship: ing.relationship,
			});
		}
	}
	if (active.signature_info) {
		summary.signatureInfo = {
			issuer: active.signature_info.issuer || null,
			commonName: active.signature_info.common_name || null,
			time: active.signature_info.time || null,
			alg: active.signature_info.alg || null,
		};
	}
	return summary;
}

// ---------- reader implementations ----------

// Returns:
//   { kind: 'absent' }                  — no manifest in the file
//   { kind: 'ok', summary }             — parsed cleanly
//   { kind: 'unparseable', reason, validationStatus } — has a manifest but
//                                          reader couldn't decode it
//   { kind: 'unavailable', reason }     — this reader cannot run here
async function readWithC2paNode(filePath) {
	let result;
	try {
		const c2pa = await getC2pa();
		if (!c2pa) return { kind: 'unavailable', reason: 'c2pa-node native binding could not be loaded' };
		result = await c2pa.read({ path: filePath });
	} catch (err) {
		return { kind: 'unparseable', reason: err.message, validationStatus: [] };
	}
	return interpretC2paNodeResult(result);
}

// Pure: turn c2pa-node's read() result into the reader shape. Exported for
// tests. c2pa-node 0.5.x returns `active_manifest` as the RESOLVED MANIFEST
// OBJECT (see node_modules/c2pa-node/dist/js-src/bindings.js, read()), not as
// a label into `manifests`. An earlier version of this file indexed
// `manifests[active_manifest]` and so reported every cleanly-read manifest as
// absent; the unit test in test/unit/extraction/c2pa-read.test.js pins this.
export function interpretC2paNodeResult(result) {
	// Truly no manifest: null.
	if (!result) return { kind: 'absent' };

	let active = result.active_manifest || null;
	// Defensive: tolerate a future bindings change that returns the label.
	if (typeof active === 'string' && result.manifests) active = result.manifests[active] || null;
	if (active) return { kind: 'ok', summary: buildSummary(active), validationStatus: result.validation_status || [] };

	// c2pa-node's own signal for "manifest present but rejected": empty
	// `manifests` object plus non-empty `validation_status`. If there is a
	// validation_status the file HAS C2PA data.
	const vs = result.validation_status || [];
	if (vs.length > 0) {
		return {
			kind: 'unparseable',
			reason: vs.map(v => v.explanation || v.code).join('; '),
			validationStatus: vs,
		};
	}
	return { kind: 'absent' };
}

// Same return shape as readWithC2paNode. c2patool's output is JSON on stdout;
// non-zero exit + stderr on real failure. A file with no manifest gets an
// exit code + stderr message rather than an empty JSON body.
async function readWithC2patool(filePath) {
	const bin = resolveC2patoolPath();
	let stdout;
	try {
		const res = await execFileP(bin, [filePath], { maxBuffer: 8 * 1024 * 1024, timeout: 15000 });
		stdout = res.stdout;
	} catch (err) {
		// ENOENT → tool not installed. Log once (loudly) so ops notices, but
		// treat as fallback unavailable rather than crashing extraction.
		if (err.code === 'ENOENT') {
			log.warn('c2patool binary not found; fallback disabled. Set C2PATOOL_PATH or install to tools/c2patool/.');
			return { kind: 'absent' };
		}
		// Non-zero exit usually means "no manifest" for c2patool. It writes an
		// error string to stderr. Distinguish "no manifest" from "actual error"
		// by looking for the sentinel phrases.
		const stderr = (err.stderr || '').trim();
		if (/no.*manifest|no.*claim|jumbf.*not.*found/i.test(stderr)) {
			return { kind: 'absent' };
		}
		return { kind: 'unparseable', reason: `c2patool: ${stderr || err.message}`, validationStatus: [] };
	}

	let parsed;
	try {
		parsed = JSON.parse(stdout);
	} catch (err) {
		return { kind: 'unparseable', reason: `c2patool JSON parse: ${err.message}`, validationStatus: [] };
	}
	const active = parsed.active_manifest && parsed.manifests
		? parsed.manifests[parsed.active_manifest]
		: null;
	if (!active) return { kind: 'absent' };
	return { kind: 'ok', summary: buildSummary(active) };
}

// ---------- public API ----------

/**
 * Read the C2PA manifest from a file. Tries c2pa-node first for speed;
 * falls back to c2patool when the fast path can't decode a present manifest
 * or cannot run at all on this machine.
 *
 * Never throws — a failed read is reported in the returned object so the
 * caller can persist the signal. `readers` is injectable for tests.
 */
export async function extractC2pa(filePath, readers = { node: readWithC2paNode, tool: readWithC2patool }) {
	const node = await readers.node(filePath);
	if (node.kind === 'ok') return node.summary;
	if (node.kind === 'absent') return null;

	// The binding is not loadable here: c2patool is the only reader, so its
	// word on presence is final.
	if (node.kind === 'unavailable') {
		const only = await readers.tool(filePath);
		if (only.kind === 'ok') return { ...only.summary, _readerFallback: 'c2patool' };
		if (only.kind === 'absent') return null;
		log.error(`c2patool failed on ${filePath} and c2pa-node is unavailable: ${only.reason}`);
		return { _readError: true, _reason: node.reason, _fallbackReason: only.reason, validationStatus: [] };
	}

	// unparseable → try the reference tool
	log.warn(`c2pa-node could not decode manifest in ${filePath}: ${node.reason}. Falling back to c2patool.`);
	const tool = await readers.tool(filePath);
	if (tool.kind === 'ok') {
		return { ...tool.summary, _readerFallback: 'c2patool' };
	}
	if (tool.kind === 'absent') {
		// c2pa-node found bytes; c2patool disagrees. Treat as the manifest
		// being unparseable — we still know provenance data was present.
		log.error(`c2pa-node saw a manifest at ${filePath} but c2patool sees none; likely a c2patool binary or trust-list issue.`);
	} else {
		log.error(`Both c2pa-node and c2patool failed on ${filePath}: ${tool.reason}`);
	}
	return {
		_readError: true,
		_reason: node.reason,
		_fallbackReason: tool.kind === 'unparseable' ? tool.reason : null,
		validationStatus: node.validationStatus,
	};
}

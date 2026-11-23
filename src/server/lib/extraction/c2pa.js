// Read a C2PA manifest store from a file, using c2pa-node as the fast path and
// c2patool as a fallback for files c2pa-node can't read.
//
// Each reader returns an observation (observation.ts): which reader, its
// version, whether it worked, the full manifest store and its validation.
// observeC2pa() returns every attempt in order, so a fallback leaves a record
// of what the first reader said as well as the second. extractC2pa() turns
// those into the summary the current app stores as c2paJson.
//
// Neither reader is the last word on validity: c2pa-node 0.5.x cannot decode
// newer manifests at all, and every c2patool release so far misreads genuine
// Pixel video as invalid (docs/decisions.md D15). The observations keep what
// each one said; nothing here decides who was right.
//
// c2paJson shapes (unchanged, plus `validation`):
//   null                                     no C2PA data in the file
//   { title, format, claimGenerator, ..., validation }  parsed manifest summary
//     · _readerFallback: 'c2patool' when the fast path failed and the
//       fallback read the manifest
//   { _readError: true, ... }                manifest present (or possibly
//     present) but no reader could parse it. Stored so the signal that
//     provenance exists is not lost.

import { loadC2paNode } from "./c2pa-node-loader.js";
import { createLogger } from "../logger.js";
import {
	activeManifestOf,
	c2patoolObservation,
	parseToolVersion,
} from "@provenancetracker/core/extraction/c2patool-read.ts";
import {
	c2patoolPath as c2patoolPathFor,
	readC2pa,
} from "@provenancetracker/core-node/extract/c2patool.ts";
import {
	makeObservation,
	c2paValidation,
} from "@provenancetracker/core/extraction/observation.ts";
// The summary shape, shared with classify in the catalog (one implementation).
import { c2paSummary as buildSummary } from "@provenancetracker/core/extraction/c2pa-summary.ts";

const log = createLogger("c2pa");

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

// ---------- c2patool ----------

// The pinned c2patool, found by core-node (C2PATOOL_PATH, then tools/, then
// PATH); resolved once. Signing (manifest/c2patool.js) uses the same one.
let c2patoolPath = null;
export function resolveC2patoolPath() {
	c2patoolPath ??= c2patoolPathFor(process.env);
	return c2patoolPath;
}

export { parseToolVersion, activeManifestOf, c2patoolObservation };

// ---------- readers: file -> observation ----------

/**
 * Pure: classify c2pa-node's read() result. Exported for tests.
 * @returns {{ kind: 'absent' } | { kind: 'ok', summary, validationStatus } |
 *   { kind: 'unparseable', reason, validationStatus }}
 */
export function interpretC2paNodeResult(result) {
	// Truly no manifest: null.
	if (!result) return { kind: "absent" };

	const active = activeManifestOf(result);
	if (active)
		return {
			kind: "ok",
			summary: buildSummary(active),
			validationStatus: result.validation_status || [],
		};

	// c2pa-node's own signal for "manifest present but rejected": empty
	// `manifests` object plus non-empty `validation_status`. If there is a
	// validation_status the file HAS C2PA data.
	const vs = result.validation_status || [];
	if (vs.length > 0) {
		return {
			kind: "unparseable",
			reason: vs.map((v) => v.explanation || v.code).join("; "),
			validationStatus: vs,
		};
	}
	return { kind: "absent" };
}

/** Pure: c2pa-node's read() result (or the error it threw) as an observation. */
export function c2paNodeObservation({ result, error, version }) {
	const base = { kind: "c2pa", extractor: "c2pa-node", version };
	if (error) return makeObservation({ ...base, status: "unreadable", error });
	const r = interpretC2paNodeResult(result);
	if (r.kind === "absent")
		return makeObservation({ ...base, status: "absent" });
	if (r.kind === "unparseable")
		return makeObservation({
			...base,
			status: "unreadable",
			error: r.reason,
			validation: c2paValidation(result),
		});
	return makeObservation({
		...base,
		status: "ok",
		data: result,
		validation: c2paValidation(result),
	});
}

async function readWithC2paNode(filePath) {
	const { module, reason, version } = await loadC2paNode();
	if (!module)
		return makeObservation({
			kind: "c2pa",
			extractor: "c2pa-node",
			version,
			status: "unavailable",
			error: `c2pa-node native binding could not be loaded: ${reason}`,
		});
	try {
		const c2pa = await getC2pa();
		const result = await c2pa.read({ path: filePath });
		return c2paNodeObservation({ result, version });
	} catch (err) {
		return c2paNodeObservation({ error: err.message, version });
	}
}

async function readWithC2patool(filePath) {
	const obs = await readC2pa(filePath, { tool: resolveC2patoolPath() });
	if (obs.status === "unavailable")
		log.warn(
			"c2patool binary not found; fallback disabled. Run npm run tools:fetch or set C2PATOOL_PATH.",
		);
	return obs;
}
// ---------- public API ----------

/**
 * Every C2PA read attempted on a file, in order. c2pa-node first; c2patool
 * only when c2pa-node could not run or could not decode what it found.
 * Never throws. `readers` is injectable for tests.
 * @returns {Promise<import('@provenancetracker/core/extraction/observation.ts').Observation[]>}
 */
export async function observeC2pa(
	filePath,
	readers = { node: readWithC2paNode, tool: readWithC2patool },
) {
	const node = await readers.node(filePath);
	if (node.status === "ok" || node.status === "absent") return [node];
	if (node.status === "unreadable")
		log.warn(
			`c2pa-node could not decode the manifest in ${filePath}: ${node.error}. Falling back to c2patool.`,
		);
	const tool = await readers.tool(filePath);
	if (tool.status === "absent" && node.status === "unreadable")
		log.error(
			`c2pa-node saw a manifest at ${filePath} but c2patool sees none; likely a c2patool binary or trust-list issue.`,
		);
	else if (tool.status === "unreadable")
		log.error(`No C2PA reader could read ${filePath}: ${tool.error}`);
	return [node, tool];
}

/**
 * Pure: the c2paJson summary the current app stores, from the observations
 * of one file. Same shapes as before observations existed, plus a
 * `validation` object ({ state, failures, statuses }) on a parsed summary.
 */
export function legacyC2paSummary(observations) {
	const [node, tool] = observations;
	const summaryOf = (obs, extra = {}) => ({
		...buildSummary(activeManifestOf(obs.data)),
		...extra,
		validation: {
			state: obs.validation?.state ?? null,
			failures: obs.validation?.failures ?? [],
			statuses: obs.validation?.statuses ?? [],
		},
	});
	if (node.status === "ok") return summaryOf(node);
	if (node.status === "absent") return null;
	if (tool?.status === "ok")
		return summaryOf(tool, { _readerFallback: "c2patool" });

	if (node.status === "unavailable") {
		// c2patool is the only reader here, so its word on presence is final.
		if (!tool || tool.status !== "unreadable") return null;
		return {
			_readError: true,
			_reason: node.error,
			_fallbackReason: tool.error,
			validationStatus: [],
		};
	}
	// c2pa-node found something it could not decode; we still know provenance
	// data was present.
	return {
		_readError: true,
		_reason: node.error,
		_fallbackReason: tool?.status === "unreadable" ? tool.error : null,
		validationStatus: node.validation?.statuses ?? [],
	};
}

/**
 * Read the C2PA manifest from a file as the summary stored in c2paJson.
 * Never throws: a failed read is reported in the returned object so the
 * caller can persist the signal. `readers` is injectable for tests.
 */
export async function extractC2pa(filePath, readers) {
	return legacyC2paSummary(await observeC2pa(filePath, readers));
}

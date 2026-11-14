// Pure: the C2PA manifest definitions the tracker signs (phase 4c).
//
// Output signing: the finished edit is the parent (`c2pa.opened`), every
// tracked asset the timeline places is a component (`c2pa.placed`, with its
// IPTC digitalSourceType), and the creator statement rides along as
// `org.provenancetracker.creator_statement`. The statement and its numbers
// are built in one call from the same composition, so the text the creator
// wrote and the numbers it sits beside cannot disagree.
//
// Asset signing: one file, a `c2pa.created` action with the asset's class,
// or `c2pa.opened` on its own manifest when it already has one.
//
// The definitions are what c2patool takes with `-m` (see
// src/server/lib/manifest/c2patool.js). Signer fields (key, certificate,
// timestamp URL) and ingredient file paths are added by that IO wrapper, so
// nothing here touches the disk or knows where a key lives. No absolute path
// goes into a manifest: titles are file names only.
//
// The unsigned CAWG identity assertion the old signer wrote is gone: c2patool
// 0.27.1 rejects a `cawg.identity` without a signature and reports the whole
// manifest as `assertion.required.missing`. The identity URL is carried on
// the CreativeWork author instead, which readers already display.

import path from 'node:path';
import { sourceTypeUri, spectrumPosition, compositeClassFor } from '../../../shared/origin-vocabulary.js';
import { positionsIn } from '../timeline/compose.js';
import { classClaimedByFile } from '../origin/classify.js';

export const STATEMENT_LABEL = 'org.provenancetracker.creator_statement';
// v2 (2026-11-13) adds, for the public viewer: publicTitle on the output and
// on each ingredient (empty when not set), and per lane the compact
// `intervals` list (what plays when, by ingredient ref).
// v3: each unresolved clip carries its class (a per-clip override, such as a
// nested sequence the creator classed by hand) and its spectrum position.
export const STATEMENT_VERSION = 3;
export const PUBLIC_TITLE_MAX = 120;
export const PARENT_LABEL = 'ing-parent';

const round = (n, places) => (n == null || !Number.isFinite(n) ? null : Number(n.toFixed(places)));
const seconds = (n) => round(n, 3);
const percent = (n) => round(n, 2);

export function fileNameOf(p) {
	return String(p || '').split(/[\\/]/).pop();
}

// A public title is one line of plain text: whitespace (including line
// breaks) collapsed, control characters dropped, trimmed, capped.
export function cleanPublicTitle(value) {
	return String(value ?? '')
		.replace(/[\u0000-\u001f\u007f]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, PUBLIC_TITLE_MAX)
		.trim();
}

export function assetKey(type, id) {
	return `${type}:${id}`;
}

export function ingredientLabel(index) {
	return `ing-${index + 1}`;
}

/**
 * Next free `<name>.signed.v<N><ext>` beside the input. Never the input
 * itself, never an existing file. `exists` is injected so this stays pure.
 */
export function versionedSignedPath(inputPath, exists) {
	const ext = path.extname(inputPath);
	const base = inputPath.slice(0, inputPath.length - ext.length).replace(/\.signed\.v\d+$/, '');
	for (let v = 1; v < 10000; v++) {
		const candidate = `${base}.signed.v${v}${ext}`;
		if (!exists(candidate)) return { path: candidate, version: v };
	}
	throw new Error(`No free signed-copy name beside ${inputPath}`);
}

// Sidecar manifests (D13): a source asset's signature is a `.c2pa` file beside
// it, named like the file without its extension, which is where C2PA readers
// look for one. Earlier signatures are kept as `<name>.v<N>.c2pa`.
function withoutExtension(p) {
	const ext = path.extname(p);
	return ext ? p.slice(0, p.length - ext.length) : p;
}

export function sidecarPathFor(inputPath) {
	return `${withoutExtension(inputPath)}.c2pa`;
}

export function archivedSidecarPath(inputPath, version) {
	return `${withoutExtension(inputPath)}.v${version}.c2pa`;
}

/**
 * What to do before writing an asset's sidecar.
 *
 * @param {object} a
 * @param {string} a.inputPath
 * @param {boolean} a.sidecarExists         a `.c2pa` is already at sidecarPathFor(inputPath)
 * @param {object|null} a.currentSignature  the signature row (this asset) whose signedPath is that file
 * @param {number} a.latestVersion           highest version recorded for this asset (0 if none)
 * @returns {{ action: 'write', version, sidecarPath }
 *   | { action: 'rotate', version, sidecarPath, archive: { signatureId, from, to } }
 *   | { action: 'refuse', reason }}
 */
export function planSidecar({ inputPath, sidecarExists, currentSignature, latestVersion = 0 }) {
	const sidecarPath = sidecarPathFor(inputPath);
	const version = latestVersion + 1;
	if (!sidecarExists) return { action: 'write', version, sidecarPath };
	if (!currentSignature) {
		return { action: 'refuse', reason: `${path.basename(sidecarPath)} is already beside this file and the tracker did not write it. Move or rename it, then sign again.` };
	}
	return {
		action: 'rotate',
		version,
		sidecarPath,
		archive: { signatureId: currentSignature.id, from: sidecarPath, to: archivedSidecarPath(inputPath, currentSignature.version) }
	};
}

export function creativeWorkAssertion({ authorName, organization, identityUrl } = {}) {
	const author = [];
	if (authorName) author.push({ '@type': 'Person', name: authorName, ...(identityUrl ? { url: identityUrl } : {}) });
	if (organization) author.push({ '@type': 'Organization', name: organization, ...(identityUrl && !authorName ? { url: identityUrl } : {}) });
	return {
		label: 'stds.schema-org.CreativeWork',
		data: {
			'@context': 'https://schema.org',
			'@type': 'CreativeWork',
			...(author.length ? { author } : {}),
			...(organization ? { publisher: { '@type': 'Organization', name: organization } } : {})
		}
	};
}

// The opt-out signal C2PA defines for AI training and data mining.
export function trainingMiningAssertion() {
	return {
		label: 'c2pa.training-mining',
		data: {
			entries: {
				'c2pa.ai_generative_training': { use: 'notAllowed' },
				'c2pa.ai_inference': { use: 'notAllowed' },
				'c2pa.ai_training': { use: 'notAllowed' },
				'c2pa.data_mining': { use: 'notAllowed' }
			}
		}
	};
}

function softwareAgent(name) {
	return name ? { softwareAgent: { name } } : {};
}

/**
 * Manifest for signing one asset at ingest.
 *
 * @param {object} a
 * @param {string} a.title               file name
 * @param {string} a.originClass          the asset's class in the tracker
 * @param {boolean} [a.isAiGenerated]     the signer says a model made it; wins over the class
 * @param {boolean} [a.hasManifest]       the file already carries credentials
 * @param {string} [a.toolUsed]           what made the file
 * @param {object} a.generator            { name, version } of this program
 * @returns {{ definition: object, ingredients: Array<{label, relationship, title, useInput: true}> }}
 */
export function buildAssetManifest({ title, originClass, isAiGenerated = false, hasManifest = false, toolUsed = '', authorName = '', organization = '', identityUrl = '', trainingMiningOptOut = true, generator }) {
	const assertions = [];
	const ingredients = [];
	if (hasManifest) {
		// The file's own credentials stay as the parent; this manifest adds the
		// creator's signature on top rather than replacing them.
		ingredients.push({ label: PARENT_LABEL, relationship: 'parentOf', title, useInput: true });
		assertions.push({ label: 'c2pa.actions.v2', data: { actions: [{ action: 'c2pa.opened', ...softwareAgent(toolUsed), parameters: { ingredientIds: [PARENT_LABEL] } }] } });
	} else {
		const sourceType = isAiGenerated ? sourceTypeUri('trainedAlgorithmicMedia') : sourceTypeUri(originClass);
		if (!sourceType) throw new Error('Set the asset\'s origin class before signing: a new manifest has to say how the file was made.');
		assertions.push({ label: 'c2pa.actions.v2', data: { actions: [{ action: 'c2pa.created', digitalSourceType: sourceType, ...softwareAgent(toolUsed) }] } });
	}
	assertions.push(creativeWorkAssertion({ authorName, organization, identityUrl }));
	if (trainingMiningOptOut) assertions.push(trainingMiningAssertion());
	return {
		definition: { claim_generator_info: [generator], title, assertions },
		ingredients
	};
}

// Seconds each matched asset is present in a lane, from the composition
// intervals (so stacked or repeated uses of one asset are not double counted).
function presenceByAsset(composition) {
	const out = new Map();
	for (const lane of ['picture', 'audio']) {
		for (const iv of composition?.[lane]?.intervals || []) {
			const len = (iv.endSeconds ?? 0) - (iv.startSeconds ?? 0);
			const keys = new Set((iv.layers || []).filter(l => l.matchedAssetType && l.matchedAssetId).map(l => assetKey(l.matchedAssetType, l.matchedAssetId)));
			for (const k of keys) {
				const entry = out.get(k) || { picture: 0, audio: 0 };
				entry[lane] += len;
				out.set(k, entry);
			}
		}
	}
	return out;
}

// What plays when, compactly: per interval the spectrum positions and the
// ingredients (by ref) playing, top track first, plus how many layers are not
// tracked assets (editor titles, unmatched clips). Adjacent intervals that
// read the same are merged. This is what the public viewer draws, so the strip
// is covered by the signature, not rebuilt from a timeline that may have moved.
export function compactIntervals(lane, refOf) {
	const out = [];
	for (const iv of lane?.intervals || []) {
		const refs = [];
		let untracked = 0;
		for (const l of iv.layers || []) {
			const ref = l.matchedAssetType && l.matchedAssetId ? refOf.get(assetKey(l.matchedAssetType, l.matchedAssetId)) : undefined;
			if (ref) { if (!refs.includes(ref)) refs.push(ref); } else untracked++;
		}
		const entry = { start: seconds(iv.startSeconds), end: seconds(iv.endSeconds), positions: [...(iv.positions || [])], refs, ...(untracked ? { untracked } : {}) };
		const prev = out[out.length - 1];
		if (prev && prev.end === entry.start && prev.positions.join() === entry.positions.join() && prev.refs.join() === entry.refs.join() && (prev.untracked || 0) === untracked) {
			prev.end = entry.end;
		} else {
			out.push(entry);
		}
	}
	return out;
}

function laneSummary(lane, refOf) {
	if (!lane) return null;
	const stat = (s) => ({ seconds: seconds(s?.seconds), percent: percent(s?.percent ?? 0) });
	return {
		byPosition: Object.fromEntries(Object.entries(lane.byPosition || {}).map(([p, s]) => [p, stat(s)])),
		mixed: { ...stat(lane.mixed), combos: Object.fromEntries(Object.entries(lane.mixed?.combos || {}).map(([k, s]) => [k, stat(s)])) },
		gap: stat(lane.gap),
		intervals: compactIntervals(lane, refOf)
	};
}

function trackName(seg) {
	return `${seg.trackKind === 'audio' ? 'A' : 'V'}${seg.trackIndex}`;
}

/**
 * The assets a timeline places, in order of first use, without the output
 * itself. `segments` are the effective segments timelines.js returns.
 */
export function placedAssetKeys(segments, outputKey) {
	const keys = [];
	const seen = new Set();
	const ordered = [...(segments || [])].sort((a, b) => (a.startFrame - b.startFrame) || ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)));
	for (const s of ordered) {
		if (!s.enabled || !s.matchedAssetType || !s.matchedAssetId) continue;
		const k = assetKey(s.matchedAssetType, s.matchedAssetId);
		if (k === outputKey || seen.has(k)) continue;
		seen.add(k);
		keys.push(k);
	}
	return keys;
}

/**
 * The creator statement as it is signed. Also what the Statement tab shows,
 * so the creator reads exactly what will go into the file.
 *
 * @param {object} a
 * @param {object} a.output        { type, id, filePath, originClass }
 * @param {object} a.timeline      { sequenceName, fps, durationFrames }
 * @param {object} a.composition   breakdown.composition
 * @param {Array}  a.segments      effective segments
 * @param {Map}    a.assets        assetKey -> asset (filePath, originClass, originClassConfirmed,
 *                                 originClassSource, originClassNote, aiAssisted, signedBy,
 *                                 signerName, c2paSummary)
 * @param {object} a.statement     { text, authorName, organization, softwareAgent }
 * @param {string} a.statedAt      ISO time the statement is signed
 */
export function buildCreatorStatement({ output, timeline, composition, segments, assets, statement = {}, statedAt }) {
	const outputKey = assetKey(output.type || 'produced', output.id);
	const presence = presenceByAsset(composition);
	const outputClass = outputClassOf(output, composition);
	const placed = placedAssetKeys(segments, outputKey);
	const refOf = new Map(placed.map((k, i) => [k, ingredientLabel(i)]));
	const ingredients = placed.map((k, i) => {
		const a = assets.get(k) || {};
		const claimed = classClaimedByFile(a.c2paSummary);
		const on = presence.get(k) || { picture: 0, audio: 0 };
		return {
			ref: ingredientLabel(i),
			title: fileNameOf(a.filePath),
			publicTitle: cleanPublicTitle(a.publicTitle),
			originClass: a.originClass || 'unknown',
			digitalSourceType: sourceTypeUri(a.originClass),
			position: spectrumPosition(a.originClass, { aiAssisted: !!a.aiAssisted }),
			classSetBy: a.originClassConfirmed ? 'creator' : 'proposal',
			fileCredentials: claimed.credentials,
			classClaimedByFile: claimed.originClass,
			signedBy: a.signedBy || '',
			signerName: a.signerName || '',
			aiAssisted: !!a.aiAssisted,
			note: a.originClassNote || '',
			pictureSeconds: seconds(on.picture),
			audioSeconds: seconds(on.audio)
		};
	});
	const unresolved = [];
	let generated = 0;
	for (const s of segments || []) {
		if (!s.enabled) continue;
		if (s.sourceKind === 'generator') { generated++; continue; }
		if (s.matchedAssetType && s.matchedAssetId) continue;
		unresolved.push({
			clip: s.clipName || s.name || s.sourceName || '',
			track: trackName(s),
			startSeconds: seconds(s.startSeconds ?? (timeline?.fps ? s.startFrame / timeline.fps : null)),
			endSeconds: seconds(s.endSeconds ?? (timeline?.fps ? s.endFrame / timeline.fps : null)),
			reason: s.sourceKind === 'sequence' ? 'nested sequence' : 'no tracked asset',
			originClass: s.originClass || 'unknown',
			position: spectrumPosition(s.originClass || 'unknown', { aiAssisted: !!s.aiAssisted })
		});
	}
	return {
		version: STATEMENT_VERSION,
		statedAt,
		text: String(statement.text || '').trim(),
		author: statement.authorName || '',
		organization: statement.organization || '',
		editedWith: statement.softwareAgent || '',
		output: {
			title: fileNameOf(output.filePath),
			publicTitle: cleanPublicTitle(output.publicTitle),
			originClass: outputClass,
			digitalSourceType: sourceTypeUri(outputClass),
			sequence: timeline?.sequenceName || '',
			durationSeconds: seconds(composition?.durationSeconds),
			fps: round(timeline?.fps ?? composition?.fps, 3)
		},
		composition: { picture: laneSummary(composition?.picture, refOf), audio: laneSummary(composition?.audio, refOf) },
		ingredients,
		unresolved,
		editorGeneratedClips: generated
	};
}

// The output's class: the user's if confirmed, else what the composition says.
export function outputClassOf(output, composition) {
	if (output.originClassConfirmed && output.originClass && output.originClass !== 'unknown') return output.originClass;
	return compositeClassFor(positionsIn(composition));
}

/**
 * Manifest for signing a finished edit.
 * @returns {{ definition: object, ingredients: Array<{label, relationship, title, filePath?, useInput?}>, statement: object }}
 */
export function buildOutputManifest({ output, timeline, composition, segments, assets, statement = {}, statedAt, generator, trainingMiningOptOut = true }) {
	if (!output?.filePath) throw new Error('The output has no file to sign');
	if (!composition) throw new Error('Import the timeline before signing: the statement is built from it');
	const data = buildCreatorStatement({ output, timeline, composition, segments, assets, statement, statedAt });
	const outputKey = assetKey(output.type || 'produced', output.id);
	const keys = placedAssetKeys(segments, outputKey);

	const ingredients = [{ label: PARENT_LABEL, relationship: 'parentOf', title: data.output.title, useInput: true }];
	const actions = [{ action: 'c2pa.opened', ...(data.output.digitalSourceType ? { digitalSourceType: data.output.digitalSourceType } : {}), ...softwareAgent(statement.softwareAgent), parameters: { ingredientIds: [PARENT_LABEL] } }];
	keys.forEach((k, i) => {
		const a = assets.get(k) || {};
		const label = ingredientLabel(i);
		ingredients.push({ label, relationship: 'componentOf', title: fileNameOf(a.filePath), filePath: a.filePath });
		const dst = sourceTypeUri(a.originClass);
		actions.push({ action: 'c2pa.placed', ...(dst ? { digitalSourceType: dst } : {}), parameters: { ingredientIds: [label] } });
	});

	const assertions = [
		{ label: 'c2pa.actions.v2', data: { actions } },
		{ label: STATEMENT_LABEL, data },
		creativeWorkAssertion({ authorName: statement.authorName, organization: statement.organization, identityUrl: statement.identityUrl })
	];
	if (trainingMiningOptOut) assertions.push(trainingMiningAssertion());
	return {
		definition: { claim_generator_info: [generator], title: data.output.title, assertions },
		ingredients,
		statement: data
	};
}

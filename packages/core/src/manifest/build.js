// Pure: the C2PA manifest definitions the tracker signs (phase 4c).
//
// Output signing: the finished edit is the parent (`c2pa.opened`), every
// tracked asset the timeline places is a component (a `c2pa.placed` action
// per stretch of the edit where it plays, with its time range and IPTC
// digitalSourceType; D17), the image the creator picked is the claim
// thumbnail, and the creator statement rides along as
// `org.provenancetracker.creator_statement`. The statement and its numbers
// are built in one call from the same composition, so the text the creator
// wrote and the numbers it sits beside cannot disagree.
//
// Asset signing: one file, a `c2pa.created` action with the asset's class,
// or `c2pa.opened` on its own manifest when it already has one.
//
// The definitions are what c2patool takes with `-m` (see
// packages/core-node/src/sign/c2patool-sign.ts). Signer fields (key, certificate,
// timestamp URL) and ingredient file paths are added by that IO wrapper, so
// nothing here touches the disk or knows where a key lives. No absolute path
// goes into a manifest: titles are file names only.
//
// The unsigned CAWG identity assertion the old signer wrote is gone: c2patool
// 0.27.1 rejects a `cawg.identity` without a signature and reports the whole
// manifest as `assertion.required.missing`. The identity URL is carried on
// the CreativeWork author instead, which readers already display.

import path from "node:path";
import {
	UNVERIFIED_SIGNER,
	sourceTypeUri,
	spectrumPosition,
	compositeClassFor,
} from "../origin-vocabulary.js";
import { positionsIn } from "../timeline/compose.js";
import { classClaimedByFile } from "../origin/classify.js";

export const STATEMENT_LABEL = "org.provenancetracker.creator_statement";
// v2 (2026-11-13) adds, for the public viewer: publicTitle on the output and
// on each ingredient (empty when not set), and per lane the compact
// `intervals` list (what plays when, by ingredient ref).
// v3: each unresolved clip carries its class (a per-clip override, such as a
// nested sequence the creator classed by hand) and its spectrum position.
export const STATEMENT_VERSION = 3;
export const PUBLIC_TITLE_MAX = 120;
export const PARENT_LABEL = "ing-parent";

const round = (n, places) =>
	n == null || !Number.isFinite(n) ? null : Number(n.toFixed(places));
const seconds = (n) => round(n, 3);
const percent = (n) => round(n, 2);

export function fileNameOf(p) {
	return String(p || "")
		.split(/[\\/]/)
		.pop();
}

// A public title is one line of plain text: whitespace (including line
// breaks) collapsed, control characters dropped, trimmed, capped.
export function cleanPublicTitle(value) {
	return (
		String(value ?? "")
			// Control characters are what this strips, so the regex has to name them.
			// eslint-disable-next-line no-control-regex
			.replace(/[\u0000-\u001f\u007f]+/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, PUBLIC_TITLE_MAX)
			.trim()
	);
}

// The output names itself by ref, like every asset (core/asset-ref.ts).
function requireRef(output) {
	if (!output?.ref) throw new Error("The output has no asset ref");
	return output.ref;
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
	const base = inputPath
		.slice(0, inputPath.length - ext.length)
		.replace(/\.signed\.v\d+$/, "");
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
export function planSidecar({
	inputPath,
	sidecarExists,
	currentSignature,
	latestVersion = 0,
}) {
	const sidecarPath = sidecarPathFor(inputPath);
	const version = latestVersion + 1;
	if (!sidecarExists) return { action: "write", version, sidecarPath };
	if (!currentSignature) {
		return {
			action: "refuse",
			reason: `${path.basename(sidecarPath)} is already beside this file and the tracker did not write it. Move or rename it, then sign again.`,
		};
	}
	return {
		action: "rotate",
		version,
		sidecarPath,
		archive: {
			signatureId: currentSignature.id,
			from: sidecarPath,
			to: archivedSidecarPath(inputPath, currentSignature.version),
		},
	};
}

export function creativeWorkAssertion({
	authorName,
	organization,
	identityUrl,
} = {}) {
	const author = [];
	if (authorName)
		author.push({
			"@type": "Person",
			name: authorName,
			...(identityUrl ? { url: identityUrl } : {}),
		});
	if (organization)
		author.push({
			"@type": "Organization",
			name: organization,
			...(identityUrl && !authorName ? { url: identityUrl } : {}),
		});
	return {
		label: "stds.schema-org.CreativeWork",
		data: {
			"@context": "https://schema.org",
			"@type": "CreativeWork",
			...(author.length ? { author } : {}),
			...(organization
				? { publisher: { "@type": "Organization", name: organization } }
				: {}),
		},
	};
}

// The opt-out signal C2PA defines for AI training and data mining.
export function trainingMiningAssertion() {
	return {
		label: "c2pa.training-mining",
		data: {
			entries: {
				"c2pa.ai_generative_training": { use: "notAllowed" },
				"c2pa.ai_inference": { use: "notAllowed" },
				"c2pa.ai_training": { use: "notAllowed" },
				"c2pa.data_mining": { use: "notAllowed" },
			},
		},
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
 * @param {string} [a.authorName]         who made it
 * @param {string} [a.organization]       for whom
 * @param {string} [a.identityUrl]        where the creator's identity is published
 * @param {boolean} [a.trainingMiningOptOut=true] ask that it not be used to train or mine
 * @param {object} a.generator            { name, version } of this program
 * @returns {{ definition: object, ingredients: Array<{label, relationship, title, useInput: true}> }}
 */
export function buildAssetManifest({
	title,
	originClass,
	isAiGenerated = false,
	hasManifest = false,
	toolUsed = "",
	authorName = "",
	organization = "",
	identityUrl = "",
	trainingMiningOptOut = true,
	generator,
}) {
	const assertions = [];
	const ingredients = [];
	if (hasManifest) {
		// The file's own credentials stay as the parent; this manifest adds the
		// creator's signature on top rather than replacing them.
		ingredients.push({
			label: PARENT_LABEL,
			relationship: "parentOf",
			title,
			useInput: true,
		});
		assertions.push({
			label: "c2pa.actions.v2",
			data: {
				actions: [
					{
						action: "c2pa.opened",
						...softwareAgent(toolUsed),
						parameters: { ingredientIds: [PARENT_LABEL] },
					},
				],
			},
		});
	} else {
		const sourceType = isAiGenerated
			? sourceTypeUri("trainedAlgorithmicMedia")
			: sourceTypeUri(originClass);
		if (!sourceType)
			throw new Error(
				"Set the asset's origin class before signing: a new manifest has to say how the file was made.",
			);
		assertions.push({
			label: "c2pa.actions.v2",
			data: {
				actions: [
					{
						action: "c2pa.created",
						digitalSourceType: sourceType,
						...softwareAgent(toolUsed),
					},
				],
			},
		});
	}
	assertions.push(
		creativeWorkAssertion({ authorName, organization, identityUrl }),
	);
	if (trainingMiningOptOut) assertions.push(trainingMiningAssertion());
	return {
		definition: { claim_generator_info: [generator], title, assertions },
		ingredients,
	};
}

// Seconds each matched asset is present in a lane, from the composition
// intervals (so stacked or repeated uses of one asset are not double counted).
function presenceByAsset(composition) {
	const out = new Map();
	for (const lane of ["picture", "audio"]) {
		for (const iv of composition?.[lane]?.intervals || []) {
			const len = (iv.endSeconds ?? 0) - (iv.startSeconds ?? 0);
			const keys = new Set(
				(iv.layers || []).map((l) => l.matchedAssetRef).filter(Boolean),
			);
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
			const ref = l.matchedAssetRef ? refOf.get(l.matchedAssetRef) : undefined;
			if (ref) {
				if (!refs.includes(ref)) refs.push(ref);
			} else untracked++;
		}
		const entry = {
			start: seconds(iv.startSeconds),
			end: seconds(iv.endSeconds),
			positions: [...(iv.positions || [])],
			refs,
			...(untracked ? { untracked } : {}),
		};
		const prev = out[out.length - 1];
		if (
			prev &&
			prev.end === entry.start &&
			prev.positions.join() === entry.positions.join() &&
			prev.refs.join() === entry.refs.join() &&
			(prev.untracked || 0) === untracked
		) {
			prev.end = entry.end;
		} else {
			out.push(entry);
		}
	}
	return out;
}

function laneSummary(lane, refOf) {
	if (!lane) return null;
	const stat = (s) => ({
		seconds: seconds(s?.seconds),
		percent: percent(s?.percent ?? 0),
	});
	return {
		byPosition: Object.fromEntries(
			Object.entries(lane.byPosition || {}).map(([p, s]) => [p, stat(s)]),
		),
		mixed: {
			...stat(lane.mixed),
			combos: Object.fromEntries(
				Object.entries(lane.mixed?.combos || {}).map(([k, s]) => [k, stat(s)]),
			),
		},
		gap: stat(lane.gap),
		intervals: compactIntervals(lane, refOf),
	};
}

function trackName(seg) {
	return `${seg.trackKind === "audio" ? "A" : "V"}${seg.trackIndex}`;
}

/**
 * The refs of the assets a timeline places, in order of first use, without
 * the output itself. `segments` are the effective segments timelines.js
 * returns; each names its asset by `matchedAssetRef` (core/asset-ref.ts).
 */
export function placedAssetRefs(segments, outputRef) {
	const keys = [];
	const seen = new Set();
	const ordered = [...(segments || [])].sort(
		(a, b) =>
			a.startFrame - b.startFrame || (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
	);
	for (const s of ordered) {
		if (!s.enabled || !s.matchedAssetRef) continue;
		const k = s.matchedAssetRef;
		if (k === outputRef || seen.has(k)) continue;
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
 * @param {object} a.output        { ref, filePath, originClass }
 * @param {object} a.timeline      { sequenceName, fps, durationFrames }
 * @param {object} a.composition   breakdown.composition
 * @param {Array}  a.segments      effective segments
 * @param {Map}    a.assets        asset ref -> asset (filePath, originClass, originClassConfirmed,
 *                                 originClassSource, originClassNote, aiAssisted, signedBy,
 *                                 signerName, c2paSummary)
 * @param {object} a.statement     { text, authorName, organization, softwareAgent }
 * @param {string} a.statedAt      ISO time the statement is signed
 */
export function buildCreatorStatement({
	output,
	timeline,
	composition,
	segments,
	assets,
	statement = {},
	statedAt,
}) {
	const presence = presenceByAsset(composition);
	const outputClass = outputClassOf(output, composition);
	const placed = placedAssetRefs(segments, requireRef(output));
	const refOf = new Map(placed.map((k, i) => [k, ingredientLabel(i)]));
	const ingredients = placed.map((k, i) => {
		const a = assets.get(k) || {};
		const claimed = classClaimedByFile(a.c2paSummary);
		const on = presence.get(k) || { picture: 0, audio: 0 };
		return {
			ref: ingredientLabel(i),
			title: fileNameOf(a.filePath),
			publicTitle: cleanPublicTitle(a.publicTitle),
			originClass: a.originClass || "unknown",
			digitalSourceType: sourceTypeUri(a.originClass),
			position: spectrumPosition(a.originClass, { aiAssisted: !!a.aiAssisted }),
			classSetBy: a.originClassConfirmed ? "creator" : "proposal",
			fileCredentials: claimed.credentials,
			classClaimedByFile: claimed.originClass,
			// A name from credentials that did not verify is the catalog's to
			// know, not the statement's to repeat (D67).
			signedBy: a.signedBy === UNVERIFIED_SIGNER ? "" : a.signedBy || "",
			signerName: a.signedBy === UNVERIFIED_SIGNER ? "" : a.signerName || "",
			aiAssisted: !!a.aiAssisted,
			note: a.originClassNote || "",
			pictureSeconds: seconds(on.picture),
			audioSeconds: seconds(on.audio),
		};
	});
	const unresolved = [];
	let generated = 0;
	for (const s of segments || []) {
		if (!s.enabled) continue;
		if (s.sourceKind === "generator") {
			generated++;
			continue;
		}
		if (s.matchedAssetRef) continue;
		unresolved.push({
			clip: s.clipName || s.name || s.sourceName || "",
			track: trackName(s),
			startSeconds: seconds(
				s.startSeconds ?? (timeline?.fps ? s.startFrame / timeline.fps : null),
			),
			endSeconds: seconds(
				s.endSeconds ?? (timeline?.fps ? s.endFrame / timeline.fps : null),
			),
			reason:
				s.sourceKind === "sequence" ? "nested sequence" : "no tracked asset",
			originClass: s.originClass || "unknown",
			position: spectrumPosition(s.originClass || "unknown", {
				aiAssisted: !!s.aiAssisted,
			}),
		});
	}
	return {
		version: STATEMENT_VERSION,
		statedAt,
		text: String(statement.text || "").trim(),
		author: statement.authorName || "",
		organization: statement.organization || "",
		editedWith: statement.softwareAgent || "",
		output: {
			title: fileNameOf(output.filePath),
			publicTitle: cleanPublicTitle(output.publicTitle),
			originClass: outputClass,
			digitalSourceType: sourceTypeUri(outputClass),
			sequence: timeline?.sequenceName || "",
			durationSeconds: seconds(composition?.durationSeconds),
			fps: round(timeline?.fps ?? composition?.fps, 3),
		},
		composition: {
			picture: laneSummary(composition?.picture, refOf),
			audio: laneSummary(composition?.audio, refOf),
		},
		ingredients,
		unresolved,
		editorGeneratedClips: generated,
	};
}

// The output's class: the user's if confirmed, else what the composition says.
export function outputClassOf(output, composition) {
	if (
		output.originClassConfirmed &&
		output.originClass &&
		output.originClass !== "unknown"
	)
		return output.originClass;
	return compositeClassFor(positionsIn(composition));
}

/**
 * Where each placed asset plays in the finished edit, in the edit's own
 * seconds: per asset ref, one entry per placement [start, end), in time
 * order (D17, D52). Every clip is a placement, so every cut stays visible: a
 * take cut into pieces that follow each other is one placement per piece, and
 * a picture and its sound offset from each other (a J- or L-cut) are two.
 * Only identical copies are dropped, the same asset over the same range, such
 * as a clip's picture with its linked sound or a stereo pair, since a reader
 * could not tell them apart. Disabled clips and the output itself are left
 * out. Without a frame rate the times are unknown, so the list is empty for
 * that asset.
 */
export function placementsOf(segments, outputRef, fps) {
	const out = new Map();
	const seen = new Set();
	for (const s of segments || []) {
		if (!s.enabled || !s.matchedAssetRef || s.matchedAssetRef === outputRef)
			continue;
		const list = out.get(s.matchedAssetRef) ?? [];
		out.set(s.matchedAssetRef, list);
		const start = seconds(s.startSeconds ?? (fps ? s.startFrame / fps : null));
		const end = seconds(s.endSeconds ?? (fps ? s.endFrame / fps : null));
		if (start === null || end === null || !(end > start)) continue;
		// Compared as written, to the millisecond: equal there means the same action.
		const key = JSON.stringify([s.matchedAssetRef, start, end]);
		if (seen.has(key)) continue;
		seen.add(key);
		list.push({ start, end });
	}
	for (const list of out.values())
		list.sort((a, b) => a.start - b.start || a.end - b.end);
	return out;
}

// A temporal region of interest (C2PA 2.4, 18.15.4.6): normal play time in
// seconds, start inclusive, end exclusive.
function temporalChange({ start, end }) {
	return {
		region: [
			{
				type: "temporal",
				time: { type: "npt", start: String(start), end: String(end) },
			},
		],
	};
}

// The claim thumbnail formats c2patool and the library both embed.
const THUMBNAIL_EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png" };

/**
 * A thumbnail image's format from its first bytes: "image/jpeg",
 * "image/png", or null for anything else. Pure: the caller reads the bytes.
 */
export function thumbnailFormatOf(bytes) {
	const b = bytes || [];
	if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
	const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	if (png.every((x, i) => b[i] === x)) return "image/png";
	return null;
}

/**
 * The claim thumbnail's resource name: the image's SHA-256 and extension, so
 * the stored definition says which bytes went in without naming a path.
 */
export function thumbnailIdentifier({ sha256, format }) {
	const ext = THUMBNAIL_EXTENSIONS[format];
	if (!ext) throw new Error("A thumbnail is a JPEG or PNG image");
	if (!/^[0-9a-f]{64}$/.test(String(sha256 || "")))
		throw new Error("A thumbnail is named by its SHA-256");
	return `${sha256}.${ext}`;
}

/**
 * Manifest for signing a finished edit.
 *
 * `thumbnail` ({ sha256, format, filePath }) is the image the creator picked
 * to stand for the edit: it becomes the claim thumbnail, which verifiers show
 * (D17). The definition names it by hash; `resources` tells the signer which
 * file that name is.
 * @returns {{ definition: object, ingredients: Array<{label, relationship, title, filePath?, useInput?}>, resources: Array<{identifier, filePath}>, statement: object }}
 */
export function buildOutputManifest({
	output,
	timeline,
	composition,
	segments,
	assets,
	statement = {},
	statedAt,
	generator,
	// No default: a JS default would type it as null for TypeScript callers.
	thumbnail,
	trainingMiningOptOut = true,
}) {
	if (!output?.filePath) throw new Error("The output has no file to sign");
	if (!composition)
		throw new Error(
			"Import the timeline before signing: the statement is built from it",
		);
	const data = buildCreatorStatement({
		output,
		timeline,
		composition,
		segments,
		assets,
		statement,
		statedAt,
	});
	const keys = placedAssetRefs(segments, requireRef(output));

	const ingredients = [
		{
			label: PARENT_LABEL,
			relationship: "parentOf",
			title: data.output.title,
			useInput: true,
		},
	];
	const actions = [
		{
			action: "c2pa.opened",
			...(data.output.digitalSourceType
				? { digitalSourceType: data.output.digitalSourceType }
				: {}),
			...softwareAgent(statement.softwareAgent),
			parameters: { ingredientIds: [PARENT_LABEL] },
		},
	];
	// One placed action per placement of an ingredient, in time order, each
	// with its range (D17, D52). Every componentOf ingredient has at least one
	// (C2PA 2.4, 18.16.3), without a range if the times are unknown.
	const stretches = placementsOf(segments, requireRef(output), timeline?.fps);
	const placed = [];
	keys.forEach((k, i) => {
		const a = assets.get(k) || {};
		const label = ingredientLabel(i);
		ingredients.push({
			label,
			relationship: "componentOf",
			title: fileNameOf(a.filePath),
			filePath: a.filePath,
		});
		const dst = sourceTypeUri(a.originClass);
		const action = (range) => ({
			action: "c2pa.placed",
			...(dst ? { digitalSourceType: dst } : {}),
			parameters: { ingredientIds: [label] },
			...(range ? { changes: [temporalChange(range)] } : {}),
		});
		const ranges = stretches.get(k) ?? [];
		if (ranges.length === 0) placed.push({ order: [-1, i], act: action(null) });
		for (const r of ranges)
			placed.push({ order: [r.start, i], act: action(r) });
	});
	placed.sort((x, y) => x.order[0] - y.order[0] || x.order[1] - y.order[1]);
	actions.push(...placed.map((p) => p.act));

	const resources = [];
	let thumbnailRef = null;
	if (thumbnail) {
		const identifier = thumbnailIdentifier(thumbnail);
		if (!thumbnail.filePath) throw new Error("The thumbnail has no file");
		thumbnailRef = { format: thumbnail.format, identifier };
		resources.push({ identifier, filePath: thumbnail.filePath });
	}

	const assertions = [
		{ label: "c2pa.actions.v2", data: { actions } },
		{ label: STATEMENT_LABEL, data },
		creativeWorkAssertion({
			authorName: statement.authorName,
			organization: statement.organization,
			identityUrl: statement.identityUrl,
		}),
	];
	if (trainingMiningOptOut) assertions.push(trainingMiningAssertion());
	return {
		definition: {
			claim_generator_info: [generator],
			title: data.output.title,
			...(thumbnailRef ? { thumbnail: thumbnailRef } : {}),
			assertions,
		},
		ingredients,
		resources,
		statement: data,
	};
}

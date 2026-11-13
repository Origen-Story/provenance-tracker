// IO around the pure classifier: gather a row's stored signals, write the
// proposal back, and let the user confirm or override. A confirmed class is
// never overwritten by a proposal unless `force` is passed.
import { db } from '../../db/index.js';
import { assetMetadata } from '../../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { proposeOriginClass, parseJsonSafe, ORIGIN_CLASSES } from './classify.js';
import { originClassDef } from '../../../shared/origin-vocabulary.js';
import { tableFor, listRelationshipsFor, linkAssets } from '../relationships/relationships.js';
import { cleanPublicTitle } from '../manifest/build.js';
import { recomputeTimelinesForAsset } from '../timeline/timelines.js';

export { ORIGIN_CLASSES };

async function getRow(type, id) {
	const table = tableFor(type);
	const [row] = await db.select().from(table).where(eq(table.id, id)).limit(1);
	return row || null;
}

// Signals the classifier needs, read from where each table keeps them: the
// produced and archival tables hold exif/c2pa JSON columns; AI assets keep
// their blobs in asset_metadata.
export async function collectSignals(type, row) {
	let c2paSummary = null;
	let exifTags = {};
	let platformData = null;
	if (type === 'ai') {
		const blobs = await db.select().from(assetMetadata).where(eq(assetMetadata.assetId, row.id));
		for (const b of blobs) {
			if (b.metadataType === 'c2pa') c2paSummary = parseJsonSafe(b.rawJson);
			else if (b.metadataType === 'exif') exifTags = parseJsonSafe(b.rawJson, {}) || {};
			else if (b.metadataType === 'platform') platformData = parseJsonSafe(b.rawJson);
		}
	} else {
		c2paSummary = parseJsonSafe(row.c2paJson);
		exifTags = parseJsonSafe(row.exifJson, {}) || {};
	}
	const rels = await listRelationshipsFor(type, row.id);
	const parent = rels.parents.find(r => r.relationshipType === 'derived_from');
	return {
		c2paSummary,
		exifTags,
		platform: row.platform || '',
		platformData,
		parentClass: parent?.asset?.originClass || null,
		parentRef: parent?.asset || null
	};
}

export async function proposeForAsset(type, id) {
	const row = await getRow(type, id);
	if (!row) throw new Error('Asset not found');
	const signals = await collectSignals(type, row);
	const proposal = proposeOriginClass({ table: type, ...signals });
	return { row, proposal, signals };
}

/**
 * Write the classifier's proposal to the row. Skipped when the user has
 * confirmed a class, unless force is set.
 */
export async function applyProposal(type, id, { force = false } = {}) {
	const { row, proposal } = await proposeForAsset(type, id);
	const table = tableFor(type);
	if (row.originClassConfirmed && !force) {
		// The class is the user's. Who signed the file is not theirs to decide,
		// so that part is kept current.
		if ((row.signedBy || '') === proposal.signedBy && (row.signerName || '') === proposal.signerName) return { row, proposal, applied: false };
		const signer = { signedBy: proposal.signedBy, signerName: proposal.signerName };
		if (type === 'produced') signer.captureSigned = proposal.captureSigned;
		const [kept] = await db.update(table).set(signer).where(eq(table.id, id)).returning();
		return { row: kept, proposal, applied: false };
	}
	const patch = {
		originClass: proposal.originClass,
		originClassSource: proposal.source,
		originClassConfirmed: false,
		originClassNote: '',
		aiAssisted: false,
		signedBy: proposal.signedBy,
		signerName: proposal.signerName,
		updatedAt: sql`now()`
	};
	if (type === 'produced') patch.captureSigned = proposal.captureSigned;
	const [updated] = await db.update(table).set(patch).where(eq(table.id, id)).returning();
	if (row.originClass !== proposal.originClass || !!row.aiAssisted) await recomputeTimelinesForAsset(type, id);
	return { row: updated, proposal, applied: true };
}

// Re-propose every unconfirmed child that derives from this asset, so a
// modifier output follows its parent when the parent's class changes.
async function reproposeDerivedChildren(type, id) {
	const rels = await listRelationshipsFor(type, id);
	for (const rel of rels.children) {
		if (rel.relationshipType !== 'derived_from' || !rel.asset) continue;
		await applyProposal(rel.asset.type, rel.asset.id);
	}
}

export async function setOriginClass(type, id, { originClass, confirmed = true, ingredientClasses, note, aiAssisted } = {}) {
	if (!ORIGIN_CLASSES.includes(originClass)) throw new Error(`Unknown origin class: ${originClass}`);
	if (ingredientClasses !== undefined) {
		if (!Array.isArray(ingredientClasses) || ingredientClasses.some(c => !ORIGIN_CLASSES.includes(c))) {
			throw new Error('ingredientClasses must be an array of origin classes');
		}
	}
	const table = tableFor(type);
	const patch = {
		originClass,
		originClassConfirmed: !!confirmed,
		originClassSource: 'user',
		updatedAt: sql`now()`
	};
	if (ingredientClasses !== undefined) patch.originIngredientClasses = JSON.stringify(ingredientClasses);
	if (note !== undefined) patch.originClassNote = String(note || '').trim().slice(0, 2000);
	// The flag only means something for digital work with no AI in its pixels
	// (see spectrumPosition); it is cleared for any other class.
	if (aiAssisted !== undefined || originClassDef(originClass).position !== 'digital') {
		patch.aiAssisted = !!aiAssisted && originClassDef(originClass).position === 'digital';
	}
	const [updated] = await db.update(table).set(patch).where(eq(table.id, id)).returning();
	if (!updated) throw new Error('Asset not found');
	await reproposeDerivedChildren(type, id);
	// Screen-time breakdowns that count this asset change with its class.
	await recomputeTimelinesForAsset(type, id);
	return updated;
}

// The name the public viewer shows for this asset. It goes into the creator
// statement when an output is signed, so set it before signing.
export async function setPublicTitle(type, id, title) {
	const table = tableFor(type);
	const [updated] = await db.update(table)
		.set({ publicTitle: cleanPublicTitle(title), updatedAt: sql`now()` })
		.where(eq(table.id, id)).returning();
	if (!updated) throw new Error('Asset not found');
	return updated;
}

// Link two assets and, when the child is unconfirmed, re-run its proposal so
// a modifier picks up the parent's class straight away.
export async function linkWithRepropose(args) {
	const rel = await linkAssets(args);
	await applyProposal(args.childType, args.childId);
	return rel;
}

// Re-run proposals for every row in a project. Used after the classifier
// learns a new rule, and once for rows imported before it existed. A confirmed
// class is left alone; only who signed the file is refreshed on those rows.
export async function reproposeProject(projectId) {
	const counts = {};
	for (const type of ['ai', 'archival', 'produced']) {
		const table = tableFor(type);
		const rows = await db.select({ id: table.id }).from(table).where(eq(table.projectId, projectId));
		let changed = 0;
		for (const r of rows) {
			const { applied } = await applyProposal(type, r.id);
			if (applied) changed++;
		}
		counts[type] = { examined: rows.length, updated: changed };
	}
	return counts;
}

// IO for asset_relationships: links between any two assets across the three
// asset tables (decision D4). Pure name matching lives in auto-link.js.
import path from 'path';
import { db } from '../../db/index.js';
import { assets, archivalAssets, producedAssets, assetRelationships } from '../../db/schema.js';
import { eq, and, or, sql } from 'drizzle-orm';
import { topazSourceBasename, findSourceCandidates } from './auto-link.js';

export const ASSET_TYPES = ['ai', 'archival', 'produced'];
export const RELATIONSHIP_TYPES = ['ingredient', 'derived_from', 'output_of'];

const TABLES = { ai: assets, archival: archivalAssets, produced: producedAssets };

export function tableFor(type) {
	const table = TABLES[type];
	if (!table) throw new Error(`Unknown asset type: ${type}`);
	return table;
}

function toRef(type, row) {
	const filename = row.filename || path.basename(row.filePath || '');
	const label = type === 'ai' ? (row.assetId || filename) : (row.name || filename);
	return {
		type,
		id: row.id,
		label,
		filename,
		filePath: row.filePath,
		mimeType: row.mimeType || '',
		originClass: row.originClass || 'unknown',
		originClassConfirmed: !!row.originClassConfirmed
	};
}

export async function resolveAssetRef(type, id) {
	const table = tableFor(type);
	const [row] = await db.select().from(table).where(eq(table.id, id)).limit(1);
	return row ? toRef(type, row) : null;
}

export async function linkAssets({ parentType, parentId, childType, childId, relationshipType = 'ingredient', matchMethod = 'manual', confidence = 1, notes = '' }) {
	tableFor(parentType);
	tableFor(childType);
	if (!RELATIONSHIP_TYPES.includes(relationshipType)) throw new Error(`Unknown relationship type: ${relationshipType}`);
	if (parentType === childType && Number(parentId) === Number(childId)) throw new Error('An asset cannot be linked to itself');

	const where = and(
		eq(assetRelationships.parentAssetType, parentType),
		eq(assetRelationships.parentAssetId, parentId),
		eq(assetRelationships.childAssetType, childType),
		eq(assetRelationships.childAssetId, childId),
		eq(assetRelationships.relationshipType, relationshipType)
	);
	const [existing] = await db.select().from(assetRelationships).where(where).limit(1);
	if (existing) return existing;

	const [row] = await db.insert(assetRelationships).values({
		parentAssetType: parentType, parentAssetId: parentId,
		childAssetType: childType, childAssetId: childId,
		relationshipType, matchMethod, confidence, notes
	}).returning();
	return row;
}

export async function getRelationship(id) {
	const [row] = await db.select().from(assetRelationships).where(eq(assetRelationships.id, id)).limit(1);
	return row || null;
}

export async function unlinkRelationship(id) {
	await db.delete(assetRelationships).where(eq(assetRelationships.id, id));
}

// Every link touching one asset, with the other side resolved to a reference.
export async function listRelationshipsFor(type, id) {
	tableFor(type);
	const rows = await db.select().from(assetRelationships).where(or(
		and(eq(assetRelationships.parentAssetType, type), eq(assetRelationships.parentAssetId, id)),
		and(eq(assetRelationships.childAssetType, type), eq(assetRelationships.childAssetId, id))
	));
	const parents = [];
	const children = [];
	for (const rel of rows) {
		const isChild = rel.childAssetType === type && rel.childAssetId === id;
		if (isChild) {
			const asset = await resolveAssetRef(rel.parentAssetType, rel.parentAssetId);
			parents.push({ ...rel, asset });
		} else {
			const asset = await resolveAssetRef(rel.childAssetType, rel.childAssetId);
			children.push({ ...rel, asset });
		}
	}
	return { parents, children };
}

// Called by each table's delete function, since there are no foreign keys.
export async function removeRelationshipsFor(type, id) {
	await db.delete(assetRelationships).where(or(
		and(eq(assetRelationships.parentAssetType, type), eq(assetRelationships.parentAssetId, id)),
		and(eq(assetRelationships.childAssetType, type), eq(assetRelationships.childAssetId, id))
	));
}

// Filenames of every asset in a project, for name-based matching.
export async function buildFilenameIndex(projectId) {
	const [ai, arch, prod] = await Promise.all([
		db.select({ id: assets.id, filePath: assets.filePath }).from(assets).where(eq(assets.projectId, projectId)),
		db.select({ id: archivalAssets.id, filename: archivalAssets.filename, filePath: archivalAssets.filePath }).from(archivalAssets).where(eq(archivalAssets.projectId, projectId)),
		db.select({ id: producedAssets.id, filename: producedAssets.filename, filePath: producedAssets.filePath }).from(producedAssets).where(eq(producedAssets.projectId, projectId))
	]);
	const entry = (type, r) => ({ type, id: r.id, filename: r.filename || path.basename(r.filePath || '') });
	return [...ai.map(r => entry('ai', r)), ...arch.map(r => entry('archival', r)), ...prod.map(r => entry('produced', r))];
}

// Name search across the three tables, for the "set parent" picker.
export async function searchAssets(projectId, q, limit = 20) {
	const term = `%${String(q || '').trim()}%`;
	const [ai, arch, prod] = await Promise.all([
		db.select().from(assets).where(and(eq(assets.projectId, projectId), sql`(${assets.assetId} ILIKE ${term} OR ${assets.filePath} ILIKE ${term} OR ${assets.description} ILIKE ${term})`)).limit(limit),
		db.select().from(archivalAssets).where(and(eq(archivalAssets.projectId, projectId), sql`(${archivalAssets.name} ILIKE ${term} OR ${archivalAssets.filename} ILIKE ${term})`)).limit(limit),
		db.select().from(producedAssets).where(and(eq(producedAssets.projectId, projectId), sql`(${producedAssets.name} ILIKE ${term} OR ${producedAssets.filename} ILIKE ${term})`)).limit(limit)
	]);
	return [...ai.map(r => toRef('ai', r)), ...arch.map(r => toRef('archival', r)), ...prod.map(r => toRef('produced', r))].slice(0, limit);
}

/**
 * For an enhancer output (Topaz Video AI, Gigapixel), look for its source by
 * filename among the project's assets. One hit links it as derived_from with
 * confidence 0.7; several hits are returned for the user to choose from.
 */
export async function autoLinkEnhancer({ type, id, filename, projectId }) {
	const stem = topazSourceBasename(filename);
	if (!stem) return { linked: null, parent: null, suggestedParents: [] };
	const index = await buildFilenameIndex(projectId);
	const candidates = findSourceCandidates(stem, index, { type, id });
	if (candidates.length === 1) {
		const [c] = candidates;
		const linked = await linkAssets({
			parentType: c.type, parentId: c.id, childType: type, childId: id,
			relationshipType: 'derived_from', matchMethod: 'filename_pattern', confidence: 0.7,
			notes: `source stem "${stem}" matched ${c.filename}`
		});
		return { linked, parent: await resolveAssetRef(c.type, c.id), suggestedParents: [] };
	}
	return { linked: null, parent: null, suggestedParents: candidates };
}

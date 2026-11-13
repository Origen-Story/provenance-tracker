import { db } from '../../db/index.js';
import { archivalAssets } from '../../db/schema.js';
import { eq, desc, asc, sql, count, and, ilike } from 'drizzle-orm';
import { ARCHIVAL_ENRICHMENT_CONDITION, getArchivalMissingFields } from '../dashboard.js';
import { applyProposal } from '../origin/origin.js';
import { removeRelationshipsFor } from '../relationships/relationships.js';

export async function listArchivalAssets(projectId, {
	search = '', medium = '', enrichment = '', searchGroupId = '', sortBy = 'createdAt', sortDir = 'desc', limit = 100, offset = 0
} = {}) {
	const conditions = [eq(archivalAssets.projectId, projectId)];
	if (enrichment === 'incomplete') conditions.push(ARCHIVAL_ENRICHMENT_CONDITION);

	if (search) {
		conditions.push(
			sql`(${archivalAssets.name} ILIKE ${`%${search}%`} OR ${archivalAssets.creator} ILIKE ${`%${search}%`} OR ${archivalAssets.institution} ILIKE ${`%${search}%`} OR ${archivalAssets.caption} ILIKE ${`%${search}%`})`
		);
	}
	if (medium) conditions.push(eq(archivalAssets.medium, medium));
	if (searchGroupId) conditions.push(eq(archivalAssets.searchGroupId, searchGroupId));

	const sortCols = {
		createdAt: archivalAssets.createdAt,
		name: archivalAssets.name,
		accessDate: archivalAssets.accessDate,
		medium: archivalAssets.medium
	};
	const col = sortCols[sortBy] ?? archivalAssets.createdAt;
	const dir = sortDir === 'asc' ? asc : desc;

	const rows = await db.select().from(archivalAssets)
		.where(and(...conditions))
		.orderBy(dir(col))
		.limit(limit)
		.offset(offset);

	const [{ total }] = await db.select({ total: count() })
		.from(archivalAssets)
		.where(and(...conditions));

	const enrichedRows = rows.map(r => ({ ...r, missingFields: getArchivalMissingFields(r) }));
	return { assets: enrichedRows, total };
}

export async function getArchivalAsset(id) {
	const [row] = await db.select().from(archivalAssets).where(eq(archivalAssets.id, id)).limit(1);
	return row || null;
}

export async function createArchivalAsset(projectId, data) {
	const [row] = await db.insert(archivalAssets).values({
		projectId,
		name: data.name || '',
		filename: data.filename || '',
		filePath: data.filePath,
		inPlace: !!data.inPlace,
		fileHash: data.fileHash || '',
		fileSize: data.fileSize || 0,
		mimeType: data.mimeType || '',
		sourceUrl: data.sourceUrl || '',
		imageUrl: data.imageUrl || '',
		accessDate: data.accessDate || new Date().toISOString().slice(0, 10),
		creator: data.creator || '',
		institution: data.institution || '',
		license: data.license || '',
		licenseUrl: data.licenseUrl || '',
		caption: data.caption || '',
		originalDate: data.originalDate || '',
		medium: data.medium || 'photograph',
		usageNotes: data.usageNotes || '',
		exifJson: data.exifJson || '{}',
		c2paJson: data.c2paJson || null,
		notionImageStrategy: data.notionImageStrategy || 'external_url',
		searchGroupId: data.searchGroupId || '',
		searchGroupName: data.searchGroupName || ''
	}).returning();
	const { row: classified } = await applyProposal('archival', row.id);
	return classified || row;
}

export async function updateArchivalAsset(id, updates) {
	await db.update(archivalAssets)
		.set({ ...updates, updatedAt: sql`now()` })
		.where(eq(archivalAssets.id, id));
	return getArchivalAsset(id);
}

export async function deleteArchivalAsset(id) {
	await removeRelationshipsFor('archival', id);
	await db.delete(archivalAssets).where(eq(archivalAssets.id, id));
}

export async function markNotionSynced(id, notionPageId) {
	await db.update(archivalAssets)
		.set({ notionPageId, notionSyncedAt: sql`now()`, updatedAt: sql`now()` })
		.where(eq(archivalAssets.id, id));
}

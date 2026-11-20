import { db } from '../../db/index.js';
import { producedAssets } from '../../db/schema.js';
import { eq, desc, asc, sql, count, and } from 'drizzle-orm';
import { PRODUCED_ENRICHMENT_CONDITION, getProducedMissingFields } from '../dashboard.js';
import { probeVideoTags } from '../extraction/video-probe.js';
import { parseJsonSafe } from '../origin/classify.js';
import { applyProposal } from '../origin/origin.js';
import { removeRelationshipsFor } from '../relationships/relationships.js';

export async function listProducedAssets(projectId, {
	search = '', assetType = '', enrichment = '', outputs = '', sortBy = 'createdAt', sortDir = 'desc', limit = 100, offset = 0
} = {}) {
	const conditions = [eq(producedAssets.projectId, projectId)];
	if (enrichment === 'incomplete') conditions.push(PRODUCED_ENRICHMENT_CONDITION);
	// outputs: 'only' lists finished edits, 'exclude' lists source material.
	if (outputs === 'only') conditions.push(eq(producedAssets.isOutput, true));
	else if (outputs === 'exclude') conditions.push(eq(producedAssets.isOutput, false));

	if (search) {
		conditions.push(
			sql`(${producedAssets.name} ILIKE ${`%${search}%`} OR ${producedAssets.description} ILIKE ${`%${search}%`} OR ${producedAssets.creator} ILIKE ${`%${search}%`})`
		);
	}
	if (assetType) conditions.push(eq(producedAssets.assetType, assetType));

	const sortCols = {
		createdAt: producedAssets.createdAt,
		name: producedAssets.name,
		recordingDate: producedAssets.recordingDate,
		assetType: producedAssets.assetType
	};
	const col = sortCols[sortBy] ?? producedAssets.createdAt;
	const dir = sortDir === 'asc' ? asc : desc;

	const [rows, [{ total }]] = await Promise.all([
		db.select().from(producedAssets).where(and(...conditions)).orderBy(dir(col)).limit(limit).offset(offset),
		db.select({ total: count() }).from(producedAssets).where(and(...conditions))
	]);

	const enrichedRows = rows.map(r => ({ ...r, missingFields: getProducedMissingFields(r) }));
	return { assets: enrichedRows, total: Number(total) };
}

export async function getProducedAsset(id) {
	const [row] = await db.select().from(producedAssets).where(eq(producedAssets.id, id)).limit(1);
	return row || null;
}

export async function createProducedAsset(projectId, data) {
	// Technical fields: take what the caller sends, else derive them from the
	// stored exif summary so older import clients still get them.
	const mime = data.mimeType || '';
	const probe = (mime.startsWith('video/') || mime.startsWith('audio/')) ? probeVideoTags(parseJsonSafe(data.exifJson, {})) : null;
	const [row] = await db.insert(producedAssets).values({
		durationSeconds: data.durationSeconds ?? probe?.durationSeconds ?? null,
		frameRate: data.frameRate ?? probe?.frameRate ?? null,
		width: data.width ?? probe?.width ?? 0,
		height: data.height ?? probe?.height ?? 0,
		container: data.container ?? probe?.container ?? '',
		videoCodec: data.videoCodec ?? probe?.videoCodec ?? '',
		audioCodec: data.audioCodec ?? probe?.audioCodec ?? '',
		projectId,
		name: data.name || '',
		filename: data.filename || '',
		filePath: data.filePath,
		inPlace: !!data.inPlace,
		fileHash: data.fileHash || '',
		fileSize: data.fileSize || 0,
		mimeType: data.mimeType || '',
		assetType: data.assetType || 'audio',
		description: data.description || '',
		creator: data.creator || '',
		recordingDate: data.recordingDate || '',
		location: data.location || '',
		equipment: data.equipment || '',
		usageNotes: data.usageNotes || '',
		exifJson: data.exifJson || '{}',
		c2paJson: data.c2paJson || null
	}).returning();
	// Propose an origin class from the stored signals (D3). Unconfirmed until
	// the user says so.
	const { row: classified, proposal } = await applyProposal('produced', row.id);
	// A file whose credentials list ingredients is a finished edit (D10).
	if (proposal?.source === 'c2pa_ingredients') return markOutput(row.id, 'c2pa_ingredients');
	return classified || row;
}

// Flag a produced asset as a finished edit (or clear the flag). A flag set by
// the system never downgrades one the user set.
export async function markOutput(id, source = 'user', isOutput = true) {
	const row = await getProducedAsset(id);
	if (!row) throw new Error('Asset not found');
	if (isOutput && row.isOutput && row.outputSource === 'user') return row;
	const [updated] = await db.update(producedAssets).set({ isOutput: !!isOutput, outputSource: isOutput ? source : '', updatedAt: sql`now()` }).where(eq(producedAssets.id, id)).returning();
	return updated;
}

export async function updateProducedAsset(id, updates) {
	const allowed = ['name', 'description', 'creator', 'recordingDate', 'location', 'equipment', 'usageNotes', 'assetType'];
	const filtered = {};
	for (const key of allowed) {
		if (updates[key] !== undefined) filtered[key] = updates[key];
	}
	if (Object.keys(filtered).length) {
		await db.update(producedAssets).set({ ...filtered, updatedAt: sql`now()` }).where(eq(producedAssets.id, id));
	}
	return getProducedAsset(id);
}

export async function deleteProducedAsset(id) {
	await removeRelationshipsFor('produced', id);
	await db.delete(producedAssets).where(eq(producedAssets.id, id));
}

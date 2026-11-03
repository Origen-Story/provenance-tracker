import path from 'path';
import { db } from '../../db/index.js';
import { assets, generationParams, assetMetadata, projects } from '../../db/schema.js';
import { eq, desc, asc, sql, count, and, ilike } from 'drizzle-orm';
import { getAIMissingFields } from '../dashboard.js';
import { detectAndParse } from '../extraction/ai-extraction.js';
import { applyProposal } from '../origin/origin.js';
import { removeRelationshipsFor, autoLinkEnhancer } from '../relationships/relationships.js';
import { createLogger } from '../logger.js';

const log = createLogger('assets');

/**
 * Generate next asset ID for a project, e.g. "GAIA-007"
 */
async function nextAssetId(projectId) {
	const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
	const prefix = project?.assetIdPrefix || 'ASSET';
	const [{ value }] = await db
		.select({ value: count() })
		.from(assets)
		.where(eq(assets.projectId, projectId));
	const num = String(Number(value) + 1).padStart(3, '0');
	return `${prefix}-${num}`;
}

function empty(col) {
	return sql`(${col} IS NULL OR ${col} = '')`;
}

// Coverage below this on a recognized platform means the parser probably drifted.
// See docs/planned-features.md → "Drift fingerprint tracking" for the longer plan.
export const NOVELTY_COVERAGE_THRESHOLD = 60;

export async function listAssets(projectId, {
	search = '', assetType = '', platform = '', enrichment = '', novelty = '',
	sortBy = 'createdAt', sortDir = 'desc', limit = 100, offset = 0
} = {}) {
	const conditions = [eq(assets.projectId, projectId)];
	if (search) {
		conditions.push(
			sql`(${assets.assetId} ILIKE ${`%${search}%`} OR ${assets.description} ILIKE ${`%${search}%`} OR ${assets.notes} ILIKE ${`%${search}%`})`
		);
	}
	if (assetType) conditions.push(eq(assets.assetType, assetType));
	if (platform) conditions.push(eq(assets.platform, platform));
	if (novelty === 'novel') {
		conditions.push(sql`(${assets.platform} = 'unknown' OR (${assets.extractionCoverage} IS NOT NULL AND ${assets.extractionCoverage} < ${NOVELTY_COVERAGE_THRESHOLD}))`);
	} else if (novelty === 'unknown') {
		conditions.push(eq(assets.platform, 'unknown'));
	} else if (novelty === 'low-coverage') {
		conditions.push(sql`${assets.platform} <> 'unknown' AND ${assets.extractionCoverage} IS NOT NULL AND ${assets.extractionCoverage} < ${NOVELTY_COVERAGE_THRESHOLD}`);
	}

	// AI enrichment filter needs a join to check prompt
	const needsJoin = enrichment === 'incomplete';
	if (needsJoin) {
		conditions.push(sql`(${assets.platform} = 'unknown' OR ${empty(assets.generationDate)} OR ${empty(assets.digitalSourceType)} OR ${empty(generationParams.prompt)} OR ${assets.originClass} = 'unknown')`);
	}

	const sortCols = {
		createdAt: assets.createdAt,
		assetId: assets.assetId,
		platform: assets.platform,
		generationDate: assets.generationDate
	};
	const col = sortCols[sortBy] || assets.createdAt;
	const order = sortDir === 'asc' ? asc(col) : desc(col);

	let rowsQuery = db.select().from(assets);
	let countQuery = db.select({ value: count() }).from(assets);
	if (needsJoin) {
		rowsQuery = rowsQuery.leftJoin(generationParams, eq(generationParams.assetId, assets.id));
		countQuery = countQuery.leftJoin(generationParams, eq(generationParams.assetId, assets.id));
	}

	const [rawRows, [{ value: total }]] = await Promise.all([
		rowsQuery.where(and(...conditions)).orderBy(order).limit(limit).offset(offset),
		countQuery.where(and(...conditions))
	]);

	// When joined, drizzle nests as { assets: {...}, generation_params: {...} }
	const rows = needsJoin ? rawRows.map(r => r.assets) : rawRows;

	// Fetch generation params for all rows to compute missingFields
	const assetIds = rows.map(r => r.id);
	let gpMap = {};
	if (assetIds.length) {
		const gps = await db.select().from(generationParams).where(sql`${generationParams.assetId} IN (${sql.join(assetIds.map(id => sql`${id}`), sql`, `)})`);
		for (const gp of gps) gpMap[gp.assetId] = gp;
	}

	const enrichedRows = rows.map(r => ({ ...r, missingFields: getAIMissingFields(r, gpMap[r.id]) }));
	return { assets: enrichedRows, total: Number(total) };
}

export async function getAsset(id) {
	const [row] = await db.select().from(assets).where(eq(assets.id, id));
	if (!row) return null;

	const params = await db.select().from(generationParams).where(eq(generationParams.assetId, id));
	const metadata = await db.select().from(assetMetadata).where(eq(assetMetadata.assetId, id));

	return { ...row, generationParams: params[0] || null, metadata };
}

/**
 * Counts of assets by novelty category — unknown platform and low-coverage
 * known platform. Drives the dashboard "needs review" callout.
 */
export async function getNoveltyStats(projectId) {
	const threshold = NOVELTY_COVERAGE_THRESHOLD;
	const [row] = await db.select({
		total: count(),
		unknown: sql`count(*) filter (where ${assets.platform} = 'unknown')`.mapWith(Number),
		lowCoverage: sql`count(*) filter (where ${assets.platform} <> 'unknown' and ${assets.extractionCoverage} is not null and ${assets.extractionCoverage} < ${threshold})`.mapWith(Number)
	}).from(assets).where(eq(assets.projectId, projectId));
	return {
		total: Number(row.total),
		unknown: row.unknown,
		lowCoverage: row.lowCoverage,
		novel: row.unknown + row.lowCoverage,
		threshold
	};
}

export async function createAsset(projectId, data) {
	const assetId = await nextAssetId(projectId);

	const [row] = await db.insert(assets).values({
		projectId,
		assetId,
		description: data.description || '',
		filePath: data.filePath,
		fileHash: data.fileHash || '',
		fileSize: data.fileSize || 0,
		mimeType: data.mimeType || '',
		assetType: data.assetType || 'image',
		platform: data.platform || 'unknown',
		digitalSourceType: data.digitalSourceType || '',
		generationDate: data.generationDate || '',
		notes: data.notes || '',
		extractionCoverage: data.extractionCoverage ?? null
	}).returning();

	// Save generation params if provided
	if (data.generationParams) {
		const gp = data.generationParams;
		await db.insert(generationParams).values({
			assetId: row.id,
			prompt: gp.prompt || '',
			negativePrompt: gp.negativePrompt || '',
			modelName: gp.modelName || '',
			modelVersion: gp.modelVersion || '',
			seed: gp.seed || '',
			steps: gp.steps || 0,
			cfgScale: gp.cfgScale || '',
			sampler: gp.sampler || '',
			scheduler: gp.scheduler || '',
			width: gp.width || 0,
			height: gp.height || 0,
			aspectRatio: gp.aspectRatio || '',
			stylize: gp.stylize || '',
			loras: gp.loras || '[]',
			otherParams: gp.otherParams || '{}'
		});
	}

	// Save raw metadata blobs
	const metaInserts = [];
	if (data.exifJson) metaInserts.push({ assetId: row.id, metadataType: 'exif', rawJson: data.exifJson });
	if (data.c2paJson) metaInserts.push({ assetId: row.id, metadataType: 'c2pa', rawJson: data.c2paJson });
	if (data.pngChunksJson) metaInserts.push({ assetId: row.id, metadataType: 'png_chunks', rawJson: data.pngChunksJson });
	if (data.platformJson) metaInserts.push({ assetId: row.id, metadataType: 'platform', rawJson: data.platformJson });
	if (metaInserts.length) await db.insert(assetMetadata).values(metaInserts);

	// Enhancer outputs (Topaz) try to find their source by filename, then the
	// origin class is proposed with the parent known (D3, D4).
	const filename = path.basename(data.filePath || '');
	const link = await autoLinkEnhancer({ type: 'ai', id: row.id, filename, projectId }).catch(err => {
		log.warn(`auto-link skipped for ${filename}: ${err.message}`);
		return { linked: null, parent: null, suggestedParents: [] };
	});
	await applyProposal('ai', row.id);

	const created = await getAsset(row.id);
	return { ...created, autoLinkedParent: link.parent, suggestedParents: link.suggestedParents };
}

/**
 * Re-run platform detection + parsing against this asset's stored raw metadata.
 * Doesn't touch the file on disk — replays the current parser registry on the
 * EXIF/PNG-chunks blobs we captured at import time. Primary use: when a parser
 * gets updated (new platform added, existing parser fixed), existing assets can
 * benefit without re-importing.
 *
 * Updates: assets.platform, assets.extractionCoverage, and the `suggested*`
 * fields stored in generation_params. Also rewrites the `platform` metadata blob.
 */
export async function reExtractAsset(id) {
	const asset = await getAsset(id);
	if (!asset) throw new Error('Asset not found');

	const metaMap = {};
	for (const m of asset.metadata || []) {
		try { metaMap[m.metadataType] = JSON.parse(m.rawJson); } catch { /* corrupt blob — skip */ }
	}
	const exifTags = metaMap.exif || {};
	const chunks = metaMap.png_chunks || {};

	const { platform, coverage, data } = detectAndParse(exifTags, chunks);

	await db.update(assets)
		.set({ platform, extractionCoverage: coverage, updatedAt: sql`now()` })
		.where(eq(assets.id, id));

	// Update generation_params — but only overwrite fields the parser actually populated
	// so user-edited values aren't clobbered by an empty re-extract.
	const gpPatch = {};
	const mappings = {
		prompt: 'prompt', negativePrompt: 'negativePrompt', modelName: 'modelName',
		modelVersion: 'modelVersion', seed: 'seed', steps: 'steps', cfgScale: 'cfgScale',
		sampler: 'sampler', scheduler: 'scheduler', width: 'width', height: 'height',
		aspectRatio: 'aspectRatio', stylize: 'stylize'
	};
	for (const [src, dst] of Object.entries(mappings)) {
		const v = data[src];
		if (v !== undefined && v !== null && v !== '' && v !== 0) gpPatch[dst] = v;
	}
	if (Object.keys(gpPatch).length) {
		const [existing] = await db.select().from(generationParams).where(eq(generationParams.assetId, id));
		if (existing) {
			await db.update(generationParams).set(gpPatch).where(eq(generationParams.assetId, id));
		} else {
			await db.insert(generationParams).values({ assetId: id, ...gpPatch });
		}
	}

	// Replace the stored platform blob so downstream tooling sees the new parse output.
	const platformJson = JSON.stringify({ platform, ...data });
	const [existingBlob] = await db.select().from(assetMetadata)
		.where(and(eq(assetMetadata.assetId, id), eq(assetMetadata.metadataType, 'platform')));
	if (existingBlob) {
		await db.update(assetMetadata).set({ rawJson: platformJson, extractedAt: sql`now()` })
			.where(eq(assetMetadata.id, existingBlob.id));
	} else {
		await db.insert(assetMetadata).values({ assetId: id, metadataType: 'platform', rawJson: platformJson });
	}

	log.info(`re-extracted asset ${id}: platform=${platform}, coverage=${coverage}`);
	return getAsset(id);
}

export async function updateAsset(id, data) {
	const updates = {};
	const allowed = ['description', 'notes', 'digitalSourceType', 'generationDate', 'platform', 'assetType'];
	for (const key of allowed) {
		if (data[key] !== undefined) updates[key] = data[key];
	}
	if (Object.keys(updates).length) {
		await db.update(assets).set({ ...updates, updatedAt: sql`now()` }).where(eq(assets.id, id));
	}

	// Update generation params if provided
	if (data.generationParams) {
		const gp = data.generationParams;
		const existing = await db.select().from(generationParams).where(eq(generationParams.assetId, id));
		if (existing.length) {
			await db.update(generationParams).set({
				prompt: gp.prompt ?? existing[0].prompt,
				negativePrompt: gp.negativePrompt ?? existing[0].negativePrompt,
				modelName: gp.modelName ?? existing[0].modelName,
				modelVersion: gp.modelVersion ?? existing[0].modelVersion,
				seed: gp.seed ?? existing[0].seed,
				steps: gp.steps ?? existing[0].steps,
				cfgScale: gp.cfgScale ?? existing[0].cfgScale,
				sampler: gp.sampler ?? existing[0].sampler,
				scheduler: gp.scheduler ?? existing[0].scheduler,
				width: gp.width ?? existing[0].width,
				height: gp.height ?? existing[0].height,
				aspectRatio: gp.aspectRatio ?? existing[0].aspectRatio,
				stylize: gp.stylize ?? existing[0].stylize,
				loras: gp.loras ?? existing[0].loras,
				otherParams: gp.otherParams ?? existing[0].otherParams
			}).where(eq(generationParams.assetId, id));
		} else {
			await db.insert(generationParams).values({ assetId: id, ...gp });
		}
	}

	return getAsset(id);
}

export async function deleteAsset(id) {
	await removeRelationshipsFor('ai', id);
	await db.delete(assets).where(eq(assets.id, id));
}

// Called after a successful c2pa-sign run. Repoints filePath at the signed
// copy, refreshes hash/size/mime, stashes the unsigned original's path, and
// upserts the c2pa manifest blob in asset_metadata (where AI-asset C2PA
// summaries live; the assets table itself has no c2paJson column).
export async function applySignature(id, { signedPath, fileHash, fileSize, mimeType, c2paJson, originalFilePath }) {
	await db.update(assets).set({
		filePath: signedPath,
		fileHash,
		fileSize,
		mimeType,
		originalFilePath,
		updatedAt: sql`now()`
	}).where(eq(assets.id, id));

	const [existingBlob] = await db.select().from(assetMetadata)
		.where(and(eq(assetMetadata.assetId, id), eq(assetMetadata.metadataType, 'c2pa')));
	if (existingBlob) {
		await db.update(assetMetadata).set({ rawJson: c2paJson, extractedAt: sql`now()` }).where(eq(assetMetadata.id, existingBlob.id));
	} else {
		await db.insert(assetMetadata).values({ assetId: id, metadataType: 'c2pa', rawJson: c2paJson });
	}

	return getAsset(id);
}

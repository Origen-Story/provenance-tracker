import { db } from '../db/index.js';
import { assets, archivalAssets, producedAssets, generationParams } from '../db/schema.js';
import { eq, count, sql, and } from 'drizzle-orm';

/**
 * SQL conditions for "needs enrichment" per asset type.
 * Exported so list endpoints can filter by enrichment status.
 */
function empty(col) {
	return sql`(${col} IS NULL OR ${col} = '')`;
}

// Archival: caption, originalDate, institution, creator, license, medium, sourceUrl
export const ARCHIVAL_ENRICHMENT_CONDITION = sql`(
	${empty(archivalAssets.caption)} OR
	${empty(archivalAssets.originalDate)} OR
	${empty(archivalAssets.institution)} OR
	${empty(archivalAssets.creator)} OR
	${empty(archivalAssets.license)} OR
	${empty(archivalAssets.medium)} OR
	${empty(archivalAssets.sourceUrl)}
)`;

// AI: platform != unknown, generationDate, digitalSourceType, plus prompt checked via join
export const AI_ENRICHMENT_CONDITION = sql`(
	${assets.platform} = 'unknown' OR
	${empty(assets.generationDate)} OR
	${empty(assets.digitalSourceType)}
)`;

// Produced: name, description, assetType, recordingDate, creator, plus C2PA
// manifest. Missing Content Credentials is the v0.2 signing prompt — the row
// turns amber until it's signed.
export const PRODUCED_ENRICHMENT_CONDITION = sql`(
	${empty(producedAssets.name)} OR
	${empty(producedAssets.description)} OR
	${empty(producedAssets.assetType)} OR
	${empty(producedAssets.recordingDate)} OR
	${empty(producedAssets.creator)} OR
	${producedAssets.c2paJson} IS NULL
)`;

/**
 * Check enrichment completeness for a single asset (client-side friendly).
 * Returns list of missing field names.
 */
export function getArchivalMissingFields(asset) {
	const missing = [];
	if (!asset.caption) missing.push('caption');
	if (!asset.originalDate) missing.push('original date');
	if (!asset.institution) missing.push('institution');
	if (!asset.creator) missing.push('creator');
	if (!asset.license) missing.push('license');
	if (!asset.medium) missing.push('medium');
	if (!asset.sourceUrl) missing.push('source URL');
	return missing;
}

export function getAIMissingFields(asset, genParams) {
	const missing = [];
	if (!asset.platform || asset.platform === 'unknown') missing.push('platform');
	if (!asset.generationDate) missing.push('generation date');
	if (!asset.digitalSourceType) missing.push('digital source type');
	if (!genParams?.prompt) missing.push('prompt');
	// AI assets without an embedded C2PA manifest get flagged. Many platforms
	// don't emit one (ElevenLabs audio, hand-imported renders), so this nudges
	// the user to sign locally.
	const hasC2pa = (asset.metadata || []).some(m => m.metadataType === 'c2pa' && m.rawJson && m.rawJson !== '{}');
	if (!hasC2pa) missing.push('Content Credentials');
	return missing;
}

export function getProducedMissingFields(asset) {
	const missing = [];
	if (!asset.name) missing.push('name');
	if (!asset.description) missing.push('description');
	if (!asset.assetType) missing.push('asset type');
	if (!asset.recordingDate) missing.push('recording date');
	if (!asset.creator) missing.push('creator');
	if (!asset.c2paJson) missing.push('Content Credentials');
	return missing;
}

/**
 * Get dashboard statistics for a project.
 */
export async function getDashboardStats(projectId) {
	// Total counts per asset type
	const [[{ aiTotal }], [{ archivalTotal }], [{ producedTotal }]] = await Promise.all([
		db.select({ aiTotal: count() }).from(assets).where(eq(assets.projectId, projectId)),
		db.select({ archivalTotal: count() }).from(archivalAssets).where(eq(archivalAssets.projectId, projectId)),
		db.select({ producedTotal: count() }).from(producedAssets).where(eq(producedAssets.projectId, projectId))
	]);

	// Assets needing enrichment — use the shared conditions
	// AI also needs prompt check via generation_params join
	const [[{ aiNeedsEnrich }], [{ archNeedsEnrich }], [{ prodNeedsEnrich }]] = await Promise.all([
		db.select({ aiNeedsEnrich: count() }).from(assets)
			.leftJoin(generationParams, eq(generationParams.assetId, assets.id))
			.where(and(
				eq(assets.projectId, projectId),
				sql`(${assets.platform} = 'unknown' OR ${empty(assets.generationDate)} OR ${empty(assets.digitalSourceType)} OR ${empty(generationParams.prompt)})`
			)),
		db.select({ archNeedsEnrich: count() }).from(archivalAssets).where(
			and(eq(archivalAssets.projectId, projectId), ARCHIVAL_ENRICHMENT_CONDITION)
		),
		db.select({ prodNeedsEnrich: count() }).from(producedAssets).where(
			and(eq(producedAssets.projectId, projectId), PRODUCED_ENRICHMENT_CONDITION)
		)
	]);

	// Breakdown by asset subtype
	const [aiByType, aiByPlatform, archByMedium, prodByType] = await Promise.all([
		db.select({ type: assets.assetType, count: count() })
			.from(assets).where(eq(assets.projectId, projectId)).groupBy(assets.assetType),
		db.select({ platform: assets.platform, count: count() })
			.from(assets).where(eq(assets.projectId, projectId)).groupBy(assets.platform),
		db.select({ medium: archivalAssets.medium, count: count() })
			.from(archivalAssets).where(eq(archivalAssets.projectId, projectId)).groupBy(archivalAssets.medium),
		db.select({ type: producedAssets.assetType, count: count() })
			.from(producedAssets).where(eq(producedAssets.projectId, projectId)).groupBy(producedAssets.assetType)
	]);

	// Recent activity (last 5 of each type)
	const [recentAI, recentArch, recentProd] = await Promise.all([
		db.select({ id: assets.id, assetId: assets.assetId, description: assets.description, createdAt: assets.createdAt })
			.from(assets).where(eq(assets.projectId, projectId))
			.orderBy(sql`${assets.createdAt} DESC`).limit(5),
		db.select({ id: archivalAssets.id, name: archivalAssets.name, createdAt: archivalAssets.createdAt })
			.from(archivalAssets).where(eq(archivalAssets.projectId, projectId))
			.orderBy(sql`${archivalAssets.createdAt} DESC`).limit(5),
		db.select({ id: producedAssets.id, name: producedAssets.name, createdAt: producedAssets.createdAt })
			.from(producedAssets).where(eq(producedAssets.projectId, projectId))
			.orderBy(sql`${producedAssets.createdAt} DESC`).limit(5)
	]);

	return {
		counts: {
			ai: Number(aiTotal),
			archival: Number(archivalTotal),
			produced: Number(producedTotal),
			total: Number(aiTotal) + Number(archivalTotal) + Number(producedTotal)
		},
		needsEnrichment: {
			ai: Number(aiNeedsEnrich),
			archival: Number(archNeedsEnrich),
			produced: Number(prodNeedsEnrich),
			total: Number(aiNeedsEnrich) + Number(archNeedsEnrich) + Number(prodNeedsEnrich)
		},
		breakdowns: {
			aiByType: aiByType.map(r => ({ type: r.type, count: Number(r.count) })),
			aiByPlatform: aiByPlatform.map(r => ({ platform: r.platform, count: Number(r.count) })),
			archByMedium: archByMedium.map(r => ({ medium: r.medium, count: Number(r.count) })),
			prodByType: prodByType.map(r => ({ type: r.type, count: Number(r.count) }))
		},
		recent: [
			...recentAI.map(r => ({ ...r, type: 'ai', label: r.assetId || r.description || 'Untitled', link: `/assets/${r.id}` })),
			...recentArch.map(r => ({ ...r, type: 'archival', label: r.name || 'Untitled', link: `/archival/${r.id}` })),
			...recentProd.map(r => ({ ...r, type: 'produced', label: r.name || 'Untitled', link: `/produced/${r.id}` }))
		].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 10)
	};
}

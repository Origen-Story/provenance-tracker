/**
 * Archive search orchestration.
 * Coordinates Wikimedia API calls, dedup, DB writes, and approval flow.
 */

import { db } from '../../db/index.js';
import { searchCandidates, archivalAssets } from '../../db/schema.js';
import { eq, and, desc, asc, sql, count, inArray } from 'drizzle-orm';
import { searchFiles, getCategoryMembers, getImageInfo } from './wikimedia.js';
import { downloadAndExtract } from '../archival/extraction.js';
import { createArchivalAsset } from '../archival/archival.js';

// ---------------------------------------------------------------------------
// Execute search for a stop
// ---------------------------------------------------------------------------

export async function executeStopSearch(projectId, stopConfig) {
	const { stopId, stopName, keywords, categories } = stopConfig;

	// 1. Collect page titles from keyword searches (all languages)
	const allKeywords = [
		...(keywords.en || []),
		...(keywords.ca || []),
		...(keywords.es || [])
	];

	// Track which query found each title (first one wins)
	const titleSource = new Map(); // title → { type: 'keyword'|'category', query: string }
	let searchCount = 0;

	console.log(`[search] Starting search for "${stopName}" (${allKeywords.length} keywords, ${(categories || []).length} categories)`);

	for (const keyword of allKeywords) {
		const titles = await searchFiles(keyword, { maxResults: 200 });
		for (const t of titles) {
			if (!titleSource.has(t)) titleSource.set(t, { type: 'keyword', query: keyword });
		}
		searchCount++;
		console.log(`[search] Keyword ${searchCount}/${allKeywords.length}: "${keyword}" → ${titles.length} results (${titleSource.size} unique total)`);
	}

	// 2. Collect page titles from category crawls
	for (let i = 0; i < (categories || []).length; i++) {
		const cat = categories[i];
		console.log(`[search] Category ${i + 1}/${categories.length}: "${cat}" (crawling depth 2)...`);
		const titles = await getCategoryMembers(cat, { depth: 2, maxFiles: 2000 });
		for (const t of titles) {
			if (!titleSource.has(t)) titleSource.set(t, { type: 'category', query: cat.replace('Category:', '') });
		}
		console.log(`[search]   → ${titles.length} files found (${titleSource.size} unique total)`);
	}

	const uniqueTitles = [...titleSource.keys()];
	console.log(`[search] Fetching image info for ${uniqueTitles.length} unique titles...`);

	// 3. Fetch image info in batches
	const candidates = await getImageInfo(uniqueTitles);
	console.log(`[search] Got info for ${candidates.length} images`);

	// Attach source info to each candidate
	for (const c of candidates) {
		// Match by finding the title in our source map
		const pageTitle = `File:${c.title}`;
		const source = titleSource.get(pageTitle);
		if (source) {
			c.searchQuery = `[${source.type}] ${source.query}`;
		}
	}

	// 4. Filter out red-tier licenses
	const usable = candidates.filter(c => c.licenseTier !== 'red');
	const skippedLicense = candidates.length - usable.length;

	// 5. Dedup against existing search_candidates for this project
	const existingCandidates = await db.select({ sourcePageUrl: searchCandidates.sourcePageUrl })
		.from(searchCandidates)
		.where(eq(searchCandidates.projectId, projectId));
	const existingUrls = new Set(existingCandidates.map(r => r.sourcePageUrl));

	// 6. Dedup against archival_assets for this project
	const existingArchival = await db.select({ sourceUrl: archivalAssets.sourceUrl })
		.from(archivalAssets)
		.where(eq(archivalAssets.projectId, projectId));
	const archivalUrls = new Set(existingArchival.map(r => r.sourceUrl).filter(Boolean));

	const toInsert = [];
	let skippedDuplicate = 0;
	let skippedExisting = 0;

	for (const c of usable) {
		if (existingUrls.has(c.sourcePageUrl)) {
			skippedDuplicate++;
			continue;
		}
		if (archivalUrls.has(c.sourcePageUrl)) {
			skippedExisting++;
			continue;
		}
		existingUrls.add(c.sourcePageUrl); // prevent dups within this batch
		toInsert.push({
			projectId,
			stopId,
			stopName,
			source: 'wikimedia',
			...c,
			status: 'pending'
		});
	}

	// 7. Batch insert
	if (toInsert.length > 0) {
		for (let i = 0; i < toInsert.length; i += 100) {
			await db.insert(searchCandidates).values(toInsert.slice(i, i + 100));
		}
	}

	console.log(`[search] Done! Inserted ${toInsert.length}, skipped ${skippedLicense} (license), ${skippedDuplicate} (dup candidates), ${skippedExisting} (already in archive)`);

	return {
		totalSearched: uniqueTitles.length,
		totalWithInfo: candidates.length,
		skippedLicense,
		skippedDuplicate,
		skippedExisting,
		inserted: toInsert.length,
		searchesRun: searchCount,
		categoriesCrawled: (categories || []).length
	};
}

// ---------------------------------------------------------------------------
// List candidates
// ---------------------------------------------------------------------------

export async function listCandidates(projectId, {
	stopId = '', status = '', licenseTier = '', search = '', searchType = '',
	sortBy = 'createdAt', sortDir = 'desc', limit = 100, offset = 0
} = {}) {
	const conditions = [eq(searchCandidates.projectId, projectId)];

	if (stopId) conditions.push(eq(searchCandidates.stopId, stopId));
	if (status) conditions.push(eq(searchCandidates.status, status));
	if (licenseTier) conditions.push(eq(searchCandidates.licenseTier, licenseTier));
	if (searchType === 'keyword') {
		conditions.push(sql`${searchCandidates.searchQuery} LIKE '[keyword]%'`);
	} else if (searchType === 'category') {
		conditions.push(sql`${searchCandidates.searchQuery} LIKE '[category]%'`);
	}
	if (search) {
		conditions.push(
			sql`(${searchCandidates.title} ILIKE ${`%${search}%`} OR ${searchCandidates.description} ILIKE ${`%${search}%`} OR ${searchCandidates.author} ILIKE ${`%${search}%`})`
		);
	}

	const sortCols = {
		createdAt: searchCandidates.createdAt,
		title: searchCandidates.title,
		licenseTier: searchCandidates.licenseTier,
		originalDate: searchCandidates.originalDate
	};
	const col = sortCols[sortBy] ?? searchCandidates.createdAt;
	const dir = sortDir === 'asc' ? asc : desc;

	const [rows, [{ total }]] = await Promise.all([
		db.select().from(searchCandidates)
			.where(and(...conditions))
			.orderBy(dir(col))
			.limit(limit)
			.offset(offset),
		db.select({ total: count() }).from(searchCandidates)
			.where(and(...conditions))
	]);

	return { candidates: rows, total: Number(total) };
}

// ---------------------------------------------------------------------------
// Get single candidate
// ---------------------------------------------------------------------------

export async function getCandidate(id) {
	const [row] = await db.select().from(searchCandidates).where(eq(searchCandidates.id, id)).limit(1);
	return row || null;
}

// ---------------------------------------------------------------------------
// Status updates
// ---------------------------------------------------------------------------

export async function updateCandidateStatus(id, status, rejectionReason = '') {
	await db.update(searchCandidates)
		.set({ status, rejectionReason, updatedAt: sql`now()` })
		.where(eq(searchCandidates.id, id));
	return getCandidate(id);
}

export async function bulkUpdateStatus(ids, status, rejectionReason = '') {
	if (!ids.length) return 0;
	const result = await db.update(searchCandidates)
		.set({ status, rejectionReason, updatedAt: sql`now()` })
		.where(inArray(searchCandidates.id, ids));
	return ids.length;
}

// ---------------------------------------------------------------------------
// Approval flow (enqueue-only — actual download runs in queue.js worker)
// ---------------------------------------------------------------------------

/**
 * Enqueue a single candidate for background download.
 * Just flips status to 'processing' — the queue worker picks it up.
 */
export async function enqueueApproval(candidateId) {
	const candidate = await getCandidate(candidateId);
	if (!candidate) throw new Error('Candidate not found');
	if (candidate.archivalAssetId) throw new Error('Already has archival asset');
	await db.update(searchCandidates)
		.set({
			status: 'processing',
			retryCount: 0,
			nextAttemptAt: sql`now()`,
			lastError: '',
			updatedAt: sql`now()`
		})
		.where(eq(searchCandidates.id, candidateId));
}

export async function enqueueBulk(ids) {
	if (!ids.length) return 0;
	await db.update(searchCandidates)
		.set({
			status: 'processing',
			retryCount: 0,
			nextAttemptAt: sql`now()`,
			lastError: '',
			updatedAt: sql`now()`
		})
		.where(inArray(searchCandidates.id, ids));
	return ids.length;
}

/**
 * Process a single candidate: download image, check for duplicate, create archival asset.
 * Called by the queue worker. Throws on any failure — caller decides retry/permanent classification.
 */
export async function processOne(projectId, candidate, projectStoragePath) {
	// Download full-res image and extract metadata
	const extracted = await downloadAndExtract(candidate.imageUrl, projectStoragePath);

	// Check for duplicate by file hash
	if (extracted.fileHash) {
		const [existing] = await db.select({ id: archivalAssets.id, name: archivalAssets.name })
			.from(archivalAssets)
			.where(and(eq(archivalAssets.projectId, projectId), eq(archivalAssets.fileHash, extracted.fileHash)))
			.limit(1);
		if (existing) {
			// Duplicate is a permanent outcome — mark rejected here so the worker's error branch
			// only has to log (not decide what to do).
			await db.update(searchCandidates)
				.set({
					status: 'rejected',
					rejectionReason: `Duplicate of asset #${existing.id} (${existing.name})`,
					lastError: '',
					updatedAt: sql`now()`
				})
				.where(eq(searchCandidates.id, candidate.id));
			throw new Error(`Duplicate file hash — matches asset #${existing.id} "${existing.name}"`);
		}
	}

	// Parse dimensions for medium guess
	let medium = 'photograph';
	const desc = (candidate.description || '').toLowerCase();
	if (desc.includes('map') || desc.includes('plan') || desc.includes('plano')) medium = 'map';
	else if (desc.includes('drawing') || desc.includes('illustration') || desc.includes('dibuix')) medium = 'illustration';
	else if (desc.includes('document') || desc.includes('letter') || desc.includes('carta')) medium = 'document';

	// Create archival asset
	const asset = await createArchivalAsset(projectId, {
		name: candidate.title || extracted.filename,
		filename: extracted.filename,
		filePath: extracted.filePath,
		fileHash: extracted.fileHash,
		fileSize: extracted.fileSize,
		mimeType: extracted.mimeType,
		sourceUrl: candidate.sourcePageUrl,
		imageUrl: candidate.imageUrl || '',
		searchGroupId: candidate.stopId || '',
		searchGroupName: candidate.stopName || '',
		accessDate: new Date().toISOString().slice(0, 10),
		creator: candidate.author || extracted.suggestedCreator || '',
		institution: 'Wikimedia Commons',
		license: candidate.license || '',
		licenseUrl: candidate.licenseUrl || '',
		caption: candidate.description || extracted.suggestedCaption || '',
		originalDate: candidate.originalDate || extracted.suggestedOriginalDate || '',
		medium,
		exifJson: extracted.exifJson,
		c2paJson: extracted.c2paJson
	});

	return asset;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export async function getCandidateStats(projectId) {
	const rows = await db.select({
		stopId: searchCandidates.stopId,
		stopName: searchCandidates.stopName,
		status: searchCandidates.status,
		count: count()
	})
		.from(searchCandidates)
		.where(eq(searchCandidates.projectId, projectId))
		.groupBy(searchCandidates.stopId, searchCandidates.stopName, searchCandidates.status);

	// Group by stop
	const byStop = {};
	for (const r of rows) {
		if (!byStop[r.stopId]) {
			byStop[r.stopId] = { stopId: r.stopId, stopName: r.stopName, pending: 0, processing: 0, approved: 0, rejected: 0, flagged: 0, failed: 0, total: 0 };
		}
		const n = Number(r.count);
		byStop[r.stopId][r.status] = (byStop[r.stopId][r.status] || 0) + n;
		byStop[r.stopId].total += n;
	}

	return Object.values(byStop);
}

// ---------------------------------------------------------------------------
// Delete candidate
// ---------------------------------------------------------------------------

export async function deleteCandidate(id) {
	await db.delete(searchCandidates).where(eq(searchCandidates.id, id));
}

/**
 * Archive search orchestration.
 * Coordinates Wikimedia API calls, dedup, DB writes, and approval flow.
 */

import { db } from '../../db/index.js';
import { searchCandidates, archivalAssets } from '../../db/schema.js';
import { eq, and, desc, asc, sql, count, inArray } from 'drizzle-orm';
import { createLogger } from '../logger.js';
import { searchFiles, getCategoryMembers, getImageInfo } from './wikimedia.js';
import { downloadAndExtract } from '../archival/extraction.js';
import { createArchivalAsset } from '../archival/archival.js';
import { updateProgress, isCancelled, markCompleted } from './search-jobs.js';

const log = createLogger('search');

class CancelledError extends Error {
	constructor() { super('Search cancelled'); this.code = 'CANCELLED'; }
}

// ---------------------------------------------------------------------------
// Execute search for a group
// ---------------------------------------------------------------------------

/**
 * Run Wikimedia keyword + category search for a group.
 * Called by the search-jobs worker. Writes progress to the job row as it goes
 * and checks for external cancellation between iterations.
 *
 * `jobId` is required — this is the row in search_jobs whose counters we update
 * and whose status we poll for cancellation.
 */
export async function executeGroupSearch(projectId, group, jobId) {
	if (!jobId) throw new Error('executeGroupSearch requires a jobId');
	const { groupId, groupName, keywords, categories } = group;

	// Flatten all language buckets — language keys are free-form, so iterate the dict.
	const allKeywords = [];
	for (const terms of Object.values(keywords || {})) {
		if (Array.isArray(terms)) allKeywords.push(...terms);
	}
	const cats = categories || [];

	// Track which query found each title (first one wins)
	const titleSource = new Map();

	log.info(`Starting search for "${groupName}" (${allKeywords.length} keywords, ${cats.length} categories)`);

	async function checkCancelled() {
		if (await isCancelled(jobId)) throw new CancelledError();
	}

	for (let i = 0; i < allKeywords.length; i++) {
		await checkCancelled();
		const keyword = allKeywords[i];
		const titles = await searchFiles(keyword, { maxResults: 200 });
		for (const t of titles) {
			if (!titleSource.has(t)) titleSource.set(t, { type: 'keyword', query: keyword });
		}
		await updateProgress(jobId, { keywordsDone: i + 1, uniqueTitles: titleSource.size });
		log.info(`Keyword ${i + 1}/${allKeywords.length}: "${keyword}" → ${titles.length} results (${titleSource.size} unique total)`);
	}

	for (let i = 0; i < cats.length; i++) {
		await checkCancelled();
		const cat = cats[i];
		log.info(`Category ${i + 1}/${cats.length}: "${cat}" (crawling depth 2)...`);
		const titles = await getCategoryMembers(cat, { depth: 2, maxFiles: 2000 });
		for (const t of titles) {
			if (!titleSource.has(t)) titleSource.set(t, { type: 'category', query: cat.replace('Category:', '') });
		}
		await updateProgress(jobId, { categoriesDone: i + 1, uniqueTitles: titleSource.size });
		log.info(`  → ${titles.length} files found (${titleSource.size} unique total)`);
	}

	await checkCancelled();

	const uniqueTitles = [...titleSource.keys()];
	log.info(`Fetching image info for ${uniqueTitles.length} unique titles...`);
	// Per-batch progress keeps the job lease fresh (updateProgress extends it)
	// and lets the UI show a counter so a 6k-title fetch doesn't look stalled.
	// Also checks cancellation so Cancel is responsive during this phase.
	const candidates = await getImageInfo(uniqueTitles, async ({ fetched }) => {
		await updateProgress(jobId, { titlesFetched: fetched });
		await checkCancelled();
	});
	log.info(`Got info for ${candidates.length} images`);

	for (const c of candidates) {
		const pageTitle = `File:${c.title}`;
		const source = titleSource.get(pageTitle);
		if (source) c.searchQuery = `[${source.type}] ${source.query}`;
	}

	const usable = candidates.filter(c => c.licenseTier !== 'red');
	const skippedLicense = candidates.length - usable.length;

	// Dedup against existing search_candidates + archival_assets
	const existingCandidates = await db.select({ sourcePageUrl: searchCandidates.sourcePageUrl })
		.from(searchCandidates)
		.where(eq(searchCandidates.projectId, projectId));
	const existingUrls = new Set(existingCandidates.map(r => r.sourcePageUrl));

	const existingArchival = await db.select({ sourceUrl: archivalAssets.sourceUrl })
		.from(archivalAssets)
		.where(eq(archivalAssets.projectId, projectId));
	const archivalUrls = new Set(existingArchival.map(r => r.sourceUrl).filter(Boolean));

	const toInsert = [];
	let skippedDuplicate = 0;
	let skippedExisting = 0;

	for (const c of usable) {
		if (existingUrls.has(c.sourcePageUrl)) { skippedDuplicate++; continue; }
		if (archivalUrls.has(c.sourcePageUrl)) { skippedExisting++; continue; }
		existingUrls.add(c.sourcePageUrl);
		toInsert.push({
			projectId,
			searchGroupId: groupId,
			searchGroupName: groupName,
			source: 'wikimedia',
			...c,
			status: 'pending'
		});
	}

	// Insert in batches so a crash mid-run doesn't lose everything.
	let insertedSoFar = 0;
	for (let i = 0; i < toInsert.length; i += 100) {
		await checkCancelled();
		const chunk = toInsert.slice(i, i + 100);
		await db.insert(searchCandidates).values(chunk);
		insertedSoFar += chunk.length;
		await updateProgress(jobId, { candidatesInserted: insertedSoFar });
	}

	await markCompleted(jobId, {
		uniqueTitles: uniqueTitles.length,
		candidatesInserted: toInsert.length,
		skippedLicense,
		skippedDuplicate,
		skippedExisting
	});

	log.info(`Done. Inserted ${toInsert.length}, skipped ${skippedLicense} (license), ${skippedDuplicate} (dup candidates), ${skippedExisting} (already in archive)`);

	return {
		totalSearched: uniqueTitles.length,
		totalWithInfo: candidates.length,
		skippedLicense,
		skippedDuplicate,
		skippedExisting,
		inserted: toInsert.length,
		searchesRun: allKeywords.length,
		categoriesCrawled: cats.length
	};
}

// ---------------------------------------------------------------------------
// List candidates
// ---------------------------------------------------------------------------

export async function listCandidates(projectId, {
	searchGroupId = '', status = '', licenseTier = '', search = '', searchType = '',
	sortBy = 'createdAt', sortDir = 'desc', limit = 100, offset = 0
} = {}) {
	const conditions = [eq(searchCandidates.projectId, projectId)];

	if (searchGroupId) conditions.push(eq(searchCandidates.searchGroupId, searchGroupId));
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
	await db.update(searchCandidates)
		.set({ status, rejectionReason, updatedAt: sql`now()` })
		.where(inArray(searchCandidates.id, ids));
	return ids.length;
}

// ---------------------------------------------------------------------------
// Approval flow (enqueue-only — actual download runs in queue.js worker)
// ---------------------------------------------------------------------------

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
	const extracted = await downloadAndExtract(candidate.imageUrl, projectStoragePath);

	if (extracted.fileHash) {
		const [existing] = await db.select({ id: archivalAssets.id, name: archivalAssets.name })
			.from(archivalAssets)
			.where(and(eq(archivalAssets.projectId, projectId), eq(archivalAssets.fileHash, extracted.fileHash)))
			.limit(1);
		if (existing) {
			// Duplicate is permanent — mark rejected here so the worker's error branch just logs.
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

	let medium = 'photograph';
	const desc = (candidate.description || '').toLowerCase();
	if (desc.includes('map') || desc.includes('plan') || desc.includes('plano')) medium = 'map';
	else if (desc.includes('drawing') || desc.includes('illustration') || desc.includes('dibuix')) medium = 'illustration';
	else if (desc.includes('document') || desc.includes('letter') || desc.includes('carta')) medium = 'document';

	const asset = await createArchivalAsset(projectId, {
		name: candidate.title || extracted.filename,
		filename: extracted.filename,
		filePath: extracted.filePath,
		fileHash: extracted.fileHash,
		fileSize: extracted.fileSize,
		mimeType: extracted.mimeType,
		sourceUrl: candidate.sourcePageUrl,
		imageUrl: candidate.imageUrl || '',
		searchGroupId: candidate.searchGroupId || '',
		searchGroupName: candidate.searchGroupName || '',
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
		searchGroupId: searchCandidates.searchGroupId,
		searchGroupName: searchCandidates.searchGroupName,
		status: searchCandidates.status,
		count: count()
	})
		.from(searchCandidates)
		.where(eq(searchCandidates.projectId, projectId))
		.groupBy(searchCandidates.searchGroupId, searchCandidates.searchGroupName, searchCandidates.status);

	const byGroup = {};
	for (const r of rows) {
		if (!byGroup[r.searchGroupId]) {
			byGroup[r.searchGroupId] = { searchGroupId: r.searchGroupId, searchGroupName: r.searchGroupName, pending: 0, processing: 0, approved: 0, rejected: 0, flagged: 0, failed: 0, total: 0 };
		}
		const n = Number(r.count);
		byGroup[r.searchGroupId][r.status] = (byGroup[r.searchGroupId][r.status] || 0) + n;
		byGroup[r.searchGroupId].total += n;
	}

	return Object.values(byGroup);
}

// ---------------------------------------------------------------------------
// Delete candidate
// ---------------------------------------------------------------------------

export async function deleteCandidate(id) {
	await db.delete(searchCandidates).where(eq(searchCandidates.id, id));
}

/**
 * Wikimedia Commons API client.
 * Handles file search, category crawling, image info retrieval, and license classification.
 */

import { throttledFetch } from './rate-limiter.js';
import { USER_AGENT } from '../user-agent.js';
import { createLogger } from '../logger.js';

const log = createLogger('wikimedia');

const API_URL = 'https://commons.wikimedia.org/w/api.php';

// Abort any single API request that hangs longer than this. Node's undici fetch
// has no default request timeout, so a stalled TCP connection can hang forever
// — which is fatal inside a long-running search job because one dead call
// blocks all progress updates and the job's lease then expires.
const REQUEST_TIMEOUT_MS = 60_000;

// Use POST so long parameter lists (e.g. 50 pipe-joined titles in getImageInfo)
// don't blow past server URL length limits (we saw a 414 URI Too Long on GET).
// MediaWiki's action=query accepts POST; format/origin stay in the query string.
async function apiCall(params) {
	const url = new URL(API_URL);
	url.searchParams.set('format', 'json');
	url.searchParams.set('origin', '*');
	const body = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		body.set(k, v);
	}
	const res = await throttledFetch(url.toString(), {
		method: 'POST',
		headers: {
			'User-Agent': USER_AGENT,
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body,
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	});
	if (!res.ok) throw new Error(`Wikimedia API error: ${res.status}`);
	return res.json();
}

// ---------------------------------------------------------------------------
// 1. Search files by keyword
// ---------------------------------------------------------------------------

/**
 * Search Wikimedia Commons File namespace for a keyword.
 * Returns all matching page titles (paginating automatically).
 */
export async function searchFiles(query, { maxResults = 200 } = {}) {
	const titles = [];
	let offset = 0;
	const batchSize = 50;

	while (titles.length < maxResults) {
		const data = await apiCall({
			action: 'query',
			list: 'search',
			srnamespace: '6', // File namespace
			srsearch: query,
			srlimit: String(Math.min(batchSize, maxResults - titles.length)),
			sroffset: String(offset)
		});

		const results = data.query?.search || [];
		if (results.length === 0) break;

		for (const r of results) {
			titles.push(r.title);
		}

		if (!data.continue?.sroffset) break;
		offset = data.continue.sroffset;
	}

	return titles;
}

// ---------------------------------------------------------------------------
// 2. Category member crawling
// ---------------------------------------------------------------------------

/**
 * Recursively get file page titles from a Wikimedia category.
 * Crawls subcategories up to `depth` levels.
 */
export async function getCategoryMembers(categoryTitle, { depth = 2, maxFiles = 2000, _visited = new Set() } = {}) {
	if (_visited.has(categoryTitle)) return [];
	_visited.add(categoryTitle);

	const fileTitles = [];
	const subcategories = [];

	let cmcontinue = null;
	do {
		const params = {
			action: 'query',
			list: 'categorymembers',
			cmtitle: categoryTitle,
			cmtype: 'file|subcat',
			cmlimit: '500'
		};
		if (cmcontinue) params.cmcontinue = cmcontinue;

		const data = await apiCall(params);
		const members = data.query?.categorymembers || [];

		for (const m of members) {
			if (m.ns === 6) { // File namespace
				fileTitles.push(m.title);
			} else if (m.ns === 14 && depth > 0) { // Category namespace
				subcategories.push(m.title);
			}
		}

		cmcontinue = data.continue?.cmcontinue || null;

		if (fileTitles.length >= maxFiles) break;
	} while (cmcontinue);

	// Recurse into subcategories
	if (depth > 0) {
		for (const subcat of subcategories) {
			if (fileTitles.length >= maxFiles) break;
			const subFiles = await getCategoryMembers(subcat, {
				depth: depth - 1,
				maxFiles: maxFiles - fileTitles.length,
				_visited
			});
			fileTitles.push(...subFiles);
		}
	}

	return fileTitles.slice(0, maxFiles);
}

// ---------------------------------------------------------------------------
// 3. Image info retrieval (batch up to 50 titles)
// ---------------------------------------------------------------------------

/**
 * Fetch detailed image info for an array of page titles.
 * Batches 50 titles per API call. Per-batch failures are logged and skipped —
 * one transient Wikimedia hiccup in the middle of a 6k-title fetch must not
 * kill the whole job, since the caller can't cheaply re-derive the title list.
 *
 * `onBatch({ fetched, total, failed })` is called after every batch attempt
 * (success OR failure) so the caller can update progress and extend its lease.
 */
export async function getImageInfo(titles, onBatch) {
	const BATCH_SIZE = 50;
	const results = [];
	let fetched = 0;
	let failed = 0;

	for (let i = 0; i < titles.length; i += BATCH_SIZE) {
		const batch = titles.slice(i, i + BATCH_SIZE);
		try {
			const data = await apiCall({
				action: 'query',
				titles: batch.join('|'),
				prop: 'imageinfo|categories',
				iiprop: 'url|size|extmetadata|mime',
				iiurlwidth: '300', // request 300px thumbnail
				cllimit: '50'
			});

			const pages = data.query?.pages || {};
			for (const page of Object.values(pages)) {
				if (!page.imageinfo?.length) continue;
				const info = page.imageinfo[0];
				const ext = info.extmetadata || {};

				const candidate = normalizeCandidate(page, info, ext);
				results.push(candidate);
			}
		} catch (err) {
			failed++;
			log.warn(`Batch starting at title ${i} failed (${batch.length} titles): ${err.message}`);
		}

		fetched += batch.length;
		if (onBatch) {
			try {
				await onBatch({ fetched, total: titles.length, failed });
			} catch {
				// Progress callbacks must never abort the fetch — swallow errors here.
			}
		}
	}

	if (failed > 0) {
		log.warn(`getImageInfo done: ${failed} of ${Math.ceil(titles.length / BATCH_SIZE)} batches failed (up to ${failed * BATCH_SIZE} titles skipped)`);
	}

	return results;
}

// ---------------------------------------------------------------------------
// 4. Normalization + license classification
// ---------------------------------------------------------------------------

function extractText(extField) {
	if (!extField) return '';
	return (extField.value || '').replace(/<[^>]*>/g, '').trim();
}

function normalizeCandidate(page, info, ext) {
	const license = extractText(ext.LicenseShortName);
	const title = (page.title || '').replace(/^File:/, '');

	return {
		sourcePageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title).replace(/%20/g, '_')}`,
		imageUrl: info.url || '',
		thumbnailUrl: info.thumburl || '',
		title,
		description: extractText(ext.ImageDescription),
		author: extractText(ext.Artist),
		license,
		licenseUrl: extractText(ext.LicenseUrl),
		licenseTier: classifyLicense(license),
		originalDate: extractText(ext.DateTimeOriginal) || extractText(ext.DateTime),
		dimensions: JSON.stringify({ width: info.width || 0, height: info.height || 0 }),
		categories: JSON.stringify((page.categories || []).map(c => c.title?.replace(/^Category:/, '') || '')),
		rawMetadata: JSON.stringify({ pageId: page.pageid, extmetadata: ext })
	};
}

/**
 * Classify a Wikimedia license string into a tier.
 * Green = safe to use. Yellow = attribution required. Red = restricted or unknown.
 */
export function classifyLicense(licenseStr) {
	if (!licenseStr) return 'red';
	const lower = licenseStr.toLowerCase();

	// Green: public domain variants
	if (lower.includes('public domain') || lower.includes('pd-')
		|| lower === 'pd' || lower.includes('cc0')
		|| lower.includes('copyrighted free use')) {
		return 'green';
	}

	// Red: NC or ND restrictions (check before yellow to avoid false match on "CC BY-NC-SA")
	if (lower.includes('-nc') || lower.includes('-nd')) {
		return 'red';
	}

	// Yellow: CC BY / CC BY-SA (without NC/ND, which was caught above)
	if (lower.startsWith('cc by') || lower.startsWith('cc-by')
		|| lower.includes('attribution')) {
		return 'yellow';
	}

	// Red: everything else (GFDL, FAL, unknown, etc.)
	return 'red';
}

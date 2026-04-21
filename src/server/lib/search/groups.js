/**
 * Search group CRUD — per-project configurations for archive search.
 *
 * A "group" is a searchable bucket (e.g. a tour stop, a chapter, an era) with
 * multilingual keywords and Wikimedia categories. Replaces the static stops.js
 * array so users can edit/import/export config without touching source.
 */

import { db } from '../../db/index.js';
import { searchGroups, searchCandidates, archivalAssets } from '../../db/schema.js';
import { eq, and, asc, sql, count, inArray } from 'drizzle-orm';

// Fields accepted from user input on create/update. Everything else is ignored
// (e.g. `id`, `createdAt`) to keep the API shape safe against pasted JSON.
const EDITABLE_FIELDS = new Set([
	'groupId', 'groupName',
	'keywords', 'categories',
	'notes', 'sortOrder'
]);

// JSON-encoded text columns — values come in as objects/arrays, stored as strings.
const JSON_FIELDS = new Set(['keywords', 'categories']);

function slugify(str) {
	return (str || '')
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 64) || 'group';
}

function parseJson(str, fallback) {
	if (typeof str !== 'string' || !str) return fallback;
	try { return JSON.parse(str); } catch { return fallback; }
}

// Convert a DB row (JSON fields stored as text) into a client-friendly shape.
export function hydrateGroup(row) {
	if (!row) return null;
	return {
		...row,
		keywords: parseJson(row.keywords, {}),
		categories: parseJson(row.categories, [])
	};
}

// Normalize an incoming payload to DB column values. JSON fields get stringified.
function normalizePayload(input) {
	const out = {};
	const ignored = [];
	for (const [k, v] of Object.entries(input || {})) {
		if (!EDITABLE_FIELDS.has(k)) {
			ignored.push(k);
			continue;
		}
		if (JSON_FIELDS.has(k)) {
			out[k] = JSON.stringify(v ?? (k === 'keywords' ? {} : []));
		} else {
			out[k] = v;
		}
	}
	return { values: out, ignored };
}

// Count keywords across all language buckets.
export function countKeywords(keywordsObj) {
	if (!keywordsObj || typeof keywordsObj !== 'object') return 0;
	let n = 0;
	for (const v of Object.values(keywordsObj)) {
		if (Array.isArray(v)) n += v.length;
	}
	return n;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function listGroups(projectId) {
	const rows = await db.select().from(searchGroups)
		.where(eq(searchGroups.projectId, projectId))
		.orderBy(asc(searchGroups.sortOrder), asc(searchGroups.id));

	if (rows.length === 0) return [];

	// Pull candidate counts by searchGroupId in one query
	const candRows = await db.select({
		groupId: searchCandidates.searchGroupId,
		status: searchCandidates.status,
		n: count()
	})
		.from(searchCandidates)
		.where(eq(searchCandidates.projectId, projectId))
		.groupBy(searchCandidates.searchGroupId, searchCandidates.status);

	const candStats = {};
	for (const r of candRows) {
		if (!candStats[r.groupId]) candStats[r.groupId] = { total: 0, pending: 0, processing: 0, approved: 0, rejected: 0, flagged: 0, failed: 0 };
		const k = Number(r.n);
		candStats[r.groupId][r.status] = (candStats[r.groupId][r.status] || 0) + k;
		candStats[r.groupId].total += k;
	}

	// Archival asset counts per group (so UI can warn before delete)
	const assetRows = await db.select({
		groupId: archivalAssets.searchGroupId,
		n: count()
	})
		.from(archivalAssets)
		.where(eq(archivalAssets.projectId, projectId))
		.groupBy(archivalAssets.searchGroupId);

	const assetCounts = {};
	for (const r of assetRows) assetCounts[r.groupId] = Number(r.n);

	return rows.map(row => {
		const g = hydrateGroup(row);
		return {
			...g,
			keywordCount: countKeywords(g.keywords),
			categoryCount: (g.categories || []).length,
			candidateStats: candStats[g.groupId] || { total: 0, pending: 0, processing: 0, approved: 0, rejected: 0, flagged: 0, failed: 0 },
			archivalAssetCount: assetCounts[g.groupId] || 0
		};
	});
}

export async function getGroup(id) {
	const [row] = await db.select().from(searchGroups).where(eq(searchGroups.id, id)).limit(1);
	return hydrateGroup(row);
}

export async function getGroupByGroupId(projectId, groupId) {
	const [row] = await db.select().from(searchGroups)
		.where(and(eq(searchGroups.projectId, projectId), eq(searchGroups.groupId, groupId)))
		.limit(1);
	return hydrateGroup(row);
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function createGroup(projectId, input) {
	const { values, ignored } = normalizePayload(input);

	if (!values.groupName) throw new Error('groupName is required');
	if (!values.groupId) values.groupId = await uniqueGroupId(projectId, slugify(values.groupName));

	// Defaults for JSON fields if caller omitted them
	if (!('keywords' in values)) values.keywords = '{}';
	if (!('categories' in values)) values.categories = '[]';

	// sortOrder defaults to end of list
	if (values.sortOrder == null) {
		const [{ maxOrder }] = await db.select({ maxOrder: sql`COALESCE(MAX(${searchGroups.sortOrder}), -1)` })
			.from(searchGroups)
			.where(eq(searchGroups.projectId, projectId));
		values.sortOrder = Number(maxOrder) + 1;
	}

	const [row] = await db.insert(searchGroups).values({ projectId, ...values }).returning();
	return { group: hydrateGroup(row), ignoredFields: ignored };
}

export async function updateGroup(id, input) {
	const { values, ignored } = normalizePayload(input);
	if (Object.keys(values).length === 0) return { group: await getGroup(id), ignoredFields: ignored };
	await db.update(searchGroups)
		.set({ ...values, updatedAt: sql`now()` })
		.where(eq(searchGroups.id, id));
	return { group: await getGroup(id), ignoredFields: ignored };
}

// ---------------------------------------------------------------------------
// Delete — blocking when candidates/assets reference the group
// ---------------------------------------------------------------------------

export async function getGroupUsage(projectId, groupId) {
	const [{ candidates }] = await db.select({ candidates: count() })
		.from(searchCandidates)
		.where(and(eq(searchCandidates.projectId, projectId), eq(searchCandidates.searchGroupId, groupId)));
	const [{ assets }] = await db.select({ assets: count() })
		.from(archivalAssets)
		.where(and(eq(archivalAssets.projectId, projectId), eq(archivalAssets.searchGroupId, groupId)));
	return { candidates: Number(candidates), assets: Number(assets) };
}

export async function deleteGroup(id) {
	const group = await getGroup(id);
	if (!group) throw new Error('Group not found');
	const usage = await getGroupUsage(group.projectId, group.groupId);
	if (usage.candidates > 0 || usage.assets > 0) {
		const err = new Error(`Group "${group.groupName}" is in use: ${usage.candidates} candidate(s), ${usage.assets} archival asset(s). Reassign before deleting.`);
		err.code = 'GROUP_IN_USE';
		err.usage = usage;
		throw err;
	}
	await db.delete(searchGroups).where(eq(searchGroups.id, id));
}

// Reassign candidates + assets from one group to another, then delete the source group.
export async function reassignAndDeleteGroup(id, targetGroupId) {
	const source = await getGroup(id);
	if (!source) throw new Error('Source group not found');
	const target = await getGroupByGroupId(source.projectId, targetGroupId);
	if (!target) throw new Error('Target group not found');
	if (target.id === source.id) throw new Error('Target and source are the same group');

	await db.update(searchCandidates)
		.set({ searchGroupId: target.groupId, searchGroupName: target.groupName, updatedAt: sql`now()` })
		.where(and(
			eq(searchCandidates.projectId, source.projectId),
			eq(searchCandidates.searchGroupId, source.groupId)
		));

	await db.update(archivalAssets)
		.set({ searchGroupId: target.groupId, searchGroupName: target.groupName, updatedAt: sql`now()` })
		.where(and(
			eq(archivalAssets.projectId, source.projectId),
			eq(archivalAssets.searchGroupId, source.groupId)
		));

	await db.delete(searchGroups).where(eq(searchGroups.id, id));
}

// ---------------------------------------------------------------------------
// Import / Export — round-trip JSON
// ---------------------------------------------------------------------------

/**
 * Bulk import groups.
 * mode='merge' — upsert by groupId (existing groups updated, new ones inserted).
 * mode='replace' — delete all groups for project first, then insert fresh.
 *   When candidates/assets would be orphaned, the caller is expected to have
 *   confirmed this; we still perform the op (candidate.searchGroupId is a text
 *   field, not an FK, so data isn't lost — it just becomes "dangling" until
 *   re-imported groups cover the same groupIds).
 *
 * Validation: warn-and-keep. Unknown fields are ignored with a list returned.
 * Missing groupId is generated from slugify(groupName). Missing groupName is
 * rejected per-entry (entry reported in `errors`).
 */
export async function importGroups(projectId, groups, { mode = 'merge' } = {}) {
	if (!Array.isArray(groups)) throw new Error('groups must be an array');

	const errors = [];
	const allIgnored = new Set();
	const prepared = [];

	for (let i = 0; i < groups.length; i++) {
		const raw = groups[i];
		if (!raw || typeof raw !== 'object') {
			errors.push({ index: i, error: 'entry is not an object' });
			continue;
		}
		if (!raw.groupName) {
			errors.push({ index: i, error: 'groupName required' });
			continue;
		}
		const { values, ignored } = normalizePayload(raw);
		for (const f of ignored) allIgnored.add(f);
		if (!values.groupId) values.groupId = slugify(values.groupName);
		prepared.push(values);
	}

	let inserted = 0;
	let updated = 0;
	let deleted = 0;

	if (mode === 'replace') {
		const res = await db.delete(searchGroups)
			.where(eq(searchGroups.projectId, projectId))
			.returning({ id: searchGroups.id });
		deleted = res.length;
	}

	// De-dup by groupId within the input so we don't violate the unique index mid-batch
	const seen = new Set();
	for (let i = 0; i < prepared.length; i++) {
		const values = prepared[i];
		if (seen.has(values.groupId)) {
			errors.push({ index: i, error: `duplicate groupId in input: ${values.groupId}` });
			continue;
		}
		seen.add(values.groupId);

		if (values.sortOrder == null) values.sortOrder = i;
		if (!('keywords' in values)) values.keywords = '{}';
		if (!('categories' in values)) values.categories = '[]';

		if (mode === 'merge') {
			const existing = await getGroupByGroupId(projectId, values.groupId);
			if (existing) {
				await db.update(searchGroups)
					.set({ ...values, updatedAt: sql`now()` })
					.where(eq(searchGroups.id, existing.id));
				updated++;
				continue;
			}
		}

		await db.insert(searchGroups).values({ projectId, ...values });
		inserted++;
	}

	return {
		inserted, updated, deleted,
		ignoredFields: [...allIgnored],
		errors
	};
}

export async function exportGroups(projectId) {
	const rows = await db.select().from(searchGroups)
		.where(eq(searchGroups.projectId, projectId))
		.orderBy(asc(searchGroups.sortOrder), asc(searchGroups.id));

	return rows.map(r => {
		const g = hydrateGroup(r);
		// Strip DB-internal fields for a portable export
		const { id: _id, projectId: _pid, createdAt: _ca, updatedAt: _ua, ...rest } = g;
		return rest;
	});
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function uniqueGroupId(projectId, base) {
	// If `base` is free, take it; otherwise append _2, _3, ...
	let candidate = base;
	let n = 2;
	while (true) {
		const existing = await getGroupByGroupId(projectId, candidate);
		if (!existing) return candidate;
		candidate = `${base}_${n++}`;
		if (n > 1000) throw new Error('Could not find unique groupId');
	}
}

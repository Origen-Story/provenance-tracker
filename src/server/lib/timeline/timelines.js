// IO for imported timelines: parse, store the raw file, match clips to the
// project's assets, persist segments, compute and cache the breakdown, and
// link matched assets to the output (relationship output_of). Pure logic
// lives in formats/, match.js and breakdown.js.
import path from 'path';
import { mkdir, writeFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { db } from '../../db/index.js';
import { timelines, timelineSegments, assets, archivalAssets, producedAssets } from '../../db/schema.js';
import { eq, and, sql, asc } from 'drizzle-orm';
import { parseTimeline } from './formats/index.js';
import { buildMatchIndex, matchClips, sourcesFromTimeline, matchesByClip } from './match.js';
import { computeBreakdown, segmentsFromTimeline } from './breakdown.js';
import { computeFileHash } from '../core/file-utils.js';
import { linkAssets, resolveAssetRef, tableFor } from '../relationships/relationships.js';
import { createLogger } from '../logger.js';

const log = createLogger('timelines');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function storageRoot(project) {
	return project?.storagePath || process.env.STORAGE_PATH || path.resolve(__dirname, '../../../../data');
}

function safeName(name) {
	return String(name || 'timeline.xml').replace(/[^a-zA-Z0-9._-]/g, '_');
}

// Every asset in the project in the shape match.js expects.
export async function buildProjectAssetIndex(projectId) {
	const pick = (type, r) => ({
		type, id: r.id,
		filename: r.filename || path.basename(r.filePath || ''),
		filePath: r.filePath, originalFilePath: r.originalFilePath || null,
		fileHash: r.fileHash || '', fileSize: r.fileSize || 0,
		originClass: r.originClass || 'unknown', originClassConfirmed: !!r.originClassConfirmed
	});
	const [ai, arch, prod] = await Promise.all([
		db.select().from(assets).where(eq(assets.projectId, projectId)),
		db.select().from(archivalAssets).where(eq(archivalAssets.projectId, projectId)),
		db.select().from(producedAssets).where(eq(producedAssets.projectId, projectId))
	]);
	return [...ai.map(r => pick('ai', r)), ...arch.map(r => pick('archival', r)), ...prod.map(r => pick('produced', r))];
}

const io = {
	statSize: async (p) => (existsSync(p) ? (await stat(p)).size : null),
	hashFile: async (p) => (existsSync(p) ? computeFileHash(p) : null)
};

async function storeRaw(project, producedAssetId, xmlText, sourceFileName) {
	const dir = path.join(storageRoot(project), 'timelines', String(producedAssetId || 'unassigned'));
	if (!existsSync(dir)) await mkdir(dir, { recursive: true });
	const base = safeName(sourceFileName);
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const dest = path.join(dir, `${stamp}_${base}`);
	await writeFile(dest, xmlText, 'utf8');
	return dest;
}

/**
 * Import one timeline file for a produced output. The output itself may be
 * matched by the timeline (it never is, the sequence is not a file), so the
 * produced row is only the owner here.
 */
export async function importTimeline({ project, producedAssetId, xmlText, sourceFileName, primaryTrackIndex = 1, includeOverlays = false }) {
	const parsed = parseTimeline(xmlText);
	const sourceFilePath = await storeRaw(project, producedAssetId, xmlText, sourceFileName);
	const sourceFileHash = await computeFileHash(sourceFilePath);

	const index = buildMatchIndex(await buildProjectAssetIndex(project.id));
	const sources = sourcesFromTimeline(parsed);
	const bySource = await matchClips(sources, index, io);
	const byClip = matchesByClip(parsed, bySource);
	const segments = segmentsFromTimeline(parsed, byClip);
	const fps = parsed.sequence.fps || null;

	const [row] = await db.insert(timelines).values({
		projectId: project.id,
		producedAssetId: producedAssetId || null,
		sourceFormat: parsed.format,
		sourceFormatVersion: parsed.version || '',
		sourceFileName: sourceFileName || '',
		sourceFilePath,
		sourceFileHash,
		sequenceName: parsed.sequence.name,
		timebase: parsed.sequence.timebase,
		ntsc: parsed.sequence.ntsc,
		fps,
		durationFrames: parsed.sequence.durationFrames,
		width: parsed.sequence.width,
		height: parsed.sequence.height,
		primaryTrackIndex,
		includeOverlays,
		notesJson: JSON.stringify(parsed.notes || [])
	}).returning();

	if (segments.length) {
		await db.insert(timelineSegments).values(segments.map((s, i) => ({
			timelineId: row.id,
			trackKind: s.trackKind,
			trackIndex: s.trackIndex,
			clipId: s.clipId,
			clipName: s.name,
			enabled: s.enabled,
			startFrame: s.startFrame,
			endFrame: s.endFrame,
			inFrame: s.inFrame,
			outFrame: s.outFrame,
			startSeconds: fps ? s.startFrame / fps : null,
			endSeconds: fps ? s.endFrame / fps : null,
			sourceKind: s.sourceKind,
			sourceKey: s.sourceKey || '',
			sourceName: s.sourceName || '',
			sourcePath: s.sourcePath || '',
			matchedAssetType: s.matchedAssetType,
			matchedAssetId: s.matchedAssetId,
			matchMethod: s.matchMethod,
			matchConfidence: s.matchConfidence,
			originClass: null,
			sortOrder: i
		})));
	}

	await linkMatchedAssets(row, segments);
	await recomputeTimeline(row.id);
	log.info(`timeline ${row.id} imported: ${parsed.format} v${parsed.version}, ${segments.length} segments, ${sources.length} sources, ${[...bySource.values()].filter(m => m.asset).length} matched`);
	return getTimeline(row.id);
}

// Each distinct matched asset becomes a parent of the output (output_of).
async function linkMatchedAssets(timelineRow, segments) {
	if (!timelineRow.producedAssetId) return;
	const seen = new Set();
	for (const s of segments) {
		if (!s.matchedAssetType || !s.matchedAssetId) continue;
		const key = `${s.matchedAssetType}:${s.matchedAssetId}`;
		if (seen.has(key)) continue;
		seen.add(key);
		if (s.matchedAssetType === 'produced' && s.matchedAssetId === timelineRow.producedAssetId) continue;
		await linkAssets({
			parentType: s.matchedAssetType, parentId: s.matchedAssetId,
			childType: 'produced', childId: timelineRow.producedAssetId,
			relationshipType: 'output_of', matchMethod: 'timeline', confidence: s.matchConfidence || 0.5,
			notes: `timeline ${timelineRow.id} clip ${s.clipId}`
		}).catch(err => log.warn(`link skipped for ${key}: ${err.message}`));
	}
}

async function loadSegments(timelineId) {
	return db.select().from(timelineSegments).where(eq(timelineSegments.timelineId, timelineId)).orderBy(asc(timelineSegments.sortOrder));
}

// Effective class per segment: explicit override, else the matched asset's
// current class. Returns breakdown-ready rows plus resolved asset refs.
async function effectiveSegments(rows) {
	const refCache = new Map();
	const out = [];
	for (const r of rows) {
		let asset = null;
		if (r.matchedAssetType && r.matchedAssetId) {
			const key = `${r.matchedAssetType}:${r.matchedAssetId}`;
			if (!refCache.has(key)) refCache.set(key, await resolveAssetRef(r.matchedAssetType, r.matchedAssetId));
			asset = refCache.get(key);
		}
		out.push({
			...r,
			name: r.clipName,
			matched: !!asset,
			asset,
			originClass: r.originClass || asset?.originClass || null,
			originClassOverride: r.originClass || null
		});
	}
	return out;
}

export async function recomputeTimeline(id) {
	const [row] = await db.select().from(timelines).where(eq(timelines.id, id)).limit(1);
	if (!row) throw new Error('Timeline not found');
	const segs = await effectiveSegments(await loadSegments(id));
	const breakdown = computeBreakdown(segs, {
		durationFrames: row.durationFrames,
		fps: row.fps,
		primaryTrackIndex: row.primaryTrackIndex || 1,
		includeOverlays: !!row.includeOverlays
	});
	await db.update(timelines).set({ breakdownJson: JSON.stringify(breakdown), updatedAt: sql`now()` }).where(eq(timelines.id, id));
	return breakdown;
}

export async function getTimeline(id) {
	const [row] = await db.select().from(timelines).where(eq(timelines.id, id)).limit(1);
	if (!row) return null;
	const segments = await effectiveSegments(await loadSegments(id));
	let breakdown = null;
	let notes = [];
	try { breakdown = JSON.parse(row.breakdownJson || 'null'); } catch { breakdown = null; }
	try { notes = JSON.parse(row.notesJson || '[]'); } catch { notes = []; }
	return { ...row, breakdown, notes, segments };
}

export async function listTimelines({ projectId, producedAssetId }) {
	const conds = [eq(timelines.projectId, projectId)];
	if (producedAssetId) conds.push(eq(timelines.producedAssetId, producedAssetId));
	const rows = await db.select().from(timelines).where(and(...conds)).orderBy(asc(timelines.createdAt));
	return rows.map(r => {
		let breakdown = null;
		try { breakdown = JSON.parse(r.breakdownJson || 'null'); } catch { /* keep null */ }
		return { ...r, breakdown };
	});
}

export async function updateTimelineSettings(id, { primaryTrackIndex, includeOverlays }) {
	const patch = { updatedAt: sql`now()` };
	if (primaryTrackIndex !== undefined) patch.primaryTrackIndex = parseInt(primaryTrackIndex) || 1;
	if (includeOverlays !== undefined) patch.includeOverlays = !!includeOverlays;
	await db.update(timelines).set(patch).where(eq(timelines.id, id));
	await recomputeTimeline(id);
	return getTimeline(id);
}

/**
 * Manual fix for one segment: set or clear the matched asset and/or set a
 * class override (null clears it). Every segment of the same source file
 * follows the match, since they are the same media.
 */
export async function updateSegment(timelineId, segmentId, { matchedAssetType, matchedAssetId, originClass, applyToSource = true } = {}) {
	const [seg] = await db.select().from(timelineSegments).where(and(eq(timelineSegments.id, segmentId), eq(timelineSegments.timelineId, timelineId))).limit(1);
	if (!seg) throw new Error('Segment not found');
	const patch = {};
	if (matchedAssetType !== undefined || matchedAssetId !== undefined) {
		if (matchedAssetType && matchedAssetId) {
			tableFor(matchedAssetType);
			const ref = await resolveAssetRef(matchedAssetType, parseInt(matchedAssetId));
			if (!ref) throw new Error('Matched asset not found');
			patch.matchedAssetType = matchedAssetType;
			patch.matchedAssetId = ref.id;
			patch.matchMethod = 'manual';
			patch.matchConfidence = 1;
		} else {
			patch.matchedAssetType = null;
			patch.matchedAssetId = null;
			patch.matchMethod = 'unmatched';
			patch.matchConfidence = 0;
		}
	}
	if (originClass !== undefined) patch.originClass = originClass || null;
	if (Object.keys(patch).length) {
		const where = applyToSource && seg.sourceKey && seg.sourceKind === 'file'
			? and(eq(timelineSegments.timelineId, timelineId), eq(timelineSegments.sourceKey, seg.sourceKey))
			: eq(timelineSegments.id, segmentId);
		await db.update(timelineSegments).set(patch).where(where);
	}
	const [row] = await db.select().from(timelines).where(eq(timelines.id, timelineId)).limit(1);
	if (patch.matchedAssetType && row) {
		await linkMatchedAssets(row, [{ ...seg, ...patch, clipId: seg.clipId }]);
	}
	await recomputeTimeline(timelineId);
	return getTimeline(timelineId);
}

// Called when an asset's origin class changes: every timeline that uses it
// gets a fresh breakdown.
export async function recomputeTimelinesForAsset(type, id) {
	const rows = await db.selectDistinct({ timelineId: timelineSegments.timelineId }).from(timelineSegments)
		.where(and(eq(timelineSegments.matchedAssetType, type), eq(timelineSegments.matchedAssetId, id)));
	for (const r of rows) await recomputeTimeline(r.timelineId).catch(err => log.warn(`recompute ${r.timelineId} failed: ${err.message}`));
	return rows.length;
}

export async function deleteTimeline(id) {
	await db.delete(timelines).where(eq(timelines.id, id));
}

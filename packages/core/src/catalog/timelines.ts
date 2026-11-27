// Imported timelines in the catalog (roadmap Phase 6, D40): writing one, its
// breakdown, a person's corrections, and creator statements. Pure: SQL on a
// catalog it is handed; the caller parses the file and matches its sources.
//
// A timeline belongs to the cut it made (a content of the output). Matching
// is per source, so every clip of one file follows one match. The breakdown
// is a cache, recomputed from the clips with the same computeBreakdown the
// app has always used, with the catalog's asset ids as refs (D23). Whatever
// changes what is on screen (a match, a clip's class, the timeline's
// settings, an asset's class) refreshes the timelines it touches, and the
// outputs are classified again from their composition.

import type { DatabaseSync } from "node:sqlite";
import { computeBreakdown } from "../timeline/breakdown.js";
import { classifyCatalog } from "./classify.ts";
import type { Tool } from "./create.ts";
import { createRow, editRow, removeRow, type Actor } from "./edit.ts";
import { inTransaction } from "./format.ts";
import { EditError, NotFoundError } from "./errors.ts";
import { finishRun, startRun } from "./runs.ts";

interface ClipRow {
	id: number;
	track_kind: string;
	track_index: number;
	clip_key: string;
	name: string;
	enabled: number;
	start_frame: number;
	end_frame: number;
	in_frame: number | null;
	out_frame: number | null;
	clip_class: string | null;
	source_kind: string | null;
	source_key: string | null;
	source_name: string | null;
	asset_id: number | null;
	asset_class: string | null;
	ai_assisted: number | null;
	sort_order: number;
}

interface NamingOptions {
	refOf: (assetId: number) => string | null;
	segmentIdOf: (clipId: number) => number | null;
	/** Breaks ties in sort order; the clip's own id by default. */
	tieBreak?: (clipId: number) => number;
}

function timelineRow(db: DatabaseSync, timelineId: number) {
	const t = db
		.prepare(
			"SELECT duration_frames, fps, primary_track_index, include_overlays FROM timelines WHERE id = ?",
		)
		.get(timelineId) as
		| {
				duration_frames: number;
				fps: number;
				primary_track_index: number;
				include_overlays: number;
		  }
		| undefined;
	if (!t) throw new Error(`No timeline ${timelineId}`);
	return t;
}

/**
 * A timeline's clips as the app's "effective segments": each clip's class is
 * its own override, else its source's asset's class. How an asset is named
 * (refOf) and a clip (segmentIdOf), and the order of clips that share a sort
 * order, are the caller's: the migration's check names them as Postgres did.
 */
export function timelineSegments(
	db: DatabaseSync,
	timelineId: number,
	opts: NamingOptions,
) {
	const t = timelineRow(db, timelineId);
	const clips = db
		.prepare(
			`SELECT c.id, c.track_kind, c.track_index, c.clip_key, c.name, c.enabled, c.start_frame, c.end_frame,
			        c.in_frame, c.out_frame, c.origin_class AS clip_class,
			        s.kind AS source_kind, s.source_key, s.name AS source_name, s.asset_id,
			        a.origin_class AS asset_class, a.ai_assisted, c.sort_order
			 FROM timeline_clips c
			 LEFT JOIN timeline_sources s ON s.id = c.source_id
			 LEFT JOIN assets a ON a.id = s.asset_id
			 WHERE c.timeline_id = ? ORDER BY c.sort_order, c.id`,
		)
		.all(timelineId) as unknown as ClipRow[];
	const tie = opts.tieBreak ?? ((id: number) => id);
	clips.sort((a, b) => a.sort_order - b.sort_order || tie(a.id) - tie(b.id));
	const fps = t.fps || null;
	return clips.map((c) => ({
		id: opts.segmentIdOf(c.id),
		clipId: c.clip_key,
		name: c.name,
		clipName: c.name,
		trackKind: c.track_kind,
		trackIndex: c.track_index,
		enabled: c.enabled === 1,
		startFrame: c.start_frame,
		endFrame: c.end_frame,
		inFrame: c.in_frame,
		outFrame: c.out_frame,
		startSeconds: fps ? c.start_frame / fps : null,
		endSeconds: fps ? c.end_frame / fps : null,
		sortOrder: c.sort_order,
		sourceKind: c.source_kind ?? "file",
		sourceKey: c.source_key ?? "",
		sourceName: c.source_name ?? "",
		matchedAssetRef: c.asset_id === null ? null : opts.refOf(c.asset_id),
		matched: c.asset_id !== null,
		originClass: c.clip_class || c.asset_class || null,
		aiAssisted: !c.clip_class && c.ai_assisted === 1,
	}));
}

/** A timeline's breakdown from its clips, with the same computeBreakdown the app used. */
export function breakdownOf(
	db: DatabaseSync,
	timelineId: number,
	opts: NamingOptions,
): unknown {
	const t = timelineRow(db, timelineId);
	return computeBreakdown(timelineSegments(db, timelineId, opts), {
		durationFrames: t.duration_frames,
		fps: t.fps,
		primaryTrackIndex: t.primary_track_index || 1,
		includeOverlays: t.include_overlays === 1,
	});
}
/** Recompute a timeline's breakdown cache. A cache, not a record: no history. */
export function refreshTimeline(db: DatabaseSync, timelineId: number): unknown {
	const breakdown = breakdownOf(db, timelineId, {
		refOf: (id) => String(id),
		segmentIdOf: (id) => id,
	});
	db.prepare("UPDATE timelines SET breakdown = ? WHERE id = ?").run(
		JSON.stringify(breakdown),
		timelineId,
	);
	return breakdown;
}

/** The output asset whose cut a timeline belongs to. */
function outputOf(db: DatabaseSync, timelineId: number): number | null {
	const row = db
		.prepare(
			"SELECT c.asset_id FROM timelines t JOIN contents c ON c.sha256 = t.content_sha256 WHERE t.id = ?",
		)
		.get(timelineId) as { asset_id: number } | undefined;
	return row?.asset_id ?? null;
}

/**
 * Refresh these timelines, then classify their outputs again from what is
 * now on screen (a classify run, with its rules: a person's or a confirmed
 * class is kept).
 */
export function refreshTimelines(
	db: DatabaseSync,
	timelineIds: readonly number[],
	opts: { tool: Tool; now?: string },
): void {
	if (!timelineIds.length) return;
	const outputs = new Set<number>();
	for (const id of timelineIds) {
		refreshTimeline(db, id);
		const out = outputOf(db, id);
		if (out !== null) outputs.add(out);
	}
	if (outputs.size)
		classifyCatalog(db, {
			tool: opts.tool,
			assetIds: [...outputs],
			now: opts.now ? () => opts.now! : undefined,
		});
}

/** The timelines that use an asset (any of their sources is matched to it). */
export function timelinesUsing(db: DatabaseSync, assetId: number): number[] {
	return (
		db
			.prepare(
				"SELECT DISTINCT timeline_id AS id FROM timeline_sources WHERE asset_id = ? ORDER BY timeline_id",
			)
			.all(assetId) as Array<{ id: number }>
	).map((r) => r.id);
}

/** One clip of a parsed timeline, as segmentsFromTimeline gives it, with its match. */
export interface TimelineSegment {
	clipId: string;
	name: string;
	trackKind: string;
	trackIndex: number;
	enabled: boolean;
	startFrame: number;
	endFrame: number;
	inFrame: number | null;
	outFrame: number | null;
	sourceKind: string;
	sourceKey: string | null;
	sourceName: string;
	sourcePath: string;
	/** The matched asset's id, as text (its ref), or null. */
	matchedAssetRef: string | null;
	matchMethod: string;
	matchConfidence: number;
}

export interface NewTimeline {
	/** The output whose cut this timeline made. */
	outputAssetId: number;
	/** The cut: a content of the output. */
	contentSha256: string;
	format: string;
	formatVersion: string;
	fileName: string;
	/** The timeline file's SHA-256; the caller keeps the file under timelines/. */
	fileSha256: string;
	sequence: {
		name: string;
		timebase: number | null;
		ntsc: boolean;
		fps: number | null;
		durationFrames: number | null;
		width: number | null;
		height: number | null;
	};
	notes: unknown[];
	primaryTrackIndex?: number;
	includeOverlays?: boolean;
	segments: TimelineSegment[];
}

/** A source's key: the file's own, else the kind and name of what made the clip. */
function sourceKeyOf(s: TimelineSegment): string {
	return s.sourceKey || `${s.sourceKind}:${s.sourceName || s.name}`;
}

/**
 * What a clip is, as far as its class goes, the same from one export of a
 * timeline to the next: its track kind, its name, and the asset it shows
 * (else the kind and name of what made it). Clip ids are not: an editor
 * numbers them afresh on each export.
 */
function clipIdentity(
	trackKind: string,
	clipName: string,
	assetId: number | null,
	sourceKind: string,
	sourceName: string,
): string {
	const source =
		assetId !== null
			? `asset:${assetId}`
			: `${sourceKind}:${sourceName || clipName}`;
	return JSON.stringify([trackKind, clipName, source]);
}

/**
 * The classes given to clips in the output's newest timeline, by clip
 * identity, to carry to a new import of it: a re-export of the edit would
 * otherwise drop them, and a class a person gave a clip that has no asset of
 * its own (a subclip, a nested sequence) would silently become unknown. A
 * clip identity given two different classes is left out; a class cleared in
 * the newest timeline is not brought back from an older one.
 */
function classesToCarry(
	db: DatabaseSync,
	outputAssetId: number,
): { fromTimelineId: number; classes: Map<string, string> } | null {
	// An edit's own newest timeline; for its first, the newest of the edit
	// it started from (D50).
	const previous =
		newestTimelineOf(db, outputAssetId) ??
		newestTimelineOf(db, startedFrom(db, outputAssetId));
	if (!previous) return null;
	return {
		fromTimelineId: previous.id,
		classes: classesToCarryFrom(db, previous.id),
	};
}

/** The clip classes in one timeline, by clip identity, leaving out any given two. */
function classesToCarryFrom(
	db: DatabaseSync,
	timelineId: number,
): Map<string, string> {
	const rows = db
		.prepare(
			`SELECT c.track_kind, c.name, c.origin_class, s.asset_id, s.kind, s.name AS source_name
			 FROM timeline_clips c LEFT JOIN timeline_sources s ON s.id = c.source_id
			 WHERE c.timeline_id = ? AND c.origin_class IS NOT NULL`,
		)
		.all(timelineId) as Array<{
		track_kind: string;
		name: string;
		origin_class: string;
		asset_id: number | null;
		kind: string | null;
		source_name: string | null;
	}>;
	const classes = new Map<string, string>();
	const mixed = new Set<string>();
	for (const r of rows) {
		const id = clipIdentity(
			r.track_kind,
			r.name,
			r.asset_id,
			r.kind ?? "",
			r.source_name ?? "",
		);
		if (classes.has(id) && classes.get(id) !== r.origin_class) mixed.add(id);
		else classes.set(id, r.origin_class);
	}
	for (const id of mixed) classes.delete(id);
	return classes;
}

function newestTimelineOf(
	db: DatabaseSync,
	assetId: number | null,
): { id: number } | undefined {
	if (assetId === null) return undefined;
	return db
		.prepare(
			`SELECT t.id FROM timelines t JOIN contents c ON c.sha256 = t.content_sha256
			 WHERE c.asset_id = ? ORDER BY t.id DESC LIMIT 1`,
		)
		.get(assetId) as { id: number } | undefined;
}

/**
 * The earlier edit this one started from (D50), if any: as its next revision
 * (`started_from`) or as something made from it (`made_from`, D60). Either
 * way its clip classes carry to this edit's first timeline.
 */
export function startedFrom(db: DatabaseSync, assetId: number): number | null {
	const row = db
		.prepare(
			"SELECT parent_id FROM relationships WHERE child_id = ? AND type IN ('started_from', 'made_from') ORDER BY id DESC LIMIT 1",
		)
		.get(assetId) as { parent_id: number } | undefined;
	return row?.parent_id ?? null;
}

/**
 * Give the clips of an edit's newest timeline the classes a person gave the
 * same clips in another edit's newest timeline (D50), for a timeline imported
 * before the edit started from that one. Only a clip nobody has given a class
 * keeps quiet now; one a person set or cleared is left as they left it.
 * @returns how many clips were given a class
 */
export function carryClassesInto(
	db: DatabaseSync,
	outputAssetId: number,
	fromAssetId: number,
	change: { actor: Actor; now?: string; evidence?: Record<string, unknown> },
	tool: Tool,
): number {
	const target = newestTimelineOf(db, outputAssetId);
	const source = newestTimelineOf(db, fromAssetId);
	if (!target || !source) return 0;
	const carry = classesToCarryFrom(db, source.id);
	const clips = db
		.prepare(
			`SELECT c.id, c.track_kind, c.name, s.asset_id, s.kind, s.name AS source_name
			 FROM timeline_clips c LEFT JOIN timeline_sources s ON s.id = c.source_id
			 WHERE c.timeline_id = ? AND c.origin_class IS NULL
			   AND NOT EXISTS (SELECT 1 FROM history h WHERE h.table_name = 'timeline_clips'
			     AND h.row_key = CAST(c.id AS TEXT) AND h.field = 'origin_class' AND h.old_value IS NOT NULL)`,
		)
		.all(target.id) as Array<{
		id: number;
		track_kind: string;
		name: string;
		asset_id: number | null;
		kind: string | null;
		source_name: string | null;
	}>;
	let n = 0;
	for (const c of clips) {
		const cls = carry.get(
			clipIdentity(
				c.track_kind,
				c.name,
				c.asset_id,
				c.kind ?? "",
				c.source_name ?? "",
			),
		);
		if (!cls) continue;
		editRow(
			db,
			"timeline_clips",
			c.id,
			{ origin_class: cls },
			{
				...change,
				evidence: { ...change.evidence, carried_from_timeline: source.id },
			},
		);
		n++;
	}
	if (n) refreshTimelines(db, [target.id], { tool, now: change.now });
	return n;
}

/**
 * Write an imported timeline: the timeline, a source for each file (or
 * generator, or nested sequence) with its match, and each clip. A clip that
 * had a class of its own in the output's previous timeline keeps it
 * (classesToCarry), recorded in its history. Each matched asset is linked to
 * the output (output_of), and the output is marked a finished edit unless a
 * person said otherwise. Then its breakdown is computed and the output
 * classified from it. One import run.
 * @returns the timeline's id, the run's, and how many clip classes were carried
 */
export function writeTimeline(
	db: DatabaseSync,
	input: NewTimeline,
	opts: { tool: Tool; now?: () => string },
): { timelineId: number; runId: number; carriedClasses: number } {
	const now = opts.now ?? (() => new Date().toISOString());
	const content = db
		.prepare("SELECT asset_id FROM contents WHERE sha256 = ?")
		.get(input.contentSha256) as { asset_id: number } | undefined;
	if (!content || content.asset_id !== input.outputAssetId)
		throw new EditError("The cut is not a file of this output");
	const runId = startRun(db, { kind: "timeline", tool: opts.tool, now: now() });
	const actor: Actor = {
		kind: "tool",
		name: `${opts.tool.name} ${opts.tool.version}`,
		runId,
	};
	const evidence = {
		timeline_file: input.fileSha256,
		file_name: input.fileName,
		format: input.format,
	};
	try {
		let carriedClasses = 0;
		const timelineId = inTransaction(db, () => {
			const at = now();
			const change = { actor, now: at, evidence };
			const carry = classesToCarry(db, input.outputAssetId);
			const fps = input.sequence.fps;
			const timelineId = Number(
				createRow(
					db,
					"timelines",
					{
						content_sha256: input.contentSha256,
						format: input.format,
						format_version: input.formatVersion,
						file_name: input.fileName,
						file_sha256: input.fileSha256,
						sequence_name: input.sequence.name,
						timebase: input.sequence.timebase,
						ntsc: input.sequence.ntsc ? 1 : 0,
						fps,
						duration_frames: input.sequence.durationFrames,
						width: input.sequence.width,
						height: input.sequence.height,
						primary_track_index: input.primaryTrackIndex ?? 1,
						include_overlays: input.includeOverlays ?? false,
						notes: JSON.stringify(input.notes ?? []),
						imported_at: at,
					},
					change,
				),
			);
			const sources = new Map<string, number>();
			const linked = new Set<number>();
			input.segments.forEach((s, i) => {
				const key = sourceKeyOf(s);
				let sourceId = sources.get(key);
				const assetId =
					s.matchedAssetRef === null ? null : Number(s.matchedAssetRef);
				if (sourceId === undefined) {
					sourceId = Number(
						createRow(
							db,
							"timeline_sources",
							{
								timeline_id: timelineId,
								source_key: key,
								kind: s.sourceKind,
								name: s.sourceName,
								path: s.sourcePath,
								asset_id: assetId,
								match_method: s.matchMethod,
								match_confidence: s.matchConfidence,
							},
							change,
						),
					);
					sources.set(key, sourceId);
				}
				const clipId = createRow(
					db,
					"timeline_clips",
					{
						timeline_id: timelineId,
						source_id: sourceId,
						track_kind: s.trackKind,
						track_index: s.trackIndex,
						clip_key: s.clipId ?? "",
						name: s.name ?? "",
						enabled: s.enabled ? 1 : 0,
						start_frame: s.startFrame,
						end_frame: s.endFrame,
						in_frame: s.inFrame,
						out_frame: s.outFrame,
						start_seconds: fps ? s.startFrame / fps : null,
						end_seconds: fps ? s.endFrame / fps : null,
						origin_class: null,
						sort_order: i,
					},
					change,
				);
				const carried = carry?.classes.get(
					clipIdentity(
						s.trackKind,
						s.name ?? "",
						assetId,
						s.sourceKind,
						s.sourceName,
					),
				);
				if (carried) {
					editRow(
						db,
						"timeline_clips",
						Number(clipId),
						{ origin_class: carried },
						{
							...change,
							evidence: {
								...evidence,
								carried_from_timeline: carry!.fromTimelineId,
							},
						},
					);
					carriedClasses++;
				}
				if (
					assetId !== null &&
					assetId !== input.outputAssetId &&
					!linked.has(assetId)
				) {
					linked.add(assetId);
					linkOutput(
						db,
						assetId,
						input.outputAssetId,
						s.matchConfidence,
						change,
					);
				}
			});
			markOutput(db, input.outputAssetId, change);
			finishRun(db, runId, {
				outcome: "ok",
				summary: {
					timeline: timelineId,
					clips: input.segments.length,
					sources: sources.size,
					matched: [...linked].length,
					carried_classes: carriedClasses,
				},
				now: now(),
			});
			return timelineId;
		});
		refreshTimelines(db, [timelineId], { tool: opts.tool, now: now() });
		return { timelineId, runId, carriedClasses };
	} catch (err) {
		// A failed write was rolled back, its run's ending with it; say so.
		const run = db
			.prepare("SELECT finished_at FROM runs WHERE id = ?")
			.get(runId) as { finished_at: string | null };
		if (run.finished_at === null)
			finishRun(db, runId, {
				outcome: "failed",
				summary: { error: (err as Error).message },
				now: now(),
			});
		throw err;
	}
}
/** Link an asset to the output that used it, once (output_of, by the timeline). */
function linkOutput(
	db: DatabaseSync,
	parent: number,
	output: number,
	confidence: number,
	change: { actor: Actor; now?: string; evidence?: Record<string, unknown> },
): void {
	if (
		db
			.prepare(
				"SELECT 1 FROM relationships WHERE parent_id = ? AND child_id = ? AND type = 'output_of'",
			)
			.get(parent, output)
	)
		return;
	createRow(
		db,
		"relationships",
		{
			parent_id: parent,
			child_id: output,
			type: "output_of",
			match_method: "timeline",
			confidence: confidence || 0.5,
		},
		change,
	);
}

/** Mark the output a finished edit (D10), unless a person set it. */
function markOutput(
	db: DatabaseSync,
	assetId: number,
	change: { actor: Actor; now?: string; evidence?: Record<string, unknown> },
): void {
	const by = db
		.prepare(
			"SELECT actor_kind FROM history WHERE table_name = 'assets' AND row_key = ? AND field = 'is_output' ORDER BY id DESC LIMIT 1",
		)
		.get(String(assetId)) as { actor_kind: string } | undefined;
	if (by && by.actor_kind !== "tool") return;
	editRow(
		db,
		"assets",
		assetId,
		{ is_output: true, output_source: "timeline" },
		change,
	);
}

/** A person's change to a timeline, with its effect on screen. */
export interface TimelineEdit {
	actor: Actor;
	note?: string;
	now?: string;
	tool: Tool;
}

function sourceOf(db: DatabaseSync, timelineId: number, sourceId: number) {
	const row = db
		.prepare("SELECT * FROM timeline_sources WHERE id = ? AND timeline_id = ?")
		.get(sourceId, timelineId) as Record<string, unknown> | undefined;
	if (!row) throw new NotFoundError("There is no such source in this timeline");
	return row;
}

/**
 * Say which asset a source is, or that it is none. Every clip of the source
 * follows. The method records the evidence: the file's path or bytes when
 * they agree with the asset picked, else a person's word.
 */
export function setSourceMatch(
	db: DatabaseSync,
	timelineId: number,
	sourceId: number,
	match: { assetId: number | null; method: string },
	opts: TimelineEdit,
): void {
	sourceOf(db, timelineId, sourceId);
	if (
		match.assetId !== null &&
		!db.prepare("SELECT 1 FROM assets WHERE id = ?").get(match.assetId)
	)
		throw new NotFoundError("There is no such asset");
	const change = { actor: opts.actor, note: opts.note ?? "", now: opts.now };
	inTransaction(db, () => {
		editRow(
			db,
			"timeline_sources",
			sourceId,
			match.assetId === null
				? { asset_id: null, match_method: "unmatched", match_confidence: 0 }
				: {
						asset_id: match.assetId,
						match_method: match.method,
						match_confidence: 1,
					},
			change,
		);
		const output = outputOf(db, timelineId);
		if (match.assetId !== null && output !== null && match.assetId !== output)
			linkOutput(db, match.assetId, output, 1, change);
		refreshTimelines(db, [timelineId], { tool: opts.tool, now: opts.now });
	});
}

/** Set one clip's own class, or (null) let it follow its source's asset. */
export function setClipClass(
	db: DatabaseSync,
	timelineId: number,
	clipId: number,
	originClass: string | null,
	opts: TimelineEdit,
): void {
	const clip = db
		.prepare("SELECT id FROM timeline_clips WHERE id = ? AND timeline_id = ?")
		.get(clipId, timelineId);
	if (!clip) throw new NotFoundError("There is no such clip in this timeline");
	inTransaction(db, () => {
		editRow(
			db,
			"timeline_clips",
			clipId,
			{ origin_class: originClass },
			{ actor: opts.actor, note: opts.note ?? "", now: opts.now },
		);
		refreshTimelines(db, [timelineId], { tool: opts.tool, now: opts.now });
	});
}

/** Which video track decides the headline numbers, and whether overlays count. */
export function setTimelineSettings(
	db: DatabaseSync,
	timelineId: number,
	settings: { primary_track_index?: number; include_overlays?: boolean },
	opts: TimelineEdit,
): string[] {
	if (!db.prepare("SELECT 1 FROM timelines WHERE id = ?").get(timelineId))
		throw new NotFoundError("There is no such timeline");
	return inTransaction(db, () => {
		const changed = editRow(db, "timelines", timelineId, settings, {
			actor: opts.actor,
			note: opts.note ?? "",
			now: opts.now,
		});
		if (changed.length)
			refreshTimelines(db, [timelineId], { tool: opts.tool, now: opts.now });
		return changed;
	});
}

/** Remove a timeline with its sources and clips; the history keeps each field's last value. */
export function removeTimeline(
	db: DatabaseSync,
	timelineId: number,
	opts: TimelineEdit,
): void {
	if (!db.prepare("SELECT 1 FROM timelines WHERE id = ?").get(timelineId))
		throw new NotFoundError("There is no such timeline");
	removeRow(db, "timelines", timelineId, {
		actor: opts.actor,
		note: opts.note ?? "",
		now: opts.now,
	});
}

/**
 * Save a creator statement for an output: the words and who says them. Each
 * save is a new row and the newest is the current one, so a statement signed
 * earlier is never changed underneath its signature. The row says who saved
 * it (format 3, D75): these are the words that get signed.
 */
export function saveStatement(
	db: DatabaseSync,
	assetId: number,
	statement: {
		text: string;
		author?: string;
		organization?: string;
		editedWith?: string;
	},
	opts: { now?: string; actor: Actor },
): number {
	if (!opts.actor?.name?.trim())
		throw new EditError("A statement is saved under somebody's name");
	const asset = db
		.prepare("SELECT is_output FROM assets WHERE id = ?")
		.get(assetId) as { is_output: number } | undefined;
	if (!asset) throw new NotFoundError("There is no such asset");
	if (asset.is_output !== 1)
		throw new EditError(
			"A creator statement is for a finished edit (an output)",
		);
	const text = String(statement.text ?? "").trim();
	if (!text) throw new EditError("A statement needs its words");
	const clip = (v: unknown, max: number) =>
		String(v ?? "")
			.trim()
			.slice(0, max);
	return Number(
		db
			.prepare(
				`INSERT INTO statements (asset_id, text, author, organization, edited_with, saved_at, saved_by, saved_by_kind)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				assetId,
				text.slice(0, 20_000),
				clip(statement.author, 500),
				clip(statement.organization, 500),
				clip(statement.editedWith, 500),
				opts.now ?? new Date().toISOString(),
				opts.actor.name.trim(),
				opts.actor.kind,
			).lastInsertRowid,
	);
}

/** One file of an asset, for matching a timeline's sources: where it lives, and its bytes. */
export interface MatchableFile {
	assetId: number;
	sha256: string;
	size: number;
	/** The live place it was last seen; null for a content with none (matched by bytes only). */
	rootId: number | null;
	path: string | null;
	originClass: string;
	originClassConfirmed: boolean;
	aiAssisted: boolean;
}

/** Every content of every asset not removed, with each of its live places. */
export function matchableFiles(db: DatabaseSync): MatchableFile[] {
	return (
		db
			.prepare(
				`SELECT c.asset_id, c.sha256, c.size, l.root_id, l.path,
				        a.origin_class, a.origin_class_confirmed, a.ai_assisted
				 FROM contents c JOIN assets a ON a.id = c.asset_id
				 LEFT JOIN locations l ON l.content_sha256 = c.sha256 AND l.gone_run_id IS NULL
				 WHERE a.removed_at IS NULL ORDER BY c.asset_id, c.rowid, l.id`,
			)
			.all() as Array<Record<string, unknown>>
	).map((r) => ({
		assetId: r.asset_id as number,
		sha256: r.sha256 as string,
		size: r.size as number,
		rootId: (r.root_id as number | null) ?? null,
		path: (r.path as string | null) ?? null,
		originClass: r.origin_class as string,
		originClassConfirmed: r.origin_class_confirmed === 1,
		aiAssisted: r.ai_assisted === 1,
	}));
}

/** A timeline with its sources, clips and breakdown, for a page to show. */
export function timelineRecord(db: DatabaseSync, id: number) {
	const t = db.prepare("SELECT * FROM timelines WHERE id = ?").get(id) as
		Record<string, unknown> | undefined;
	if (!t) return null;
	const parse = (v: unknown, fallback: unknown) => {
		try {
			return typeof v === "string" ? JSON.parse(v) : fallback;
		} catch {
			return fallback;
		}
	};
	const output = outputOf(db, id);
	return {
		id,
		outputAssetId: output,
		contentSha256: t.content_sha256 as string,
		format: t.format as string,
		formatVersion: t.format_version as string,
		fileName: t.file_name as string,
		fileSha256: t.file_sha256 as string,
		sequenceName: t.sequence_name as string,
		fps: t.fps as number | null,
		durationFrames: t.duration_frames as number | null,
		width: t.width as number | null,
		height: t.height as number | null,
		primaryTrackIndex: t.primary_track_index as number,
		includeOverlays: t.include_overlays === 1,
		notes: parse(t.notes, []),
		importedAt: t.imported_at as string,
		breakdown: parse(t.breakdown, null),
		sources: (
			db
				.prepare(
					`SELECT s.id, s.source_key, s.kind, s.name, s.path, s.asset_id, s.match_method, s.match_confidence,
					        a.title AS asset_title, a.origin_class AS asset_class,
					        a.origin_class_confirmed AS asset_confirmed, a.ai_assisted AS asset_ai,
					        (SELECT count(*) FROM timeline_clips c WHERE c.source_id = s.id) AS clips
					 FROM timeline_sources s LEFT JOIN assets a ON a.id = s.asset_id
					 WHERE s.timeline_id = ? ORDER BY s.id`,
				)
				.all(id) as Array<Record<string, unknown>>
		).map((s) => ({
			id: s.id as number,
			key: s.source_key as string,
			kind: s.kind as string,
			name: s.name as string,
			path: s.path as string,
			assetId: (s.asset_id as number | null) ?? null,
			assetTitle: (s.asset_title as string | null) ?? null,
			/** The matched asset's class, which the source's clips follow unless a clip has its own. */
			assetClass: (s.asset_class as string | null) ?? null,
			assetClassConfirmed: s.asset_confirmed === 1,
			assetAiAssisted: s.asset_ai === 1,
			matchMethod: s.match_method as string,
			matchConfidence: s.match_confidence as number,
			clips: s.clips as number,
		})),
		clips: (
			db
				.prepare(
					`SELECT id, source_id, track_kind, track_index, clip_key, name, enabled,
					        start_frame, end_frame, in_frame, out_frame, origin_class
					 FROM timeline_clips WHERE timeline_id = ? ORDER BY sort_order, id`,
				)
				.all(id) as Array<Record<string, unknown>>
		).map((c) => ({
			id: c.id as number,
			sourceId: (c.source_id as number | null) ?? null,
			trackKind: c.track_kind as string,
			trackIndex: c.track_index as number,
			clipKey: c.clip_key as string,
			name: c.name as string,
			enabled: c.enabled === 1,
			startFrame: c.start_frame as number,
			endFrame: c.end_frame as number,
			inFrame: (c.in_frame as number | null) ?? null,
			outFrame: (c.out_frame as number | null) ?? null,
			originClass: (c.origin_class as string | null) ?? null,
		})),
	};
}

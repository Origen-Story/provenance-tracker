// Importing an editing timeline into a project (D40): parse the file, keep it
// in the project as .provenancetracker/timelines/<sha256>, match each source
// to the project's assets by path, bytes or name, and write it. The pure
// parts are core's (timeline formats, matching, the breakdown, writeTimeline).

import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import {
	matchableFiles,
	writeTimeline,
	type TimelineSegment,
} from "@provenancetracker/core/catalog/timelines.ts";
import { fromCatalogPath } from "@provenancetracker/core/catalog/paths.ts";
import { segmentsFromTimeline } from "@provenancetracker/core/timeline/breakdown.js";
import { parseTimeline } from "@provenancetracker/core/timeline/formats/index.js";
import {
	buildMatchIndex,
	matchClips,
	matchesByClip,
	reconcileManualMatch,
	sourcesFromTimeline,
} from "@provenancetracker/core/timeline/match.js";
import { sha256OfFile } from "./hash.ts";
import type { Machine } from "./machine.ts";
import {
	PROJECT_DIR,
	placeWithoutReplacing,
	TIMELINES_DIR,
	type OpenProject,
} from "./project.ts";
import { listRoots } from "./roots.ts";
import { TOOL } from "./tool.ts";

/** Where a timeline file is kept in its project, by its SHA-256. */
export function timelineFilePath(
	projectFolder: string,
	sha256: string,
): string {
	return path.join(projectFolder, PROJECT_DIR, TIMELINES_DIR, sha256);
}

/** Keep the file's bytes under timelines/, once; an existing copy is left as it is. */
function keepFile(projectFolder: string, bytes: Buffer, sha256: string): void {
	const dest = timelineFilePath(projectFolder, sha256);
	if (existsSync(dest)) return;
	mkdirSync(path.dirname(dest), { recursive: true });
	const temp = `${dest}.${process.pid}.new`;
	try {
		writeFileSync(temp, bytes, { flag: "wx" });
		try {
			placeWithoutReplacing(temp, dest);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
		}
	} finally {
		rmSync(temp, { force: true });
	}
}

/** The project's files in the shape the matcher reads, with their paths on this machine. */
function matchIndex(project: OpenProject, machine: Machine) {
	const folders = new Map(
		listRoots(project, machine)
			.filter((r) => r.folder !== null)
			.map((r) => [r.id, r.folder!]),
	);
	return matchableFiles(project.db).map((f) => {
		const folder = f.rootId === null ? undefined : folders.get(f.rootId);
		const filePath =
			folder && f.path
				? fromCatalogPath(folder, f.path, machine.platform)
				: null;
		return {
			ref: String(f.assetId),
			assetId: f.assetId,
			filename: f.path ? f.path.slice(f.path.lastIndexOf("/") + 1) : "",
			filePath,
			originalFilePath: null,
			fileHash: f.sha256,
			fileSize: f.size,
			originClass: f.originClass,
			originClassConfirmed: f.originClassConfirmed,
			aiAssisted: f.aiAssisted,
		};
	});
}

/** Reading the files a timeline names, to match them by size or bytes. */
const io = {
	statSize: async (p: string) => (existsSync(p) ? statSync(p).size : null),
	hashFile: async (p: string) => (existsSync(p) ? sha256OfFile(p) : null),
};

/** The output's own newest file (never a signed copy): the cut a timeline belongs to by default. */
function ownCut(project: OpenProject, assetId: number): string | null {
	const row = project.db
		.prepare(
			`SELECT c.sha256 FROM contents c WHERE c.asset_id = ?
			   AND NOT EXISTS (SELECT 1 FROM signatures s WHERE s.signed_sha256 = c.sha256)
			 ORDER BY c.created_at DESC, c.rowid DESC LIMIT 1`,
		)
		.get(assetId) as { sha256: string } | undefined;
	return row?.sha256 ?? null;
}

export interface TimelineImport {
	timelineId: number;
	runId: number;
	format: string;
	sources: number;
	matched: number;
	clips: number;
}

/**
 * Import a timeline file for an output. The file's bytes are kept in the
 * project; its sources are matched to the project's files on this machine.
 */
export async function importTimeline(
	project: OpenProject,
	machine: Machine,
	opts: {
		outputAssetId: number;
		bytes: Buffer;
		fileName: string;
		/** The cut it belongs to; the output's own newest file by default. */
		contentSha256?: string;
		primaryTrackIndex?: number;
		includeOverlays?: boolean;
		now?: () => string;
	},
): Promise<TimelineImport> {
	const decoded = opts.bytes.toString("utf8");
	// A byte-order mark at the start is not part of the XML.
	const text = decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded;
	const parsed = parseTimeline(text);
	const content = opts.contentSha256 ?? ownCut(project, opts.outputAssetId);
	if (!content)
		throw new Error("This output has no file of its own to hang a timeline on");
	const sha256 = createHash("sha256").update(opts.bytes).digest("hex");
	keepFile(project.folder, opts.bytes, sha256);

	const index = buildMatchIndex(matchIndex(project, machine));
	const bySource = await matchClips(sourcesFromTimeline(parsed), index, io);
	const segments = segmentsFromTimeline(
		parsed,
		matchesByClip(parsed, bySource),
	) as TimelineSegment[];
	const { timelineId, runId } = writeTimeline(
		project.db,
		{
			outputAssetId: opts.outputAssetId,
			contentSha256: content,
			format: parsed.format,
			formatVersion: String(parsed.version ?? ""),
			fileName: path.basename(opts.fileName || "timeline.xml"),
			fileSha256: sha256,
			sequence: {
				name: parsed.sequence.name ?? "",
				timebase: parsed.sequence.timebase ?? null,
				ntsc: !!parsed.sequence.ntsc,
				fps: parsed.sequence.fps || null,
				durationFrames: parsed.sequence.durationFrames ?? null,
				width: parsed.sequence.width ?? null,
				height: parsed.sequence.height ?? null,
			},
			notes: parsed.notes ?? [],
			primaryTrackIndex: opts.primaryTrackIndex,
			includeOverlays: opts.includeOverlays,
			segments,
		},
		{ tool: TOOL, now: opts.now },
	);
	return {
		timelineId,
		runId,
		format: parsed.format,
		sources: bySource.size,
		matched: [...bySource.values()].filter((m) => m.asset).length,
		clips: segments.length,
	};
}

/**
 * The evidence for a person's pick of an asset for a source: the file's own
 * path or bytes when they agree with the asset picked (stronger than a
 * person's word), else "manual".
 */
export async function matchEvidence(
	project: OpenProject,
	machine: Machine,
	sourcePath: string,
	assetId: number,
): Promise<string> {
	const files = matchIndex(project, machine).filter(
		(f) => f.assetId === assetId,
	);
	if (!files.length) return "manual";
	const hash = sourcePath
		? await io.hashFile(sourcePath).catch(() => null)
		: null;
	for (const f of files) {
		const m = reconcileManualMatch({ path: sourcePath, hash }, f);
		if (m.method !== "manual") return m.method;
	}
	return "manual";
}

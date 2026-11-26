// Importing an editing timeline into a project (D40): parse the file, keep it
// in the project as .provenancetracker/timelines/<sha256>, match each source
// to the project's assets by path, bytes or name, and write it. The pure
// parts are core's (timeline formats, matching, the breakdown, writeTimeline).
// A path the timeline names is opened only inside the project's media
// folders (D65).

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
import { openTimeline } from "@provenancetracker/core/timeline/formats/index.js";
import { mayOpenSourcePath } from "@provenancetracker/core/timeline/source-paths.ts";
import { chooseSequence } from "@provenancetracker/core/timeline/sequence-choice.js";
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

/** What reading a file takes; given so a test can see what would be opened. */
export interface SourceFiles {
	exists: (file: string) => boolean;
	size: (file: string) => number;
	hash: (file: string) => Promise<string>;
}

const DISK: SourceFiles = {
	exists: existsSync,
	size: (file) => statSync(file).size,
	hash: sha256OfFile,
};

/**
 * Reading the files a timeline names, to match them by size or bytes: only
 * inside the project's media folders (D65). A timeline is a file from
 * somewhere else, and a path it names may be anywhere, another computer
 * included; any path outside those folders is answered as if no file were
 * there, without being touched.
 * @param folders the project's media folders on this machine
 */
export function sourceReader(
	folders: readonly string[],
	platform: Machine["platform"],
	files: SourceFiles = DISK,
) {
	const here = (p: string) =>
		mayOpenSourcePath(p, folders, platform) && files.exists(p);
	return {
		statSize: async (p: string) => (here(p) ? files.size(p) : null),
		hashFile: async (p: string) => (here(p) ? files.hash(p) : null),
	};
}

/** The reader for a project: its media folders that are here now. */
function readerFor(project: OpenProject, machine: Machine) {
	return sourceReader(
		listRoots(project, machine)
			.filter((r) => r.status === "ok" && r.folder !== null)
			.map((r) => r.folder!),
		machine.platform,
	);
}

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

/** A sequence of a timeline file, as a person chooses among them. */
export interface SequenceChoice {
	index: number;
	name: string;
	seconds: number | null;
}

/**
 * The timeline file holds several sequences and none can be told to be this
 * edit's (Phase 8 step 6): import again with `sequence` set to one of
 * `choices`. Nothing was kept or written.
 */
export class SequenceChoiceError extends Error {
	choices: SequenceChoice[];
	constructor(message: string, choices: SequenceChoice[]) {
		super(message);
		this.name = "SequenceChoiceError";
		this.choices = choices;
	}
}

/** The length of one of the project's files, as its reading says; null if unknown. */
function secondsOf(project: OpenProject, sha256: string): number | null {
	const row = project.db
		.prepare("SELECT duration_seconds FROM technical WHERE content_sha256 = ?")
		.get(sha256) as { duration_seconds: number | null } | undefined;
	return row?.duration_seconds ?? null;
}

export interface TimelineImport {
	timelineId: number;
	runId: number;
	format: string;
	sources: number;
	matched: number;
	clips: number;
	/** Clips given the class they had in the previous import of this edit. */
	carriedClasses: number;
	/** Which sequence of the file was imported, and how it was chosen. */
	sequence: {
		index: number;
		name: string;
		of: number;
		by: "chosen" | "only" | "length";
	};
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
		/** Which of the file's sequences, by its index, when it holds several. */
		sequence?: number | null;
		now?: () => string;
	},
): Promise<TimelineImport> {
	const decoded = opts.bytes.toString("utf8");
	// A byte-order mark at the start is not part of the XML.
	const text = decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded;
	const content = opts.contentSha256 ?? ownCut(project, opts.outputAssetId);
	if (!content)
		throw new Error("This output has no file of its own to hang a timeline on");
	// A whole-project export holds every sequence: never take the first
	// without saying so (Phase 8 step 6). The file is read once, for the list
	// and for the sequence chosen from it.
	const timeline = openTimeline(text);
	const list = timeline.sequences();
	const choice = chooseSequence(list, {
		requested: opts.sequence ?? null,
		outputSeconds: secondsOf(project, content),
	});
	if ("refuse" in choice)
		throw new SequenceChoiceError(
			choice.refuse,
			choice.choices.map((c: SequenceChoice) => ({
				index: c.index,
				name: c.name,
				seconds: c.seconds,
			})),
		);
	const parsed = timeline.parse({ sequence: choice.index });
	const sha256 = createHash("sha256").update(opts.bytes).digest("hex");
	keepFile(project.folder, opts.bytes, sha256);

	const index = buildMatchIndex(matchIndex(project, machine));
	const bySource = await matchClips(
		sourcesFromTimeline(parsed),
		index,
		readerFor(project, machine),
	);
	const segments = segmentsFromTimeline(
		parsed,
		matchesByClip(parsed, bySource),
	) as TimelineSegment[];
	const { timelineId, runId, carriedClasses } = writeTimeline(
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
		carriedClasses,
		sequence: {
			index: choice.index,
			name: parsed.sequence.name ?? "",
			of: list.length,
			by: choice.by,
		},
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
	// The path is the timeline's word, kept in the catalog: as at import, it
	// is opened only inside the project's media folders.
	const hash = sourcePath
		? await readerFor(project, machine)
				.hashFile(sourcePath)
				.catch(() => null)
		: null;
	for (const f of files) {
		const m = reconcileManualMatch({ path: sourcePath, hash }, f);
		if (m.method !== "manual") return m.method;
	}
	return "manual";
}

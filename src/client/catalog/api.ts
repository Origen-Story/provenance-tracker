// The new pages' one way to call the catalog API (/api, D36). Every
// call answers with its JSON or throws an ApiError carrying the API's own
// words, which pages show as they are.

export class ApiError extends Error {
	status: number;
	/** The answer's body, for a refusal that says more than its message (a timeline's sequences to choose from). */
	data: unknown;
	constructor(status: number, message: string, data: unknown = null) {
		super(message);
		this.status = status;
		this.data = data;
	}
}

const BASE = "/api";

export async function api<T>(
	method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
	path: string,
	body?: unknown,
): Promise<T> {
	// Files go as form data, which sets its own content type; the rest as JSON.
	const form = body instanceof FormData;
	const res = await fetch(BASE + path, {
		method,
		headers:
			body === undefined || form ? {} : { "content-type": "application/json" },
		body: body === undefined ? undefined : form ? body : JSON.stringify(body),
	});
	const text = await res.text();
	let json: unknown = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		/* not JSON: the status line says what happened */
	}
	if (!res.ok) {
		const words =
			(json as { error?: string } | null)?.error ??
			`${res.status} ${res.statusText}`;
		throw new ApiError(res.status, words, json);
	}
	return json as T;
}

// --- Projects ---

export type ProjectStatus =
	"ok" | "folder missing" | "no catalog" | "not readable" | "another project";

export interface KnownProject {
	projectId: string;
	folder: string;
	name: string | null;
	status: ProjectStatus;
	detail?: string;
}

export interface Root {
	id: number;
	name: string;
	note: string;
	folder: string | null;
	inProject: boolean;
	status: "ok" | "not located on this machine" | "folder missing";
	warnings: string[];
}

export interface ProjectSummary {
	projectId: string;
	name: string;
	folder: string;
	settings: Record<string, string>;
	roots: Root[];
	counts: {
		assets: number;
		byKind: Record<string, number>;
		unsorted: number;
		outputs: number;
		removed: number;
	};
	lastRuns: Array<{
		kind: string;
		finishedAt: string | null;
		outcome: string | null;
	}>;
}

export const projects = {
	list: () => api<{ projects: KnownProject[] }>("GET", "/projects"),
	open: (folder: string) =>
		api<{ projectId: string; name: string; folder: string }>(
			"POST",
			"/projects/open",
			{
				folder,
			},
		),
	create: (folder: string, name: string) =>
		api<{ projectId: string; name: string; folder: string }>(
			"POST",
			"/projects",
			{
				fields: { folder, name },
			},
		),
	summary: (projectId: string) =>
		api<ProjectSummary>("GET", `/projects/${projectId}`),
	/** Change the project's settings (packages/core/src/catalog/fields.ts EDITABLE_META). */
	editSettings: (
		projectId: string,
		fields: Record<string, string>,
		note = "",
	) =>
		api<{ changed: string[]; settings: Record<string, string> }>(
			"PATCH",
			`/projects/${projectId}/settings`,
			{ fields, note },
		),
	/** Forget the project on this machine; its folder is not touched. */
	forget: (projectId: string) =>
		api<{ forgotten: string; projects: KnownProject[] }>(
			"DELETE",
			`/projects/${projectId}`,
		),
};

// --- This machine (packages/core-node/src/settings.ts) ---

export const machine = {
	get: () => api<{ person: string | null }>("GET", "/machine"),
	setPerson: (person: string) =>
		api<{ person: string }>("PATCH", "/machine", { fields: { person } }),
};

// --- Assets (packages/core/src/catalog/read.ts, edits.ts) ---

export interface FilePlace {
	root: string;
	path: string;
}

export interface AssetSummary {
	id: number;
	code: string | null;
	kind: string;
	title: string;
	publicTitle: string;
	displayTitle: string;
	originClass: string;
	originClassConfirmed: boolean;
	isOutput: boolean;
	aiAssisted: boolean;
	file: (FilePlace & { sha256: string; size: number }) | null;
	versions: number;
	updatedAt: string;
	removedAt: string | null;
}

export interface AssetFilter {
	kind?: string;
	class?: string;
	position?: string;
	outputs?: boolean;
	q?: string;
	removed?: boolean | "only";
	limit?: number;
	offset?: number;
}

export interface Reading {
	id: number;
	kind: string;
	extractor: string;
	version: string;
	status: string;
	observedAt: string;
	fromSidecar: boolean;
}

export interface Credit {
	id: number;
	role: string;
	name: string;
	on_behalf_of: string;
	stated_by: string;
	sort_order: number;
}

export interface Relationship {
	id: number;
	direction: "parent" | "child";
	otherAssetId: number;
	otherTitle: string;
	type: string;
	matchMethod: string;
	confidence: number;
	note: string;
}

export interface AssetRecord {
	id: number;
	fields: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
	contents: Array<{
		sha256: string;
		size: number;
		createdAt: string;
		signedCopy: boolean;
		places: Array<FilePlace & { live: boolean }>;
		technical: Record<string, unknown> | null;
		readings: Reading[];
	}>;
	credits: Credit[];
	generation: Record<string, unknown> | null;
	relationships: Relationship[];
	timelines: Array<{
		id: number;
		contentSha256: string;
		fileName: string;
		sequenceName: string;
		importedAt: string;
	}>;
	statements: Array<{
		id: number;
		text: string;
		author: string;
		organization: string;
		editedWith: string;
		savedAt: string;
	}>;
	signatures: Array<{
		id: number;
		kind: string;
		version: number;
		sourceSha256: string;
		signedSha256: string;
		engine: string;
		engineVersion: string;
		signerName: string;
		identity: { name: string; status: string } | null;
		status: string;
		timestamped: boolean;
		signedAt: string;
		/** Where this signed copy is published (D56); null if never. */
		publication: Publication | null;
	}>;
	history: Array<{
		at: string;
		actorKind: string;
		actor: string;
		field: string;
		oldValue: unknown;
		newValue: unknown;
		note: string;
	}>;
}

export interface ReadingInFull {
	id: number;
	kind: string;
	extractor: string;
	version: string;
	status: string;
	data: unknown;
	error: string | null;
	warnings: unknown[];
	validation: unknown;
	observedAt: string;
}

type Fields = Record<string, unknown>;
type Answer = { changed?: string[]; asset: AssetRecord };

function searchOf(filter: AssetFilter): string {
	const p = new URLSearchParams();
	for (const [k, v] of Object.entries(filter)) {
		if (v === undefined || v === "" || v === false) continue;
		p.set(k, v === true ? "1" : String(v));
	}
	const s = p.toString();
	return s ? `?${s}` : "";
}

/** The address of a file's bytes, for previews: the server finds it by its SHA-256. */
export const fileUrl = (projectId: string, sha256: string) =>
	`${BASE}/projects/${projectId}/contents/${sha256}/file`;

export const assets = {
	list: (projectId: string, filter: AssetFilter) =>
		api<{ total: number; assets: AssetSummary[] }>(
			"GET",
			`/projects/${projectId}/assets${searchOf(filter)}`,
		),
	get: (projectId: string, id: number) =>
		api<AssetRecord>("GET", `/projects/${projectId}/assets/${id}`),
	edit: (projectId: string, id: number, fields: Fields, note = "") =>
		api<Answer>("PATCH", `/projects/${projectId}/assets/${id}`, {
			fields,
			note,
		}),
	remove: (projectId: string, id: number, note = "") =>
		api<Answer>("POST", `/projects/${projectId}/assets/${id}/remove`, {
			note,
		}),
	restore: (projectId: string, id: number, note = "") =>
		api<Answer>("POST", `/projects/${projectId}/assets/${id}/restore`, {
			note,
		}),
	/** Start a new export from an earlier edit: as its next revision, or made from it (D60). */
	startFrom: (
		projectId: string,
		id: number,
		fromId: number,
		as: "revision" | "made_from" = "revision",
	) =>
		api<
			Answer & {
				copied: {
					from: number;
					fields: string[];
					credits: number;
					statement: boolean;
					thumbnail: boolean;
					clipClasses: number;
				};
			}
		>("POST", `/projects/${projectId}/assets/${id}/start-from`, {
			fields: { from_id: fromId, as },
		}),
	/** Pick the image the edit is shown by in its credentials, or none (D52). */
	setThumbnail: (projectId: string, id: number, imageId: number | null) =>
		api<Answer>("PUT", `/projects/${projectId}/assets/${id}/thumbnail`, {
			fields: { image_id: imageId },
		}),
	addCredit: (projectId: string, id: number, fields: Fields) =>
		api<Answer>("POST", `/projects/${projectId}/assets/${id}/credits`, {
			fields,
		}),
	editCredit: (projectId: string, id: number, credit: number, fields: Fields) =>
		api<Answer>(
			"PATCH",
			`/projects/${projectId}/assets/${id}/credits/${credit}`,
			{ fields },
		),
	removeCredit: (projectId: string, id: number, credit: number) =>
		api<Answer>(
			"DELETE",
			`/projects/${projectId}/assets/${id}/credits/${credit}`,
			{},
		),
	setGeneration: (projectId: string, id: number, fields: Fields) =>
		api<Answer>("PUT", `/projects/${projectId}/assets/${id}/generation`, {
			fields,
		}),
	link: (projectId: string, fields: Fields) =>
		api<{ id: number }>("POST", `/projects/${projectId}/relationships`, {
			fields,
		}),
	unlink: (projectId: string, linkId: number) =>
		api<{ removed: number }>(
			"DELETE",
			`/projects/${projectId}/relationships/${linkId}`,
			{},
		),
	reading: (projectId: string, id: number) =>
		api<ReadingInFull>("GET", `/projects/${projectId}/observations/${id}`),
};

// --- Media folders, adding files, and the work on them (D39) ---

export type JobKind =
	"scan" | "extract" | "classify" | "import" | "download" | "sign";

export interface Job {
	id: string;
	projectId: string;
	kind: JobKind;
	state: "running" | "done" | "failed" | "cancelled";
	startedAt: string;
	finishedAt: string | null;
	progress: { step: string; done: number; total: number; file: string } | null;
	/** What the job reported when it finished; its shape depends on the kind. */
	result: unknown;
	error: string | null;
}

export interface Placed {
	root: string;
	path: string;
	/** Placed under another name, as one was already taken. */
	renamed: boolean;
}

export const media = {
	addRoot: (projectId: string, name: string, folder: string, note: string) =>
		api<{ roots: Root[] }>("POST", `/projects/${projectId}/roots`, {
			fields: { name, folder, note },
		}),
	editRoot: (
		projectId: string,
		root: string,
		fields: { name?: string; note?: string },
	) =>
		api<{ roots: Root[] }>(
			"PATCH",
			`/projects/${projectId}/roots/${encodeURIComponent(root)}`,
			{ fields },
		),
	locateRoot: (projectId: string, root: string, folder: string) =>
		api<{ roots: Root[] }>(
			"POST",
			`/projects/${projectId}/roots/${encodeURIComponent(root)}/locate`,
			{ fields: { folder } },
		),
	upload: (projectId: string, root: string, folder: string, files: File[]) => {
		const form = new FormData();
		for (const file of files) form.append("files", file, file.name);
		const q = new URLSearchParams({ root, folder });
		// job is null, with a note, when other work began while the files arrived.
		return api<{ placed: Placed[]; job: Job | null; note?: string }>(
			"POST",
			`/projects/${projectId}/files?${q}`,
			form,
		);
	},
	download: (projectId: string, url: string, root: string, folder: string) =>
		api<{ job: Job }>("POST", `/projects/${projectId}/downloads`, {
			fields: { url, root, folder },
		}),
	start: (
		projectId: string,
		kind: "scan" | "extract" | "classify" | "import",
		roots?: string[],
	) =>
		api<{ job: Job }>("POST", `/projects/${projectId}/jobs`, {
			fields: roots?.length ? { kind, roots } : { kind },
		}),
	jobs: (projectId: string) =>
		api<{ jobs: Job[] }>("GET", `/projects/${projectId}/jobs`),
	cancel: (projectId: string, jobId: string) =>
		api<{ job: Job }>(
			"POST",
			`/projects/${projectId}/jobs/${jobId}/cancel`,
			{},
		),
};

// --- Finished edits: timelines, statements, signing, the public export (D40, D41) ---

export interface TimelineSource {
	id: number;
	key: string;
	/** file, sequence (a nested one) or generator (a title or matte). */
	kind: string;
	name: string;
	path: string;
	assetId: number | null;
	assetTitle: string | null;
	/** The matched asset's class, which the source's clips follow unless a clip has its own. */
	assetClass: string | null;
	assetClassConfirmed: boolean;
	assetAiAssisted: boolean;
	matchMethod: string;
	matchConfidence: number;
	clips: number;
}

export interface TimelineClip {
	id: number;
	sourceId: number | null;
	trackKind: "video" | "audio";
	trackIndex: number;
	clipKey: string;
	name: string;
	enabled: boolean;
	startFrame: number;
	endFrame: number;
	inFrame: number | null;
	outFrame: number | null;
	/** A person's class for this clip alone; null follows its source's asset. */
	originClass: string | null;
}

/** One lane of the composition (D10): what plays when, per spectrum position. Read by the strip as it is. */
export type Lane = Record<string, unknown> & {
	intervals: Array<Record<string, unknown>>;
};

export interface Breakdown {
	durationFrames: number | null;
	fps: number | null;
	durationSeconds: number | null;
	composition: {
		durationSeconds: number | null;
		picture?: Lane;
		audio?: Lane;
	} | null;
	counts: {
		segments: number;
		unmatched: number;
		generators: number;
		nested: number;
		disabled: number;
	};
}

export interface Timeline {
	id: number;
	outputAssetId: number | null;
	contentSha256: string;
	format: string;
	formatVersion: string;
	fileName: string;
	fileSha256: string;
	sequenceName: string;
	fps: number | null;
	durationFrames: number | null;
	width: number | null;
	height: number | null;
	primaryTrackIndex: number;
	includeOverlays: boolean;
	notes: string[];
	importedAt: string;
	breakdown: Breakdown | null;
	sources: TimelineSource[];
	clips: TimelineClip[];
}

/** An assertion in a source's own credentials that says something about a person, a place or a device (D62). */
export interface RevealItem {
	uri: string;
	manifest: string;
	label: string;
	kind:
		"identity" | "metadata" | "author" | "location" | "device" | "generation";
	what: string;
	values: string[];
	redactable: boolean;
}

/** A source whose own credentials would travel into the signed film, and what they would reveal (D62). */
export interface SourceReveal {
	assetId: number;
	title: string;
	parent: boolean;
	reveal: {
		manifests: number;
		signers: string[];
		items: RevealItem[];
		otherAssertions: number;
		/** Why its credentials could not be read; they can then only be left out. */
		unreadable?: string;
	};
}

/** What the last signing of an edit kept out, as it applies to the sources now (D63). */
export interface WithheldBefore {
	/** Where the next signing starts: addresses to redact, and sources to leave out. */
	redact: string[];
	leaveOut: number[];
	/** Each redaction the last signing made, in words, with its address or addresses now. */
	redactions: Array<{ assetId: number | null; what: string; now: string[] }>;
	/** The sources the last signing left out. */
	leftOut: number[];
	/** What was found again in a changed file, and what was dropped, in sentences. */
	notes: string[];
}

export interface StatementIngredient {
	ref: string;
	title: string;
	publicTitle: string;
	originClass: string;
	position: string;
	classSetBy: "creator" | "proposal";
	fileCredentials: "none" | "unreadable" | "present";
	classClaimedByFile: string | null;
	signedBy: string;
	signerName: string;
	aiAssisted: boolean;
	note: string;
	pictureSeconds: number | null;
	audioSeconds: number | null;
}

/** The creator statement as signing would build it now (manifest/build.js). */
export interface BuiltStatement {
	text: string;
	author: string;
	organization: string;
	editedWith: string;
	output: {
		title: string;
		publicTitle: string;
		originClass: string;
		sequence: string;
		durationSeconds: number | null;
		fps: number | null;
	};
	composition: { picture?: Lane; audio?: Lane };
	ingredients: StatementIngredient[];
	unresolved: Array<{
		clip: string;
		track: string;
		startSeconds: number | null;
		endSeconds: number | null;
		reason: string;
	}>;
	editorGeneratedClips: number;
}

export interface SigningStatus {
	configured: boolean;
	problem: string | null;
	/** What the certificate says. The API never sends its path. */
	certificate: {
		commonName: string;
		issuer: string;
		fingerprint: string;
		validTo: string;
	} | null;
}

export const outputs = {
	/**
	 * Import a timeline file for an output. A file holding several sequences
	 * may need `sequence` (its index): without one the answer is 409 with the
	 * sequences to choose from (timelineSequences reads them off the error).
	 */
	importTimeline: (
		projectId: string,
		assetId: number,
		file: File,
		sequence: number | null = null,
	) => {
		const form = new FormData();
		form.append("timeline", file, file.name);
		if (sequence !== null) form.append("sequence", String(sequence));
		return api<{
			import: {
				timelineId: number;
				sources: number;
				matched: number;
				clips: number;
				carriedClasses: number;
				sequence: { index: number; name: string; of: number; by: string };
			};
			timeline: Timeline;
		}>("POST", `/projects/${projectId}/assets/${assetId}/timelines`, form);
	},
	timeline: (projectId: string, timelineId: number) =>
		api<Timeline>("GET", `/projects/${projectId}/timelines/${timelineId}`),
	setTimeline: (
		projectId: string,
		timelineId: number,
		fields: { primary_track_index?: number; include_overlays?: boolean },
	) =>
		api<{ changed: string[]; timeline: Timeline }>(
			"PATCH",
			`/projects/${projectId}/timelines/${timelineId}`,
			{ fields },
		),
	/** Say which asset a source is, or null for none. */
	matchSource: (
		projectId: string,
		timelineId: number,
		sourceId: number,
		assetId: number | null,
	) =>
		api<{ timeline: Timeline }>(
			"PATCH",
			`/projects/${projectId}/timelines/${timelineId}/sources/${sourceId}`,
			{ fields: { asset_id: assetId } },
		),
	/** A class for one clip alone, or null to follow its source. */
	setClipClass: (
		projectId: string,
		timelineId: number,
		clipId: number,
		originClass: string | null,
	) =>
		api<{ timeline: Timeline }>(
			"PATCH",
			`/projects/${projectId}/timelines/${timelineId}/clips/${clipId}`,
			{ fields: { origin_class: originClass } },
		),
	removeTimeline: (projectId: string, timelineId: number) =>
		api<{ removed: number }>(
			"DELETE",
			`/projects/${projectId}/timelines/${timelineId}`,
			{},
		),
	saveStatement: (
		projectId: string,
		assetId: number,
		fields: {
			text: string;
			author: string;
			organization: string;
			edited_with: string;
		},
	) =>
		api<Answer>("POST", `/projects/${projectId}/assets/${assetId}/statements`, {
			fields,
		}),
	preview: (projectId: string, assetId: number) =>
		api<{
			statement: BuiltStatement | null;
			blockers: string[];
			/** The asset each ingredient is, in the statement's order. */
			ingredientAssetIds: number[];
			thumbnailAssetId: number | null;
			/** The creator's identity signing would add (D55), when one is set up here. */
			identity: {
				name: string;
				issuer: string;
				validTo: string;
				covers: string[];
				role: string;
				authorDiffers: boolean;
			} | null;
			/** What each source's own credentials would reveal inside the signed film (D62). */
			reveals: SourceReveal[];
			/** What the newest signing of this edit kept out; null before the first. */
			lastWithheld: WithheldBefore | null;
		}>("GET", `/projects/${projectId}/assets/${assetId}/statement-preview`),
	signing: (projectId: string) =>
		api<SigningStatus>("GET", `/projects/${projectId}/signing`),
	setSigning: (projectId: string, certificate: string, privateKey: string) =>
		api<SigningStatus>("PUT", `/projects/${projectId}/signing`, {
			fields: { certificate, private_key: privateKey },
		}),
	clearSigning: (projectId: string) =>
		api<SigningStatus>("DELETE", `/projects/${projectId}/signing`, {}),
	/** The creator's identity certificate and key for this project here (D55): the same shape as signing. */
	identity: (projectId: string) =>
		api<SigningStatus>("GET", `/projects/${projectId}/identity`),
	setIdentity: (projectId: string, certificate: string, privateKey: string) =>
		api<SigningStatus>("PUT", `/projects/${projectId}/identity`, {
			fields: { certificate, private_key: privateKey },
		}),
	clearIdentity: (projectId: string) =>
		api<SigningStatus>("DELETE", `/projects/${projectId}/identity`, {}),
	/**
	 * Sign an asset: an output gets a signed copy, a source asset a sidecar.
	 * A job. `timestamp: true` asks the tracker's time-stamp server.
	 */
	sign: (projectId: string, assetId: number, fields: Fields) =>
		api<{ job: Job }>("POST", `/projects/${projectId}/assets/${assetId}/sign`, {
			fields,
		}),
	/** Where a signed copy is published (D56): https addresses, or "" for none. */
	setPublication: (
		projectId: string,
		signatureId: number,
		fields: { file_url?: string; page_url?: string },
	) =>
		api<{ publication: Publication | null; asset: AssetRecord }>(
			"PUT",
			`/projects/${projectId}/signatures/${signatureId}/publication`,
			{ fields },
		),
	publicExportUrl: (projectId: string, signatureId: number) =>
		`${BASE}/projects/${projectId}/signatures/${signatureId}/public-export`,
	publicExport: (projectId: string, signatureId: number) =>
		api<PublicExport>(
			"GET",
			`/projects/${projectId}/signatures/${signatureId}/public-export`,
		),
};

/** A sequence of a timeline file, as the server offers them when it cannot choose. */
export interface SequenceChoice {
	index: number;
	name: string;
	seconds: number | null;
}

/** The sequences a refused timeline import offers, or null when it was refused for another reason. */
export function timelineSequences(error: unknown): SequenceChoice[] | null {
	if (!(error instanceof ApiError) || error.status !== 409) return null;
	const list = (error.data as { sequences?: SequenceChoice[] } | null)
		?.sequences;
	return Array.isArray(list) ? list : null;
}

/** A finished edit as the revisions view shows it (D60). */
export interface EditSummary {
	assetId: number;
	title: string;
	fileName: string;
	signed: number;
	published: number;
	removed: boolean;
}

/** A finished edit's revisions, what it was made from and what was made from it, and its re-renders (D60). */
export interface Revisions {
	line: Array<EditSummary & { depth: number; current: boolean }>;
	madeFrom: EditSummary | null;
	deliverables: EditSummary[];
	renders: Array<{
		sha256: string;
		createdAt: string;
		signedVersions: number[];
	}>;
}

export const revisions = {
	of: (projectId: string, id: number) =>
		api<Revisions>("GET", `/projects/${projectId}/assets/${id}/revisions`),
	/** Whether this edit is the next revision of the one it started from, or made from it. */
	setRelation: (projectId: string, id: number, as: "revision" | "made_from") =>
		api<{ revisions: Revisions; asset: AssetRecord }>(
			"PUT",
			`/projects/${projectId}/assets/${id}/relation`,
			{ fields: { as } },
		),
};

/** Where a signed copy is published (D56). */
export interface Publication {
	fileUrl: string;
	pageUrl: string;
}

/** The public export of one signing (manifest/public-export.js): what a public page shows. */
export interface PublicExport {
	film: { title: string; durationSeconds: number | null };
	statement: { text: string };
	ingredients: Array<{ title: string; fileName: string }>;
	composition: { picture?: Lane; audio?: Lane };
	untracked: unknown[];
	signedFile: {
		fileName: string;
		bytes: number;
		sha256: string;
		version: number | null;
		url: string | null;
	};
	page: { url: string | null };
	/** Export format 2 (D57): the file, the signer and the identity, read apart. */
	file: { status: "matches" | "changed" | "unchecked"; hashVerified: boolean };
	signer: {
		status: string;
		statusLabel: string;
		commonName: string;
		timeStamp: {
			time: string | null;
			authority: string;
			trusted: boolean | null;
		} | null;
	};
	identity: { status: string; name: string; roles: string[] } | null;
	withheld: { fromRecord: number; fromSignedFile: number };
}

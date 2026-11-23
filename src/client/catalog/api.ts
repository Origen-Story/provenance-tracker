// The new pages' one way to call the catalog API (/api/next, D36). Every
// call answers with its JSON or throws an ApiError carrying the API's own
// words, which pages show as they are.

export class ApiError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

const BASE = "/api/next";

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
		throw new ApiError(res.status, words);
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
		signerName: string;
		status: string;
		timestamped: boolean;
		signedAt: string;
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

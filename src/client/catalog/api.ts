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
	const res = await fetch(BASE + path, {
		method,
		headers: body === undefined ? {} : { "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
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

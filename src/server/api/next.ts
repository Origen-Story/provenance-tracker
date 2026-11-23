// The app's API on the catalogs (roadmap Phase 6). It grows beside the old
// Postgres routes under /api/next, page by page, and becomes /api when the
// old routes are removed. Routes stay thin: the work is core's (SQL on a
// catalog) and core-node's (opening catalogs, this machine's settings).
//
// A project is named in the URL by its id; this machine's settings say which
// folder holds it. Each request opens the catalog and closes it again.

import { Router, type Request, type Response } from "express";
import {
	assetRecord,
	listAssets,
	projectSummary,
	type AssetFilter,
} from "@provenancetracker/core/catalog/read.ts";
import type { Actor } from "@provenancetracker/core/catalog/edit.ts";
import {
	addCredit,
	editAsset,
	EditError,
	editCredit,
	editSettings,
	linkAssets,
	NotFoundError,
	removeCredit,
	setGeneration,
	setRemoved,
	unlink,
	type PersonEdit,
} from "@provenancetracker/core/catalog/edits.ts";
import type { Machine } from "@provenancetracker/core-node/machine.ts";
import { TOOL } from "@provenancetracker/core-node/tool.ts";
import {
	openProject,
	type OpenProject,
} from "@provenancetracker/core-node/project.ts";
import { knownProjects } from "@provenancetracker/core-node/projects.ts";
import { listRoots } from "@provenancetracker/core-node/roots.ts";
import { readSettings } from "@provenancetracker/core-node/settings.ts";

/** An error with the HTTP status it should answer with. */
export class HttpError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Open the project the URL names, run `fn`, and close it again. */
function withProject<T>(
	machine: Machine,
	projectId: string,
	fn: (project: OpenProject) => T,
): T {
	if (!UUID.test(projectId))
		throw new HttpError(404, "There is no such project");
	const folder = readSettings(machine.settingsPath).projects[projectId]?.folder;
	if (!folder)
		throw new HttpError(
			404,
			"This machine does not know that project. Open its folder first.",
		);
	let project: OpenProject;
	try {
		project = openProject(folder, { machine });
	} catch (err) {
		throw new HttpError(409, (err as Error).message);
	}
	try {
		if (project.projectId !== projectId)
			throw new HttpError(
				409,
				`${folder} now holds another project (${project.name}). Open the folder this project moved to.`,
			);
		return fn(project);
	} finally {
		project.db.close();
	}
}

/** A whole number from a query value, or undefined. */
function queryNumber(value: unknown): number | undefined {
	if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
	return Number(value);
}

const queryText = (value: unknown) =>
	typeof value === "string" && value !== "" ? value : undefined;

const queryFlag = (value: unknown) => value === "1" || value === "true";

/** The person edits are recorded under: this machine's settings, never the request. */
function person(machine: Machine): Actor {
	const name = readSettings(machine.settingsPath).person?.trim();
	if (!name)
		throw new HttpError(
			409,
			'Edits are recorded under your name. Set it once with: npm run cli -- settings person "Your Name"',
		);
	return { kind: "person", name };
}

/** A request body's `fields` (what to set) and `note` (why). */
function editBody(req: Request): {
	fields: Record<string, unknown>;
	note: string;
} {
	const body = req.body as { fields?: unknown; note?: unknown };
	const fields = body.fields ?? {};
	if (!fields || typeof fields !== "object" || Array.isArray(fields))
		throw new HttpError(400, 'Send the values to set as { "fields": { ... } }');
	if (body.note !== undefined && typeof body.note !== "string")
		throw new HttpError(400, "A note is text");
	return {
		fields: fields as Record<string, unknown>,
		note: (body.note as string) ?? "",
	};
}

/** Open the project, make the edit under the person's name, and answer the caller's mistakes in words. */
function withEdit<T>(
	machine: Machine,
	req: Request,
	fn: (
		project: OpenProject,
		opts: PersonEdit,
		fields: Record<string, unknown>,
	) => T,
): T {
	const { fields, note } = editBody(req);
	const opts: PersonEdit = { actor: person(machine), note, tool: TOOL };
	return withProject(machine, String(req.params.projectId), (project) => {
		try {
			return fn(project, opts, fields);
		} catch (err) {
			if (err instanceof EditError) throw new HttpError(400, err.message);
			if (err instanceof NotFoundError) throw new HttpError(404, err.message);
			throw err;
		}
	});
}

/** A whole-number id from the URL; 404 when it is not one. */
function idParam(value: unknown, what: string): number {
	const id = queryNumber(value);
	if (id === undefined) throw new HttpError(404, `There is no such ${what}`);
	return id;
}

export function catalogApi(opts: { machine: Machine }): Router {
	const { machine } = opts;
	const api = Router();

	api.get("/projects", (_req: Request, res: Response) => {
		res.json({ projects: knownProjects(machine) });
	});

	// Open a project folder: its catalog, recorded in this machine's settings.
	api.post("/projects/open", (req: Request, res: Response) => {
		const folder = (req.body as { folder?: unknown }).folder;
		if (typeof folder !== "string" || !folder.trim())
			throw new HttpError(400, "Say which folder to open");
		let project: OpenProject;
		try {
			project = openProject(folder, { machine });
		} catch (err) {
			throw new HttpError(409, (err as Error).message);
		}
		try {
			res.json({
				projectId: project.projectId,
				name: project.name,
				folder: project.folder,
				upgraded: project.upgraded,
			});
		} finally {
			project.db.close();
		}
	});

	api.get("/projects/:projectId", (req: Request, res: Response) => {
		withProject(machine, String(req.params.projectId), (project) => {
			res.json({
				...projectSummary(project.db),
				projectId: project.projectId,
				name: project.name,
				folder: project.folder,
				roots: listRoots(project, machine).map(
					({ id, name, note, folder, inProject, status, warnings }) => ({
						id,
						name,
						note,
						folder,
						inProject,
						status,
						warnings,
					}),
				),
			});
		});
	});

	api.get("/projects/:projectId/assets", (req: Request, res: Response) => {
		const q = req.query;
		const filter: AssetFilter = {
			kind: queryText(q.kind),
			originClass: queryText(q.class),
			outputs: queryFlag(q.outputs),
			q: queryText(q.q),
			removed: queryFlag(q.removed),
			limit: queryNumber(q.limit),
			offset: queryNumber(q.offset),
		};
		withProject(machine, String(req.params.projectId), (project) => {
			res.json(listAssets(project.db, filter));
		});
	});

	api.get(
		"/projects/:projectId/assets/:assetId",
		(req: Request, res: Response) => {
			const id = queryNumber(req.params.assetId);
			withProject(machine, String(req.params.projectId), (project) => {
				const record = id === undefined ? null : assetRecord(project.db, id);
				if (!record) throw new HttpError(404, "There is no such asset");
				res.json(record);
			});
		},
	);

	// One reading in full: what an extractor said about a file.
	api.get(
		"/projects/:projectId/observations/:observationId",
		(req: Request, res: Response) => {
			const id = queryNumber(req.params.observationId);
			withProject(machine, String(req.params.projectId), (project) => {
				const row =
					id === undefined
						? undefined
						: (project.db
								.prepare(
									`SELECT id, content_sha256, source_sha256, kind, extractor, extractor_version,
									        status, data, error, warnings, validation, observed_at
									 FROM observations WHERE id = ?`,
								)
								.get(id) as Record<string, unknown> | undefined);
				if (!row) throw new HttpError(404, "There is no such reading");
				const parse = (v: unknown) =>
					typeof v === "string" ? JSON.parse(v) : null;
				res.json({
					id: row.id,
					contentSha256: row.content_sha256,
					sourceSha256: row.source_sha256,
					kind: row.kind,
					extractor: row.extractor,
					version: row.extractor_version,
					status: row.status,
					data: parse(row.data),
					error: row.error,
					warnings: parse(row.warnings) ?? [],
					validation: parse(row.validation),
					observedAt: row.observed_at,
				});
			});
		},
	);

	// --- Edits, each under the person's name with its history (D38) ---

	api.patch("/projects/:projectId/settings", (req: Request, res: Response) => {
		withEdit(machine, req, (project, opts, fields) => {
			const changed = editSettings(project.db, fields, opts);
			res.json({ changed, settings: projectSummary(project.db).settings });
		});
	});

	const answerAsset = (
		project: OpenProject,
		res: Response,
		id: number,
		changed?: string[],
	) =>
		res.json({
			...(changed ? { changed } : {}),
			asset: assetRecord(project.db, id),
		});

	api.patch(
		"/projects/:projectId/assets/:assetId",
		(req: Request, res: Response) => {
			const id = idParam(req.params.assetId, "asset");
			withEdit(machine, req, (project, opts, fields) =>
				answerAsset(project, res, id, editAsset(project.db, id, fields, opts)),
			);
		},
	);

	for (const [action, removed] of [
		["remove", true],
		["restore", false],
	] as const)
		api.post(
			`/projects/:projectId/assets/:assetId/${action}`,
			(req: Request, res: Response) => {
				const id = idParam(req.params.assetId, "asset");
				withEdit(machine, req, (project, opts) => {
					setRemoved(project.db, id, removed, opts);
					answerAsset(project, res, id);
				});
			},
		);

	api.post(
		"/projects/:projectId/assets/:assetId/credits",
		(req: Request, res: Response) => {
			const id = idParam(req.params.assetId, "asset");
			withEdit(machine, req, (project, opts, fields) => {
				addCredit(project.db, id, fields, opts);
				answerAsset(project, res, id);
			});
		},
	);

	api.patch(
		"/projects/:projectId/assets/:assetId/credits/:creditId",
		(req: Request, res: Response) => {
			const id = idParam(req.params.assetId, "asset");
			const credit = idParam(req.params.creditId, "credit");
			withEdit(machine, req, (project, opts, fields) =>
				answerAsset(
					project,
					res,
					id,
					editCredit(project.db, id, credit, fields, opts),
				),
			);
		},
	);

	api.delete(
		"/projects/:projectId/assets/:assetId/credits/:creditId",
		(req: Request, res: Response) => {
			const id = idParam(req.params.assetId, "asset");
			const credit = idParam(req.params.creditId, "credit");
			withEdit(machine, req, (project, opts) => {
				removeCredit(project.db, id, credit, opts);
				answerAsset(project, res, id);
			});
		},
	);

	api.put(
		"/projects/:projectId/assets/:assetId/generation",
		(req: Request, res: Response) => {
			const id = idParam(req.params.assetId, "asset");
			withEdit(machine, req, (project, opts, fields) =>
				answerAsset(
					project,
					res,
					id,
					setGeneration(project.db, id, fields, opts),
				),
			);
		},
	);

	api.post(
		"/projects/:projectId/relationships",
		(req: Request, res: Response) => {
			withEdit(machine, req, (project, opts, fields) => {
				res.json({ id: linkAssets(project.db, fields, opts) });
			});
		},
	);

	api.delete(
		"/projects/:projectId/relationships/:linkId",
		(req: Request, res: Response) => {
			const id = idParam(req.params.linkId, "link");
			withEdit(machine, req, (project, opts) => {
				unlink(project.db, id, opts);
				res.json({ removed: id });
			});
		},
	);

	return api;
}

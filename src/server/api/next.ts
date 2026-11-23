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
import type { Machine } from "@provenancetracker/core-node/machine.ts";
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

	return api;
}

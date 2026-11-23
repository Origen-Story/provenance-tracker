// The app's API on the catalogs (roadmap Phase 6). It grows beside the old
// Postgres routes under /api/next, page by page, and becomes /api when the
// old routes are removed. Routes stay thin: the work is core's (SQL on a
// catalog) and core-node's (opening catalogs, this machine's settings).
//
// A project is named in the URL by its id; this machine's settings say which
// folder holds it. Each request opens the catalog and closes it again.

import { lookup as dnsLookup } from "node:dns/promises";
import { rmSync } from "node:fs";
import {
	Router,
	type NextFunction,
	type Request,
	type Response,
} from "express";
import multer from "multer";
import { classifyCatalog } from "@provenancetracker/core/catalog/classify.ts";
import { editRow } from "@provenancetracker/core/catalog/edit.ts";
import {
	extractProject,
	machineReaders,
	type Reader,
} from "@provenancetracker/core-node/extract.ts";
import {
	incomingFolder,
	placeFile,
	targetFolder,
} from "@provenancetracker/core-node/incoming.ts";
import { importFiles } from "@provenancetracker/core-node/pipeline.ts";
import {
	addRoot,
	locateRoot,
	renameRoot,
} from "@provenancetracker/core-node/roots.ts";
import { scanProject } from "@provenancetracker/core-node/scan.ts";
import { USER_AGENT } from "../lib/user-agent.js";
import { download } from "./download.ts";
import { BusyError, JobRunner, type JobKind } from "./jobs.ts";
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

/** Open the project with this id, as this machine's settings place it. The caller closes it. */
function openById(machine: Machine, projectId: string): OpenProject {
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
	if (project.projectId !== projectId) {
		project.db.close();
		throw new HttpError(
			409,
			`${folder} now holds another project (${project.name}). Open the folder this project moved to.`,
		);
	}
	return project;
}

/** Open the project the URL names, run `fn`, and close it again. */
function withProject<T>(
	machine: Machine,
	projectId: string,
	fn: (project: OpenProject) => T,
): T {
	const project = openById(machine, projectId);
	try {
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

/** What a job reports: the counts, not every file. */
function summarise(r: Awaited<ReturnType<typeof importFiles>>) {
	return {
		cancelled: r.cancelled,
		scan: r.scan && {
			runId: r.scan.runId,
			outcome: r.scan.outcome,
			counts: r.scan.counts,
			skipped: r.scan.skipped.length,
		},
		extract: r.extract && {
			runId: r.extract.runId,
			outcome: r.extract.outcome,
			contents: r.extract.contents,
			written: r.extract.written,
		},
		classify: r.classify && {
			runId: r.classify.runId,
			examined: r.classify.examined,
			changed: r.classify.changed,
		},
	};
}

/** A whole-number id from the URL; 404 when it is not one. */
function idParam(value: unknown, what: string): number {
	const id = queryNumber(value);
	if (id === undefined) throw new HttpError(404, `There is no such ${what}`);
	return id;
}

export interface CatalogApiOptions {
	machine: Machine;
	/** The jobs this server runs (one runner per server). */
	jobs?: JobRunner;
	/** What extract reads files with; this machine's ExifTool and c2patool when not given. */
	readers?: () => Promise<Reader[]>;
	/** For downloads; tests give their own, so no test reaches the network. */
	fetchImpl?: (url: string, init: RequestInit) => Promise<globalThis.Response>;
	lookup?: (hostname: string) => Promise<Array<{ address: string }>>;
}

const JOB_KINDS: readonly string[] = ["scan", "extract", "classify", "import"];

export function catalogApi(opts: CatalogApiOptions): Router {
	const { machine } = opts;
	const jobs = opts.jobs ?? new JobRunner();
	const readers = opts.readers ?? (() => machineReaders(machine));
	const lookup =
		opts.lookup ?? ((host: string) => dnsLookup(host, { all: true }));
	const api = Router();

	/** Start a job that opens the project for as long as it runs. */
	const startJob = (
		projectId: string,
		kind: JobKind,
		run: (
			project: OpenProject,
			ctx: {
				signal: AbortSignal;
				progress: (p: {
					step: string;
					done: number;
					total: number;
					file: string;
				}) => void;
			},
		) => Promise<unknown>,
	) => {
		openById(machine, projectId).db.close(); // refuse now, not later, if it cannot be opened
		try {
			return jobs.start(projectId, kind, async (ctx) => {
				const project = openById(machine, projectId);
				try {
					return await run(project, ctx);
				} finally {
					project.db.close();
				}
			});
		} catch (err) {
			if (err instanceof BusyError) throw new HttpError(409, err.message);
			throw err;
		}
	};

	/** The import a job runs after files arrive: scan, read and classify, in the roots given. */
	const runImport = async (
		project: OpenProject,
		roots: string[] | undefined,
		ctx: {
			signal: AbortSignal;
			progress: (p: {
				step: string;
				done: number;
				total: number;
				file: string;
			}) => void;
		},
	) =>
		summarise(
			await importFiles(project, machine, {
				roots,
				readers: await readers(),
				signal: ctx.signal,
				onProgress: ctx.progress,
			}),
		);

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

	// --- Jobs: scan, read, classify, import (D39) ---

	api.post("/projects/:projectId/jobs", (req: Request, res: Response) => {
		const { fields } = editBody(req);
		const kind = String(fields.kind ?? "");
		if (!JOB_KINDS.includes(kind))
			throw new HttpError(400, `A job is one of ${JOB_KINDS.join(", ")}`);
		const roots = fields.roots;
		if (
			roots !== undefined &&
			(!Array.isArray(roots) || roots.some((r) => typeof r !== "string"))
		)
			throw new HttpError(400, "roots is a list of root names");
		const projectId = String(req.params.projectId);
		const job = startJob(projectId, kind as JobKind, async (project, ctx) => {
			const scope = roots as string[] | undefined;
			if (kind === "import") return runImport(project, scope, ctx);
			if (kind === "scan") {
				const r = await scanProject(project, machine, {
					roots: scope,
					signal: ctx.signal,
					onProgress: (p) =>
						ctx.progress({
							step: "scan",
							done: p.hashed,
							total: p.toHash,
							file: p.file,
						}),
				});
				return {
					runId: r.runId,
					outcome: r.outcome,
					counts: r.counts,
					skipped: r.skipped.length,
				};
			}
			if (kind === "extract") {
				const r = await extractProject(project, machine, {
					roots: scope,
					readers: await readers(),
					signal: ctx.signal,
					onProgress: (p) =>
						ctx.progress({
							step: "extract",
							done: p.done,
							total: p.total,
							file: p.file,
						}),
				});
				return {
					runId: r.runId,
					outcome: r.outcome,
					contents: r.contents,
					written: r.written,
				};
			}
			const r = classifyCatalog(project.db, { tool: TOOL });
			return { runId: r.runId, examined: r.examined, changed: r.changed };
		});
		res.status(202).json({ job });
	});

	api.get("/projects/:projectId/jobs", (req: Request, res: Response) => {
		res.json({ jobs: jobs.list(String(req.params.projectId)) });
	});

	api.get("/projects/:projectId/jobs/:jobId", (req: Request, res: Response) => {
		const job = jobs.get(
			String(req.params.projectId),
			String(req.params.jobId),
		);
		if (!job) throw new HttpError(404, "There is no such job");
		res.json({ job });
	});

	api.post(
		"/projects/:projectId/jobs/:jobId/cancel",
		(req: Request, res: Response) => {
			const job = jobs.cancel(
				String(req.params.projectId),
				String(req.params.jobId),
			);
			if (!job) throw new HttpError(404, "There is no such job");
			res.json({ job });
		},
	);

	// --- Roots: where the project's files are ---

	const rootsOf = (project: OpenProject) =>
		listRoots(project, machine).map(
			({ id, name, note, folder, inProject, status, warnings }) => ({
				id,
				name,
				note,
				folder,
				inProject,
				status,
				warnings,
			}),
		);

	/** Run a roots change, answering its refusals (a folder that is not there, overlaps) as the caller's to fix. */
	const rootChange = (
		req: Request,
		res: Response,
		fn: (
			project: OpenProject,
			actor: Actor,
			fields: Record<string, unknown>,
		) => void,
	) =>
		withEdit(machine, req, (project, opts, fields) => {
			try {
				fn(project, opts.actor, fields);
			} catch (err) {
				if (err instanceof HttpError) throw err;
				throw new HttpError(400, (err as Error).message);
			}
			res.json({ roots: rootsOf(project) });
		});

	// Adding or moving a root takes a folder from the person on purpose: which
	// folder holds their media is theirs to say (docs/threat-model.md).
	api.post("/projects/:projectId/roots", (req: Request, res: Response) =>
		rootChange(req, res, (project, actor, fields) => {
			const { name, folder, note } = fields as {
				name?: unknown;
				folder?: unknown;
				note?: unknown;
			};
			if (typeof name !== "string" || typeof folder !== "string")
				throw new HttpError(400, "A root needs a name and a folder");
			addRoot(project, machine, {
				name,
				folder,
				note: typeof note === "string" ? note : "",
				actor,
			});
		}),
	);

	api.post(
		"/projects/:projectId/roots/:root/locate",
		(req: Request, res: Response) =>
			rootChange(req, res, (project, actor, fields) => {
				if (typeof fields.folder !== "string")
					throw new HttpError(400, "Say which folder the root is in");
				locateRoot(project, machine, {
					name: String(req.params.root),
					folder: fields.folder,
					actor: () => actor,
				});
			}),
	);

	api.patch("/projects/:projectId/roots/:root", (req: Request, res: Response) =>
		rootChange(req, res, (project, actor, fields) => {
			const unknown = Object.keys(fields).filter(
				(k) => k !== "name" && k !== "note",
			);
			if (unknown.length)
				throw new HttpError(
					400,
					`A root has no field ${unknown.join(", ")} that can be set`,
				);
			const root = String(req.params.root);
			if (typeof fields.note === "string") {
				const row = listRoots(project, machine).find((r) => r.name === root);
				if (!row)
					throw new HttpError(404, `This project has no root called "${root}"`);
				editRow(project.db, "roots", row.id, { note: fields.note }, { actor });
			}
			if (typeof fields.name === "string")
				renameRoot(project, { name: root, newName: fields.name, actor });
		}),
	);

	// --- Adding files: uploads and downloads, into a folder inside a root ---

	/** The folder inside a root that the request names, checked and made; the caller's mistakes as 400. */
	const target = (project: OpenProject, root: unknown, folder: unknown) => {
		if (typeof root !== "string" || !root)
			throw new HttpError(400, "Say which root the files go into");
		try {
			return targetFolder(
				project,
				machine,
				root,
				typeof folder === "string" ? folder : "",
			);
		} catch (err) {
			throw new HttpError(400, (err as Error).message);
		}
	};

	const upload = multer({
		storage: multer.diskStorage({
			destination: (_req, _file, cb) =>
				cb(null, (_req as Request & { incoming: string }).incoming),
			// Never the browser's name on disk until the file is placed.
			filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.part`),
		}),
		limits: { files: 200 },
		// Browsers send a file's name as UTF-8; the parser's default, Latin-1,
		// would turn "Plaça" into "PlaÃ§a".
		defParamCharset: "utf8",
	});

	api.post(
		"/projects/:projectId/files",
		(req: Request, _res: Response, next: NextFunction) => {
			// Check the project, the person and the target before taking a byte.
			person(machine);
			withProject(machine, String(req.params.projectId), (project) => {
				const t = target(project, req.query.root, req.query.folder);
				Object.assign(req, {
					target: t,
					incoming: incomingFolder(project.folder),
				});
			});
			next();
		},
		(req: Request, res: Response, next: NextFunction) =>
			upload.array("files")(req, res, (err: unknown) =>
				err ? next(new HttpError(400, (err as Error).message)) : next(),
			),
		(req: Request, res: Response) => {
			const files = (req.files ?? []) as Express.Multer.File[];
			const t = (req as Request & { target: ReturnType<typeof target> }).target;
			try {
				if (!files.length)
					throw new HttpError(400, 'Send the files as form field "files"');
				const placed = files.map((f) =>
					placeFile(f.path, t, f.originalname, machine),
				);
				const projectId = String(req.params.projectId);
				const job = startJob(projectId, "import", (project, ctx) =>
					runImport(project, [t.root], ctx),
				);
				res.status(202).json({
					placed: placed.map(({ root, path, renamed }) => ({
						root,
						path,
						renamed,
					})),
					job,
				});
			} finally {
				for (const f of files) rmSync(f.path, { force: true });
			}
		},
	);

	api.post("/projects/:projectId/downloads", (req: Request, res: Response) => {
		const { fields } = editBody(req);
		const unknown = Object.keys(fields).filter(
			(k) => !["url", "root", "folder"].includes(k),
		);
		if (unknown.length)
			throw new HttpError(400, `A download has no field ${unknown.join(", ")}`);
		if (typeof fields.url !== "string" || !fields.url.trim())
			throw new HttpError(400, "Give the address of the file");
		const url = fields.url.trim();
		const actor = person(machine);
		const projectId = String(req.params.projectId);
		const t = withProject(machine, projectId, (project) =>
			target(project, fields.root, fields.folder),
		);
		const job = startJob(projectId, "download", async (project, ctx) => {
			ctx.progress({ step: "download", done: 0, total: 1, file: url });
			const got = await download({
				url,
				incoming: incomingFolder(project.folder),
				userAgent: USER_AGENT,
				lookup,
				fetchImpl: opts.fetchImpl,
				signal: ctx.signal,
			});
			const placed = placeFile(got.file, t, got.name, machine);
			const imported = await runImport(project, [t.root], ctx);
			const content = project.db
				.prepare("SELECT asset_id FROM contents WHERE sha256 = ?")
				.get(got.sha256) as { asset_id: number } | undefined;
			// Where it came from and when, as the person's own record of it.
			if (content) {
				const asset = project.db
					.prepare("SELECT source_url, access_date FROM assets WHERE id = ?")
					.get(content.asset_id) as { source_url: string; access_date: string };
				const fill: Record<string, unknown> = {};
				if (!asset.source_url) fill.source_url = url;
				if (!asset.access_date)
					fill.access_date = new Date().toISOString().slice(0, 10);
				if (Object.keys(fill).length)
					editAsset(project.db, content.asset_id, fill, {
						actor,
						tool: TOOL,
						note: "downloaded from this address",
					});
			}
			return {
				placed: {
					root: placed.root,
					path: placed.path,
					renamed: placed.renamed,
				},
				mediaType: got.mediaType,
				size: got.size,
				sha256: got.sha256,
				assetId: content?.asset_id ?? null,
				import: imported,
			};
		});
		res.status(202).json({ job });
	});

	return api;
}

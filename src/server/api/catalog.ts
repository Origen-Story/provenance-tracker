// The app's API, on /api, on the project catalogs (roadmap Phase 6; it was
// /api/next while the old Postgres routes still held /api). Routes stay thin: the work is core's (SQL on a
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
import {
	importTimeline,
	SequenceChoiceError,
	matchEvidence,
} from "@provenancetracker/core-node/timeline-import.ts";
import {
	removeTimeline,
	saveStatement,
	setClipClass,
	setSourceMatch,
	setTimelineSettings,
	timelineRecord,
} from "@provenancetracker/core/catalog/timelines.ts";
import { ORIGIN_CLASSES } from "@provenancetracker/core/origin-vocabulary.js";
import { USER_AGENT } from "../lib/user-agent.js";
import { download } from "./download.ts";
import { showable, streamFile } from "./stream.ts";
import { signAsset } from "@provenancetracker/core-node/sign/sign-asset.ts";
import {
	NotReadyError,
	previewOutputStatement,
	signOutput,
	TIMESTAMP_URL,
	type SigningEngine,
} from "@provenancetracker/core-node/sign/sign-output.ts";
import { signingEngineFor } from "@provenancetracker/core-node/sign/engines/index.ts";
import {
	clearIdentity,
	clearSigning,
	identityStatus,
	setIdentity,
	setSigning,
	signingStatus,
} from "@provenancetracker/core-node/sign/signing-settings.ts";
import { publicExport } from "@provenancetracker/core/catalog/signatures.ts";
import {
	revisionsOf,
	type EditRelation,
} from "@provenancetracker/core/catalog/revisions.ts";
import { fromCatalogPath } from "@provenancetracker/core/catalog/paths.ts";
import { existsSync } from "node:fs";
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
	PUBLICATION_FIELDS,
	setGeneration,
	setPublication,
	setEditRelation,
	setRemoved,
	setThumbnail,
	startFromEdit,
	unlink,
	type PersonEdit,
} from "@provenancetracker/core/catalog/edits.ts";
import type { Machine } from "@provenancetracker/core-node/machine.ts";
import { TOOL } from "@provenancetracker/core-node/tool.ts";
import {
	createProject,
	NoCatalogError,
	openProject,
	ProjectElsewhereError,
	type OpenProject,
} from "@provenancetracker/core-node/project.ts";
import {
	forgetProject,
	knownProjects,
} from "@provenancetracker/core-node/projects.ts";
import { listRoots } from "@provenancetracker/core-node/roots.ts";
import {
	decideWebCredentialHost,
	readSettings,
	setWebCredentialMode,
	signingEngineOf,
	updateSettings,
	webCredentialChoiceOf,
	type Settings,
} from "@provenancetracker/core-node/settings.ts";
import { credentialsWaiting } from "@provenancetracker/core/catalog/on-the-web.ts";
import {
	BUILT_IN_HOSTS,
	WEB_CREDENTIAL_MODES,
	hostStateNow,
	listedHost,
	type WebCredentialMode,
} from "@provenancetracker/core/extraction/web-credentials.ts";

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
			'Edits are recorded under your name. Set it once on the Projects page, under "Your name on this machine".',
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

/**
 * What this machine does about Content Credentials a file keeps on the web
 * (D74), as a page shows it: the mode (null until chosen), and the lists.
 */
function webCredentialsView(settings: Settings) {
	const choice = webCredentialChoiceOf(settings);
	return {
		mode: choice.mode,
		builtIn: [...BUILT_IN_HOSTS],
		hosts: [...choice.hosts],
		left: [...choice.left],
	};
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
	/** What signs; this machine's engine (the C2PA library unless its settings say c2patool) when not given. */
	signingEngine?: (machine: Machine) => Promise<SigningEngine>;
}

const JOB_KINDS: readonly string[] = ["scan", "extract", "classify", "import"];

export function catalogApi(opts: CatalogApiOptions): Router {
	const { machine } = opts;
	const jobs = opts.jobs ?? new JobRunner();
	const readers = opts.readers ?? (() => machineReaders(machine));
	const lookup =
		opts.lookup ?? ((host: string) => dnsLookup(host, { all: true }));
	const signingEngine =
		opts.signingEngine ?? ((m: Machine) => signingEngineFor(m));
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

	// This machine's own settings that a page may show or change: the name
	// edits are recorded under. Where projects and their media are here is
	// changed by opening, placing and forgetting, never set whole.
	api.get("/machine", (_req: Request, res: Response) => {
		const s = readSettings(machine.settingsPath);
		res.json({
			person: s.person ?? null,
			credentialsOnTheWeb: webCredentialsView(s),
		});
	});

	// What this machine does about Content Credentials a file keeps on the
	// web (D74): the mode, and one host at a time on or off its lists.
	api.put("/machine/credentials-on-the-web", (req: Request, res: Response) => {
		const { fields } = editBody(req);
		const unknown = Object.keys(fields).filter((k) => k !== "mode");
		if (unknown.length)
			throw new HttpError(400, `There is no field ${unknown.join(", ")} here`);
		const mode = fields.mode;
		if (!(WEB_CREDENTIAL_MODES as readonly unknown[]).includes(mode))
			throw new HttpError(
				400,
				`The mode is one of ${WEB_CREDENTIAL_MODES.join(", ")}`,
			);
		// c2patool fetches from any address whatever the setting says.
		if (
			mode !== "any" &&
			signingEngineOf(readSettings(machine.settingsPath)) === "c2patool"
		)
			throw new HttpError(
				409,
				"This machine signs with c2patool, which fetches such credentials from any address whatever this setting says. Switch to the C2PA library first: npm run cli -- settings signing-engine library",
			);
		const s = updateSettings(machine.settingsPath, (s) =>
			setWebCredentialMode(s, mode as WebCredentialMode),
		);
		res.json({ credentialsOnTheWeb: webCredentialsView(s) });
	});

	api.post(
		"/machine/credentials-on-the-web/hosts",
		(req: Request, res: Response) => {
			const { fields } = editBody(req);
			const unknown = Object.keys(fields).filter(
				(k) => k !== "host" && k !== "decision",
			);
			if (unknown.length)
				throw new HttpError(
					400,
					`There is no field ${unknown.join(", ")} here`,
				);
			const decision = fields.decision;
			if (decision !== "allow" && decision !== "leave" && decision !== "forget")
				throw new HttpError(400, "The decision is one of allow, leave, forget");
			const host =
				typeof fields.host === "string" && fields.host.length <= 300
					? listedHost(fields.host)
					: null;
			if (!host)
				throw new HttpError(
					400,
					"That is not a host name. A host is a name such as cai-manifests.adobe.com.",
				);
			const s = updateSettings(machine.settingsPath, (s) =>
				decideWebCredentialHost(s, host, decision),
			);
			res.json({ host, credentialsOnTheWeb: webCredentialsView(s) });
		},
	);

	// Which of a project's files keep their Content Credentials on the web
	// and do not have them, by host, and what the person can do about each as
	// this machine is set now.
	api.get(
		"/projects/:projectId/credentials-on-the-web",
		(req: Request, res: Response) => {
			const settings = readSettings(machine.settingsPath);
			const choice = webCredentialChoiceOf(settings);
			const waiting = withProject(
				machine,
				String(req.params.projectId),
				(project) => credentialsWaiting(project.db),
			);
			res.json({
				credentialsOnTheWeb: webCredentialsView(settings),
				waiting: waiting.map((w) => ({
					host: w.host,
					// Only when there is no host to name it by.
					address: w.host === null ? w.address : null,
					files: w.files,
					state: hostStateNow(choice, w.address),
					outcome: w.outcome,
					detail: w.detail,
				})),
			});
		},
	);

	api.patch("/machine", (req: Request, res: Response) => {
		const { fields } = editBody(req);
		const unknown = Object.keys(fields).filter((k) => k !== "person");
		if (unknown.length)
			throw new HttpError(
				400,
				`This machine's settings have no field ${unknown.join(", ")}`,
			);
		const name = fields.person;
		if (typeof name !== "string" || !name.trim())
			throw new HttpError(400, "Your name cannot be empty");
		if (name.trim().length > 200 || /\p{Cc}/u.test(name))
			throw new HttpError(
				400,
				"Your name is up to 200 characters, on one line",
			);
		const s = updateSettings(machine.settingsPath, (s) => {
			s.person = name.trim();
		});
		res.json({
			person: s.person,
			credentialsOnTheWeb: webCredentialsView(s),
		});
	});

	// Forget a project on this machine (its entry in this machine's settings);
	// the folder, the catalog and the media are not touched. Not while work
	// runs on it, which reads those settings as it goes.
	api.delete("/projects/:projectId", (req: Request, res: Response) => {
		const projectId = String(req.params.projectId);
		const running = jobs.running(projectId);
		if (running)
			throw new HttpError(
				409,
				`Work is running on this project (${running.kind}). Stop it or let it finish first.`,
			);
		if (!forgetProject(machine, projectId))
			throw new HttpError(404, "This machine does not know that project");
		res.json({ forgotten: projectId, projects: knownProjects(machine) });
	});

	// Open a project folder: its catalog, recorded in this machine's settings.
	// A folder holding a project this machine already has elsewhere is
	// answered 409 with where (`elsewhere`), and opened only when asked again
	// with take_over (D68).
	api.post("/projects/open", (req: Request, res: Response) => {
		const body = (req.body ?? {}) as Record<string, unknown>;
		const unknown = Object.keys(body).filter(
			(k) => k !== "folder" && k !== "take_over",
		);
		if (unknown.length)
			throw new HttpError(
				400,
				`Opening a project has no field ${unknown.join(", ")}`,
			);
		const folder = body.folder;
		if (typeof folder !== "string" || !folder.trim())
			throw new HttpError(400, "Say which folder to open");
		if (body.take_over !== undefined && typeof body.take_over !== "boolean")
			throw new HttpError(400, "take_over is true or false");
		let project: OpenProject;
		try {
			project = openProject(folder, {
				machine,
				takeOver: body.take_over === true,
			});
		} catch (err) {
			if (err instanceof ProjectElsewhereError) {
				res.status(409).json({
					error: err.message,
					elsewhere: { folder: err.known },
				});
				return;
			}
			throw new HttpError(
				409,
				err instanceof NoCatalogError
					? `${err.message} To start a project there, use "Make a new project".`
					: (err as Error).message,
			);
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

	// Make a new project in a folder (the command line's init): an empty
	// catalog in .provenancetracker, recorded in this machine's settings. The
	// folder is the person's choice (docs/threat-model.md); a folder that
	// already has a catalog, or sits in a sync client's folder, is refused.
	api.post("/projects", (req: Request, res: Response) => {
		const { fields } = editBody(req);
		const unknown = Object.keys(fields).filter(
			(k) => k !== "folder" && k !== "name",
		);
		if (unknown.length)
			throw new HttpError(400, `A project has no field ${unknown.join(", ")}`);
		const { folder, name } = fields as { folder?: unknown; name?: unknown };
		if (typeof folder !== "string" || !folder.trim())
			throw new HttpError(400, "Say which folder the project is in");
		if (typeof name !== "string" || !name.trim())
			throw new HttpError(400, "A project needs a name");
		let made: { projectId: string; folder: string };
		try {
			made = createProject(folder, { name: name.trim(), machine });
		} catch (err) {
			throw new HttpError(409, (err as Error).message);
		}
		res.status(201).json({
			projectId: made.projectId,
			name: name.trim(),
			folder: made.folder,
		});
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
			position: queryText(q.position),
			outputs: queryFlag(q.outputs),
			q: queryText(q.q),
			removed: q.removed === "only" ? "only" : queryFlag(q.removed),
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

	// A new export starts from an earlier finished edit, once (D50).
	api.post(
		"/projects/:projectId/assets/:assetId/start-from",
		(req: Request, res: Response) => {
			const id = idParam(req.params.assetId, "asset");
			withEdit(machine, req, (project, opts, fields) => {
				const unknown = Object.keys(fields).filter(
					(k) => k !== "from_id" && k !== "as",
				);
				if (unknown.length)
					throw new HttpError(
						400,
						`Starting from an edit takes only from_id and as, not ${unknown.join(", ")}`,
					);
				const copied = startFromEdit(
					project.db,
					id,
					Number(fields.from_id),
					opts,
					(fields.as ?? "revision") as EditRelation,
				);
				res.json({ copied, asset: assetRecord(project.db, id) });
			});
		},
	);

	// A finished edit's revisions, what it was made from and what was made
	// from it, and its own re-renders (D60): read from links.
	api.get(
		"/projects/:projectId/assets/:assetId/revisions",
		(req: Request, res: Response) => {
			const id = idParam(req.params.assetId, "asset");
			withProject(machine, String(req.params.projectId), (project) => {
				if (!project.db.prepare("SELECT 1 FROM assets WHERE id = ?").get(id))
					throw new HttpError(404, "There is no such asset");
				res.json(revisionsOf(project.db, id));
			});
		},
	);

	// Whether this edit is the next revision of the one it started from, or made from it (D60).
	api.put(
		"/projects/:projectId/assets/:assetId/relation",
		(req: Request, res: Response) => {
			const id = idParam(req.params.assetId, "asset");
			withEdit(machine, req, (project, opts, fields) => {
				const unknown = Object.keys(fields).filter((k) => k !== "as");
				if (unknown.length)
					throw new HttpError(
						400,
						'Give { "as": "revision" } or { "as": "made_from" }',
					);
				setEditRelation(project.db, id, fields.as, opts);
				res.json({
					revisions: revisionsOf(project.db, id),
					asset: assetRecord(project.db, id),
				});
			});
		},
	);

	// The image a finished edit is shown by in its credentials (D52), or none.
	api.put(
		"/projects/:projectId/assets/:assetId/thumbnail",
		(req: Request, res: Response) => {
			const id = idParam(req.params.assetId, "asset");
			withEdit(machine, req, (project, opts, fields) => {
				const unknown = Object.keys(fields).filter((k) => k !== "image_id");
				const image = fields.image_id;
				if (
					unknown.length ||
					!(
						image === null ||
						(typeof image === "number" && Number.isSafeInteger(image))
					)
				)
					throw new HttpError(
						400,
						'Give { "image_id": <an asset id> } or { "image_id": null }',
					);
				setThumbnail(project.db, id, image as number | null, opts);
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
			// Check the project, the person, the target and that no other work is
			// running before taking a byte: files placed while the project is busy
			// would wait unimported, and sending them again would copy them twice.
			person(machine);
			const busy = jobs.running(String(req.params.projectId));
			if (busy)
				throw new HttpError(
					409,
					`This project is busy: a ${busy.kind} started at ${busy.startedAt} is still running. Add the files when it has finished.`,
				);
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
				// Work that started while the files arrived leaves them placed but
				// not imported: say so, rather than an error for files that are in.
				let job = null;
				let note = "";
				try {
					job = startJob(projectId, "import", (project, ctx) =>
						runImport(project, [t.root], ctx),
					);
				} catch (err) {
					if (!(err instanceof HttpError && err.status === 409)) throw err;
					note = `The files are in, but other work started meanwhile. Run Import when it has finished. (${err.message})`;
				}
				res.status(202).json({
					placed: placed.map(({ root, path, renamed }) => ({
						root,
						path,
						renamed,
					})),
					job,
					...(note ? { note } : {}),
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

	// --- Timelines and creator statements (D40) ---

	const timelineUpload = multer({
		storage: multer.memoryStorage(),
		limits: { files: 1, fileSize: 50 * 1024 * 1024 },
		defParamCharset: "utf8",
	});

	/** Run a timeline change, answering its refusals in words. */
	const onTimeline = <T>(fn: () => T): T => {
		try {
			return fn();
		} catch (err) {
			if (err instanceof EditError) throw new HttpError(400, err.message);
			if (err instanceof NotFoundError) throw new HttpError(404, err.message);
			throw err;
		}
	};

	// Import a timeline file (form field "timeline") for an output. A file
	// holding several sequences needs form field "sequence" (its index) unless
	// one matches the edit's length: otherwise the answer is 409 with the
	// sequences to choose from (Phase 8 step 6).
	api.post(
		"/projects/:projectId/assets/:assetId/timelines",
		(req: Request, res: Response, next: NextFunction) =>
			timelineUpload.single("timeline")(req, res, (err: unknown) =>
				err ? next(new HttpError(400, (err as Error).message)) : next(),
			),
		async (req: Request, res: Response) => {
			const id = idParam(req.params.assetId, "asset");
			const file = req.file;
			if (!file)
				throw new HttpError(
					400,
					'Send the timeline file as form field "timeline"',
				);
			const fields = (req.body ?? {}) as Record<string, unknown>;
			const unknown = Object.keys(fields).filter((k) => k !== "sequence");
			if (unknown.length)
				throw new HttpError(
					400,
					`A timeline import has no field ${unknown.join(", ")}`,
				);
			let sequence: number | null = null;
			if (fields.sequence !== undefined && fields.sequence !== "") {
				sequence = Number(fields.sequence);
				if (!Number.isSafeInteger(sequence) || sequence < 0)
					throw new HttpError(
						400,
						"sequence is a sequence's number: 0, 1, ...",
					);
			}
			const project = openById(machine, String(req.params.projectId));
			try {
				if (!project.db.prepare("SELECT 1 FROM assets WHERE id = ?").get(id))
					throw new HttpError(404, "There is no such asset");
				let result;
				try {
					result = await importTimeline(project, machine, {
						outputAssetId: id,
						bytes: file.buffer,
						fileName: file.originalname,
						sequence,
					});
				} catch (err) {
					if (err instanceof SequenceChoiceError) {
						res
							.status(409)
							.json({ error: err.message, sequences: err.choices });
						return;
					}
					if (err instanceof HttpError || err instanceof NotFoundError)
						throw err;
					// Not a timeline this tracker reads, or a cut that is not the output's.
					throw new HttpError(400, (err as Error).message);
				}
				res.json({
					import: result,
					timeline: timelineRecord(project.db, result.timelineId),
				});
			} finally {
				project.db.close();
			}
		},
	);

	api.get(
		"/projects/:projectId/timelines/:timelineId",
		(req: Request, res: Response) => {
			const id = idParam(req.params.timelineId, "timeline");
			withProject(machine, String(req.params.projectId), (project) => {
				const record = timelineRecord(project.db, id);
				if (!record) throw new HttpError(404, "There is no such timeline");
				res.json(record);
			});
		},
	);

	api.patch(
		"/projects/:projectId/timelines/:timelineId",
		(req: Request, res: Response) => {
			const id = idParam(req.params.timelineId, "timeline");
			withEdit(machine, req, (project, opts, fields) => {
				const unknown = Object.keys(fields).filter(
					(k) => k !== "primary_track_index" && k !== "include_overlays",
				);
				if (unknown.length)
					throw new HttpError(
						400,
						`A timeline has no field ${unknown.join(", ")} that can be set`,
					);
				const changed = onTimeline(() =>
					setTimelineSettings(
						project.db,
						id,
						fields as {
							primary_track_index?: number;
							include_overlays?: boolean;
						},
						opts,
					),
				);
				res.json({ changed, timeline: timelineRecord(project.db, id) });
			});
		},
	);

	api.patch(
		"/projects/:projectId/timelines/:timelineId/sources/:sourceId",
		async (req: Request, res: Response) => {
			const timelineId = idParam(req.params.timelineId, "timeline");
			const sourceId = idParam(req.params.sourceId, "source");
			const { fields, note } = editBody(req);
			const unknown = Object.keys(fields).filter((k) => k !== "asset_id");
			if (unknown.length || !("asset_id" in fields))
				throw new HttpError(
					400,
					'Say which asset the source is: { "asset_id": n } (or null for none)',
				);
			const assetId = fields.asset_id;
			if (assetId !== null && !Number.isSafeInteger(assetId))
				throw new HttpError(400, "asset_id is an asset's id, or null");
			const actor = person(machine);
			const project = openById(machine, String(req.params.projectId));
			try {
				const source = project.db
					.prepare(
						"SELECT path FROM timeline_sources WHERE id = ? AND timeline_id = ?",
					)
					.get(sourceId, timelineId) as { path: string } | undefined;
				if (!source)
					throw new HttpError(404, "There is no such source in this timeline");
				const method =
					assetId === null
						? "unmatched"
						: await matchEvidence(
								project,
								machine,
								source.path,
								assetId as number,
							);
				onTimeline(() =>
					setSourceMatch(
						project.db,
						timelineId,
						sourceId,
						{ assetId: assetId as number | null, method },
						{ actor, note, tool: TOOL },
					),
				);
				res.json({ timeline: timelineRecord(project.db, timelineId) });
			} finally {
				project.db.close();
			}
		},
	);

	api.patch(
		"/projects/:projectId/timelines/:timelineId/clips/:clipId",
		(req: Request, res: Response) => {
			const timelineId = idParam(req.params.timelineId, "timeline");
			const clipId = idParam(req.params.clipId, "clip");
			withEdit(machine, req, (project, opts, fields) => {
				const cls = fields.origin_class;
				if (
					Object.keys(fields).some((k) => k !== "origin_class") ||
					!("origin_class" in fields)
				)
					throw new HttpError(
						400,
						'Say the clip\'s class: { "origin_class": "..." } (or null to follow its source)',
					);
				if (cls !== null && !ORIGIN_CLASSES.includes(cls as string))
					throw new HttpError(
						400,
						`Unknown origin class: ${JSON.stringify(cls)}`,
					);
				onTimeline(() =>
					setClipClass(
						project.db,
						timelineId,
						clipId,
						cls as string | null,
						opts,
					),
				);
				res.json({ timeline: timelineRecord(project.db, timelineId) });
			});
		},
	);

	api.delete(
		"/projects/:projectId/timelines/:timelineId",
		(req: Request, res: Response) => {
			const id = idParam(req.params.timelineId, "timeline");
			withEdit(machine, req, (project, opts) => {
				onTimeline(() => removeTimeline(project.db, id, opts));
				res.json({ removed: id });
			});
		},
	);

	// Save a creator statement for an output: a new version each time.
	api.post(
		"/projects/:projectId/assets/:assetId/statements",
		(req: Request, res: Response) => {
			const id = idParam(req.params.assetId, "asset");
			withEdit(machine, req, (project, opts, fields) => {
				const unknown = Object.keys(fields).filter(
					(k) => !["text", "author", "organization", "edited_with"].includes(k),
				);
				if (unknown.length)
					throw new HttpError(
						400,
						`A statement has no field ${unknown.join(", ")}`,
					);
				onTimeline(() =>
					saveStatement(
						project.db,
						id,
						{
							text: String(fields.text ?? ""),
							author: fields.author as string | undefined,
							organization: fields.organization as string | undefined,
							editedWith: fields.edited_with as string | undefined,
						},
						// Recorded with the statement: these are the words that get signed.
						{ actor: opts.actor },
					),
				);
				answerAsset(project, res, id);
			});
		},
	);

	// What an output would be signed with now, from the same builder signing
	// uses, and what stops it being signed here. Reads only.
	api.get(
		"/projects/:projectId/assets/:assetId/statement-preview",
		(req: Request, res: Response) => {
			const id = idParam(req.params.assetId, "asset");
			withProject(machine, String(req.params.projectId), (project) => {
				try {
					res.json(previewOutputStatement(project, machine, { assetId: id }));
				} catch (err) {
					if (err instanceof NotReadyError)
						throw new HttpError(
							err.message === "There is no such asset" ? 404 : 400,
							err.message,
						);
					throw err;
				}
			});
		},
	);

	// --- Signing, the public export and previews (D41) ---

	// Two key pairs a project can have on this machine, set the same way:
	// what signs it (D41), and the creator's identity (D55). Their files are
	// ones the person names on purpose (docs/threat-model.md), kept in this
	// machine's settings, never in the catalog, never sent back: each route
	// answers only whether it is set, the certificate's name, issuer, expiry
	// and fingerprint, and what stops it.
	for (const pair of [
		{
			path: "signing",
			set: setSigning,
			clear: clearSigning,
			status: signingStatus,
		},
		{
			path: "identity",
			set: setIdentity,
			clear: clearIdentity,
			status: identityStatus,
		},
	]) {
		api.get(
			`/projects/:projectId/${pair.path}`,
			async (req: Request, res: Response) => {
				const projectId = String(req.params.projectId);
				withProject(machine, projectId, () => undefined);
				res.json(await pair.status(machine, projectId));
			},
		);

		api.put(
			`/projects/:projectId/${pair.path}`,
			async (req: Request, res: Response) => {
				const { fields } = editBody(req);
				person(machine);
				const projectId = String(req.params.projectId);
				withProject(machine, projectId, () => undefined);
				const unknown = Object.keys(fields).filter(
					(k) => k !== "certificate" && k !== "private_key",
				);
				if (
					unknown.length ||
					typeof fields.certificate !== "string" ||
					typeof fields.private_key !== "string"
				)
					throw new HttpError(
						400,
						'Give { "certificate": <file>, "private_key": <file> }',
					);
				try {
					res.json(
						await pair.set(machine, projectId, {
							certificate: fields.certificate,
							privateKey: fields.private_key,
						}),
					);
				} catch (err) {
					throw new HttpError(400, (err as Error).message);
				}
			},
		);

		api.delete(
			`/projects/:projectId/${pair.path}`,
			async (req: Request, res: Response) => {
				person(machine);
				const projectId = String(req.params.projectId);
				withProject(machine, projectId, () => undefined);
				pair.clear(machine, projectId);
				res.json(await pair.status(machine, projectId));
			},
		);
	}

	// Sign an output: a job, since c2patool reads the whole film and each source.
	api.post(
		"/projects/:projectId/assets/:assetId/sign",
		(req: Request, res: Response) => {
			const id = idParam(req.params.assetId, "asset");
			const { fields } = editBody(req);
			// An output takes only whether to time-stamp; a source asset also who
			// made it and how. The time-stamp server is the tracker's own
			// (docs/network.md), never an address from the request.
			const ASSET_FIELDS = [
				"creator_name",
				"organization",
				"tool_used",
				"is_ai_generated",
				"training_mining_opt_out",
			];
			const unknown = Object.keys(fields).filter(
				(k) =>
					k !== "timestamp" && k !== "withhold" && !ASSET_FIELDS.includes(k),
			);
			if (unknown.length)
				throw new HttpError(400, `Signing has no field ${unknown.join(", ")}`);
			// What a finished edit keeps out of its signed file (D62):
			// { redact: [assertion addresses], leave_out: [asset ids] }.
			let withhold: { redact: string[]; leaveOut: number[] } | undefined;
			if (fields.withhold !== undefined) {
				const w = fields.withhold as Record<string, unknown> | null;
				const extra = w
					? Object.keys(w).filter((k) => k !== "redact" && k !== "leave_out")
					: [];
				const redact = w?.redact ?? [];
				const leaveOut = w?.leave_out ?? [];
				if (
					!w ||
					typeof w !== "object" ||
					extra.length ||
					!Array.isArray(redact) ||
					!redact.every((u) => typeof u === "string") ||
					!Array.isArray(leaveOut) ||
					!leaveOut.every((n) => Number.isSafeInteger(n))
				)
					throw new HttpError(
						400,
						'withhold is { "redact": [addresses], "leave_out": [asset ids] }',
					);
				withhold = {
					redact: redact as string[],
					leaveOut: leaveOut as number[],
				};
			}
			if (
				fields.timestamp !== undefined &&
				typeof fields.timestamp !== "boolean"
			)
				throw new HttpError(400, "timestamp is true or false");
			const timestampUrl =
				fields.timestamp === true ? TIMESTAMP_URL : undefined;
			const text = (k: string) =>
				typeof fields[k] === "string" ? (fields[k] as string) : undefined;
			person(machine);
			const job = startJob(
				String(req.params.projectId),
				"sign",
				async (project, ctx) => {
					ctx.progress({ step: "sign", done: 0, total: 1, file: "" });
					// A refusal (nothing set up, no statement, a file not here) is
					// the job's error, in words.
					const engine = await signingEngine(machine);
					const asset = project.db
						.prepare("SELECT is_output FROM assets WHERE id = ?")
						.get(id) as { is_output: number } | undefined;
					if (!asset) throw new Error("There is no such asset");
					if (asset.is_output !== 1 && withhold)
						throw new Error(
							"Keeping details out is for a finished edit's signed copy",
						);
					if (asset.is_output === 1) {
						const extra = Object.keys(fields).filter((k) =>
							ASSET_FIELDS.includes(k),
						);
						if (extra.length)
							throw new Error(
								`A finished edit is signed from its statement; ${extra.join(", ")} is for a source asset`,
							);
						return await signOutput(project, machine, {
							assetId: id,
							engine,
							timestampUrl,
							withhold,
						});
					}
					return await signAsset(project, machine, {
						assetId: id,
						engine,
						timestampUrl,
						creatorName: text("creator_name"),
						organization: text("organization"),
						toolUsed: text("tool_used"),
						isAiGenerated: fields.is_ai_generated === true,
						trainingMiningOptOut: fields.training_mining_opt_out !== false,
					});
				},
			);
			res.status(202).json({ job });
		},
	);

	// The public export of one signing of an output: what a public page shows, built from that record alone.
	api.get(
		"/projects/:projectId/signatures/:signatureId/public-export",
		(req: Request, res: Response) => {
			const id = idParam(req.params.signatureId, "signing");
			withProject(machine, String(req.params.projectId), (project) => {
				const { data, fileName } = onTimeline(() =>
					publicExport(project.db, id, {
						generatedAt: new Date().toISOString(),
						generator: { name: "provenance-tracker", version: TOOL.version },
					}),
				);
				// Any name: one with letters a header cannot carry as they are
				// (outside Latin-1) is sent encoded, with a plain fallback.
				res.attachment(fileName);
				res.json(data);
			});
		},
	);

	// Where a signed copy is published (D56): the web address of the signed
	// file and of the page that shows it, https only. Recorded, never fetched.
	api.put(
		"/projects/:projectId/signatures/:signatureId/publication",
		(req: Request, res: Response) => {
			const id = idParam(req.params.signatureId, "signing");
			withEdit(machine, req, (project, opts, fields) => {
				const unknown = Object.keys(fields).filter(
					(k) => !PUBLICATION_FIELDS.includes(k),
				);
				if (unknown.length)
					throw new HttpError(
						400,
						`Give { "file_url": <https address or "">, "page_url": <https address or ""> }; there is no ${unknown.join(", ")}`,
					);
				const named = Object.fromEntries(
					PUBLICATION_FIELDS.filter((k) => Object.hasOwn(fields, k)).map(
						(k) => [k, fields[k]],
					),
				);
				const publication = setPublication(project.db, id, named, opts);
				const signing = project.db
					.prepare("SELECT asset_id FROM signatures WHERE id = ?")
					.get(id) as { asset_id: number };
				res.json({
					publication: publication && {
						fileUrl: publication.fileUrl,
						pageUrl: publication.pageUrl,
					},
					asset: assetRecord(project.db, signing.asset_id),
				});
			});
		},
	);

	// A file by its bytes' SHA-256, from wherever it lives on this machine:
	// pictures, video and sound only. The path comes from the catalog, never the request.
	api.get(
		"/projects/:projectId/contents/:sha256/file",
		async (req: Request, res: Response) => {
			const sha = String(req.params.sha256);
			if (!/^[0-9a-f]{64}$/.test(sha))
				throw new HttpError(404, "There is no such file");
			const file = withProject(
				machine,
				String(req.params.projectId),
				(project) => {
					const folders = new Map(
						listRoots(project, machine)
							.filter((r) => r.folder)
							.map((r) => [r.id, r.folder!]),
					);
					const places = project.db
						.prepare(
							"SELECT root_id, path FROM locations WHERE content_sha256 = ? AND gone_run_id IS NULL ORDER BY id",
						)
						.all(sha) as Array<{ root_id: number; path: string }>;
					for (const p of places) {
						const folder = folders.get(p.root_id);
						if (!folder) continue;
						const abs = fromCatalogPath(folder, p.path, machine.platform);
						if (existsSync(abs)) return abs;
					}
					return null;
				},
			);
			if (!file) throw new HttpError(404, "That file is not on this machine");
			if (!showable(file))
				throw new HttpError(415, "Only pictures, video and sound are shown");
			await streamFile(req, res, file);
		},
	);

	return api;
}

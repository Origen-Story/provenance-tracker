// This machine's settings: what is true here and nowhere else. Which folder
// each project is in, which folder each of its media roots is (by root id, so
// renaming a root changes nothing here), and the person's name for edits.
// The file never travels with a project; a catalog copied to a laptop finds
// its roots through the laptop's own settings (D28).

import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

/** The newest settings format this version reads and writes. */
export const SETTINGS_FORMAT = 1;

export interface ProjectSettings {
	/** The project folder (the one holding .provenancetracker) when last opened here. */
	folder?: string;
	/** Root id (as text) → that root's folder on this machine. */
	roots: Record<string, string>;
	/**
	 * Where this project's signing certificate and private key are on this
	 * machine. Paths only, never in a catalog (catalogs travel) and never
	 * returned by the API.
	 */
	signing?: { certificate: string; privateKey: string };
}

export interface Settings {
	format: number;
	/** The name recorded when a person edits a catalog from this machine. */
	person?: string;
	/**
	 * Whether reading a file whose Content Credentials are stored on the web
	 * (it carries only their address; Adobe Firefly video does this) fetches
	 * them. Absent means yes (D51); docs/network.md says what goes out.
	 */
	remoteCredentials?: boolean;
	/**
	 * What signs on this machine: the C2PA library, or c2patool as the
	 * fallback (D53). Absent means the library.
	 */
	signingEngine?: SigningEngineName;
	/** Project id → what this machine knows about it. */
	projects: Record<string, ProjectSettings>;
	/** Anything a newer version of the same format added is kept as it is. */
	[other: string]: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ROOT_ID = /^[1-9][0-9]*$/;

/** Whether a value is a project id (a UUID), and so may be a key in the settings. */
export const isProjectId = (value: string): boolean => UUID.test(value);

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function damaged(file: string, why: string): Error {
	return new Error(
		`The settings file ${file} is damaged (${why}). It was left as it is; fix or move it and try again.`,
	);
}

/** Read the settings; a file that does not exist yet reads as empty. */
export function readSettings(file: string): Settings {
	if (!existsSync(file)) return { format: SETTINGS_FORMAT, projects: {} };
	let data: unknown;
	try {
		data = JSON.parse(readFileSync(file, "utf8"));
	} catch (err) {
		throw damaged(file, `not JSON: ${(err as Error).message}`);
	}
	if (!isPlainObject(data)) throw damaged(file, "not a JSON object");
	if (typeof data.format !== "number" || !Number.isInteger(data.format))
		throw damaged(file, "no format number");
	if (data.format > SETTINGS_FORMAT)
		throw new Error(
			`The settings file ${file} is format ${data.format}, written by a newer Provenance Tracker; this version reads format ${SETTINGS_FORMAT}. Nothing was changed.`,
		);
	if (data.person !== undefined && typeof data.person !== "string")
		throw damaged(file, "person is not text");
	if (
		data.remoteCredentials !== undefined &&
		typeof data.remoteCredentials !== "boolean"
	)
		throw damaged(file, "remoteCredentials is not true or false");
	if (
		data.signingEngine !== undefined &&
		!SIGNING_ENGINES.includes(data.signingEngine as SigningEngineName)
	)
		throw damaged(
			file,
			`signingEngine is not one of ${SIGNING_ENGINES.join(", ")}`,
		);
	const projects = data.projects ?? {};
	if (!isPlainObject(projects))
		throw damaged(file, "projects is not an object");
	for (const [id, project] of Object.entries(projects)) {
		if (!UUID.test(id)) throw damaged(file, `${id} is not a project id`);
		if (!isPlainObject(project))
			throw damaged(file, `project ${id} is not an object`);
		if (project.folder !== undefined && typeof project.folder !== "string")
			throw damaged(file, `project ${id} folder is not text`);
		const roots = project.roots ?? {};
		if (!isPlainObject(roots))
			throw damaged(file, `project ${id} roots is not an object`);
		for (const [rootId, folder] of Object.entries(roots)) {
			if (!ROOT_ID.test(rootId))
				throw damaged(file, `${rootId} is not a root id`);
			if (typeof folder !== "string")
				throw damaged(file, `root ${rootId} folder is not text`);
		}
		project.roots = roots;
		if (project.signing !== undefined) {
			const s = project.signing as Record<string, unknown>;
			if (
				!isPlainObject(s) ||
				typeof s.certificate !== "string" ||
				typeof s.privateKey !== "string"
			)
				throw damaged(
					file,
					`project ${id} signing is not a certificate and a key`,
				);
		}
	}
	return { ...data, format: data.format, projects } as Settings;
}

/** The engines a machine can sign with (D53); the first is the default. */
export const SIGNING_ENGINES = ["library", "c2patool"] as const;
export type SigningEngineName = (typeof SIGNING_ENGINES)[number];

/** What signs on this machine: its setting, else the library. */
export const signingEngineOf = (settings: Settings): SigningEngineName =>
	settings.signingEngine ?? "library";

/** Whether this machine fetches Content Credentials a file points to on the web (D51). */
export const fetchesRemoteCredentials = (settings: Settings): boolean =>
	settings.remoteCredentials !== false;

/**
 * Write the settings whole: to a temporary file beside it, then renamed over
 * it, so a crash leaves the old file or the new one and never half of either.
 */
export function writeSettings(file: string, settings: Settings): void {
	mkdirSync(path.dirname(file), { recursive: true });
	const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
	try {
		writeFileSync(temp, `${JSON.stringify(settings, null, "\t")}\n`, {
			flag: "wx",
		});
		renameSync(temp, file);
	} finally {
		rmSync(temp, { force: true });
	}
}

/** Read, change and write back the settings. */
export function updateSettings(
	file: string,
	change: (settings: Settings) => void,
): Settings {
	const settings = readSettings(file);
	change(settings);
	writeSettings(file, settings);
	return settings;
}

/**
 * This machine's entry for a project, created empty if missing. Only a
 * project id (a UUID) is ever a key: anything else, such as "__proto__" from
 * a request, is refused here rather than trusted to every caller, so writing
 * settings can never reach the object prototype.
 */
export function projectEntry(
	settings: Settings,
	projectId: string,
): ProjectSettings {
	if (!isProjectId(projectId))
		throw new Error(`${JSON.stringify(projectId)} is not a project id`);
	if (!Object.hasOwn(settings.projects, projectId))
		settings.projects[projectId] = { roots: {} };
	return settings.projects[projectId];
}

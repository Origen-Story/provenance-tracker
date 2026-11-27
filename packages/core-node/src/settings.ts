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
import {
	WEB_CREDENTIAL_MODES,
	listedHost,
	type WebCredentialChoice,
	type WebCredentialMode,
} from "@provenancetracker/core/extraction/web-credentials.ts";

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
	/**
	 * Where the creator's identity certificate and key are on this machine
	 * (D55), kept apart from the signing pair. Paths only, like signing.
	 */
	identity?: { certificate: string; privateKey: string };
}

export interface Settings {
	format: number;
	/** The name recorded when a person edits a catalog from this machine. */
	person?: string;
	/**
	 * What this machine does about a file whose Content Credentials are stored
	 * on the web (it carries only their address; Adobe Firefly video does
	 * this): never fetch them, fetch them from hosts on a list, or from any
	 * host (D74). No mode means the person has not chosen, and nothing is
	 * fetched. docs/network.md says what a fetch sends out.
	 */
	credentialsOnTheWeb?: {
		mode?: WebCredentialMode;
		/** Hosts the person added to the built-in list. */
		hosts?: string[];
		/** Hosts the person said to leave: not fetched, not asked about again. */
		left?: string[];
	};
	/**
	 * The switch before D74 (D51), still read: false means "never". True, or
	 * nothing, was "fetch from anywhere", which is no longer assumed: it reads
	 * as not chosen. Taken out when a mode is set.
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
	if (data.credentialsOnTheWeb !== undefined) {
		const c = data.credentialsOnTheWeb;
		if (!isPlainObject(c))
			throw damaged(file, "credentialsOnTheWeb is not an object");
		if (
			c.mode !== undefined &&
			!WEB_CREDENTIAL_MODES.includes(c.mode as WebCredentialMode)
		)
			throw damaged(
				file,
				`credentialsOnTheWeb.mode is not one of ${WEB_CREDENTIAL_MODES.join(", ")}`,
			);
		for (const list of ["hosts", "left"] as const) {
			const hosts = c[list];
			if (hosts === undefined) continue;
			if (
				!Array.isArray(hosts) ||
				hosts.some((h) => typeof h !== "string" || listedHost(h) !== h)
			)
				throw damaged(
					file,
					`credentialsOnTheWeb.${list} is not a list of host names`,
				);
		}
	}
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
		for (const pair of ["signing", "identity"] as const) {
			if (project[pair] === undefined) continue;
			const s = project[pair] as Record<string, unknown>;
			if (
				!isPlainObject(s) ||
				typeof s.certificate !== "string" ||
				typeof s.privateKey !== "string"
			)
				throw damaged(
					file,
					`project ${id} ${pair} is not a certificate and a key`,
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

/**
 * What this machine was told about Content Credentials stored on the web
 * (D74). Not chosen until a mode is set; the old switch counts only when it
 * was off.
 */
export function webCredentialChoiceOf(settings: Settings): WebCredentialChoice {
	const c = settings.credentialsOnTheWeb;
	return {
		mode: c?.mode ?? (settings.remoteCredentials === false ? "never" : null),
		hosts: c?.hosts ?? [],
		left: c?.left ?? [],
	};
}

/** Set the mode. The old switch it replaces is taken out. */
export function setWebCredentialMode(
	settings: Settings,
	mode: WebCredentialMode,
): void {
	settings.credentialsOnTheWeb = { ...settings.credentialsOnTheWeb, mode };
	delete settings.remoteCredentials;
}

/**
 * Record what the person said about one host: put it on the list ("allow"),
 * leave it ("leave": never fetched while the list is in force, and not asked
 * about again), or take it off both ("forget": it is asked about again). A
 * host is on one of the two or neither.
 * @param host as listedHost gives it
 */
export function decideWebCredentialHost(
	settings: Settings,
	host: string,
	decision: "allow" | "leave" | "forget",
): void {
	if (listedHost(host) !== host)
		throw new Error(`${JSON.stringify(host)} is not a host name`);
	const c = settings.credentialsOnTheWeb ?? {};
	const without = (list: string[] | undefined) =>
		(list ?? []).filter((h) => h !== host);
	settings.credentialsOnTheWeb = {
		...c,
		hosts: [...without(c.hosts), ...(decision === "allow" ? [host] : [])],
		left: [...without(c.left), ...(decision === "leave" ? [host] : [])],
	};
}

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

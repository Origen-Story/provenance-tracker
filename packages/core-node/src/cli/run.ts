// The command line (roadmap Phase 4): init, roots, scan, extract, verify, show, settings.
// Everything it needs from outside (arguments, the folder it was started in,
// the machine, where to print) is passed in, so tests run it in-process.

import path from "node:path";
import { parseArgs } from "node:util";
import type { Actor } from "@provenancetracker/core/catalog/edit.ts";
import type { Machine } from "../machine.ts";
import {
	createProject,
	findProjectFolder,
	NoCatalogError,
	openProject,
	type OpenProject,
} from "../project.ts";
import {
	addRoot,
	listRoots,
	locateRoot,
	renameRoot,
	type RootView,
} from "../roots.ts";
import { endExifTool } from "../extract/exiftool.ts";
import { extractProject, machineReaders } from "../extract.ts";
import {
	dryRun,
	migrate as migrateCatalogs,
	readLayout,
	type DryRunReport,
	type MigrationReport,
} from "../legacy/migrate.ts";
import { writeFileSync } from "node:fs";
import { scanProject, type ScanReport } from "../scan.ts";
import { describeFile } from "../show.ts";
import { verifyProject } from "../verify.ts";
import {
	fetchesRemoteCredentials,
	readSettings,
	SIGNING_ENGINES,
	signingEngineOf,
	updateSettings,
	type SigningEngineName,
} from "../settings.ts";
import { signingEngineFor } from "../sign/engines/index.ts";
import { TOOL } from "../tool.ts";
import { signAsset } from "../sign/sign-asset.ts";
import { signOutput } from "../sign/sign-output.ts";
import {
	clearIdentity,
	clearSigning,
	identityStatus,
	setIdentity,
	setSigning,
	signingStatus,
	type SigningStatus,
} from "../sign/signing-settings.ts";
import { classifyCatalog } from "@provenancetracker/core/catalog/classify.ts";
import { listAssets } from "@provenancetracker/core/catalog/read.ts";

export interface Io {
	machine: Machine;
	/** The folder the command was started in. */
	cwd: string;
	out: (line: string) => void;
	err: (line: string) => void;
	/** Stops a scan between files (the entry point wires it to Ctrl+C). */
	signal?: AbortSignal;
}

const HELP = `Provenance Tracker ${TOOL.version}

Usage: npm run cli -- <command> [options]

  init <folder> [--name <name>]       Make a new project in <folder>
  roots                               List the project's media roots
  roots add <name> <folder>           Add a media root [--note <text>]
  roots locate <name> <folder>        Say where a root is on this machine
  roots rename <name> <new name>      Rename a root
  scan [--root <name>]                Record every file in the roots on this machine
  extract [--root <name>] [--again]   Read what each file says (ExifTool, C2PA, PNG text, sidecars)
  classify [--dry-run]                Say what each asset is, from what its file said (kind for
                                      unsorted assets, origin class, AI generation details)
  signing                             Whether this project can be signed here, and with what
  signing --certificate <f> --key <f> Set the certificate and key that sign it on this machine
  signing --clear                     Forget them
  identity                            Whether your identity (CAWG) is added when this project
                                      is signed here, and whose
  identity --certificate <f> --key <f> Set your identity certificate and key on this machine
                                      (separate from the signing pair; npm run cert:generate
                                      -- --name "Your Name" <folder> makes a test one)
  identity --clear                    Forget them: signing goes on without an identity
  sign <asset id> [--timestamp <url>] Sign it: a finished edit gets a signed copy beside its
       [--engine library|c2patool]    file; any other asset a .c2pa sidecar beside it. The
                                      engine is this machine's setting unless named
  verify [--hash] [--root <name>]    Check the catalog, and that every file is still as it was
  show <file>                         Everything the catalog knows about one file
  settings                            Show this machine's settings
  settings person <name>              Set the name your edits are recorded under
  settings remote-credentials on|off  Whether reading a file fetches Content Credentials it
                                      says are stored on the web (on unless turned off)
  settings signing-engine library|c2patool
                                      What signs on this machine: the C2PA library (the
                                      default) or c2patool, the fallback
  migrate --dry-run --layout <file>   Build the catalogs from a Postgres dump in a throwaway
                                      folder, check them, and report [--report <file>]
  migrate --write --layout <file>     The same, then put each catalog in its project folder,
                                      only if every check holds [--report <file>]

Commands that work on a project use the one in the current folder (or a
folder above it), or --project <folder>. Edits are recorded under the name
from "settings person", or --by <name>.
`;

/** A mistake in how the command was typed: printed with a hint, exit code 2. */
class UsageError extends Error {}

const OPTIONS = {
	name: { type: "string" },
	note: { type: "string" },
	project: { type: "string" },
	by: { type: "string" },
	root: { type: "string", multiple: true },
	again: { type: "boolean" },
	hash: { type: "boolean" },
	help: { type: "boolean", short: "h" },
	"dry-run": { type: "boolean" },
	write: { type: "boolean" },
	layout: { type: "string" },
	report: { type: "string" },
	certificate: { type: "string" },
	key: { type: "string" },
	clear: { type: "boolean" },
	timestamp: { type: "string" },
	engine: { type: "string" },
} as const;

type Values = {
	name?: string;
	note?: string;
	project?: string;
	by?: string;
	root?: string[];
	again?: boolean;
	hash?: boolean;
	help?: boolean;
	"dry-run"?: boolean;
	write?: boolean;
	layout?: string;
	report?: string;
	certificate?: string;
	key?: string;
	clear?: boolean;
	timestamp?: string;
	engine?: string;
};

/** A signing engine's name as typed, or a usage error naming the choices. */
function engineName(raw: string): SigningEngineName {
	const value = raw.trim().toLowerCase();
	if (!SIGNING_ENGINES.includes(value as SigningEngineName))
		throw new UsageError(`Say ${SIGNING_ENGINES.join(" or ")}`);
	return value as SigningEngineName;
}

function needArgs(args: string[], count: number, usage: string): void {
	if (args.length !== count)
		throw new UsageError(`Usage: npm run cli -- ${usage}`);
}

function resolveFrom(io: Io, p: string): string {
	return path.resolve(io.cwd, p);
}

async function withProject<T>(
	io: Io,
	values: Values,
	fn: (project: OpenProject) => T | Promise<T>,
): Promise<T> {
	const folder = values.project
		? resolveFrom(io, values.project)
		: findProjectFolder(io.cwd);
	if (!folder)
		throw new Error(
			`There is no project in ${io.cwd} or any folder above it. Pass --project <folder>, or make one with init.`,
		);
	let project: OpenProject;
	try {
		project = openProject(folder, { machine: io.machine });
	} catch (err) {
		if (err instanceof NoCatalogError)
			throw new Error(
				`${err.message} To make one there: npm run cli -- init "${err.folder}"`,
				{ cause: err },
			);
		throw err;
	}
	try {
		if (project.upgraded)
			io.out(
				`Upgraded the catalog from format ${project.upgraded.from} to ${project.upgraded.to}; the copy from before is ${project.upgraded.backup}`,
			);
		return await fn(project);
	} finally {
		project.db.close();
	}
}

function person(io: Io, values: Values): Actor {
	const name =
		values.by?.trim() || readSettings(io.machine.settingsPath).person?.trim();
	if (!name)
		throw new UsageError(
			'This change is recorded under your name. Set it once with: npm run cli -- settings person "Your Name" (or pass --by "Your Name").',
		);
	return { kind: "person", name };
}

function printRoot(io: Io, root: RootView): void {
	const where = root.inProject ? ", inside the project folder" : "";
	io.out(
		`  ${root.name}  ${root.folder ?? "-"}  (${root.status}${where})${root.note ? `  ${root.note}` : ""}`,
	);
	for (const w of root.warnings) io.out(`    warning: ${w}`);
}

function init(io: Io, args: string[], values: Values): void {
	needArgs(args, 1, "init <folder> [--name <name>]");
	const folder = resolveFrom(io, args[0]);
	const name = values.name ?? path.basename(folder);
	const made = createProject(folder, { name, machine: io.machine });
	io.out(`Made project "${name}" in ${made.folder}`);
	io.out(`  catalog: ${made.catalogPath}`);
	io.out(`  id: ${made.projectId}`);
	io.out(
		`Next, add a media folder: npm run cli -- roots add <name> <folder> --project "${made.folder}"`,
	);
}

async function roots(io: Io, args: string[], values: Values): Promise<void> {
	const [sub, ...rest] = args;
	await withProject(io, values, (project) => {
		switch (sub) {
			case undefined: {
				const list = listRoots(project, io.machine);
				io.out(`Project "${project.name}" (${project.folder})`);
				if (!list.length)
					io.out(
						"  No roots yet. Add one with: npm run cli -- roots add <name> <folder>",
					);
				for (const root of list) printRoot(io, root);
				return;
			}
			case "add": {
				needArgs(rest, 2, "roots add <name> <folder> [--note <text>]");
				const root = addRoot(project, io.machine, {
					name: rest[0],
					folder: resolveFrom(io, rest[1]),
					note: values.note,
					actor: person(io, values),
				});
				io.out(`Added root "${root.name}":`);
				printRoot(io, root);
				return;
			}
			case "locate": {
				needArgs(rest, 2, "roots locate <name> <folder>");
				const root = locateRoot(project, io.machine, {
					name: rest[0],
					folder: resolveFrom(io, rest[1]),
					actor: () => person(io, values),
				});
				io.out(
					root.inProject
						? `Root "${root.name}" is at ${root.folder}, inside the project folder, so every copy of the project finds it there.`
						: `Root "${root.name}" is at ${root.folder} on this machine.`,
				);
				for (const w of root.warnings) io.out(`  warning: ${w}`);
				return;
			}
			case "rename": {
				needArgs(rest, 2, "roots rename <name> <new name>");
				renameRoot(project, {
					name: rest[0],
					newName: rest[1],
					actor: person(io, values),
				});
				io.out(`Renamed root "${rest[0]}" to "${rest[1].trim()}".`);
				return;
			}
			default:
				throw new UsageError(
					`Unknown roots command "${sub}". Try: roots, roots add, roots locate, roots rename`,
				);
		}
	});
}

function settings(io: Io, args: string[]): void {
	const file = io.machine.settingsPath;
	const [sub, ...rest] = args;
	if (sub === "person") {
		needArgs(rest, 1, 'settings person "Your Name"');
		const name = rest[0].trim();
		if (!name) throw new UsageError("The name cannot be empty");
		updateSettings(file, (s) => {
			s.person = name;
		});
		io.out(`Edits from this machine will be recorded as made by "${name}".`);
		return;
	}
	if (sub === "remote-credentials") {
		needArgs(rest, 1, "settings remote-credentials on|off");
		const value = rest[0].trim().toLowerCase();
		if (value !== "on" && value !== "off")
			throw new UsageError('Say "on" or "off"');
		updateSettings(file, (s) => {
			s.remoteCredentials = value === "on";
		});
		io.out(
			value === "on"
				? "Reading a file fetches Content Credentials it says are stored on the web (docs/network.md)."
				: "Reading a file no longer fetches Content Credentials stored on the web; such a file reads as unreadable, with the address it gives.",
		);
		return;
	}
	if (sub === "signing-engine") {
		needArgs(rest, 1, "settings signing-engine library|c2patool");
		const value = engineName(rest[0]);
		updateSettings(file, (s) => {
			s.signingEngine = value;
		});
		io.out(
			value === "library"
				? "This machine signs with the C2PA library (the default)."
				: "This machine signs with c2patool, the fallback. It fetches Content Credentials an ingredient says are stored on the web whatever remote-credentials says (docs/network.md). Switch back with: npm run cli -- settings signing-engine library",
		);
		return;
	}
	if (sub !== undefined)
		throw new UsageError(
			`Unknown settings command "${sub}". Try: settings, settings person, settings remote-credentials, settings signing-engine`,
		);
	const s = readSettings(file);
	io.out(`Settings file: ${file}`);
	io.out(`Person: ${s.person ?? "(not set)"}`);
	io.out(
		`Content Credentials stored on the web: ${fetchesRemoteCredentials(s) ? "fetched when a file is read" : "not fetched"}`,
	);
	io.out(
		`Signing engine: ${signingEngineOf(s) === "library" ? "the C2PA library" : "c2patool (the fallback)"}`,
	);
	const projects = Object.entries(s.projects);
	io.out(
		projects.length
			? "Projects on this machine:"
			: "No projects on this machine yet.",
	);
	for (const [id, p] of projects)
		io.out(
			`  ${id}  ${p.folder ?? "(folder not known)"}  ${Object.keys(p.roots).length} root(s) outside the project folder placed here`,
		);
}

/** 1536 → "1.5 KB": decimal units, as file managers show sizes. */
export function formatBytes(bytes: number): string {
	const units = ["bytes", "KB", "MB", "GB", "TB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1000 && unit < units.length - 1) {
		value /= 1000;
		unit++;
	}
	return unit === 0 ? `${bytes} bytes` : `${value.toFixed(1)} ${units[unit]}`;
}

const LISTED = 20;

function printScan(io: Io, report: ScanReport): void {
	const c = report.counts;
	for (const root of report.roots)
		io.out(
			root.scanned
				? `  ${root.name}: ${root.files} file(s) in ${root.folder}`
				: `  ${root.name}: skipped (${root.reason}); its files were left as they were`,
		);
	io.out(
		`${c.files} file(s): ${c.unchanged} unchanged, ${c.added - c.moved} new, ${c.moved} moved, ${c.replaced} changed, ${c.touched} with only a new time; ${c.gone} gone.`,
	);
	io.out(
		`${c.newAssets} new asset(s) (kind "unsorted"), ${c.newVersions} new version(s) of known assets. Read ${formatBytes(c.hashedBytes)}.`,
	);
	if (report.duplicates.length) {
		io.out(`${report.duplicates.length} set(s) of identical files:`);
		for (const d of report.duplicates.slice(0, LISTED))
			io.out(`  ${d.places.map((p) => `${p.root}/${p.path}`).join("  =  ")}`);
		if (report.duplicates.length > LISTED)
			io.out(
				`  … and ${report.duplicates.length - LISTED} more (in run ${report.runId})`,
			);
	}
	if (report.skipped.length) {
		io.out(`${report.skipped.length} skipped:`);
		for (const s of report.skipped.slice(0, LISTED))
			io.out(`  ${s.root}/${s.path}: ${s.reason}`);
		if (report.skipped.length > LISTED)
			io.out(`  … and ${report.skipped.length - LISTED} more`);
	}
	if (report.outcome === "cancelled")
		io.out(
			"Stopped before the end. What was finished is kept; nothing was marked gone. Scan again to finish.",
		);
}

async function scan(io: Io, args: string[], values: Values): Promise<number> {
	if (args.length)
		throw new UsageError("Usage: npm run cli -- scan [--root <name>]");
	return withProject(io, values, async (project) => {
		io.out(`Scanning project "${project.name}"`);
		let last = Date.now();
		const report = await scanProject(project, io.machine, {
			roots: values.root,
			signal: io.signal,
			onProgress: (p) => {
				if (Date.now() - last < 2000) return;
				last = Date.now();
				io.out(
					`  reading ${p.hashed + 1} of ${p.toHash} (${formatBytes(p.bytes)} so far): ${p.file}`,
				);
			},
		});
		printScan(io, report);
		return report.outcome === "ok" ? 0 : 1;
	});
}

async function extract(
	io: Io,
	args: string[],
	values: Values,
): Promise<number> {
	if (args.length)
		throw new UsageError(
			"Usage: npm run cli -- extract [--root <name>] [--again]",
		);
	return withProject(io, values, async (project) => {
		io.out(`Reading what the files of project "${project.name}" say`);
		let last = Date.now();
		try {
			const report = await extractProject(project, io.machine, {
				roots: values.root,
				again: values.again,
				signal: io.signal,
				onProgress: (p) => {
					if (Date.now() - last < 2000) return;
					last = Date.now();
					io.out(`  ${p.done + 1} of ${p.total}: ${p.file}`);
				},
			});
			const written = Object.entries(report.written).sort(([a], [b]) =>
				a < b ? -1 : 1,
			);
			io.out(
				written.length
					? `${report.contents} file(s) read: ${written.map(([k, n]) => `${n} ${k}`).join(", ")}.`
					: "Nothing new to read: every file here has been read by these versions of the readers.",
			);
			if (report.sidecars)
				io.out(
					`${report.sidecars} sidecar file(s) linked to the files they describe.`,
				);
			if (report.notHere)
				io.out(
					`${report.notHere} file(s) are in roots not on this machine; they are read when their root is here.`,
				);
			if (report.skipped.length) {
				io.out(`${report.skipped.length} skipped:`);
				for (const s of report.skipped.slice(0, LISTED))
					io.out(`  ${s.root}/${s.path}: ${s.reason}`);
				if (report.skipped.length > LISTED)
					io.out(`  … and ${report.skipped.length - LISTED} more`);
			}
			if (report.outcome === "cancelled")
				io.out(
					"Stopped before the end. What was read is kept; extract again to finish.",
				);
			return report.outcome === "ok" ? 0 : 1;
		} finally {
			await endExifTool();
		}
	});
}

function printSigning(io: Io, status: SigningStatus): void {
	if (!status.configured) {
		io.out("No certificate and key are set for this project on this machine.");
		return;
	}
	const c = status.certificate;
	if (c)
		io.out(
			`Signs as ${c.commonName} (issued by ${c.issuer}), valid to ${c.validTo.slice(0, 10)}. Certificate SHA-256 ${c.fingerprint}.`,
		);
	io.out(
		status.problem
			? `It cannot sign now: ${status.problem}.`
			: "Ready to sign.",
	);
}

async function signing(
	io: Io,
	args: string[],
	values: Values,
): Promise<number> {
	if (
		args.length ||
		(values.clear && (values.certificate || values.key)) ||
		!values.certificate !== !values.key
	)
		throw new UsageError(
			"Usage: npm run cli -- signing [--certificate <file> --key <file> | --clear]",
		);
	return withProject(io, values, async (project) => {
		if (values.clear) {
			clearSigning(io.machine, project.projectId);
			io.out(
				"This project's certificate and key are forgotten on this machine.",
			);
			return 0;
		}
		if (values.certificate && values.key) {
			printSigning(
				io,
				await setSigning(io.machine, project.projectId, {
					certificate: resolveFrom(io, values.certificate),
					privateKey: resolveFrom(io, values.key),
				}),
			);
			return 0;
		}
		printSigning(io, await signingStatus(io.machine, project.projectId));
		return 0;
	});
}

function printIdentity(io: Io, status: SigningStatus): void {
	if (!status.configured) {
		io.out(
			"No identity is set up for this project on this machine: files are signed without one.",
		);
		return;
	}
	const c = status.certificate;
	if (c)
		io.out(
			`Signed files say they are by ${c.commonName} (identity issued by ${c.issuer}), valid to ${c.validTo.slice(0, 10)}. Certificate SHA-256 ${c.fingerprint}.`,
		);
	io.out(
		status.problem
			? `It cannot be added now, so signing would stop: ${status.problem}.`
			: "Added to every signing here (the C2PA library signs it).",
	);
}

/** The creator's identity certificate and key for this project here (D55). */
async function identity(
	io: Io,
	args: string[],
	values: Values,
): Promise<number> {
	if (
		args.length ||
		(values.clear && (values.certificate || values.key)) ||
		!values.certificate !== !values.key
	)
		throw new UsageError(
			"Usage: npm run cli -- identity [--certificate <file> --key <file> | --clear]",
		);
	return withProject(io, values, async (project) => {
		if (values.clear) {
			clearIdentity(io.machine, project.projectId);
			io.out(
				"This project's identity is forgotten on this machine; files are signed without one.",
			);
			return 0;
		}
		if (values.certificate && values.key) {
			printIdentity(
				io,
				await setIdentity(io.machine, project.projectId, {
					certificate: resolveFrom(io, values.certificate),
					privateKey: resolveFrom(io, values.key),
				}),
			);
			return 0;
		}
		printIdentity(io, await identityStatus(io.machine, project.projectId));
		return 0;
	});
}

async function sign(io: Io, args: string[], values: Values): Promise<number> {
	needArgs(
		args,
		1,
		"sign <asset id> [--timestamp <url>] [--engine library|c2patool]",
	);
	const id = Number(args[0]);
	if (!Number.isSafeInteger(id) || id < 1)
		throw new UsageError("The asset id is a whole number (see the asset list)");
	const chosen =
		values.engine === undefined ? undefined : engineName(values.engine);
	return withProject(io, values, async (project) => {
		const asset = project.db
			.prepare("SELECT is_output FROM assets WHERE id = ?")
			.get(id) as { is_output: number } | undefined;
		if (!asset) throw new Error(`There is no asset ${id}`);
		const engine = await signingEngineFor(io.machine, chosen);
		if (asset.is_output === 1) {
			io.out(
				`Signing with ${engine.name === "c2patool" ? "c2patool" : "the C2PA library"} ${engine.version}; it reads the whole film and each source it places.`,
			);
			const r = await signOutput(project, io.machine, {
				assetId: id,
				engine,
				timestampUrl: values.timestamp,
			});
			io.out(
				`Signed copy v${r.version}: ${r.root}/${r.path} (${r.status || "read back"}).`,
			);
			return 0;
		}
		// A source asset: its credentials go in a .c2pa sidecar beside it.
		const r = await signAsset(project, io.machine, {
			assetId: id,
			engine,
			timestampUrl: values.timestamp,
		});
		io.out(
			`Signed into a sidecar, v${r.version}: ${r.root}/${r.path} (${r.status || "read back"}).`,
		);
		if (r.archived)
			io.out(`The earlier signature is kept as ${r.root}/${r.archived}.`);
		return 0;
	});
}
async function classify(
	io: Io,
	args: string[],
	values: Values,
): Promise<number> {
	if (args.length)
		throw new UsageError("Usage: npm run cli -- classify [--dry-run]");
	return withProject(io, values, (project) => {
		const dry = !!values["dry-run"];
		const report = classifyCatalog(project.db, { tool: TOOL, dryRun: dry });
		const names = new Map(
			listAssets(project.db, { limit: 1000 }).assets.map((a) => [
				a.id,
				a.file ? `${a.file.root}/${a.file.path}` : a.displayTitle,
			]),
		);
		const shown = (v: unknown) => (v === "" ? '""' : String(v));
		for (const a of report.assets) {
			if (!a.changes.length && !a.generation) continue;
			io.out(`${names.get(a.assetId) ?? `asset ${a.assetId}`}  (${a.rule})`);
			for (const c of a.changes)
				io.out(`  ${c.field}: ${shown(c.from)} -> ${shown(c.to)}`);
			if (a.generation)
				io.out(
					`  generation details from ${a.platform}${a.generation.model_name ? `, model ${String(a.generation.model_name)}` : ""}`,
				);
		}
		const kept = report.assets.flatMap((a) => a.kept);
		const byWho = (by: string) => kept.filter((k) => k.by === by).length;
		io.out(
			`${report.examined} asset(s) looked at; ${report.changed} ${dry ? "would change" : "changed"}` +
				(report.generationAdded
					? `, ${report.generationAdded} with generation details added`
					: "") +
				".",
		);
		if (kept.length)
			io.out(
				`Left as they are: ${byWho("person")} value(s) a person set, ${byWho("legacy")} carried from Postgres, ${byWho("confirmed")} confirmed class(es) that the file would now put otherwise.`,
			);
		if (dry) io.out("Dry run: nothing was written.");
		return 0;
	});
}
async function verify(io: Io, args: string[], values: Values): Promise<number> {
	if (args.length)
		throw new UsageError(
			"Usage: npm run cli -- verify [--hash] [--root <name>]",
		);
	return withProject(io, values, async (project) => {
		io.out(
			`Checking project "${project.name}"${values.hash ? ", reading every file" : ""}`,
		);
		let last = Date.now();
		const report = await verifyProject(project, io.machine, {
			hash: values.hash,
			roots: values.root,
			signal: io.signal,
			onProgress: (p) => {
				if (Date.now() - last < 2000) return;
				last = Date.now();
				io.out(`  ${p.done + 1} of ${p.total}: ${p.file}`);
			},
		});
		io.out(
			report.catalog.length
				? `The catalog has ${report.catalog.length} problem(s):`
				: "The catalog: sound (integrity, links, every edit in its history).",
		);
		for (const p of report.catalog.slice(0, LISTED))
			io.out(
				`  ${p.check}${p.table ? ` ${p.table}${p.key !== undefined ? ` ${p.key}` : ""}${p.field ? `.${p.field}` : ""}` : ""}: ${p.detail}`,
			);
		io.out(
			`Files: ${report.checked} checked${values.hash ? ` (${report.hashed} read in full)` : " by size and time"}, ${report.files.length} with a problem.`,
		);
		for (const f of report.files.slice(0, LISTED))
			io.out(
				`  ${f.root}/${f.path}: ${f.problem}${f.detail ? ` (${f.detail})` : ""}`,
			);
		if (report.files.length > LISTED)
			io.out(`  … and ${report.files.length - LISTED} more`);
		for (const n of report.notChecked)
			io.out(`  ${n.root}: ${n.files} file(s) not checked (${n.reason})`);
		if (report.outcome === "cancelled") io.out("Stopped before the end.");
		const clean =
			report.catalog.length === 0 &&
			report.files.length === 0 &&
			report.outcome === "ok";
		if (clean && !report.notChecked.length) io.out("All good.");
		return clean ? 0 : 1;
	});
}

function show(io: Io, args: string[], values: Values): Promise<number> {
	needArgs(args, 1, "show <file>");
	const file = resolveFrom(io, args[0]);
	return withProject(
		io,
		{
			...values,
			project:
				values.project ?? findProjectFolder(path.dirname(file)) ?? undefined,
		},
		(project) => {
			const info = describeFile(project, io.machine, file);
			io.out(`${info.root}/${info.path}`);
			io.out(
				`  asset ${info.asset.id}, kind ${info.asset.kind}, origin ${info.asset.originClass}${info.asset.title ? `, "${info.asset.title}"` : ""}`,
			);
			io.out(
				`  ${formatBytes(info.size)}, SHA-256 ${info.sha256}${info.versions > 1 ? `; version of an asset with ${info.versions} versions` : ""}`,
			);
			for (const s of info.sameBytes)
				io.out(`  same bytes at ${s.root}/${s.path}`);
			const t = info.technical;
			if (t) {
				const parts = [
					t.mime_type,
					t.duration_seconds != null
						? `${Number(t.duration_seconds).toFixed(2)} s`
						: null,
					t.width ? `${t.width}×${t.height}` : null,
					t.frame_rate ? `${t.frame_rate} fps` : null,
					t.video_codec ? `video ${t.video_codec}` : null,
					t.audio_codec ? `audio ${t.audio_codec}` : null,
					t.sample_rate ? `${t.sample_rate} Hz` : null,
					t.channels ? `${t.channels} ch` : null,
					t.bits_per_sample ? `${t.bits_per_sample}-bit` : null,
				].filter(Boolean);
				io.out(`  ${parts.join(", ")}`);
			} else io.out("  no technical values yet (run extract)");
			for (const r of info.readings)
				io.out(
					`  ${r.kind}: ${r.status}${r.validation ? ` (${r.validation})` : ""}, ${r.extractor} ${r.version}${r.from ? `, from ${r.from}` : ""}`,
				);
			for (const s of info.sidecars) io.out(`  sidecar ${s.root}/${s.path}`);
			return 0;
		},
	);
}

function printDryRun(io: Io, report: DryRunReport): void {
	io.out("");
	io.out(
		`Dump: ${report.dump.file} (matches its .sha256${report.dump.pinned ? "; the backup the layout names" : ""})`,
	);
	if (report.sinceBackup)
		io.out(
			report.sinceBackup.differences.length
				? `The newest dump, ${report.sinceBackup.newest}, has other data: Postgres has changed since the backup.\n${report.sinceBackup.differences.map((d) => `  ${d}`).join("\n")}`
				: `The newest dump, ${report.sinceBackup.newest}, has the same data: nothing has changed since the backup.`,
		);
	if (report.orphans.length) {
		io.out(`${report.orphans.length} Postgres row(s) belong to nothing:`);
		for (const o of report.orphans) io.out(`  ${o}`);
	} else io.out("No orphaned Postgres rows.");
	for (const p of report.notInLayout)
		io.out(
			`Project "${p.name}" is in the dump but not in the layout: not migrated.`,
		);
	for (const p of report.projects) {
		io.out("");
		io.out(
			`${p.ok ? "OK  " : "FIX "} ${p.legacy.name} -> ${p.folder}${p.folderExists ? "" : " (the folder does not exist yet; the real run makes it)"}`,
		);
		for (const r of p.roots)
			io.out(
				`  root ${r.name}: ${r.folder ?? "-"} (${r.status}${r.inProject ? ", inside the project folder" : ""})`,
			);
		if (p.error) io.out(`  stopped: ${p.error}`);
		for (const b of p.plan.blocking) io.out(`  blocking: ${b}`);
		for (const x of p.problems) io.out(`  problem: ${x}`);
		for (const n of p.plan.notes) io.out(`  note: ${n}`);
		const found = p.files.filter((f) => f.found).length;
		io.out(
			`  files Postgres names: ${found} of ${p.files.length} found in the roots`,
		);
		for (const f of p.notFound)
			io.out(`    not here (carried by its hash): ${f.path}`);
		if (p.written)
			io.out(
				`  written: ${Object.entries(p.written)
					.map(([k, n]) => `${n} ${k}`)
					.join(", ")}`,
			);
		if (p.written)
			io.out(
				p.verify.length
					? `  verifyCatalog: ${p.verify.length} problem(s)`
					: "  verifyCatalog: clean",
			);
		for (const v of p.verify.slice(0, 20))
			io.out(
				`    ${v.check} ${v.table ?? ""} ${v.key ?? ""} ${v.field ?? ""}: ${v.detail}`,
			);
		for (const b of p.breakdowns)
			io.out(
				`  timeline ${b.timeline}: breakdown ${b.same ? "recomputes the same" : `differs at ${b.differences.join(", ")}`}${b.oldShape ? " (cached before asset refs, read as the app reads it)" : ""}`,
			);
		for (const e of p.exports)
			io.out(
				`  signing ${e.signature}: public export ${e.same ? "byte-identical" : `differs at ${e.differences.join(", ")}`}${e.note ? ` (${e.note})` : ""}`,
			);
		if (p.technical) {
			io.out(
				`  technical values: ${p.technical.compared} file(s) compared, ${p.technical.differences.length} difference(s)`,
			);
			for (const d of p.technical.differences) io.out(`    ${d}`);
		}
		if (p.scan) {
			io.out(
				`  scan after: ${p.scan.unchanged} unchanged, ${p.scan.gone} gone, ${p.scan.added} file(s) Postgres did not have`,
			);
			for (const f of p.scan.addedFiles.slice(0, 30)) io.out(`    new: ${f}`);
			if (p.scan.addedFiles.length > 30)
				io.out(
					`    ... and ${p.scan.addedFiles.length - 30} more (see the report file)`,
				);
		}
		if (p.plan.uncarried.length) {
			io.out("  not carried (by column):");
			for (const u of p.plan.uncarried)
				io.out(`    ${u.column} x${u.count}: ${u.why}`);
		}
	}
	io.out("");
	if (!("placed" in report)) {
		io.out(
			report.ok
				? "Dry run: everything checked is sound. Nothing was kept."
				: "Dry run: something above needs fixing before the real run. Nothing was kept.",
		);
		return;
	}
	const real = report as MigrationReport;
	if (real.refused) io.out(real.refused);
	for (const p of real.placed) {
		io.out(
			`Placed ${p.name}: ${p.catalogPath}, with ${p.timelineFiles} timeline file(s). verifyCatalog: ${p.verify.length ? `${p.verify.length} problem(s)` : "clean"}.`,
		);
		for (const r of p.roots)
			io.out(
				`  root ${r.name}: ${r.folder ?? "-"} (${r.status}${r.inProject ? ", inside the project folder" : ""})`,
			);
	}
	if (real.placed.length)
		io.out(
			real.ok
				? "Migrated. Next, in each project: scan, extract, verify --hash."
				: "Placed, but the check above found a problem.",
		);
}

async function migrate(
	io: Io,
	args: string[],
	values: Values,
): Promise<number> {
	if (args.length || !values.layout || !values["dry-run"] === !values.write)
		throw new UsageError(
			"Usage: npm run cli -- migrate (--dry-run | --write) --layout <file> [--report <file>]",
		);
	const layout = readLayout(
		resolveFrom(io, values.layout),
		io.machine.platform,
	);
	const actor = person(io, values);
	const readers = await machineReaders(io.machine);
	const exif = readers.find((r) => r.kind === "exif") ?? null;
	if (!exif?.version)
		io.out(
			"ExifTool is not available here: technical values are not compared.",
		);
	let last = 0;
	try {
		const report = await (values.write ? migrateCatalogs : dryRun)({
			layout,
			machine: io.machine,
			actor,
			exifReader: exif?.version ? exif : null,
			progress: (line) => {
				if (
					line.startsWith("    ") ||
					(line.startsWith("  file ") && Date.now() - last < 2000)
				)
					return;
				last = Date.now();
				io.out(line);
			},
		});
		printDryRun(io, report);
		if (values.report) {
			const file = resolveFrom(io, values.report);
			writeFileSync(file, `${JSON.stringify(report, null, "\t")}\n`);
			io.out(`The full report is in ${file}`);
		}
		return report.ok ? 0 : 1;
	} finally {
		await endExifTool();
	}
}
/** Run one command. @returns the exit code */
export async function run(argv: string[], io: Io): Promise<number> {
	let parsed;
	try {
		parsed = parseArgs({
			args: argv,
			options: OPTIONS,
			allowPositionals: true,
			strict: true,
		});
	} catch (err) {
		io.err((err as Error).message);
		io.err('Run "npm run cli -- help" for the commands.');
		return 2;
	}
	const values = parsed.values as Values;
	const [command, ...args] = parsed.positionals;
	try {
		if (values.help || command === undefined || command === "help") {
			io.out(HELP);
			return 0;
		}
		switch (command) {
			case "init":
				init(io, args, values);
				return 0;
			case "roots":
				await roots(io, args, values);
				return 0;
			case "scan":
				return await scan(io, args, values);
			case "extract":
				return await extract(io, args, values);
			case "classify":
				return await classify(io, args, values);
			case "signing":
				return await signing(io, args, values);
			case "identity":
				return await identity(io, args, values);
			case "sign":
				return await sign(io, args, values);
			case "verify":
				return await verify(io, args, values);
			case "show":
				return await show(io, args, values);
			case "settings":
				settings(io, args);
				return 0;
			case "migrate":
				return await migrate(io, args, values);
			default:
				throw new UsageError(`Unknown command "${command}".`);
		}
	} catch (err) {
		io.err((err as Error).message);
		if (err instanceof UsageError) {
			io.err('Run "npm run cli -- help" for the commands.');
			return 2;
		}
		return 1;
	}
}

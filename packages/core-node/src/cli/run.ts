// The command line: init, roots and settings so far (roadmap Phase 4).
// Everything it needs from outside (arguments, the folder it was started in,
// the machine, where to print) is passed in, so tests run it in-process.

import path from "node:path";
import { parseArgs } from "node:util";
import type { Actor } from "@provenancetracker/core/catalog/edit.ts";
import type { Machine } from "../machine.ts";
import {
	createProject,
	findProjectFolder,
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
import { readSettings, updateSettings } from "../settings.ts";
import { TOOL } from "../tool.ts";

export interface Io {
	machine: Machine;
	/** The folder the command was started in. */
	cwd: string;
	out: (line: string) => void;
	err: (line: string) => void;
}

const HELP = `Provenance Tracker ${TOOL.version}

Usage: npm run cli -- <command> [options]

  init <folder> [--name <name>]       Make a new project in <folder>
  roots                               List the project's media roots
  roots add <name> <folder>           Add a media root [--note <text>]
  roots locate <name> <folder>        Say where a root is on this machine
  roots rename <name> <new name>      Rename a root
  settings                            Show this machine's settings
  settings person <name>              Set the name your edits are recorded under

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
	help: { type: "boolean", short: "h" },
} as const;

type Values = {
	name?: string;
	note?: string;
	project?: string;
	by?: string;
	help?: boolean;
};

function needArgs(args: string[], count: number, usage: string): void {
	if (args.length !== count)
		throw new UsageError(`Usage: npm run cli -- ${usage}`);
}

function resolveFrom(io: Io, p: string): string {
	return path.resolve(io.cwd, p);
}

function withProject<T>(
	io: Io,
	values: Values,
	fn: (project: OpenProject) => T,
): T {
	const folder = values.project
		? resolveFrom(io, values.project)
		: findProjectFolder(io.cwd);
	if (!folder)
		throw new Error(
			`There is no project in ${io.cwd} or any folder above it. Pass --project <folder>, or make one with init.`,
		);
	const project = openProject(folder, { machine: io.machine });
	try {
		if (project.upgraded)
			io.out(
				`Upgraded the catalog from format ${project.upgraded.from} to ${project.upgraded.to}; the copy from before is ${project.upgraded.backup}`,
			);
		return fn(project);
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
	io.out(
		`  ${root.name}  ${root.folder ?? "-"}  (${root.status})${root.note ? `  ${root.note}` : ""}`,
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

function roots(io: Io, args: string[], values: Values): void {
	const [sub, ...rest] = args;
	withProject(io, values, (project) => {
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
				});
				io.out(`Root "${root.name}" is at ${root.folder} on this machine.`);
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
	if (sub !== undefined)
		throw new UsageError(
			`Unknown settings command "${sub}". Try: settings, settings person`,
		);
	const s = readSettings(file);
	io.out(`Settings file: ${file}`);
	io.out(`Person: ${s.person ?? "(not set)"}`);
	const projects = Object.entries(s.projects);
	io.out(
		projects.length
			? "Projects on this machine:"
			: "No projects on this machine yet.",
	);
	for (const [id, p] of projects)
		io.out(
			`  ${id}  ${p.folder ?? "(folder not known)"}  ${Object.keys(p.roots).length} root(s) located`,
		);
}

/** Run one command. @returns the exit code */
export function run(argv: string[], io: Io): number {
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
				roots(io, args, values);
				return 0;
			case "settings":
				settings(io, args);
				return 0;
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

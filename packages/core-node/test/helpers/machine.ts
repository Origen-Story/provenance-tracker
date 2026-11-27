// A pretend machine for each test: its own home folder, settings file and
// environment, all inside a temp folder that is removed afterwards. The real
// machine's settings are never read or written by a test.

import { afterEach } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Env, Machine } from "../../src/machine.ts";
import type { OpenProject } from "../../src/project.ts";
import { expectSoundCatalogs } from "./verify-catalogs.ts";

export function machinesForTests() {
	const temps: string[] = [];
	const projects: OpenProject[] = [];
	const unchecked = new Set<string>();
	afterEach(() => {
		for (const p of projects.splice(0)) if (p.db.isOpen) p.db.close();
		try {
			// Every catalog a test left behind is held to its own rules.
			expectSoundCatalogs(temps, unchecked);
		} finally {
			unchecked.clear();
			for (const dir of temps.splice(0))
				rmSync(dir, { recursive: true, force: true });
		}
	});
	const tempDir = (): string => {
		// realpath: on macOS the temp folder is reached through a link.
		const dir = realpathSync.native(
			mkdtempSync(path.join(tmpdir(), "pt-node-")),
		);
		temps.push(dir);
		return dir;
	};
	return {
		tempDir,
		/** A machine whose home and settings are inside `dir` (a new temp folder by default). */
		machine: (opts: { dir?: string; env?: Env } = {}): Machine => {
			const dir = opts.dir ?? tempDir();
			const home = path.join(dir, "home");
			mkdirSync(home, { recursive: true });
			return {
				platform: process.platform,
				env: opts.env ?? {},
				home,
				settingsPath: path.join(dir, "settings", "settings.json"),
			};
		},
		/**
		 * This catalog file was changed around the edit functions on purpose
		 * (a test of what the tracker does with such a catalog): leave it out of
		 * the check after the test.
		 */
		writtenAround: (catalogPath: string): void => {
			unchecked.add(path.resolve(catalogPath));
		},
		/** Close this project after the test. */
		track: (project: OpenProject): OpenProject => {
			projects.push(project);
			return project;
		},
		/** A folder inside a temp folder, made. */
		folder: (...parts: string[]): string => {
			const dir = path.join(tempDir(), ...parts);
			mkdirSync(dir, { recursive: true });
			return dir;
		},
	};
}

/** Open a catalog file directly, read-only, for a test to look inside. */
export function peek<T>(catalogPath: string, fn: (db: DatabaseSync) => T): T {
	const db = new DatabaseSync(catalogPath, { readOnly: true });
	try {
		return fn(db);
	} finally {
		db.close();
	}
}

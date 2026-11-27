import { describe, expect, it } from "vitest";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defaultSettingsPath, SETTINGS_ENV } from "../src/machine.ts";
import {
	projectEntry,
	readSettings,
	SETTINGS_FORMAT,
	updateSettings,
	writeSettings,
} from "../src/settings.ts";
import { machinesForTests } from "./helpers/machine.ts";

const t = machinesForTests();
const ID = "0f3c2b1a-9d8e-4f7a-8b6c-5d4e3f2a1b0c";

describe("defaultSettingsPath", () => {
	it("is under Local, not Roaming, on Windows", () => {
		expect(
			defaultSettingsPath(
				{ LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" },
				"win32",
				"C:\\Users\\a",
			),
		).toBe("C:\\Users\\a\\AppData\\Local\\provenancetracker\\settings.json");
		expect(defaultSettingsPath({}, "win32", "C:\\Users\\a")).toBe(
			"C:\\Users\\a\\AppData\\Local\\provenancetracker\\settings.json",
		);
	});

	it("follows each system's place for application settings", () => {
		expect(defaultSettingsPath({}, "darwin", "/Users/a")).toBe(
			"/Users/a/Library/Application Support/provenancetracker/settings.json",
		);
		expect(defaultSettingsPath({}, "linux", "/home/a")).toBe(
			"/home/a/.config/provenancetracker/settings.json",
		);
		expect(
			defaultSettingsPath({ XDG_CONFIG_HOME: "/cfg" }, "linux", "/home/a"),
		).toBe("/cfg/provenancetracker/settings.json");
	});

	it("can be moved by the environment, to a full path only", () => {
		const file = path.join(t.tempDir(), "s.json");
		expect(
			defaultSettingsPath(
				{ [SETTINGS_ENV]: file },
				process.platform,
				"/home/a",
			),
		).toBe(file);
		expect(() =>
			defaultSettingsPath(
				{ [SETTINGS_ENV]: "s.json" },
				process.platform,
				"/home/a",
			),
		).toThrow("absolute path");
	});
});

describe("readSettings and writeSettings", () => {
	it("read a missing file as empty, and write nothing until asked", () => {
		const file = path.join(t.tempDir(), "settings", "settings.json");
		expect(readSettings(file)).toEqual({
			format: SETTINGS_FORMAT,
			projects: {},
		});
		expect(() => readFileSync(file)).toThrow();
	});

	it("round-trip, keeping fields a newer version of the same format added", () => {
		const file = path.join(t.tempDir(), "settings", "settings.json");
		writeSettings(file, {
			format: 1,
			person: "A. Maker",
			projects: { [ID]: { folder: "/p", roots: { "1": "/media" } } },
			later: { kept: true },
		});
		updateSettings(file, (s) => {
			s.projects[ID].roots["2"] = "/archive";
		});
		expect(readSettings(file)).toEqual({
			format: 1,
			person: "A. Maker",
			projects: {
				[ID]: { folder: "/p", roots: { "1": "/media", "2": "/archive" } },
			},
			later: { kept: true },
		});
	});

	it("leave no temporary file behind", () => {
		const dir = t.tempDir();
		const file = path.join(dir, "settings.json");
		writeSettings(file, { format: 1, projects: {} });
		writeSettings(file, { format: 1, person: "B", projects: {} });
		expect(readdirSync(dir)).toEqual(["settings.json"]);
	});

	it("refuse a damaged file and leave it as it is", () => {
		const dir = t.tempDir();
		const file = path.join(dir, "settings.json");
		const cases: Array<[string, string]> = [
			["{ not json", "not JSON"],
			["[]", "not a JSON object"],
			['{"projects": {}}', "no format number"],
			[
				'{"format": 1, "projects": {"not-an-id": {"roots": {}}}}',
				"not a project id",
			],
			[
				`{"format": 1, "projects": {"${ID}": {"roots": {"0": "/a"}}}}`,
				"not a root id",
			],
			[
				`{"format": 1, "projects": {"${ID}": {"roots": {"1": 5}}}}`,
				"folder is not text",
			],
			['{"format": 1, "person": 3, "projects": {}}', "person is not text"],
			[
				'{"format": 1, "signingEngine": "openssl", "projects": {}}',
				"signingEngine is not one of library, c2patool",
			],
			[
				'{"format": 1, "remoteCredentials": "no", "projects": {}}',
				"remoteCredentials is not true or false",
			],
			[
				'{"format": 1, "credentialsOnTheWeb": "any", "projects": {}}',
				"credentialsOnTheWeb is not an object",
			],
			[
				'{"format": 1, "credentialsOnTheWeb": {"mode": "always"}, "projects": {}}',
				"credentialsOnTheWeb.mode is not one of never, listed, any",
			],
			[
				'{"format": 1, "credentialsOnTheWeb": {"hosts": "example.org"}, "projects": {}}',
				"credentialsOnTheWeb.hosts is not a list of host names",
			],
			[
				// A host is kept as the list holds it: an address, a bare word,
				// an IP address or capitals are not that.
				'{"format": 1, "credentialsOnTheWeb": {"hosts": ["https://example.org/x"]}, "projects": {}}',
				"credentialsOnTheWeb.hosts is not a list of host names",
			],
			[
				'{"format": 1, "credentialsOnTheWeb": {"left": ["127.0.0.1"]}, "projects": {}}',
				"credentialsOnTheWeb.left is not a list of host names",
			],
			[
				'{"format": 1, "credentialsOnTheWeb": {"left": ["Example.org"]}, "projects": {}}',
				"credentialsOnTheWeb.left is not a list of host names",
			],
		];
		for (const [text, why] of cases) {
			writeFileSync(file, text);
			expect(() => readSettings(file), text).toThrow(why);
			expect(() => updateSettings(file, () => {}), text).toThrow(
				"left as it is",
			);
			expect(readFileSync(file, "utf8")).toBe(text);
		}
	});

	it("refuse a newer format, unchanged", () => {
		const dir = t.tempDir();
		mkdirSync(dir, { recursive: true });
		const file = path.join(dir, "settings.json");
		writeFileSync(file, '{"format": 2, "projects": {}}');
		expect(() => updateSettings(file, () => {})).toThrow(
			"format 2, written by a newer Provenance Tracker",
		);
		expect(readFileSync(file, "utf8")).toBe('{"format": 2, "projects": {}}');
	});
});

describe("projectEntry", () => {
	it("takes only a project id as a key, so a request's __proto__ can never reach the object prototype", () => {
		const settings = readSettings(path.join(t.tempDir(), "settings.json"));
		expect(projectEntry(settings, ID)).toEqual({ roots: {} });
		for (const bad of ["__proto__", "constructor", "x"])
			expect(() => projectEntry(settings, bad), bad).toThrow(
				/is not a project id/,
			);
		expect(({} as Record<string, unknown>).roots).toBeUndefined();
		expect(Object.keys(settings.projects)).toEqual([ID]);
	});
});

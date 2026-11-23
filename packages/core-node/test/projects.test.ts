import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { catalogPathOf, createProject, openProject } from "../src/project.ts";
import { forgetProject, knownProjects } from "../src/projects.ts";
import { readSettings, updateSettings } from "../src/settings.ts";
import { machinesForTests } from "./helpers/machine.ts";

const { machine, tempDir } = machinesForTests();

describe("forgetProject", () => {
	it("drops the project from this machine's settings and leaves its folder and catalog as they were", () => {
		const m = machine();
		const dir = tempDir();
		const folder = path.join(dir, "Film");
		const other = path.join(dir, "Other");
		const { projectId } = createProject(folder, { name: "Film", machine: m });
		const kept = createProject(other, { name: "Other", machine: m });
		updateSettings(m.settingsPath, (s) => {
			s.person = "A. Person";
			s.projects[projectId].roots["2"] = path.join(dir, "media");
			s.projects[projectId].signing = {
				certificate: path.join(dir, "c.pem"),
				privateKey: path.join(dir, "k.pem"),
			};
		});
		const catalog = readFileSync(catalogPathOf(folder));

		expect(forgetProject(m, projectId)).toBe(true);
		const s = readSettings(m.settingsPath);
		expect(Object.keys(s.projects)).toEqual([kept.projectId]);
		expect(s.person).toBe("A. Person");
		expect(knownProjects(m).map((p) => p.name)).toEqual(["Other"]);
		expect(readFileSync(catalogPathOf(folder))).toEqual(catalog);

		// Opening the folder again brings it back, with nothing placed here yet.
		const again = openProject(folder, { machine: m });
		again.db.close();
		expect(readSettings(m.settingsPath).projects[projectId]).toMatchObject({
			folder,
			roots: {},
		});
		expect(readSettings(m.settingsPath).projects[projectId].signing).toBe(
			undefined,
		);
	});

	it("answers false, writing nothing, for a project it does not know or a value that is not a project id", () => {
		const m = machine();
		mkdirSync(path.dirname(m.settingsPath), { recursive: true });
		for (const id of [
			"00000000-0000-4000-8000-000000000000",
			"__proto__",
			"constructor",
			"../x",
		])
			expect(forgetProject(m, id)).toBe(false);
		expect(existsSync(m.settingsPath)).toBe(false);
	});
});

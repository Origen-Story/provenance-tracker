// The public viewer's example record is made by a script that runs the real
// statement and export builders. Nothing ran that script, and it has broken
// unseen once when a builder changed. This runs it, into a temp folder, and
// holds the committed example to what it writes.

import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { validate } from "../../../packages/core/test/helpers/json-schema-lite.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const EXAMPLE = path.join(ROOT, "public-viewer", "example");
const dir = mkdtempSync(path.join(tmpdir(), "pt-example-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("public-viewer/example/make-example.mjs", () => {
	const out = path.join(dir, "example.provenance.json");
	const run = spawnSync(
		process.execPath,
		[path.join(EXAMPLE, "make-example.mjs"), out],
		{ cwd: ROOT, encoding: "utf8" },
	);

	it("runs, and writes where it is told", () => {
		expect(run.stderr.replace(/^.*Warning.*$\n?|^\(Use .*\)$\n?/gm, "")).toBe(
			"",
		);
		expect(run.status).toBe(0);
	});

	it("writes a record that meets the published schema", () => {
		const schema = JSON.parse(
			readFileSync(
				path.join(ROOT, "spec", "public-export.v3.schema.json"),
				"utf8",
			),
		);
		expect(validate(schema, JSON.parse(readFileSync(out, "utf8")))).toEqual([]);
	});

	it("writes the example that is committed, value for value, so the demo shows the current format", () => {
		// By value: the committed copy is laid out by the formatter.
		const committed = JSON.parse(
			readFileSync(path.join(EXAMPLE, "example.provenance.json"), "utf8"),
		);
		expect(JSON.parse(readFileSync(out, "utf8"))).toEqual(committed);
	});
});

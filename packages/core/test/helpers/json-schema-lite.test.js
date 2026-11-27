// The schema checker the tests use is hand-written and small on purpose
// (D84). It enforces a handful of keywords and would pass over any other
// without a word. So every published schema is held to using only the
// keywords it enforces: a schema that gains another fails here, on the day
// it would otherwise have gained a rule that nothing checked.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { CHECKED, uncheckedKeywords, validate } from "./json-schema-lite.js";

const SPEC = path.resolve(import.meta.dirname, "..", "..", "..", "..", "spec");
const schemas = readdirSync(SPEC).filter((f) => f.endsWith(".schema.json"));

describe("the test schema checker (D84)", () => {
	it("finds every published schema", () => {
		expect(schemas).toEqual(
			expect.arrayContaining([
				"creator-statement.v3.schema.json",
				"public-export.v3.schema.json",
			]),
		);
	});

	it.each(schemas)("%s uses only keywords the checker enforces", (file) => {
		const schema = JSON.parse(readFileSync(path.join(SPEC, file), "utf8"));
		expect(uncheckedKeywords(schema)).toEqual([]);
	});

	it("names a keyword it would pass over, wherever it is in a schema", () => {
		expect(
			uncheckedKeywords({
				type: "object",
				title: "T",
				minProperties: 1,
				properties: {
					name: { type: "string", maxLength: 5 },
					list: { type: "array", items: { type: "string", format: "uri" } },
				},
				additionalProperties: { oneOf: [] },
				$defs: { other: { type: "number", maximum: 3 } },
			}),
		).toEqual([
			"$: minProperties",
			"$.properties.name: maxLength",
			"$.properties.list.items: format",
			"$.additionalProperties: oneOf",
			"$.$defs.other: maximum",
		]);
	});

	it("enforces each keyword it says it does", () => {
		const schema = {
			type: "object",
			required: ["kind", "n"],
			additionalProperties: false,
			properties: {
				kind: { const: "film" },
				n: { type: "integer", minimum: 1 },
				tag: { enum: ["a", "b"] },
				id: { type: "string", pattern: "^[0-9a-f]{4}$" },
				list: { type: "array", items: { $ref: "#/$defs/word" } },
			},
			$defs: { word: { type: "string" } },
		};
		expect(
			validate(schema, {
				kind: "film",
				n: 1,
				tag: "a",
				id: "0af3",
				list: ["x"],
			}),
		).toEqual([]);
		const problems = validate(schema, {
			kind: "book",
			n: 0,
			tag: "c",
			id: "XYZ",
			list: [1],
			extra: true,
		});
		expect(problems).toHaveLength(6);
		// One problem for each of const, minimum, enum, pattern, items/$ref/type
		// and additionalProperties; required is the next line.
		expect(validate(schema, { kind: "film" })).toEqual(["$: missing n"]);
		expect(CHECKED).toHaveLength(10);
	});
});

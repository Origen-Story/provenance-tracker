import { describe, it, expect } from "vitest";
import {
	parseCopyText,
	pgBoolean,
	pgInteger,
	pgReal,
	pgTimestamp,
	unescapeField,
} from "../../src/legacy/copy-text.ts";

const block = (head: string, ...lines: string[]) =>
	[head, ...lines, "\\.", ""].join("\n");

describe("parseCopyText", () => {
	it("reads each COPY block as rows of named fields, with \\N as null", () => {
		const text = [
			"SET client_encoding = 'UTF8';",
			"",
			block(
				"COPY public.assets (id, asset_id, notes) FROM stdin;",
				"1\tVPT-001\t\\N",
				"2\tVPT-002\t",
			),
			block("COPY public.manifests (id) FROM stdin;"),
		].join("\n");
		const tables = parseCopyText(text);
		expect([...tables.keys()]).toEqual(["public.assets", "public.manifests"]);
		expect(tables.get("public.assets")).toEqual({
			name: "public.assets",
			columns: ["id", "asset_id", "notes"],
			rows: [
				{ id: "1", asset_id: "VPT-001", notes: null },
				{ id: "2", asset_id: "VPT-002", notes: "" },
			],
		});
		expect(tables.get("public.manifests")!.rows).toEqual([]);
	});

	it("undoes the escapes inside a field", () => {
		const tables = parseCopyText(
			block(
				"COPY public.t (id, v) FROM stdin;",
				"1\tP:\\\\media\\\\clip.mp4",
				"2\tline one\\nline two\\ttabbed\\rback",
				"3\t\\\\N is text here",
			),
		);
		expect(tables.get("public.t")!.rows.map((r) => r.v)).toEqual([
			"P:\\media\\clip.mp4",
			"line one\nline two\ttabbed\rback",
			"\\N is text here",
		]);
	});

	it("reads lines that end in CRLF, without keeping the CR", () => {
		const text = "COPY public.t (id, v) FROM stdin;\r\n1\tx\r\n\\.\r\n";
		expect(parseCopyText(text).get("public.t")!.rows).toEqual([
			{ id: "1", v: "x" },
		]);
	});

	it("unquotes quoted table and column names", () => {
		const tables = parseCopyText(
			block(
				'COPY public."My ""odd"" table" (id, "order", "a, b") FROM stdin;',
				"1\t2\t3",
			),
		);
		const t = tables.get('public.My "odd" table')!;
		expect(t.columns).toEqual(["id", "order", "a, b"]);
		expect(t.rows).toEqual([{ id: "1", order: "2", "a, b": "3" }]);
	});

	it("reads a COPY line in time linear in its length, however its quotes fall", () => {
		// CodeQL js/redos: a name of many "" pairs made the old pattern backtrack.
		const hostile = `COPY "${'""'.repeat(50_000)} (id) FROM stdin;`;
		const started = performance.now();
		expect(parseCopyText(`${hostile}\n${hostile}x\n`).size).toBe(0);
		expect(performance.now() - started).toBeLessThan(500);
		// The same shape closed properly is a table name with quotes in it.
		const ok = `COPY "${'""'.repeat(3)}" (id) FROM stdin;\n1\n\\.\n`;
		expect([...parseCopyText(ok).keys()]).toEqual(['"""']);
	});

	it("refuses a row whose field count is not the column count", () => {
		expect(() =>
			parseCopyText(block("COPY public.t (id, v) FROM stdin;", "1\tx\ty")),
		).toThrow(/3 fields for 2 columns/);
	});

	it("refuses a block with no end", () => {
		expect(() => parseCopyText("COPY public.t (id) FROM stdin;\n1\n")).toThrow(
			/has no end/,
		);
	});

	it("refuses a table given twice", () => {
		const b = block("COPY public.t (id) FROM stdin;", "1");
		expect(() => parseCopyText(b + b)).toThrow(/twice/);
	});

	it("refuses text in an encoding other than UTF-8", () => {
		expect(() => parseCopyText("SET client_encoding = 'LATIN1';\n")).toThrow(
			/only UTF8/,
		);
	});
});

describe("unescapeField", () => {
	it("reads octal and hex bytes as UTF-8, including one character split over several", () => {
		expect(unescapeField("Pe\\303\\261a")).toBe("Peña");
		expect(unescapeField("Pe\\xc3\\xb1a")).toBe("Peña");
		expect(unescapeField("\\101\\x42C")).toBe("ABC");
	});

	it("reads \\b \\f \\v, and any other escaped character as itself", () => {
		expect(unescapeField("a\\bb\\fc\\vd\\qe")).toBe("a\bb\fc\vdqe");
	});

	it("refuses bytes that are not UTF-8, and a lone backslash at the end", () => {
		expect(() => unescapeField("\\377")).toThrow();
		expect(() => unescapeField("abc\\")).toThrow(/lone backslash/);
	});
});

describe("Postgres values", () => {
	it("turns a timestamptz into ISO 8601 UTC, to the millisecond", () => {
		expect(pgTimestamp("2026-11-13 21:53:25.345308+01")).toBe(
			"2026-11-13T20:53:25.345Z",
		);
		expect(pgTimestamp("2026-11-13 21:53:25+01")).toBe(
			"2026-11-13T20:53:25.000Z",
		);
		expect(pgTimestamp("2026-11-13 21:53:25.5+00")).toBe(
			"2026-11-13T21:53:25.500Z",
		);
		// Digits past the millisecond are dropped, never rounded up.
		expect(pgTimestamp("2026-11-13 21:53:25.999999+01")).toBe(
			"2026-11-13T20:53:25.999Z",
		);
		// Offsets with minutes, and ones that cross midnight and the year.
		expect(pgTimestamp("2026-01-01 00:15:00-05:30")).toBe(
			"2026-01-01T05:45:00.000Z",
		);
		expect(pgTimestamp("2026-01-01 00:30:00.1+02")).toBe(
			"2025-12-31T22:30:00.100Z",
		);
	});

	it("refuses text that is not a timestamptz", () => {
		expect(() => pgTimestamp("2026-11-13")).toThrow(/timestamptz/);
		expect(() => pgTimestamp("2026-11-13 21:53:25")).toThrow(/timestamptz/);
		expect(() => pgTimestamp("infinity")).toThrow(/timestamptz/);
	});

	it("reads booleans, whole numbers and numbers, with null kept", () => {
		expect([pgBoolean("t"), pgBoolean("f"), pgBoolean(null)]).toEqual([
			true,
			false,
			null,
		]);
		expect(() => pgBoolean("true")).toThrow();
		expect([pgInteger("42"), pgInteger("-3"), pgInteger(null)]).toEqual([
			42,
			-3,
			null,
		]);
		expect(() => pgInteger("1.5")).toThrow();
		expect(() => pgInteger("99999999999999999999")).toThrow();
		expect([pgReal("29.97003"), pgReal("1e3"), pgReal(null)]).toEqual([
			29.97003,
			1000,
			null,
		]);
		expect(() => pgReal("NaN")).toThrow();
		expect(() => pgReal("")).toThrow();
	});
});

import { describe, it, expect } from "vitest";
import { createRow, type Actor } from "../../src/catalog/edit.ts";
import { EditError, NotFoundError } from "../../src/catalog/errors.ts";
import { finishRun, startRun } from "../../src/catalog/runs.ts";
import {
	nextSignatureVersion,
	publicExport,
	recordSigning,
	type NewSigning,
} from "../../src/catalog/signatures.ts";
import { PERSON, TEST_TOOL, sha } from "../helpers/catalog.ts";
import { catalogsForTests } from "../helpers/catalog-tests.ts";

const { catalog } = catalogsForTests();
const AT = "2026-11-23T12:00:00.000Z";

const STATEMENT = {
	version: 2,
	text: "Made from a recording.",
	output: { title: "film.mp4", originClass: "compositeCapture" },
	composition: { picture: { intervals: [] }, audio: { intervals: [] } },
	ingredients: [],
};

function world() {
	const db = catalog();
	const root = Number(
		createRow(
			db,
			"roots",
			{ name: "media", folder_in_project: "media" },
			PERSON,
		),
	);
	const run = startRun(db, { kind: "scan", tool: TEST_TOOL, now: AT });
	const tool: Actor = { kind: "tool", name: "t", runId: run };
	const film = Number(
		createRow(
			db,
			"assets",
			{ kind: "produced", is_output: true },
			{ actor: tool, now: AT },
		),
	);
	const other = Number(
		createRow(db, "assets", { kind: "produced" }, { actor: tool, now: AT }),
	);
	createRow(
		db,
		"contents",
		{ sha256: sha("c"), size: 100, asset_id: film, first_run_id: run },
		{ actor: tool, now: AT },
	);
	createRow(
		db,
		"contents",
		{ sha256: sha("d"), size: 50, asset_id: other, first_run_id: run },
		{ actor: tool, now: AT },
	);
	finishRun(db, run, { outcome: "ok", now: AT });
	const signing = (over: Partial<NewSigning> = {}): NewSigning => ({
		assetId: film,
		kind: "output",
		version: nextSignatureVersion(db, film, "output"),
		sourceSha256: sha("c"),
		signed: {
			sha256: sha("e"),
			size: 120,
			rootId: root,
			path: "exports/film.signed.v1.mp4",
			modifiedMs: 1,
		},
		engine: "c2patool",
		engineVersion: "0.27.1",
		certificateSha256: sha("9"),
		definition: { title: "film.mp4" },
		statementId: null,
		statement: STATEMENT,
		report: null,
		signedAt: AT,
		...over,
	});
	return { db, root, film, other, signing };
}

describe("recordSigning", () => {
	it("records the signed copy as a content of the asset, in its place, and the signing, under one sign run", () => {
		const w = world();
		expect(nextSignatureVersion(w.db, w.film, "output")).toBe(1);
		const { signatureId, runId } = recordSigning(w.db, w.signing(), {
			tool: TEST_TOOL,
			now: () => AT,
		});
		expect(
			w.db
				.prepare(
					"SELECT asset_id, size, first_run_id FROM contents WHERE sha256 = ?",
				)
				.get(sha("e")),
		).toEqual({ asset_id: w.film, size: 120, first_run_id: runId });
		expect(
			w.db
				.prepare("SELECT root_id, path FROM locations WHERE content_sha256 = ?")
				.get(sha("e")),
		).toEqual({ root_id: w.root, path: "exports/film.signed.v1.mp4" });
		expect(
			w.db
				.prepare(
					"SELECT kind, version, source_sha256, signed_sha256, run_id, engine, engine_version, certificate_sha256, definition FROM signatures WHERE id = ?",
				)
				.get(signatureId),
		).toEqual({
			kind: "output",
			version: 1,
			source_sha256: sha("c"),
			signed_sha256: sha("e"),
			run_id: runId,
			engine: "c2patool",
			engine_version: "0.27.1",
			certificate_sha256: sha("9"),
			definition: '{"title":"film.mp4"}',
		});
		expect(
			w.db.prepare("SELECT kind, outcome FROM runs WHERE id = ?").get(runId),
		).toEqual({ kind: "sign", outcome: "ok" });
		expect(nextSignatureVersion(w.db, w.film, "output")).toBe(2);
	});

	it("refuses a file that is not the asset's, or a copy with another asset's bytes, recording the run as failed", () => {
		const w = world();
		expect(() =>
			recordSigning(w.db, w.signing({ sourceSha256: sha("d") }), {
				tool: TEST_TOOL,
			}),
		).toThrow(EditError);
		expect(() =>
			recordSigning(
				w.db,
				w.signing({
					signed: {
						sha256: sha("d"),
						size: 50,
						rootId: w.root,
						path: "x.mp4",
						modifiedMs: 1,
					},
				}),
				{ tool: TEST_TOOL },
			),
		).toThrow(/another asset's file/);
		expect(
			w.db.prepare("SELECT outcome FROM runs WHERE kind = 'sign'").all(),
		).toEqual([{ outcome: "failed" }]);
		expect(w.db.prepare("SELECT count(*) AS n FROM signatures").get()).toEqual({
			n: 0,
		});
	});
});

describe("publicExport", () => {
	it("is built from a signing's record alone, and named after the signed file", () => {
		const w = world();
		const { signatureId } = recordSigning(w.db, w.signing(), {
			tool: TEST_TOOL,
			now: () => AT,
		});
		const { data, fileName } = publicExport(w.db, signatureId, {
			generatedAt: AT,
			generator: { name: "provenance-tracker", version: "0" },
		});
		expect(fileName).toBe("film.signed.v1.provenance.json");
		expect(data).toMatchObject({
			signedFile: {
				fileName: "film.signed.v1.mp4",
				sha256: sha("e"),
				bytes: 120,
				version: 1,
				signedAt: AT,
			},
		});
	});

	it("refuses a signing that is not there, or of a single asset", () => {
		const w = world();
		expect(() =>
			publicExport(w.db, 9, {
				generatedAt: AT,
				generator: { name: "x", version: "0" },
			}),
		).toThrow(NotFoundError);
		const { signatureId } = recordSigning(
			w.db,
			w.signing({ kind: "asset", version: 1 }),
			{ tool: TEST_TOOL, now: () => AT },
		);
		expect(() =>
			publicExport(w.db, signatureId, {
				generatedAt: AT,
				generator: { name: "x", version: "0" },
			}),
		).toThrow(/Only a signed output/);
	});
});

import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { credentialsWaiting } from "../../src/catalog/on-the-web.ts";
import { libraryObservation } from "../../src/extraction/c2pa-library-read.ts";
import { startRun } from "../../src/catalog/runs.ts";
import type { OnTheWeb } from "../../src/extraction/web-credentials.ts";
import { catalogsForTests } from "../helpers/catalog-tests.ts";
import { sha, TEST_TOOL } from "../helpers/catalog.ts";

const t = catalogsForTests();
const AT = "2026-11-27T09:00:00.000Z";
const ADOBE = "cai-manifests.adobe.com";

/** Add a reading of a content's own credentials, as extract would. */
function reading(
	db: DatabaseSync,
	content: string,
	said: { onTheWeb: OnTheWeb } | { store: unknown } | { legacy: string },
) {
	const runId = startRun(db, { kind: "extract", tool: TEST_TOOL, now: AT });
	const o =
		"legacy" in said
			? { status: "unreadable", data: null, error: said.legacy }
			: libraryObservation({ kind: "c2pa", version: "0.12.1", ...said });
	db.prepare(
		`INSERT INTO observations (content_sha256, run_id, kind, extractor, extractor_version, status, data, error, observed_at)
		 VALUES (?, ?, 'c2pa', 'c2pa-node', '0.12.1', ?, ?, ?, ?)`,
	).run(
		sha(content),
		runId,
		o.status,
		o.data === null ? null : JSON.stringify(o.data),
		o.error,
		AT,
	);
}

const held = (
	host: string,
	name: string,
	outcome: OnTheWeb["outcome"] = "not-chosen",
	detail?: string,
): { onTheWeb: OnTheWeb } => ({
	onTheWeb: {
		address: `https://${host}/manifests/${name}`,
		host,
		outcome,
		...(detail ? { detail } : {}),
	},
});

describe("credentialsWaiting (D74)", () => {
	it("is empty for a project none of whose files keep credentials on the web", () => {
		expect(credentialsWaiting(t.sample())).toEqual([]);
	});

	it("counts files by the host they name, most files first", () => {
		const db = t.sample();
		reading(db, "b", held(ADOBE, "b"));
		reading(db, "c", held(ADOBE, "c"));
		reading(db, "d", held("credentials.example.org", "d", "not-listed"));
		expect(credentialsWaiting(db)).toEqual([
			{
				host: ADOBE,
				files: 2,
				address: `https://${ADOBE}/manifests/c`,
				outcome: "not-chosen",
				detail: null,
			},
			{
				host: "credentials.example.org",
				files: 1,
				address: "https://credentials.example.org/manifests/d",
				outcome: "not-listed",
				detail: null,
			},
		]);
	});

	it("goes by each file's newest reading: one read since is no longer waiting", () => {
		const db = t.sample();
		reading(db, "b", held(ADOBE, "b"));
		reading(db, "c", held(ADOBE, "c"));
		reading(db, "c", {
			store: { active_manifest: "urn:m", manifests: { "urn:m": {} } },
		});
		reading(
			db,
			"b",
			held(ADOBE, "b", "failed", "the server answered with status 404"),
		);
		expect(credentialsWaiting(db)).toEqual([
			{
				host: ADOBE,
				files: 1,
				address: `https://${ADOBE}/manifests/b`,
				outcome: "failed",
				detail: "the server answered with status 404",
			},
		]);
	});

	it("counts a reading made before D74, with fetching switched off", () => {
		const db = t.sample();
		reading(db, "c", {
			legacy: `C2PA library: must fetch remote manifests from url https://${ADOBE}/manifests/c`,
		});
		expect(credentialsWaiting(db)).toMatchObject([
			{ host: ADOBE, files: 1, outcome: "never" },
		]);
	});

	it("leaves out a file that is no longer anywhere, and any other unreadable reading", () => {
		const db = t.sample();
		reading(db, "b", held(ADOBE, "b"));
		reading(db, "c", { legacy: "C2PA library: asset could not be parsed" });
		const gone = startRun(db, { kind: "scan", tool: TEST_TOOL, now: AT });
		db.prepare(
			"UPDATE locations SET gone_run_id = ? WHERE content_sha256 = ?",
		).run(gone, sha("b"));
		expect(credentialsWaiting(db)).toEqual([]);
	});

	it("keeps addresses no list could hold apart, each under its own address", () => {
		const db = t.sample();
		for (const c of ["b", "c"])
			reading(db, c, {
				onTheWeb: {
					address: `http://plain.example.org/${c}`,
					host: null,
					outcome: "refused",
					detail: "only https addresses are fetched, and this one is http",
				},
			});
		expect(
			credentialsWaiting(db).map((w) => [w.host, w.files, w.address]),
		).toEqual([
			[null, 1, "http://plain.example.org/b"],
			[null, 1, "http://plain.example.org/c"],
		]);
	});
});

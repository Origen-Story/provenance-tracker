// Catalogs for tests: an empty one in memory, one with a row in every table,
// and a way to compare two schemas.

import { DatabaseSync } from "node:sqlite";
import { createCatalog } from "../../src/catalog/create.ts";
import {
	createRow,
	editRow,
	setMeta,
	type ChangeOptions,
} from "../../src/catalog/edit.ts";
import { finishRun, startRun } from "../../src/catalog/runs.ts";

export const TEST_TOOL = { name: "provenancetracker-test", version: "0.0.0" };
export const PROJECT_ID = "6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f";
const AT = "2026-11-21T12:00:00.000Z";

export function memoryCatalog(): DatabaseSync {
	const db = new DatabaseSync(":memory:");
	createCatalog(db, {
		projectId: PROJECT_ID,
		name: "Sample project",
		tool: TEST_TOOL,
		now: AT,
	});
	return db;
}

/** A SHA-256-shaped hex string made from one character. */
export const sha = (c: string) => c.repeat(64);

export const PERSON: ChangeOptions = {
	actor: { kind: "person", name: "A. Maker" },
	now: AT,
};

/**
 * One row in every table, as a small project would have them: a root, a
 * camera clip, an archival photo, an AI clip and a finished film with a
 * timeline, a statement and a signed copy. Current values go through the
 * edit functions, as real code must; records of what happened (runs,
 * locations, observations, statements, signatures) are written as the
 * scanner, extractor and signer will write them.
 */
export function fillSample(db: DatabaseSync): void {
	const tool = (runId: number): ChangeOptions => ({
		actor: { kind: "tool", name: "provenancetracker 0.3.0", runId },
		now: AT,
	});
	const sql = (text: string, ...params: Array<string | number | null>) =>
		db.prepare(text).run(...params);
	const newRun = (kind: string) =>
		startRun(db, {
			kind,
			tool: { name: "provenancetracker", version: "0.3.0" },
			now: AT,
		});

	setMeta(db, "author", "A. Maker", PERSON);
	setMeta(db, "organization", "Example Studio", PERSON);

	const scan = newRun("scan");
	const root = Number(
		createRow(db, "roots", { name: "media", note: "Main media drive" }, PERSON),
	);

	const asset = (kind: string, title: string, cls: string, isOutput = false) =>
		Number(
			createRow(
				db,
				"assets",
				{
					kind,
					is_output: isOutput,
					title,
					origin_class: cls,
					origin_class_source: "classifier",
				},
				tool(scan),
			),
		);
	const camera = asset("produced", "Street interview", "digitalCapture");
	const photo = asset("archival", "Town square, 1910", "unknown");
	const ai = asset("generated", "Title sequence", "trainedAlgorithmicMedia");
	const film = asset(
		"produced",
		"Finished film",
		"compositeWithTrainedAlgorithmicMedia",
		true,
	);
	editRow(
		db,
		"assets",
		photo,
		{
			source_url: "https://example.org/item/1",
			license: "Public domain",
			original_date: "circa 1910",
			origin_class: "digitalCapture",
			origin_class_confirmed: true,
			origin_class_note: "Scanned print",
		},
		PERSON,
	);

	createRow(
		db,
		"credits",
		{
			asset_id: photo,
			role: "creator",
			name: "Unknown photographer",
			stated_by: "legacy",
		},
		{ actor: { kind: "legacy", name: "Postgres import" }, now: AT },
	);
	createRow(
		db,
		"credits",
		{
			asset_id: photo,
			role: "institution",
			name: "Example Archive",
			stated_by: "creator",
			sort_order: 1,
		},
		PERSON,
	);
	createRow(
		db,
		"generation",
		{
			asset_id: ai,
			platform: "freepik",
			model_name: "example-model",
			prompt: "a slow pan across a square",
		},
		tool(scan),
	);

	const content = (c: string, size: number, assetId: number, path: string) => {
		createRow(
			db,
			"contents",
			{ sha256: sha(c), size, asset_id: assetId, first_run_id: scan },
			tool(scan),
		);
		sql(
			`INSERT INTO locations (content_sha256, root_id, path, modified_ms, first_seen_run_id, last_seen_run_id)
			 VALUES (?, ?, ?, 1763726400000, ?, ?)`,
			sha(c),
			root,
			path,
			scan,
			scan,
		);
	};
	content("a", 45_000_000, camera, "camera/PXL_0001.mp4");
	content("b", 2_000_000, photo, "archive/square-1910.jpg");
	content("c", 9_000_000, ai, "ai/title.mp4");
	content("d", 120_000_000, film, "exports/film.mp4");
	content("e", 120_100_000, film, "exports/signed/film.signed.v1.mp4");
	finishRun(db, scan, { outcome: "ok", summary: { files: 5 }, now: AT });

	const extract = newRun("extract");
	sql(
		`INSERT INTO observations (content_sha256, run_id, kind, extractor, extractor_version, status, data, validation, observed_at)
		 VALUES (?, ?, 'c2pa', 'c2pa-node', '0.12.1', 'ok', '{"active_manifest":"urn:c2pa:1"}', '{"state":"Trusted","failures":[],"statuses":[]}', ?),
		        (?, ?, 'exif', 'exiftool', '13.0', 'absent', NULL, NULL, ?)`,
		sha("a"),
		extract,
		AT,
		sha("b"),
		extract,
		AT,
	);
	finishRun(db, extract, { outcome: "ok", now: AT });

	createRow(
		db,
		"relationships",
		{
			parent_id: camera,
			child_id: film,
			type: "output_of",
			match_method: "timeline",
		},
		tool(scan),
	);

	const importRun = newRun("import");
	const timeline = Number(
		createRow(
			db,
			"timelines",
			{
				content_sha256: sha("d"),
				format: "xmeml",
				file_name: "film.xml",
				file_sha256: sha("f"),
				sequence_name: "Film v1",
				timebase: 25,
				fps: 25,
				duration_frames: 2500,
				breakdown: "{}",
				imported_at: AT,
			},
			tool(importRun),
		),
	);
	const source = Number(
		createRow(
			db,
			"timeline_sources",
			{
				timeline_id: timeline,
				source_key: "file-1",
				name: "PXL_0001.mp4",
				path: "D:/edit/PXL_0001.mp4",
				asset_id: camera,
				match_method: "hash",
				match_confidence: 1,
			},
			tool(importRun),
		),
	);
	createRow(
		db,
		"timeline_clips",
		{
			timeline_id: timeline,
			source_id: source,
			track_kind: "video",
			track_index: 1,
			clip_key: "clip-1",
			name: "PXL_0001.mp4",
			start_frame: 0,
			end_frame: 250,
			start_seconds: 0,
			end_seconds: 10,
		},
		tool(importRun),
	);
	finishRun(db, importRun, { outcome: "ok", now: AT });

	const statement = Number(
		sql(
			`INSERT INTO statements (asset_id, text, author, organization, saved_at)
			 VALUES (?, 'Made with camera, archive and AI material.', 'A. Maker', 'Example Studio', ?)`,
			film,
			AT,
		).lastInsertRowid,
	);
	const sign = newRun("sign");
	sql(
		`INSERT INTO signatures (asset_id, kind, version, source_sha256, signed_sha256, run_id, engine, engine_version, certificate_sha256, signer_name, definition, statement_id, statement, status, signed_at)
		 VALUES (?, 'output', 1, ?, ?, ?, 'c2pa-node', '0.12.1', ?, 'A. Maker', '{}', ?, '{"version":3}', 'Valid', ?)`,
		film,
		sha("d"),
		sha("e"),
		sign,
		sha("9"),
		statement,
		AT,
	);
	finishRun(db, sign, { outcome: "ok", now: AT });
}

/** Every table, index, trigger and view, with its SQL, in a stable order. */
export function schemaOf(db: DatabaseSync) {
	return db
		.prepare(
			"SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name",
		)
		.all();
}

/** The tables a catalog holds rows in (no FTS shadow tables). */
export function dataTables(db: DatabaseSync): string[] {
	return (
		db
			.prepare(
				`SELECT name FROM sqlite_schema WHERE type = 'table'
				 AND name NOT GLOB '*_text*' AND name NOT GLOB 'sqlite_*' ORDER BY name`,
			)
			.all() as Array<{ name: string }>
	).map((r) => r.name);
}

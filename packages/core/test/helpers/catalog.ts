// Catalogs for tests: an empty one in memory, one with a row in every table,
// and a way to compare two schemas.

import { DatabaseSync } from "node:sqlite";
import { createCatalog } from "../../src/catalog/create.ts";

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

/**
 * One row in every table, as a small project would have them: a root, a
 * camera clip, an archival photo, an AI clip and a finished film with a
 * timeline, a statement and a signed copy. Raw SQL: this is the format, not
 * the functions that will write it.
 */
export function fillSample(db: DatabaseSync): void {
	const run = (sql: string, ...params: Array<string | number | null>) =>
		db.prepare(sql).run(...params);

	run(
		`INSERT INTO meta (key, value) VALUES ('author', 'A. Maker'), ('organization', 'Example Studio')`,
	);
	const scan = Number(
		run(
			`INSERT INTO runs (kind, tool, tool_version, started_at, finished_at, outcome, summary)
			 VALUES ('scan', 'provenancetracker', '0.3.0', ?, ?, 'ok', '{"files":5}')`,
			AT,
			AT,
		).lastInsertRowid,
	);
	run(
		`INSERT INTO roots (name, note, created_at) VALUES ('media', 'Main media drive', ?)`,
		AT,
	);

	const asset = (kind: string, title: string, cls: string, extra = 0) =>
		Number(
			run(
				`INSERT INTO assets (kind, is_output, title, title_folded, origin_class, origin_class_confirmed, created_at, updated_at)
				 VALUES (?, ?, ?, lower(?), ?, 1, ?, ?)`,
				kind,
				extra,
				title,
				title,
				cls,
				AT,
				AT,
			).lastInsertRowid,
		);
	const camera = asset("produced", "Street interview", "digitalCapture");
	const photo = asset("archival", "Town square, 1910", "digitalCapture");
	const ai = asset("generated", "Title sequence", "trainedAlgorithmicMedia");
	const film = asset(
		"produced",
		"Finished film",
		"compositeWithTrainedAlgorithmicMedia",
		1,
	);
	run(
		`UPDATE assets SET source_url = 'https://example.org/item/1', license = 'Public domain', original_date = 'circa 1910' WHERE id = ?`,
		photo,
	);

	run(
		`INSERT INTO credits (asset_id, role, name, name_folded, stated_by, created_at, updated_at)
		 VALUES (?, 'creator', 'Unknown photographer', 'unknown photographer', 'legacy', ?, ?),
		        (?, 'institution', 'Example Archive', 'example archive', 'creator', ?, ?)`,
		photo,
		AT,
		AT,
		photo,
		AT,
		AT,
	);
	run(
		`INSERT INTO generation (asset_id, platform, model_name, prompt, loras, updated_at)
		 VALUES (?, 'freepik', 'example-model', 'a slow pan across a square', '[]', ?)`,
		ai,
		AT,
	);

	const content = (c: string, size: number, assetId: number, path: string) => {
		run(
			`INSERT INTO contents (sha256, size, asset_id, first_run_id, created_at) VALUES (?, ?, ?, ?, ?)`,
			sha(c),
			size,
			assetId,
			scan,
			AT,
		);
		run(
			`INSERT INTO locations (content_sha256, root_id, path, modified_ms, first_seen_run_id, last_seen_run_id)
			 VALUES (?, 1, ?, 1763726400000, ?, ?)`,
			sha(c),
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

	const extract = Number(
		run(
			`INSERT INTO runs (kind, tool, tool_version, started_at, finished_at, outcome)
			 VALUES ('extract', 'provenancetracker', '0.3.0', ?, ?, 'ok')`,
			AT,
			AT,
		).lastInsertRowid,
	);
	run(
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
	run(
		`INSERT INTO history (at, actor_kind, actor, table_name, row_key, field, old_value, new_value, note)
		 VALUES (?, 'person', 'A. Maker', 'assets', ?, 'origin_class', '"unknown"', '"digitalCapture"', 'Scanned print')`,
		AT,
		String(photo),
	);
	run(
		`INSERT INTO relationships (parent_id, child_id, type, match_method, created_at) VALUES (?, ?, 'output_of', 'timeline', ?)`,
		camera,
		film,
		AT,
	);

	const timeline = Number(
		run(
			`INSERT INTO timelines (content_sha256, format, file_name, file_sha256, sequence_name, timebase, fps, duration_frames, breakdown, imported_at, updated_at)
			 VALUES (?, 'xmeml', 'film.xml', ?, 'Film v1', 25, 25, 2500, '{}', ?, ?)`,
			sha("d"),
			sha("f"),
			AT,
			AT,
		).lastInsertRowid,
	);
	const source = Number(
		run(
			`INSERT INTO timeline_sources (timeline_id, source_key, name, path, asset_id, match_method, match_confidence)
			 VALUES (?, 'file-1', 'PXL_0001.mp4', 'D:/edit/PXL_0001.mp4', ?, 'hash', 1)`,
			timeline,
			camera,
		).lastInsertRowid,
	);
	run(
		`INSERT INTO timeline_clips (timeline_id, source_id, track_kind, track_index, clip_key, name, start_frame, end_frame, start_seconds, end_seconds)
		 VALUES (?, ?, 'video', 1, 'clip-1', 'PXL_0001.mp4', 0, 250, 0, 10)`,
		timeline,
		source,
	);
	const statement = Number(
		run(
			`INSERT INTO statements (asset_id, text, author, organization, saved_at) VALUES (?, 'Made with camera, archive and AI material.', 'A. Maker', 'Example Studio', ?)`,
			film,
			AT,
		).lastInsertRowid,
	);
	const sign = Number(
		run(
			`INSERT INTO runs (kind, tool, tool_version, started_at, finished_at, outcome)
			 VALUES ('sign', 'provenancetracker', '0.3.0', ?, ?, 'ok')`,
			AT,
			AT,
		).lastInsertRowid,
	);
	run(
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

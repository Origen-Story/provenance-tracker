// Versions and deliverables, read from links (Phase 8 step 6, D60). No table
// of its own: a new export that is the next revision of an earlier edit has a
// `started_from` link from it (D50); one made from another edit (a vertical
// cut, a trailer, a transcode) has a `made_from` link. A re-render at the
// same path is a new content of the same asset. This module reads those into
// what an edit's page shows; nothing here writes.

import type { DatabaseSync } from "node:sqlite";

/** How a finished edit relates to the one it was started from. */
export type EditRelation = "revision" | "made_from";

export const RELATION_LINK: Readonly<Record<EditRelation, string>> = {
	revision: "started_from",
	made_from: "made_from",
};

export interface EditSummary {
	assetId: number;
	title: string;
	fileName: string;
	/** Signed copies of this edit. */
	signed: number;
	/** Signed copies with a recorded web address (D56). */
	published: number;
	removed: boolean;
}

export interface Revisions {
	/** Every revision in this edit's line, earliest first, branches after their parent; depth 0 is the first. */
	line: Array<EditSummary & { depth: number; current: boolean }>;
	/** The edit this one was made from, if any. */
	madeFrom: EditSummary | null;
	/** Edits made from this one. */
	deliverables: EditSummary[];
	/** This edit's own files over time (re-renders at the same path), oldest first; signed copies left out. */
	renders: Array<{
		sha256: string;
		createdAt: string;
		signedVersions: number[];
	}>;
}

const fileNameOf = (p: string | null) => (p ? (p.split("/").pop() ?? p) : "");

function summary(db: DatabaseSync, assetId: number): EditSummary {
	const a = db
		.prepare(
			"SELECT id, title, public_title, removed_at FROM assets WHERE id = ?",
		)
		.get(assetId) as
		| {
				id: number;
				title: string;
				public_title: string;
				removed_at: string | null;
		  }
		| undefined;
	const file = db
		.prepare(
			`SELECT l.path FROM contents c JOIN locations l ON l.content_sha256 = c.sha256
			 WHERE c.asset_id = ? AND l.gone_run_id IS NULL
			   AND NOT EXISTS (SELECT 1 FROM signatures s WHERE s.signed_sha256 = c.sha256)
			 ORDER BY c.created_at DESC, c.rowid DESC LIMIT 1`,
		)
		.get(assetId) as { path: string } | undefined;
	const counts = db
		.prepare(
			`SELECT count(*) AS signed,
			        sum(EXISTS (SELECT 1 FROM publications p WHERE p.signature_id = s.id
			                    AND (p.file_url <> '' OR p.page_url <> ''))) AS published
			 FROM signatures s WHERE s.asset_id = ? AND s.kind = 'output'`,
		)
		.get(assetId) as { signed: number; published: number | null };
	const fileName = fileNameOf(file?.path ?? null);
	return {
		assetId,
		title: a?.public_title || a?.title || fileName || `Asset ${assetId}`,
		fileName,
		signed: Number(counts.signed),
		published: Number(counts.published ?? 0),
		removed: !!a?.removed_at,
	};
}

const linked = (db: DatabaseSync, sql: string, id: number): number[] =>
	(db.prepare(sql).all(id) as Array<{ id: number }>).map((r) => r.id);

/** The revisions, deliverables and re-renders of one finished edit. */
export function revisionsOf(db: DatabaseSync, assetId: number): Revisions {
	const parentOf = (id: number) =>
		linked(
			db,
			"SELECT parent_id AS id FROM relationships WHERE child_id = ? AND type = 'started_from' ORDER BY id DESC LIMIT 1",
			id,
		)[0] ?? null;
	const childrenOf = (id: number) =>
		linked(
			db,
			"SELECT child_id AS id FROM relationships WHERE parent_id = ? AND type = 'started_from' ORDER BY child_id",
			id,
		);

	// Up to the first revision; a loop (two edits started from each other) stops it.
	let root = assetId;
	const seen = new Set([assetId]);
	for (
		let up = parentOf(root);
		up !== null && !seen.has(up);
		up = parentOf(up)
	) {
		seen.add(up);
		root = up;
	}
	const line: Revisions["line"] = [];
	const visited = new Set<number>();
	const walk = (id: number, depth: number) => {
		if (visited.has(id)) return;
		visited.add(id);
		line.push({ ...summary(db, id), depth, current: id === assetId });
		for (const child of childrenOf(id)) walk(child, depth + 1);
	};
	walk(root, 0);

	const madeFromId =
		linked(
			db,
			"SELECT parent_id AS id FROM relationships WHERE child_id = ? AND type = 'made_from' ORDER BY id DESC LIMIT 1",
			assetId,
		)[0] ?? null;
	const deliverables = linked(
		db,
		"SELECT child_id AS id FROM relationships WHERE parent_id = ? AND type = 'made_from' ORDER BY child_id",
		assetId,
	).map((id) => summary(db, id));

	const renders = (
		db
			.prepare(
				`SELECT c.sha256, c.created_at FROM contents c WHERE c.asset_id = ?
				   AND NOT EXISTS (SELECT 1 FROM signatures s WHERE s.signed_sha256 = c.sha256)
				 ORDER BY c.created_at, c.rowid`,
			)
			.all(assetId) as Array<{ sha256: string; created_at: string }>
	).map((c) => ({
		sha256: c.sha256,
		createdAt: c.created_at,
		signedVersions: (
			db
				.prepare(
					"SELECT version FROM signatures WHERE asset_id = ? AND kind = 'output' AND source_sha256 = ? ORDER BY version",
				)
				.all(assetId, c.sha256) as Array<{ version: number }>
		).map((s) => s.version),
	}));

	return {
		line,
		madeFrom: madeFromId === null ? null : summary(db, madeFromId),
		deliverables,
		renders,
	};
}

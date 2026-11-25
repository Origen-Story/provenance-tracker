// Where a signed copy is published (format 2, D56): reading it. A person
// changes it only through setPublication in edits.ts, with history.

import type { DatabaseSync } from "node:sqlite";

/** Where a signed copy is published (D56), as the catalog holds it. */
export interface Publication {
	id: number;
	signatureId: number;
	fileUrl: string;
	pageUrl: string;
	withheld: string[];
	createdAt: string;
	updatedAt: string;
}

/** The publication of one signing, or null if it has never been published. */
export function publicationOf(
	db: DatabaseSync,
	signatureId: number,
): Publication | null {
	const row = db
		.prepare(
			`SELECT id, signature_id, file_url, page_url, withheld, created_at, updated_at
			 FROM publications WHERE signature_id = ?`,
		)
		.get(signatureId) as Record<string, unknown> | undefined;
	if (!row) return null;
	return {
		id: Number(row.id),
		signatureId: Number(row.signature_id),
		fileUrl: String(row.file_url),
		pageUrl: String(row.page_url),
		withheld: JSON.parse(String(row.withheld)) as string[],
		createdAt: String(row.created_at),
		updatedAt: String(row.updated_at),
	};
}

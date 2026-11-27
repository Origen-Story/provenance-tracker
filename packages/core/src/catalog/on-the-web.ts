// Which of a project's files keep their Content Credentials on the web and
// were not obtained, by host (D74). Read from each file's newest reading, so
// it is what the catalog holds now, whenever the files were read. What to do
// about a host depends on this machine's setting, which the caller holds
// (extraction/web-credentials.ts, hostStateNow).

import type { DatabaseSync } from "node:sqlite";
import {
	onTheWebOfReading,
	type NotFetched,
} from "../extraction/web-credentials.ts";

export interface WaitingHost {
	/** The host the files name; null when their address has none a list could hold. */
	host: string | null;
	/** How many live contents name it. */
	files: number;
	/** One of the addresses, to decide by (they share the host). */
	address: string;
	/** Why the newest of those readings did not have them, and its detail. */
	outcome: NotFetched;
	detail: string | null;
}

/** Hosts whose credentials this project's live files name and do not have, most files first. */
export function credentialsWaiting(db: DatabaseSync): WaitingHost[] {
	const rows = db
		.prepare(
			`SELECT o.id, o.status, o.data, o.error FROM observations o
			 WHERE o.kind = 'c2pa' AND o.status = 'unreadable'
			   AND o.id = (SELECT max(x.id) FROM observations x
			     WHERE x.content_sha256 = o.content_sha256 AND x.kind = 'c2pa')
			   AND EXISTS (SELECT 1 FROM locations l
			     WHERE l.content_sha256 = o.content_sha256 AND l.gone_run_id IS NULL)
			 ORDER BY o.id`,
		)
		.all() as Array<{
		id: number;
		status: string;
		data: string | null;
		error: string | null;
	}>;
	const byHost = new Map<string, WaitingHost>();
	for (const row of rows) {
		const w = onTheWebOfReading({
			status: row.status,
			data: row.data ? JSON.parse(row.data) : null,
			error: row.error,
		});
		if (!w) continue;
		const key = w.host ?? `\0${w.address}`;
		const known = byHost.get(key);
		// Rows come oldest first, so the last one seen is the newest.
		byHost.set(key, {
			host: w.host,
			files: (known?.files ?? 0) + 1,
			address: w.address,
			outcome: w.outcome,
			detail: w.detail ?? null,
		});
	}
	return [...byHost.values()].sort(
		(a, b) =>
			b.files - a.files ||
			(a.host ?? a.address).localeCompare(b.host ?? b.address),
	);
}

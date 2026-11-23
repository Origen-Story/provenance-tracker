// What the migration's dry run checks in a catalog it has just written
// (roadmap Phase 5, step 2). Pure: SQL on a catalog it is handed, and the
// dump's tables.
//
// The breakdown and the public export are rebuilt from the catalog with the
// same functions the app used, so a difference means the catalog lost or
// changed something, not that two implementations disagree. Both are built
// with the Postgres asset refs and segment ids (from the history's
// evidence), as the app did, so they can be compared byte for byte.

import type { DatabaseSync } from "node:sqlite";
import { withLegacyLayerRefs } from "../asset-ref.ts";
import { breakdownOf } from "../catalog/timelines.ts";
import type { CopyTable } from "./copy-text.ts";
import {
	LEGACY_TABLE,
	refOf,
	type LegacyRef,
	type LegacyType,
} from "./plan.ts";

const TYPE_OF_TABLE = new Map(
	Object.entries(LEGACY_TABLE).map(([type, table]) => [
		table,
		type as LegacyType,
	]),
);

/**
 * Postgres rows that belong to nothing: an asset of no project, or of one
 * that is not there; a link, reading, generation, timeline, clip, statement
 * or signing whose asset, timeline or project is gone. Postgres had no
 * foreign keys between its asset tables (D4), so these could exist.
 */
export function findOrphans(tables: Map<string, CopyTable>): string[] {
	const rows = (name: string) => tables.get(name)?.rows ?? [];
	const ids = (name: string) => new Set(rows(name).map((r) => r.id));
	const projects = ids("public.projects");
	const assets = new Set<LegacyRef>();
	const out: string[] = [];
	for (const [type, table] of Object.entries(LEGACY_TABLE))
		for (const r of rows(table)) {
			assets.add(refOf(type, r.id ?? ""));
			if (r.project_id === null || !projects.has(r.project_id))
				out.push(
					`${table} ${r.id} belongs to ${r.project_id === null ? "no project" : `project ${r.project_id}, which is not there`}`,
				);
		}
	const needAsset = (what: string, ref: LegacyRef) => {
		if (!assets.has(ref)) out.push(`${what} names ${ref}, which is not there`);
	};
	for (const r of rows("public.asset_relationships")) {
		needAsset(
			`public.asset_relationships ${r.id}`,
			refOf(r.parent_asset_type ?? "", r.parent_asset_id ?? ""),
		);
		needAsset(
			`public.asset_relationships ${r.id}`,
			refOf(r.child_asset_type ?? "", r.child_asset_id ?? ""),
		);
	}
	for (const t of ["public.asset_metadata", "public.generation_params"])
		for (const r of rows(t))
			needAsset(`${t} ${r.id}`, refOf("ai", r.asset_id ?? ""));
	for (const t of ["public.timelines", "public.creator_statements"])
		for (const r of rows(t)) {
			needAsset(`${t} ${r.id}`, refOf("produced", r.produced_asset_id ?? ""));
			if (r.project_id === null || !projects.has(r.project_id))
				out.push(
					`${t} ${r.id} belongs to project ${r.project_id}, which is not there`,
				);
		}
	for (const r of rows("public.signatures")) {
		needAsset(
			`public.signatures ${r.id}`,
			refOf(r.asset_type ?? "", r.asset_id ?? ""),
		);
		if (r.project_id === null || !projects.has(r.project_id))
			out.push(
				`public.signatures ${r.id} belongs to project ${r.project_id}, which is not there`,
			);
	}
	const timelines = ids("public.timelines");
	for (const r of rows("public.timeline_segments")) {
		if (r.timeline_id === null || !timelines.has(r.timeline_id))
			out.push(
				`public.timeline_segments ${r.id} belongs to timeline ${r.timeline_id}, which is not there`,
			);
		if (r.matched_asset_type && r.matched_asset_id)
			needAsset(
				`public.timeline_segments ${r.id}`,
				refOf(r.matched_asset_type, r.matched_asset_id),
			);
	}
	return out;
}

/**
 * The Postgres row behind each catalog row of a table, as the migrate run's
 * summary records it (write.ts, origins): catalog id → table and id.
 */
export function legacyIds(
	db: DatabaseSync,
	table: string,
	runId: number,
): Map<number, { legacy: string; id: number }> {
	const run = db
		.prepare("SELECT kind, summary FROM runs WHERE id = ?")
		.get(runId) as { kind: string; summary: string } | undefined;
	if (run?.kind !== "migrate")
		throw new Error(`Run ${runId} is not a migration`);
	const origins =
		(
			JSON.parse(run.summary) as {
				origins?: Record<string, Record<string, string>>;
			}
		).origins?.[table] ?? {};
	const out = new Map<number, { legacy: string; id: number }>();
	for (const [id, origin] of Object.entries(origins)) {
		const at = origin.lastIndexOf(":");
		out.set(Number(id), {
			legacy: origin.slice(0, at),
			id: Number(origin.slice(at + 1)),
		});
	}
	return out;
}
/** Each migrated asset's Postgres ref ("produced:33"), by catalog id. */
export function legacyRefs(
	db: DatabaseSync,
	runId: number,
): Map<number, LegacyRef> {
	const out = new Map<number, LegacyRef>();
	for (const [id, e] of legacyIds(db, "assets", runId)) {
		const type = TYPE_OF_TABLE.get(e.legacy);
		if (type) out.set(id, refOf(type, e.id));
	}
	return out;
}

/**
 * A migrated timeline's breakdown, recomputed from the catalog as the app
 * recomputed it, with Postgres's asset refs and segment ids, so the result
 * can be compared with the cache. Postgres ordered clips by sort_order with
 * ties in row order (its ids); the catalog's own ids follow sources, so the
 * Postgres ids break ties.
 */
export function recomputeBreakdown(
	db: DatabaseSync,
	timelineId: number,
	runId: number,
): unknown {
	const refs = legacyRefs(db, runId);
	const clipIds = legacyIds(db, "timeline_clips", runId);
	return breakdownOf(db, timelineId, {
		refOf: (id) => refs.get(id) ?? null,
		segmentIdOf: (id) => clipIds.get(id)?.id ?? null,
		tieBreak: (id) => clipIds.get(id)?.id ?? Number.MAX_SAFE_INTEGER,
	});
}
/**
 * A cached breakdown as the app reads it. One cached before asset refs
 * existed (D23) names each layer's asset by matchedAssetType and
 * matchedAssetId; the app derives matchedAssetRef from them on reading
 * (withLegacyLayerRefs), and the current shape has the ref alone. So the
 * ref is derived and the two old fields dropped, and the result can be
 * compared with a breakdown computed now: the derived ref must still equal
 * the recomputed one. `oldShape` says whether there was anything to read so.
 */
export function cachedBreakdown(json: string | null): {
	breakdown: unknown;
	oldShape: boolean;
} {
	const breakdown = withLegacyLayerRefs(JSON.parse(json ?? "null"));
	let oldShape = false;
	const lanes = (breakdown as { composition?: Record<string, unknown> } | null)
		?.composition;
	for (const lane of Object.values(lanes ?? {}) as Array<{
		intervals?: Array<{ layers?: Array<Record<string, unknown>> }>;
		tracks?: Array<{ clips?: Array<Record<string, unknown>> }>;
	} | null>) {
		const layers = [
			...(lane?.intervals ?? []).flatMap((iv) => iv.layers ?? []),
			...(lane?.tracks ?? []).flatMap((tr) => tr.clips ?? []),
		];
		for (const layer of layers)
			if ("matchedAssetType" in layer || "matchedAssetId" in layer) {
				oldShape = true;
				delete layer.matchedAssetType;
				delete layer.matchedAssetId;
			}
	}
	return { breakdown, oldShape };
}
/**
 * A signing as buildPublicExport reads it (the app's signatures row): the
 * statement and report as signed, and the signed copy's file name, hash,
 * size, version and time, from the catalog.
 */
export function signatureForExport(db: DatabaseSync, signatureId: number) {
	const s = db
		.prepare(
			`SELECT s.kind, s.version, s.statement, s.report, s.signed_sha256, s.signed_at, c.size,
			        (SELECT l.path FROM locations l WHERE l.content_sha256 = s.signed_sha256
			         ORDER BY l.gone_run_id IS NOT NULL, l.id LIMIT 1) AS path
			 FROM signatures s JOIN contents c ON c.sha256 = s.signed_sha256 WHERE s.id = ?`,
		)
		.get(signatureId) as
		| {
				kind: string;
				version: number;
				statement: string | null;
				report: string | null;
				signed_sha256: string;
				signed_at: string;
				size: number;
				path: string | null;
		  }
		| undefined;
	if (!s) throw new Error(`No signature ${signatureId}`);
	return {
		kind: s.kind,
		version: s.version,
		statementJson: s.statement,
		reportJson: s.report,
		signedPath: s.path ?? "",
		signedHash: s.signed_sha256,
		signedSize: s.size,
		createdAt: s.signed_at,
	};
}

/**
 * Where two JSON values differ, as paths ("primary.byClass.unknown.frames"),
 * the first `limit` of them. Equal values give none.
 */
export function differences(a: unknown, b: unknown, limit = 10): string[] {
	const out: string[] = [];
	const walk = (x: unknown, y: unknown, at: string) => {
		if (out.length >= limit) return;
		if (Object.is(x, y)) return;
		const bothObjects =
			x !== null &&
			y !== null &&
			typeof x === "object" &&
			typeof y === "object";
		if (!bothObjects || Array.isArray(x) !== Array.isArray(y)) {
			out.push(at || "(the whole value)");
			return;
		}
		const keys = new Set([
			...Object.keys(x as object),
			...Object.keys(y as object),
		]);
		for (const k of keys)
			walk(
				(x as Record<string, unknown>)[k],
				(y as Record<string, unknown>)[k],
				at ? `${at}.${k}` : k,
			);
	};
	walk(a, b, "");
	return out;
}

/**
 * How the data of two dumps differ, table by table: tables only in one,
 * different columns, and rows added, gone or changed (by id where the table
 * has one). Comments, pg_dump's random restrict token and anything else
 * outside the COPY blocks are not data and are not compared.
 */
export function tableDifferences(
	a: Map<string, CopyTable>,
	b: Map<string, CopyTable>,
	limit = 20,
): string[] {
	const out: string[] = [];
	const push = (line: string) => {
		if (out.length < limit) out.push(line);
	};
	for (const name of new Set([...a.keys(), ...b.keys()])) {
		const x = a.get(name);
		const y = b.get(name);
		if (!x || !y) {
			push(`${name} is only in the ${x ? "first" : "second"} dump`);
			continue;
		}
		if (x.columns.join(",") !== y.columns.join(",")) {
			push(`${name} has different columns`);
			continue;
		}
		const key = (r: Record<string, string | null>, i: number) =>
			x.columns.includes("id") ? `id ${r.id}` : `row ${i + 1}`;
		const rowsOf = (t: CopyTable) =>
			new Map(t.rows.map((r, i) => [key(r, i), JSON.stringify(r)]));
		const xs = rowsOf(x);
		const ys = rowsOf(y);
		for (const [k, v] of xs)
			if (!ys.has(k)) push(`${name} ${k} is gone`);
			else if (ys.get(k) !== v) push(`${name} ${k} changed`);
		for (const k of ys.keys()) if (!xs.has(k)) push(`${name} ${k} was added`);
	}
	return out;
}

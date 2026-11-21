// show: everything the catalog knows about one file on this machine: its
// asset, its bytes, its other places, its technical values, what each reader
// said, and its sidecars. Changes nothing.

import { existsSync, realpathSync } from "node:fs";
import { locateFile } from "@provenancetracker/core/catalog/paths.ts";
import type { Machine } from "./machine.ts";
import type { OpenProject } from "./project.ts";
import { listRoots } from "./roots.ts";

export interface FileInfo {
	root: string;
	path: string;
	sha256: string;
	size: number;
	asset: { id: number; kind: string; title: string; originClass: string };
	/** Other live places with the same bytes. */
	sameBytes: Array<{ root: string; path: string }>;
	/** How many versions (contents) the asset has, this one included. */
	versions: number;
	technical: Record<string, unknown> | null;
	/** The newest reading of each kind, with the sidecar it came from, if any. */
	readings: Array<{
		kind: string;
		extractor: string;
		version: string;
		status: string;
		validation: string | null;
		from: string | null;
	}>;
	sidecars: Array<{ root: string; path: string }>;
}

export function describeFile(
	project: OpenProject,
	machine: Machine,
	file: string,
): FileInfo {
	const { db } = project;
	if (!existsSync(file)) throw new Error(`There is no file at ${file}`);
	const real = realpathSync.native(file);
	const roots = listRoots(project, machine).filter(
		(r) => r.status === "ok" && r.folder,
	);
	const names = new Map(listRoots(project, machine).map((r) => [r.id, r.name]));
	const where = locateFile(
		roots.map((r) => ({ id: r.id, folder: r.folder! })),
		real,
		machine.platform,
	);
	if (!where)
		throw new Error(
			`${real} is not inside any of this project's roots on this machine`,
		);
	const loc = db
		.prepare(
			`SELECT l.content_sha256 AS sha256, c.size, c.asset_id AS assetId FROM locations l
			 JOIN contents c ON c.sha256 = l.content_sha256
			 WHERE l.root_id = ? AND l.path = ? AND l.gone_run_id IS NULL`,
		)
		.get(where.rootId, where.path) as
		{ sha256: string; size: number; assetId: number } | undefined;
	if (!loc)
		throw new Error(`${real} is not in the catalog yet. Scan to record it.`);
	const place = (r: { rootId: number; path: string }) => ({
		root: names.get(r.rootId) ?? String(r.rootId),
		path: r.path,
	});
	const asset = db
		.prepare(
			"SELECT id, kind, title, origin_class AS originClass FROM assets WHERE id = ?",
		)
		.get(loc.assetId) as FileInfo["asset"];
	const sameBytes = (
		db
			.prepare(
				`SELECT root_id AS rootId, path FROM locations WHERE content_sha256 = ? AND gone_run_id IS NULL
				 AND NOT (root_id = ? AND path = ?) ORDER BY root_id, path`,
			)
			.all(loc.sha256, where.rootId, where.path) as Array<{
			rootId: number;
			path: string;
		}>
	).map(place);
	const versions = (
		db
			.prepare("SELECT count(*) AS n FROM contents WHERE asset_id = ?")
			.get(loc.assetId) as { n: number }
	).n;
	const technical =
		(db
			.prepare(
				`SELECT mime_type, duration_seconds, width, height, frame_rate, video_codec, audio_codec,
				        sample_rate, channels, bits_per_sample, exiftool_version FROM technical WHERE content_sha256 = ?`,
			)
			.get(loc.sha256) as Record<string, unknown> | undefined) ?? null;
	const readings = (
		db
			.prepare(
				`SELECT o.kind, o.extractor, o.extractor_version AS version, o.status,
				        json_extract(o.validation, '$.state') AS validation, o.source_sha256 AS source
				 FROM observations o WHERE o.content_sha256 = ? AND o.id IN (
				   SELECT max(id) FROM observations WHERE content_sha256 = ? GROUP BY kind, source_sha256)
				 ORDER BY o.kind`,
			)
			.all(loc.sha256, loc.sha256) as Array<
			Omit<FileInfo["readings"][number], "from"> & { source: string | null }
		>
	).map(({ source, ...r }) => {
		const at = source
			? (db
					.prepare(
						"SELECT root_id AS rootId, path FROM locations WHERE content_sha256 = ? AND gone_run_id IS NULL",
					)
					.get(source) as { rootId: number; path: string } | undefined)
			: undefined;
		return {
			...r,
			from: at
				? `${place(at).root}/${at.path}`
				: source
					? source.slice(0, 12)
					: null,
		};
	});
	const sidecars = (
		db
			.prepare(
				`SELECT l.root_id AS rootId, l.path FROM relationships r
				 JOIN contents c ON c.asset_id = r.child_id
				 JOIN locations l ON l.content_sha256 = c.sha256 AND l.gone_run_id IS NULL
				 WHERE r.parent_id = ? AND r.type = 'sidecar_of' ORDER BY l.path`,
			)
			.all(loc.assetId) as Array<{ rootId: number; path: string }>
	).map(place);
	return {
		...place(where),
		sha256: loc.sha256,
		size: loc.size,
		asset,
		sameBytes,
		versions,
		technical,
		readings,
		sidecars,
	};
}

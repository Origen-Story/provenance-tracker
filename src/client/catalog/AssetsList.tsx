// Every asset in the project, in one list: what the three old sections
// (AI assets, archival, produced) showed apart. The filters live in the
// address, so Back and a bookmark keep them.

import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import {
	ORIGIN_CLASS_DEFS,
	POSITIONS,
} from "@provenancetracker/core/origin-vocabulary.js";
import { OriginBadge } from "./badge.tsx";
import { assets, fileUrl, type AssetFilter, type AssetSummary } from "./api.ts";
import { KIND_LABEL, KINDS, bytes, mediaKind } from "./labels.ts";
import { Checkbox, Loading, PageTitle, Problem, Select } from "./ui.tsx";

const PAGE = 100;

const positionLabel = (id: string) =>
	(POSITIONS as Array<{ id: string; label: string }>).find((p) => p.id === id)
		?.label ?? id;

export const CLASS_OPTIONS = (
	ORIGIN_CLASS_DEFS as Array<{ code: string; label: string; position: string }>
).map((c) => ({
	value: c.code,
	label: c.label,
	group: positionLabel(c.position),
}));

export default function AssetsList() {
	const { projectId } = useParams();
	const [params, setParams] = useSearchParams();
	const filter: AssetFilter = {
		kind: params.get("kind") ?? undefined,
		class: params.get("class") ?? undefined,
		outputs: params.get("outputs") === "1",
		q: params.get("q") ?? undefined,
		removed:
			params.get("removed") === "only" ? "only" : params.get("removed") === "1",
		limit: PAGE,
		offset: Number(params.get("offset") ?? 0) || 0,
	};
	const set = (key: string, value: string | null) => {
		const next = new URLSearchParams(params);
		if (value) next.set(key, value);
		else next.delete(key);
		next.delete("offset");
		setParams(next, { replace: key === "q" });
	};

	// The search box waits for a pause in typing before it asks.
	const [words, setWords] = useState(filter.q ?? "");
	useEffect(() => {
		const t = setTimeout(() => {
			if (words.trim() !== (params.get("q") ?? ""))
				set("q", words.trim() || null);
		}, 300);
		return () => clearTimeout(t);
	}, [words]);

	const { data, isLoading, error, isFetching } = useQuery({
		queryKey: ["catalog", projectId, "assets", filter],
		queryFn: () => assets.list(projectId!, filter),
		placeholderData: keepPreviousData,
	});

	return (
		<div className="max-w-6xl">
			<PageTitle
				title="Assets"
				description="Everything in this project's media folders: recorded, archival and AI-generated material, and finished edits."
			/>
			<div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4 items-end">
				<label className="block md:col-span-2">
					<span className="block text-sm text-text-primary mb-1">Search</span>
					<input
						type="search"
						value={words}
						onChange={(e) => setWords(e.target.value)}
						placeholder="Title, notes, caption, credit or file name"
						className="w-full bg-app-bg border border-border rounded px-3 py-1.5 text-sm text-text-primary"
					/>
				</label>
				<Select
					label="Kind"
					value={filter.kind ?? ""}
					onChange={(v) => set("kind", v || null)}
					options={[
						{ value: "", label: "All kinds" },
						...KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] ?? k })),
					]}
				/>
				<Select
					label="Origin class"
					value={filter.class ?? ""}
					onChange={(v) => set("class", v || null)}
					options={[
						{ value: "", label: "All classes", group: "" },
						...CLASS_OPTIONS,
					]}
				/>
				<div className="space-y-1 pb-1">
					<Checkbox
						label="Finished edits only"
						checked={!!filter.outputs}
						onChange={(v) => set("outputs", v ? "1" : null)}
					/>
					<Select
						label="Removed assets"
						value={
							filter.removed === "only" ? "only" : filter.removed ? "1" : ""
						}
						onChange={(v) => set("removed", v || null)}
						options={[
							{ value: "", label: "Hidden" },
							{ value: "1", label: "Shown too" },
							{ value: "only", label: "Only these" },
						]}
					/>
				</div>
			</div>

			{isLoading && <Loading />}
			<Problem error={error} />
			{data && (
				<>
					<p className="text-xs text-text-secondary mb-2">
						{data.total === 0
							? "Nothing matches."
							: `${filter.offset! + 1}–${filter.offset! + data.assets.length} of ${data.total}`}
						{isFetching && " · updating…"}
					</p>
					<div className="bg-card-bg border border-border rounded-lg divide-y divide-border">
						{data.assets.map((a) => (
							<AssetRow key={a.id} asset={a} projectId={projectId!} />
						))}
					</div>
					<Pager
						offset={filter.offset!}
						total={data.total}
						go={(offset) => {
							const next = new URLSearchParams(params);
							if (offset) next.set("offset", String(offset));
							else next.delete("offset");
							setParams(next);
						}}
					/>
				</>
			)}
		</div>
	);
}

function AssetRow({
	asset,
	projectId,
}: {
	asset: AssetSummary;
	projectId: string;
}) {
	return (
		<Link
			to={String(asset.id)}
			className={`flex items-center gap-3 px-3 py-2 hover:bg-card-hover ${asset.removedAt ? "opacity-60" : ""}`}
		>
			<Thumb asset={asset} projectId={projectId} />
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="text-sm font-medium text-text-primary truncate">
						{asset.displayTitle}
					</span>
					{asset.code && (
						<span className="text-xs text-text-secondary">{asset.code}</span>
					)}
					{asset.isOutput && (
						<span className="text-xs text-accent">finished edit</span>
					)}
					{asset.removedAt && (
						<span className="text-xs text-danger">removed</span>
					)}
				</div>
				<p
					className="text-xs text-text-secondary truncate"
					title={asset.file ? `${asset.file.root}/${asset.file.path}` : ""}
				>
					{asset.file
						? `${asset.file.root} / ${asset.file.path}`
						: "no file on this machine"}
				</p>
			</div>
			<span className="text-xs text-text-secondary w-32 shrink-0">
				{KIND_LABEL[asset.kind] ?? asset.kind}
			</span>
			<span className="w-44 shrink-0">
				<OriginBadge
					originClass={asset.originClass}
					confirmed={asset.originClassConfirmed}
					aiAssisted={asset.aiAssisted}
				/>
			</span>
			<span className="text-xs text-text-secondary w-24 shrink-0 text-right">
				{asset.file ? bytes(asset.file.size) : ""}
				{asset.versions > 1 && (
					<span className="block">{asset.versions} versions</span>
				)}
			</span>
		</Link>
	);
}

/** A picture for an image file; a quiet mark for video, sound and the rest. */
function Thumb({
	asset,
	projectId,
}: {
	asset: AssetSummary;
	projectId: string;
}) {
	const [failed, setFailed] = useState(false);
	const kind = mediaKind(asset.file?.path);
	return (
		<span className="w-12 h-12 shrink-0 rounded bg-app-bg border border-border flex items-center justify-center overflow-hidden text-[10px] text-text-secondary uppercase">
			{kind === "image" && asset.file && !failed ? (
				<img
					src={fileUrl(projectId, asset.file.sha256)}
					alt=""
					loading="lazy"
					className="w-full h-full object-cover"
					onError={() => setFailed(true)}
				/>
			) : (
				(kind ?? "file")
			)}
		</span>
	);
}

function Pager({
	offset,
	total,
	go,
}: {
	offset: number;
	total: number;
	go: (offset: number) => void;
}) {
	if (total <= PAGE) return null;
	return (
		<div className="flex gap-2 mt-3">
			<button
				type="button"
				disabled={offset === 0}
				onClick={() => go(Math.max(0, offset - PAGE))}
				className="text-sm px-3 py-1.5 border border-border rounded disabled:opacity-40"
			>
				Previous
			</button>
			<button
				type="button"
				disabled={offset + PAGE >= total}
				onClick={() => go(offset + PAGE)}
				className="text-sm px-3 py-1.5 border border-border rounded disabled:opacity-40"
			>
				Next
			</button>
		</div>
	);
}

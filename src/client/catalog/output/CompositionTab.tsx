// An output's timeline: importing it, the composition strip over the film,
// and putting right which asset each file in it is, or a clip's class.

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import {
	fileUrl,
	outputs,
	timelineSequences,
	type AssetRecord,
	type SequenceChoice,
	type Timeline,
	type TimelineClip,
	type TimelineSource,
} from "../api.ts";
import { CLASS_OPTIONS } from "../AssetsList.tsx";
import { assetKey } from "../asset/shared.ts";
import { OriginBadge } from "../badge.tsx";
import { mediaKind } from "../labels.ts";
import {
	Button,
	Card,
	Checkbox,
	Loading,
	Problem,
	Section,
	when,
} from "../ui.tsx";
import {
	AssetPicker,
	currentTimeline,
	METHOD_HELP,
	METHOD_LABEL,
	ownCut,
	secondsOf,
	timelineKey,
} from "./shared.tsx";
import { Composition, fmtClock } from "./strip.tsx";

export default function CompositionTab({
	projectId,
	asset,
}: {
	projectId: string;
	asset: AssetRecord;
}) {
	const { current, others } = currentTimeline(asset);
	const cut = ownCut(asset);
	const t = useQuery({
		queryKey: timelineKey(projectId, asset.id, current?.id ?? 0),
		queryFn: () => outputs.timeline(projectId, current!.id),
		enabled: !!current,
	});
	if (!cut)
		return (
			<Card>
				<p className="text-sm text-text-secondary">
					This output has no file of its own yet. Scan its media folder first.
				</p>
			</Card>
		);
	if (!current)
		return (
			<div className="space-y-4">
				{others.length > 0 && (
					<p className="text-sm text-warning">
						The timelines imported so far belong to an earlier version of this
						file. Import the one for the version there is now.
					</p>
				)}
				<ImportTimeline projectId={projectId} asset={asset} />
			</div>
		);
	if (t.isLoading) return <Loading />;
	if (t.error || !t.data)
		return <Problem error={t.error ?? "The timeline could not be read"} />;
	return <TimelineView projectId={projectId} asset={asset} timeline={t.data} />;
}

function ImportTimeline({
	projectId,
	asset,
	again,
	onDone,
}: {
	projectId: string;
	asset: AssetRecord;
	again?: boolean;
	onDone?: () => void;
}) {
	const qc = useQueryClient();
	const [file, setFile] = useState<File | null>(null);
	// When the file holds several sequences and none matches the edit's length.
	const [sequence, setSequence] = useState<number | null>(null);
	const [offered, setOffered] = useState<SequenceChoice[] | null>(null);
	const picker = useRef<HTMLInputElement>(null);
	const send = useMutation({
		mutationFn: () =>
			outputs.importTimeline(projectId, asset.id, file!, sequence),
		onError: (err) => {
			const list = timelineSequences(err);
			if (list) setOffered(list);
		},
		onSuccess: () => {
			setFile(null);
			setSequence(null);
			setOffered(null);
			if (picker.current) picker.current.value = "";
			qc.invalidateQueries({ queryKey: assetKey(projectId, asset.id) });
			qc.invalidateQueries({ queryKey: ["catalog", projectId, "assets"] });
			onDone?.();
		},
	});
	return (
		<Card className="space-y-3">
			<h4 className="font-medium text-text-primary">
				{again ? "Import the timeline again" : "Import the timeline"}
			</h4>
			<p className="text-xs text-text-secondary">
				Export the sequence from the editor. Premiere: File › Export › Final Cut
				Pro XML. Resolve: File › Export › Timeline › Final Cut Pro 7 XML. Each
				file it uses is matched to this project's assets by path, by its bytes
				and by name.
				{again &&
					" The new import becomes the one the composition and signing use; the earlier one stays in the record. A class you gave a clip in the previous import is given to the same clip in the new one (same track kind, name and asset); check the clips below afterwards."}
			</p>
			<div className="flex flex-wrap items-center gap-3">
				{/* The browser's own file input is easy to miss; a button opens it. */}
				<input
					ref={picker}
					type="file"
					accept=".xml,.fcpxml,text/xml,application/xml"
					onChange={(e) => {
						setFile(e.target.files?.[0] ?? null);
						setSequence(null);
						setOffered(null);
						send.reset();
					}}
					className="hidden"
				/>
				<Button quiet onClick={() => picker.current?.click()}>
					Choose the timeline file…
				</Button>
				<span className="text-sm text-text-secondary">
					{file ? file.name : "No file chosen"}
				</span>
				<Button
					onClick={() => send.mutate()}
					disabled={!file || send.isPending || (!!offered && sequence === null)}
				>
					{send.isPending ? "Importing…" : "Import"}
				</Button>
			</div>
			{offered ? (
				<fieldset className="space-y-1.5">
					<legend className="text-sm text-text-primary mb-1">
						{send.error instanceof Error ? send.error.message : ""}
					</legend>
					{offered.map((s) => (
						<label
							key={s.index}
							className="flex items-center gap-2 text-sm text-text-primary cursor-pointer"
						>
							<input
								type="radio"
								name="timeline-sequence"
								checked={sequence === s.index}
								onChange={() => setSequence(s.index)}
							/>
							<span>{s.name || `Sequence ${s.index + 1}`}</span>
							<span className="text-xs text-text-secondary">
								{s.seconds == null ? "length unknown" : fmtClock(s.seconds)}
							</span>
						</label>
					))}
				</fieldset>
			) : (
				<Problem error={send.error} />
			)}
		</Card>
	);
}

function TimelineView({
	projectId,
	asset,
	timeline: t,
}: {
	projectId: string;
	asset: AssetRecord;
	timeline: Timeline;
}) {
	const qc = useQueryClient();
	const [again, setAgain] = useState(false);
	const cut = ownCut(asset)!;
	const live = cut.places.find((p) => p.live);
	const kind = mediaKind(live?.path);
	const refresh = () => {
		qc.invalidateQueries({ queryKey: assetKey(projectId, asset.id) });
		qc.invalidateQueries({ queryKey: ["catalog", projectId, "assets"] });
	};
	const remove = useMutation({
		mutationFn: () => outputs.removeTimeline(projectId, t.id),
		onSuccess: refresh,
	});
	const b = t.breakdown;
	const comp = b?.composition ?? null;
	const duration =
		b?.durationSeconds ?? secondsOf(t.durationFrames ?? 0, t.fps);
	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-text-secondary">
				<span>
					<span className="text-text-primary">
						{t.sequenceName || t.fileName}
					</span>{" "}
					· {t.format} {t.formatVersion && `v${t.formatVersion}`}
				</span>
				<span>
					{duration != null ? fmtClock(duration) : `${t.durationFrames} frames`}
					{t.fps ? ` at ${t.fps.toFixed(3)} fps` : ""}
				</span>
				{t.width && t.height && (
					<span>
						{t.width}×{t.height}
					</span>
				)}
				<span>
					{t.clips.length} clips
					{b?.counts.unmatched ? (
						<span className="text-warning">
							, {b.counts.unmatched} with no matched asset
						</span>
					) : null}
				</span>
				<span>imported {when(t.importedAt)}</span>
				<span className="ml-auto flex gap-2">
					<Button quiet onClick={() => setAgain((v) => !v)}>
						{again ? "Cancel" : "Import again"}
					</Button>
				</span>
			</div>
			{again && (
				<ImportTimeline
					projectId={projectId}
					asset={asset}
					again
					onDone={() => setAgain(false)}
				/>
			)}
			{t.notes.length > 0 && (
				<div className="border border-warning/40 rounded p-3 text-xs text-warning space-y-0.5">
					{t.notes.map((n) => (
						<p key={n}>{n}</p>
					))}
				</div>
			)}
			{comp ? (
				<Composition
					composition={comp}
					src={
						kind === "video" || kind === "audio"
							? fileUrl(projectId, cut.sha256)
							: null
					}
					kind={kind === "video" || kind === "audio" ? kind : null}
					asset={{ durationSeconds: duration }}
				/>
			) : (
				<Card>
					<p className="text-sm text-text-secondary">
						No composition yet: the timeline has no clips the tracker could
						place.
					</p>
				</Card>
			)}
			<Section title="Files the timeline uses">
				<Sources projectId={projectId} asset={asset} timeline={t} />
			</Section>
			<Section title="Clips">
				<Clips projectId={projectId} asset={asset} timeline={t} />
			</Section>
			<Section title="Remove this timeline">
				<Card className="space-y-2">
					<p className="text-sm text-text-secondary">
						Takes this import out of the composition and of signing. The output,
						its files and its earlier signings stay; the removal is kept in the
						history.
					</p>
					<Button
						quiet
						disabled={remove.isPending}
						onClick={() => {
							if (
								confirm(
									"Remove this timeline? The output and its signed copies stay.",
								)
							)
								remove.mutate();
						}}
					>
						Remove the timeline
					</Button>
					<Problem error={remove.error} />
				</Card>
			</Section>
		</div>
	);
}

function useTimelineEdit(projectId: string, asset: AssetRecord, t: Timeline) {
	const qc = useQueryClient();
	return (answer: { timeline: Timeline }) => {
		qc.setQueryData(timelineKey(projectId, asset.id, t.id), answer.timeline);
		// The output's class follows its composition; the preview, its matches.
		qc.invalidateQueries({ queryKey: assetKey(projectId, asset.id) });
		qc.invalidateQueries({ queryKey: ["catalog", projectId, "assets"] });
	};
}

function Sources({
	projectId,
	asset,
	timeline: t,
}: {
	projectId: string;
	asset: AssetRecord;
	timeline: Timeline;
}) {
	const files = t.sources.filter((s) => s.kind === "file");
	const others = t.sources.filter((s) => s.kind !== "file");
	return (
		<Card className="space-y-3">
			<p className="text-xs text-text-secondary">
				Every clip of a file follows that file's match. A file's class is its
				asset's: set it on the asset's page, and every edit that uses it
				follows.
			</p>
			<table className="w-full text-xs">
				<thead>
					<tr className="text-left text-text-secondary">
						<th className="pb-1 pr-2 font-medium">File in the timeline</th>
						<th className="pb-1 pr-2 font-medium">Clips</th>
						<th className="pb-1 pr-2 font-medium">
							Asset, and how it was matched
						</th>
						<th className="pb-1 font-medium">Class</th>
					</tr>
				</thead>
				<tbody>
					{files.map((s) => (
						<SourceRow
							key={s.id}
							projectId={projectId}
							asset={asset}
							timeline={t}
							source={s}
						/>
					))}
				</tbody>
			</table>
			{others.length > 0 && (
				<p className="text-xs text-text-secondary">
					Also in the timeline:{" "}
					{others
						.map(
							(s) =>
								`${s.name || "unnamed"} (${METHOD_LABEL[s.kind] ?? s.kind}, ${s.clips} clip${s.clips === 1 ? "" : "s"})`,
						)
						.join("; ")}
					. Titles and generators made in the editor count as human-made; a
					nested sequence counts as unknown unless its clips are given a class.
				</p>
			)}
		</Card>
	);
}

function SourceRow({
	projectId,
	asset,
	timeline: t,
	source: s,
}: {
	projectId: string;
	asset: AssetRecord;
	timeline: Timeline;
	source: TimelineSource;
}) {
	const [picking, setPicking] = useState(false);
	const take = useTimelineEdit(projectId, asset, t);
	const match = useMutation({
		mutationFn: (assetId: number | null) =>
			outputs.matchSource(projectId, t.id, s.id, assetId),
		onSuccess: (r) => {
			setPicking(false);
			take(r);
		},
	});
	const weak = s.matchMethod === "filename" || !s.assetId;
	const pct =
		s.matchConfidence > 0 && s.matchConfidence < 1
			? ` ${Math.round(s.matchConfidence * 100)}%`
			: "";
	return (
		<tr className="border-t border-border/60 align-top">
			<td className="py-1.5 pr-2 max-w-[18rem]">
				<div className="truncate text-text-primary" title={s.path || s.name}>
					{s.name || s.path}
				</div>
				{s.path && (
					<div className="truncate text-text-secondary" title={s.path}>
						{s.path}
					</div>
				)}
			</td>
			<td className="py-1.5 pr-2 text-text-secondary">{s.clips}</td>
			<td className="py-1.5 pr-2">
				{picking ? (
					<AssetPicker
						projectId={projectId}
						exclude={asset.id}
						onPick={(id) => match.mutate(id)}
						onCancel={() => setPicking(false)}
					/>
				) : (
					<div className="flex flex-wrap items-center gap-2">
						{s.assetId ? (
							<Link
								to={`/catalog/${projectId}/assets/${s.assetId}`}
								className="text-text-primary hover:text-accent truncate max-w-[14rem]"
							>
								{s.assetTitle || `Asset ${s.assetId}`}
							</Link>
						) : null}
						<span
							className={weak ? "text-warning" : "text-text-secondary"}
							title={METHOD_HELP[s.matchMethod] ?? ""}
						>
							{METHOD_LABEL[s.matchMethod] ?? s.matchMethod}
							{pct}
						</span>
						<button
							type="button"
							onClick={() => setPicking(true)}
							className="text-accent hover:underline"
						>
							{s.assetId ? "a different asset" : "pick the asset"}
						</button>
						{s.assetId && (
							<button
								type="button"
								onClick={() => match.mutate(null)}
								disabled={match.isPending}
								className="text-text-secondary hover:text-text-primary"
								title="This file is no asset of the project's"
							>
								none
							</button>
						)}
					</div>
				)}
				<Problem error={match.error} />
			</td>
			<td className="py-1.5">
				{s.assetId ? (
					<OriginBadge
						originClass={s.assetClass ?? "unknown"}
						confirmed={s.assetClassConfirmed}
						aiAssisted={s.assetAiAssisted}
					/>
				) : (
					<OriginBadge originClass="unknown" confirmed={false} />
				)}
			</td>
		</tr>
	);
}

function Clips({
	projectId,
	asset,
	timeline: t,
}: {
	projectId: string;
	asset: AssetRecord;
	timeline: Timeline;
}) {
	const [audio, setAudio] = useState(false);
	const sources = new Map(t.sources.map((s) => [s.id, s]));
	const shown = t.clips.filter((c) => audio || c.trackKind === "video");
	return (
		<Card className="space-y-2">
			<div className="flex items-center justify-between gap-4">
				<p className="text-xs text-text-secondary">
					A class set here is for that one clip alone, say a shot an effect
					changed. Leave it to follow its file's asset otherwise.
				</p>
				<Checkbox
					label="Show sound clips"
					checked={audio}
					onChange={setAudio}
				/>
			</div>
			<table className="w-full text-xs">
				<thead>
					<tr className="text-left text-text-secondary">
						<th className="pb-1 pr-2 font-medium">Track</th>
						<th className="pb-1 pr-2 font-medium">Time</th>
						<th className="pb-1 pr-2 font-medium">Clip</th>
						<th className="pb-1 font-medium">Class</th>
					</tr>
				</thead>
				<tbody>
					{shown.map((c) => (
						<ClipRow
							key={c.id}
							projectId={projectId}
							asset={asset}
							timeline={t}
							clip={c}
							source={c.sourceId ? sources.get(c.sourceId) : undefined}
						/>
					))}
				</tbody>
			</table>
		</Card>
	);
}

const FOLLOW = "";

function ClipRow({
	projectId,
	asset,
	timeline: t,
	clip: c,
	source,
}: {
	projectId: string;
	asset: AssetRecord;
	timeline: Timeline;
	clip: TimelineClip;
	source?: TimelineSource;
}) {
	const take = useTimelineEdit(projectId, asset, t);
	const set = useMutation({
		mutationFn: (cls: string | null) =>
			outputs.setClipClass(projectId, t.id, c.id, cls),
		onSuccess: take,
	});
	const start = secondsOf(c.startFrame, t.fps);
	const end = secondsOf(c.endFrame, t.fps);
	const follows =
		source?.kind === "generator"
			? "made in the editor"
			: source?.assetId
				? "its file's asset"
				: "no asset: unknown";
	return (
		<tr
			className={`border-t border-border/60 ${c.enabled ? "" : "opacity-50"}`}
		>
			<td className="py-1.5 pr-2 text-text-secondary whitespace-nowrap">
				{c.trackKind === "video" ? "V" : "A"}
				{c.trackIndex}
			</td>
			<td className="py-1.5 pr-2 text-text-secondary whitespace-nowrap">
				{start != null && end != null
					? `${fmtClock(start)}–${fmtClock(end)}`
					: `${c.startFrame}–${c.endFrame}`}
			</td>
			<td className="py-1.5 pr-2 max-w-[18rem]">
				<div className="truncate text-text-primary" title={source?.path ?? ""}>
					{c.name || source?.name || "clip"}
				</div>
				{!c.enabled && <div className="text-text-secondary">turned off</div>}
			</td>
			<td className="py-1.5">
				<select
					value={c.originClass ?? FOLLOW}
					disabled={set.isPending}
					onChange={(e) => set.mutate(e.target.value || null)}
					className="bg-app-bg border border-border rounded px-2 py-1 text-xs text-text-primary"
				>
					<option value={FOLLOW}>Follows {follows}</option>
					{[...new Set(CLASS_OPTIONS.map((o) => o.group))].map((g) => (
						<optgroup key={g} label={g}>
							{CLASS_OPTIONS.filter((o) => o.group === g).map((o) => (
								<option key={o.value} value={o.value}>
									{o.label}
								</option>
							))}
						</optgroup>
					))}
				</select>
				<Problem error={set.error} />
			</td>
		</tr>
	);
}

// The project's work: scan, read, classify, import, download. One runs at a
// time per project (the API refuses a second); while one runs the list is
// asked again every second, and when one ends the pages showing what it
// changed are refreshed.

import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { media, type Job } from "../api.ts";
import { bytes } from "../labels.ts";
import { Button, Card, Problem, when } from "../ui.tsx";

export const jobsKey = (projectId: string) => ["catalog", projectId, "jobs"];

/** The project's jobs, newest first, kept fresh while one is running. */
export function useJobs(projectId: string) {
	const qc = useQueryClient();
	const q = useQuery({
		queryKey: jobsKey(projectId),
		queryFn: () => media.jobs(projectId),
		refetchInterval: (query) =>
			query.state.data?.jobs.some((j) => j.state === "running") ? 1000 : false,
	});
	// A job that has just ended changed the catalog: show what it did.
	const running = useRef<Set<string>>(new Set());
	useEffect(() => {
		const now = new Set(
			(q.data?.jobs ?? [])
				.filter((j) => j.state === "running")
				.map((j) => j.id),
		);
		const ended = [...running.current].some((id) => !now.has(id));
		running.current = now;
		if (ended) {
			qc.invalidateQueries({ queryKey: ["catalog", projectId, "summary"] });
			qc.invalidateQueries({ queryKey: ["catalog", projectId, "assets"] });
			qc.invalidateQueries({ queryKey: ["catalog", projectId, "asset"] });
			qc.invalidateQueries({
				queryKey: ["catalog", projectId, "credentials-on-the-web"],
			});
		}
	}, [q.data, projectId, qc]);
	return q;
}

const KIND: Record<string, string> = {
	scan: "Scan",
	extract: "Read files",
	classify: "Classify",
	import: "Import (scan, read, classify)",
	download: "Download",
	sign: "Sign",
};

/** The header's note of work in progress, linking to the Media page. */
export function WorkingNote({ projectId }: { projectId: string }) {
	const { data } = useJobs(projectId);
	const job = data?.jobs.find((j) => j.state === "running");
	if (!job) return null;
	return (
		<Link
			to={`/catalog/${projectId}/media`}
			className="text-xs text-warning hover:underline"
		>
			Working: {KIND[job.kind] ?? job.kind}
			{job.progress?.total
				? ` ${job.progress.done} of ${job.progress.total}`
				: "…"}
		</Link>
	);
}

type Work = "scan" | "extract" | "classify" | "import";

export function JobsPanel({ projectId }: { projectId: string }) {
	const qc = useQueryClient();
	const { data, error } = useJobs(projectId);
	const jobs = data?.jobs ?? [];
	const running = jobs.find((j) => j.state === "running");
	const start = useMutation({
		mutationFn: (kind: Work) => media.start(projectId, kind),
		onSuccess: () => qc.invalidateQueries({ queryKey: jobsKey(projectId) }),
	});
	const cancel = useMutation({
		mutationFn: (id: string) => media.cancel(projectId, id),
		onSuccess: () => qc.invalidateQueries({ queryKey: jobsKey(projectId) }),
	});
	const work: Array<{ kind: Work; label: string; hint: string }> = [
		{
			kind: "import",
			label: "Import",
			hint: "Scan, read and classify, one after another: what to run after adding files.",
		},
		{
			kind: "scan",
			label: "Scan",
			hint: "Find new, changed, moved and missing files in every media folder.",
		},
		{
			kind: "extract",
			label: "Read files",
			hint: "Read metadata and Content Credentials from files not read yet.",
		},
		{
			kind: "classify",
			label: "Classify",
			hint: "Propose kinds and origin classes from what was read. A person's choices are kept.",
		},
	];
	return (
		<Card className="space-y-4">
			<div className="grid md:grid-cols-4 gap-3">
				{work.map((w) => (
					<div key={w.kind} className="space-y-1">
						<Button
							onClick={() => start.mutate(w.kind)}
							disabled={!!running || start.isPending}
						>
							{w.label}
						</Button>
						<p className="text-xs text-text-secondary">{w.hint}</p>
					</div>
				))}
			</div>
			<Problem error={start.error ?? error} />
			{running && (
				<RunningJob
					job={running}
					onCancel={() => cancel.mutate(running.id)}
					cancelling={cancel.isPending}
				/>
			)}
			<Problem error={cancel.error} />
			{jobs.filter((j) => j.state !== "running").length > 0 && (
				<div>
					<h4 className="text-sm font-medium text-text-secondary mb-1">
						Done since the server started
					</h4>
					<ul className="divide-y divide-border text-sm">
						{jobs
							.filter((j) => j.state !== "running")
							.slice(0, 12)
							.map((j) => (
								<FinishedJob key={j.id} job={j} projectId={projectId} />
							))}
					</ul>
				</div>
			)}
		</Card>
	);
}

function RunningJob({
	job,
	onCancel,
	cancelling,
}: {
	job: Job;
	onCancel: () => void;
	cancelling: boolean;
}) {
	const p = job.progress;
	const share = p && p.total ? Math.round((p.done / p.total) * 100) : null;
	return (
		<div className="border border-warning/40 rounded p-3 space-y-2">
			<div className="flex items-center gap-3 text-sm">
				<span className="font-medium text-text-primary">
					{KIND[job.kind] ?? job.kind}
				</span>
				<span className="text-text-secondary">
					{p ? `${p.step}: ${p.done} of ${p.total}` : "starting…"}
				</span>
				<span className="ml-auto">
					<Button quiet onClick={onCancel} disabled={cancelling}>
						{cancelling ? "Stopping…" : "Stop"}
					</Button>
				</span>
			</div>
			<div className="h-1.5 bg-app-bg rounded overflow-hidden">
				<div
					className="h-full bg-accent transition-all"
					style={{ width: `${share ?? 5}%` }}
				/>
			</div>
			{p?.file && (
				<p className="text-xs text-text-secondary truncate" title={p.file}>
					{p.file}
				</p>
			)}
		</div>
	);
}

function FinishedJob({ job, projectId }: { job: Job; projectId: string }) {
	const lines = describe(job);
	const assetId = (job.result as { assetId?: number } | null)?.assetId;
	return (
		<li className="py-2">
			<div className="flex gap-3">
				<span className="font-medium text-text-primary">
					{KIND[job.kind] ?? job.kind}
				</span>
				<span
					className={
						job.state === "done"
							? "text-accent"
							: job.state === "failed"
								? "text-danger"
								: "text-text-secondary"
					}
				>
					{job.state === "done"
						? "done"
						: job.state === "failed"
							? "failed"
							: "stopped"}
				</span>
				<span className="text-xs text-text-secondary ml-auto">
					{when(job.finishedAt)}
				</span>
			</div>
			{job.error && <p className="text-xs text-danger">{job.error}</p>}
			{lines.map((l) => (
				<p key={l} className="text-xs text-text-secondary">
					{l}
				</p>
			))}
			{assetId && (
				<Link
					to={`/catalog/${projectId}/assets/${assetId}`}
					className="text-xs text-accent"
				>
					Open the downloaded asset
				</Link>
			)}
		</li>
	);
}

type Counts = Record<string, number>;
type Part = {
	counts?: Counts;
	skipped?: number;
	contents?: number;
	written?: number;
	examined?: number;
	changed?: number;
};

/** What a finished job reported, in a line or two. */
function describe(job: Job): string[] {
	const r = job.result as Record<string, unknown> | null;
	if (!r) return [];
	const scan = (s?: Part) => {
		if (!s?.counts) return null;
		const c = s.counts;
		const bits = [
			`${c.files} files`,
			c.newAssets && `${c.newAssets} new assets`,
			c.newVersions && `${c.newVersions} new versions`,
			c.moved && `${c.moved} moved`,
			c.replaced && `${c.replaced} replaced`,
			c.gone && `${c.gone} missing`,
			s.skipped && `${s.skipped} skipped`,
		].filter(Boolean);
		return `Scan: ${bits.join(", ")}${c.hashedBytes ? ` (${bytes(c.hashedBytes)} read)` : ""}.`;
	};
	const read = (e?: Part) =>
		e
			? `Read: ${e.written ?? 0} readings from ${e.contents ?? 0} files.`
			: null;
	const cls = (k?: Part) =>
		k
			? `Classify: ${k.changed ?? 0} changes across ${k.examined ?? 0} assets.`
			: null;
	const imported = (i?: Record<string, Part> & { cancelled?: boolean }) =>
		i
			? [
					scan(i.scan),
					read(i.extract),
					cls(i.classify),
					i.cancelled ? "Stopped part way." : null,
				]
			: [];
	const out: Array<string | null> =
		job.kind === "scan"
			? [scan(r as Part)]
			: job.kind === "extract"
				? [read(r as Part)]
				: job.kind === "classify"
					? [cls(r as Part)]
					: job.kind === "import"
						? imported(r as Record<string, Part>)
						: job.kind === "download"
							? [
									(() => {
										const placed = r.placed as
											| { root: string; path: string; renamed: boolean }
											| undefined;
										return placed
											? `Saved as ${placed.root} / ${placed.path}${placed.renamed ? " (that name was taken)" : ""}${typeof r.size === "number" ? `, ${bytes(r.size)}` : ""}.`
											: null;
									})(),
									...imported(r.import as Record<string, Part>),
								]
							: [];
	return out.filter((l): l is string => !!l);
}

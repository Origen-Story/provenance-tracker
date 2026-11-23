// A project at a glance: what it holds, where its media is on this machine,
// and when each kind of work last ran.

import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { projects, type Root } from "./api.ts";
import { KIND_LABEL } from "./labels.ts";
import { Card, Loading, PageTitle, Problem, Status, when } from "./ui.tsx";

const RUN_LABEL: Record<string, string> = {
	create: "Made",
	migrate: "Moved from the old app",
	scan: "Last scan",
	extract: "Last read of files",
	classify: "Last classify",
	timeline: "Last timeline import",
	sign: "Last signing",
};

export default function ProjectHome() {
	const { projectId } = useParams();
	const { data, isLoading, error } = useQuery({
		queryKey: ["catalog", projectId, "summary"],
		queryFn: () => projects.summary(projectId!),
	});
	if (isLoading) return <Loading />;
	if (error || !data)
		return <Problem error={error ?? "This project could not be read"} />;
	const s = data.settings;
	return (
		<div className="max-w-4xl space-y-6">
			<PageTitle title={data.name} description={s.description || data.folder} />

			<section className="grid grid-cols-2 md:grid-cols-4 gap-3">
				<Count label="Assets" value={data.counts.assets} to="assets" />
				<Count
					label="Finished edits"
					value={data.counts.outputs}
					to="assets?outputs=1"
				/>
				<Count
					label="Not sorted yet"
					value={data.counts.unsorted}
					to="assets?kind=unsorted"
				/>
				<Count
					label="Removed"
					value={data.counts.removed}
					to="assets?removed=only"
				/>
			</section>

			<section>
				<h3 className="font-medium text-text-primary mb-2">By kind</h3>
				<Card>
					<dl className="grid grid-cols-2 gap-y-1 text-sm">
						{Object.entries(data.counts.byKind).map(([kind, n]) => (
							<div key={kind} className="contents">
								<dt className="text-text-secondary">
									<Link
										to={`assets?kind=${kind}`}
										className="hover:text-text-primary"
									>
										{KIND_LABEL[kind] ?? kind}
									</Link>
								</dt>
								<dd className="text-text-primary">{n}</dd>
							</div>
						))}
					</dl>
				</Card>
			</section>

			<section>
				<h3 className="font-medium text-text-primary mb-2">
					Media folders (roots)
				</h3>
				<div className="space-y-2">
					{data.roots.length === 0 && (
						<p className="text-sm text-text-secondary">No roots yet.</p>
					)}
					{data.roots.map((r) => (
						<RootRow key={r.id} root={r} />
					))}
				</div>
			</section>

			<section>
				<h3 className="font-medium text-text-primary mb-2">Work done</h3>
				<Card>
					<dl className="grid grid-cols-2 gap-y-1 text-sm">
						{data.lastRuns.map((r) => (
							<div key={r.kind} className="contents">
								<dt className="text-text-secondary">
									{RUN_LABEL[r.kind] ?? r.kind}
								</dt>
								<dd className="text-text-primary">
									{when(r.finishedAt)}
									{r.outcome && r.outcome !== "ok" && (
										<span className="text-warning"> ({r.outcome})</span>
									)}
								</dd>
							</div>
						))}
					</dl>
				</Card>
			</section>

			<p className="text-xs text-text-secondary">
				Project folder: {data.folder}
			</p>
		</div>
	);
}

function Count({
	label,
	value,
	to,
}: {
	label: string;
	value: number;
	to: string;
}) {
	return (
		<Link to={to} className="block hover:opacity-80">
			<Card>
				<div className="text-2xl font-semibold text-text-primary">{value}</div>
				<div className="text-xs text-text-secondary">{label}</div>
			</Card>
		</Link>
	);
}

function RootRow({ root }: { root: Root }) {
	return (
		<Card className="flex items-start justify-between gap-4">
			<div className="min-w-0">
				<div className="flex items-center gap-2">
					<span className="font-medium text-text-primary">{root.name}</span>
					{root.inProject && (
						<span className="text-xs text-text-secondary">
							inside the project folder
						</span>
					)}
				</div>
				<p
					className="text-xs text-text-secondary truncate"
					title={root.folder ?? ""}
				>
					{root.folder ?? "not placed on this machine"}
				</p>
				{root.note && (
					<p className="text-xs text-text-secondary mt-0.5">{root.note}</p>
				)}
				{root.warnings.map((w) => (
					<p key={w} className="text-xs text-warning mt-0.5">
						{w}
					</p>
				))}
			</div>
			<Status ok={root.status === "ok"}>
				{root.status === "ok" ? "here" : root.status}
			</Status>
		</Card>
	);
}

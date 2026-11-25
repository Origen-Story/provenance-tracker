// A finished edit among its versions (D60): the revisions of the film,
// branches included, which are signed and published; what this edit was made
// from and what was made from it; and its own re-renders at the same path.
// All read from links; nothing here copies anything.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { revisions, type AssetRecord, type EditSummary } from "../api.ts";
import { assetKey } from "../asset/shared.ts";
import { Card, Problem, Select, when } from "../ui.tsx";
import { startedFromLink } from "./StartFrom.tsx";

const revisionsKey = (projectId: string, id: number) => [
	...assetKey(projectId, id),
	"revisions",
];

function Edit({
	projectId,
	edit,
	current = false,
}: {
	projectId: string;
	edit: EditSummary;
	current?: boolean;
}) {
	const counts = [
		edit.signed
			? `${edit.signed} signed cop${edit.signed === 1 ? "y" : "ies"}`
			: "not signed",
		edit.published ? `${edit.published} published` : null,
		edit.removed ? "removed" : null,
	]
		.filter(Boolean)
		.join(" · ");
	return (
		<span className="inline-flex flex-wrap items-baseline gap-x-2">
			{current ? (
				<strong className="text-text-primary">{edit.title} (this edit)</strong>
			) : (
				<Link
					to={`/catalog/${projectId}/outputs/${edit.assetId}`}
					className="text-accent hover:underline"
				>
					{edit.title}
				</Link>
			)}
			{edit.fileName && edit.fileName !== edit.title && (
				<span className="text-xs text-text-secondary">{edit.fileName}</span>
			)}
			<span className="text-xs text-text-secondary">{counts}</span>
		</span>
	);
}

export default function Revisions({
	projectId,
	asset,
}: {
	projectId: string;
	asset: AssetRecord;
}) {
	const qc = useQueryClient();
	const { data: r } = useQuery({
		queryKey: revisionsKey(projectId, asset.id),
		queryFn: () => revisions.of(projectId, asset.id),
	});
	const link = startedFromLink(asset);
	const relate = useMutation({
		mutationFn: (as: "revision" | "made_from") =>
			revisions.setRelation(projectId, asset.id, as),
		onSuccess: (answer) => {
			qc.setQueryData(assetKey(projectId, asset.id), answer.asset);
			qc.setQueryData(revisionsKey(projectId, asset.id), answer.revisions);
			if (link)
				qc.invalidateQueries({
					queryKey: revisionsKey(projectId, link.otherAssetId),
				});
		},
	});
	if (!r) return null;
	const renders = r.renders.length > 1 ? r.renders : [];
	if (
		r.line.length < 2 &&
		!r.madeFrom &&
		r.deliverables.length === 0 &&
		!renders.length &&
		!link
	)
		return null;
	return (
		<Card className="space-y-3">
			<h2 className="text-sm font-medium text-text-primary">
				Versions of this film
			</h2>
			{link && (
				<div className="flex flex-wrap items-end gap-3 text-sm">
					<div className="min-w-72">
						<Select
							label={`This edit, against ${link.otherTitle || `edit ${link.otherAssetId}`}`}
							value={link.type === "made_from" ? "made_from" : "revision"}
							onChange={(v) => relate.mutate(v as "revision" | "made_from")}
							options={[
								{ value: "revision", label: "is its next revision" },
								{
									value: "made_from",
									label: "is made from it (a vertical cut, a trailer…)",
								},
							]}
						/>
					</div>
					<Problem error={relate.error} />
				</div>
			)}
			{r.line.length > 1 && (
				<div>
					<p className="text-xs text-text-secondary mb-1">
						Revisions, earliest first
					</p>
					<ol className="space-y-1 text-sm">
						{r.line.map((e) => (
							<li
								key={e.assetId}
								style={{ paddingLeft: `${e.depth * 1.25}rem` }}
							>
								<Edit projectId={projectId} edit={e} current={e.current} />
							</li>
						))}
					</ol>
				</div>
			)}
			{r.madeFrom && (
				<p className="text-sm">
					<span className="text-text-secondary">Made from </span>
					<Edit projectId={projectId} edit={r.madeFrom} />
				</p>
			)}
			{r.deliverables.length > 0 && (
				<div>
					<p className="text-xs text-text-secondary mb-1">
						Made from this edit
					</p>
					<ul className="space-y-1 text-sm">
						{r.deliverables.map((e) => (
							<li key={e.assetId}>
								<Edit projectId={projectId} edit={e} />
							</li>
						))}
					</ul>
				</div>
			)}
			{renders.length > 0 && (
				<div>
					<p className="text-xs text-text-secondary mb-1">
						This edit's file, rendered again at the same place
					</p>
					<ol className="space-y-0.5 text-sm text-text-primary">
						{renders.map((c, i) => (
							<li key={c.sha256}>
								Render {i + 1}, {when(c.createdAt)}
								<span className="text-xs text-text-secondary">
									{c.signedVersions.length
										? ` · signed as ${c.signedVersions.map((v) => `v${v}`).join(", ")}`
										: " · not signed"}
								</span>
							</li>
						))}
					</ol>
				</div>
			)}
		</Card>
	);
}

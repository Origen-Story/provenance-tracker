// The project's finished edits, each with how far it has got (a timeline, a
// statement, a signed copy), and what signs them on this machine.

import { useQueries, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { assets, type AssetRecord } from "./api.ts";
import { assetKey } from "./asset/shared.ts";
import { OriginBadge } from "./badge.tsx";
import { currentTimeline } from "./output/shared.tsx";
import { SigningSetUp } from "./output/SigningTab.tsx";
import {
	Card,
	Loading,
	PageTitle,
	Problem,
	Section,
	Status,
	when,
} from "./ui.tsx";

export default function OutputsList() {
	const { projectId } = useParams();
	const p = projectId!;
	const list = useQuery({
		queryKey: ["catalog", p, "assets", { outputs: true }],
		queryFn: () => assets.list(p, { outputs: true, limit: 200 }),
	});
	// Few edits per project: each one's record says how far it has got.
	const records = useQueries({
		queries: (list.data?.assets ?? []).map((a) => ({
			queryKey: assetKey(p, a.id),
			queryFn: () => assets.get(p, a.id),
		})),
	});
	return (
		<div className="max-w-4xl space-y-8">
			<PageTitle
				title="Finished edits"
				description="The edits made from this project's assets: import each one's timeline, write its statement, sign it, and export it for a public page."
			/>
			<Section title="Edits">
				{list.isLoading && <Loading />}
				<Problem error={list.error} />
				{list.data && list.data.assets.length === 0 && (
					<Card>
						<p className="text-sm text-text-secondary">
							None yet. Open the asset that is the exported film or sound, and
							tick “A finished edit” in its details.
						</p>
					</Card>
				)}
				<div className="space-y-2">
					{(list.data?.assets ?? []).map((a, n) => {
						const r = records[n]?.data;
						return (
							<Link
								key={a.id}
								to={`/catalog/${p}/outputs/${a.id}`}
								className="block bg-card-bg border border-border rounded-lg p-4 hover:border-accent/60"
							>
								<div className="flex flex-wrap items-center gap-3">
									<span className="font-medium text-text-primary">
										{a.displayTitle}
									</span>
									<OriginBadge
										originClass={a.originClass}
										confirmed={a.originClassConfirmed}
										aiAssisted={a.aiAssisted}
									/>
									<span className="ml-auto text-xs text-text-secondary">
										changed {when(a.updatedAt)}
									</span>
								</div>
								{a.file && (
									<p className="text-xs text-text-secondary mt-1 truncate">
										{a.file.root} / {a.file.path}
									</p>
								)}
								{r && <Progress record={r} />}
							</Link>
						);
					})}
				</div>
			</Section>
			<Section title="What signs this project on this machine">
				<SigningSetUp projectId={p} />
			</Section>
		</div>
	);
}

function Progress({ record: r }: { record: AssetRecord }) {
	const { current } = currentTimeline(r);
	const signed = r.signatures.filter((s) => s.kind === "output");
	const last = signed[signed.length - 1];
	return (
		<div className="flex flex-wrap gap-2 mt-2">
			<Status ok={!!current}>
				{current ? "timeline imported" : "no timeline"}
			</Status>
			<Status ok={r.statements.length > 0}>
				{r.statements.length ? "statement saved" : "no statement"}
			</Status>
			<Status ok={!!last}>
				{last
					? `signed v${last.version}, ${when(last.signedAt)}`
					: "not signed"}
			</Status>
		</div>
	);
}

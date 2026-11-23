// One finished edit: its timeline and composition, the creator statement,
// signing, and the public export. The tab is kept in the address.

import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import { assets } from "./api.ts";
import { assetKey, str } from "./asset/shared.ts";
import { OriginBadge } from "./badge.tsx";
import CompositionTab from "./output/CompositionTab.tsx";
import ExportTab from "./output/ExportTab.tsx";
import SigningTab from "./output/SigningTab.tsx";
import StatementTab from "./output/StatementTab.tsx";
import { Loading, PageTitle, Problem } from "./ui.tsx";

const TABS = [
	{ id: "composition", label: "Composition" },
	{ id: "statement", label: "Statement" },
	{ id: "signing", label: "Signing" },
	{ id: "export", label: "Export" },
] as const;

type Tab = (typeof TABS)[number]["id"];

export default function OutputPage() {
	const { projectId, assetId } = useParams();
	const id = Number(assetId);
	const p = projectId!;
	const [params, setParams] = useSearchParams();
	const tab: Tab =
		(TABS.find((t) => t.id === params.get("tab"))?.id as Tab) ?? "composition";
	const {
		data: asset,
		isLoading,
		error,
	} = useQuery({
		queryKey: assetKey(p, id),
		queryFn: () => assets.get(p, id),
	});
	if (isLoading) return <Loading />;
	if (error || !asset)
		return <Problem error={error ?? "This output could not be read"} />;
	const f = asset.fields;
	const fileName = asset.contents[0]?.places[0]?.path.split("/").pop();
	const title = str(f.title) || fileName || `Output ${asset.id}`;
	return (
		<div key={asset.id} className="max-w-6xl space-y-6">
			<div>
				<Link
					to={`/catalog/${p}/outputs`}
					className="text-xs text-text-secondary hover:text-text-primary"
				>
					← All finished edits
				</Link>
				<PageTitle
					title={title}
					description={
						<span className="flex flex-wrap items-center gap-2">
							<OriginBadge
								originClass={str(f.origin_class) || "unknown"}
								confirmed={!!f.origin_class_confirmed}
								aiAssisted={!!f.ai_assisted}
								note={str(f.origin_class_note)}
							/>
							{str(f.public_title) && (
								<span>shown publicly as “{str(f.public_title)}”</span>
							)}
							<Link
								to={`/catalog/${p}/assets/${asset.id}`}
								className="text-accent hover:underline"
							>
								Its details, credits and files
							</Link>
						</span>
					}
				/>
				{!f.is_output && (
					<p className="text-sm text-warning">
						This asset is not marked as a finished edit. Mark it on its details
						page to sign it as one.
					</p>
				)}
			</div>
			<nav className="flex gap-1 border-b border-border">
				{TABS.map((t) => (
					<button
						key={t.id}
						type="button"
						onClick={() => {
							const next = new URLSearchParams(params);
							next.set("tab", t.id);
							setParams(next, { replace: true });
						}}
						className={`px-3 py-2 text-sm border-b-2 -mb-px ${tab === t.id ? "border-accent text-text-primary" : "border-transparent text-text-secondary hover:text-text-primary"}`}
					>
						{t.label}
					</button>
				))}
			</nav>
			{tab === "composition" && <CompositionTab projectId={p} asset={asset} />}
			{tab === "statement" && <StatementTab projectId={p} asset={asset} />}
			{tab === "signing" && <SigningTab projectId={p} asset={asset} />}
			{tab === "export" && <ExportTab projectId={p} asset={asset} />}
		</div>
	);
}

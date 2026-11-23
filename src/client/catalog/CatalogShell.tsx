// The new pages' frame: the project's name, its pages, and the way back to
// the old app until the cutover (Phase 6, slice 7) makes this the app.

import { useQuery } from "@tanstack/react-query";
import { Link, NavLink, Outlet, useParams } from "react-router";
import { projects } from "./api.ts";
import { WorkingNote } from "./media/Jobs.tsx";

export default function CatalogShell() {
	const { projectId } = useParams();
	const { data: summary } = useQuery({
		queryKey: ["catalog", projectId, "summary"],
		queryFn: () => projects.summary(projectId!),
		enabled: !!projectId,
	});
	const tab = ({ isActive }: { isActive: boolean }) =>
		`px-3 py-1.5 rounded text-sm ${isActive ? "bg-card-hover text-text-primary" : "text-text-secondary hover:text-text-primary"}`;
	return (
		<div className="min-h-screen bg-app-bg">
			<header className="border-b border-border bg-sidebar-bg px-8 py-3 flex items-center gap-6">
				<Link to="/catalog" className="font-semibold text-text-primary">
					Provenance Tracker
				</Link>
				{projectId && (
					<>
						<span className="text-text-secondary">/</span>
						<span className="text-text-primary">{summary?.name ?? "…"}</span>
						<nav className="flex gap-1">
							<NavLink to={`/catalog/${projectId}`} end className={tab}>
								Overview
							</NavLink>
							<NavLink to={`/catalog/${projectId}/assets`} className={tab}>
								Assets
							</NavLink>
							<NavLink to={`/catalog/${projectId}/media`} className={tab}>
								Media
							</NavLink>
							<NavLink to={`/catalog/${projectId}/outputs`} className={tab}>
								Finished edits
							</NavLink>
							<NavLink to={`/catalog/${projectId}/settings`} className={tab}>
								Settings
							</NavLink>
						</nav>
						<WorkingNote projectId={projectId} />
					</>
				)}
				<Link
					to="/"
					className="ml-auto text-xs text-text-secondary hover:text-text-primary"
				>
					Back to the current app
				</Link>
			</header>
			<main className="p-8">
				<Outlet />
			</main>
		</div>
	);
}

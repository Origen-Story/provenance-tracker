// Getting files into the project: its media folders, adding files to them,
// and the work that finds and reads what is there.

import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { projects } from "./api.ts";
import { AddFiles } from "./media/AddFiles.tsx";
import { JobsPanel } from "./media/Jobs.tsx";
import { Roots } from "./media/Roots.tsx";
import { Loading, PageTitle, Problem, Section } from "./ui.tsx";

export default function MediaPage() {
	const { projectId } = useParams();
	const { data, isLoading, error } = useQuery({
		queryKey: ["catalog", projectId, "summary"],
		queryFn: () => projects.summary(projectId!),
	});
	if (isLoading) return <Loading />;
	if (error || !data)
		return <Problem error={error ?? "This project could not be read"} />;
	return (
		<div className="max-w-4xl space-y-8">
			<PageTitle
				title="Media"
				description="Where this project's files are, adding more, and finding and reading what is there."
			/>
			<Section title="Work">
				<JobsPanel projectId={projectId!} />
			</Section>
			<Section title="Media folders">
				<Roots projectId={projectId!} roots={data.roots} />
			</Section>
			<Section title="Add files">
				<AddFiles projectId={projectId!} roots={data.roots} />
			</Section>
		</div>
	);
}

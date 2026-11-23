// The projects this machine knows, and opening or making one. A project is a
// folder: its catalog is inside it, so opening one is naming its folder.

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { projects, type KnownProject } from "./api.ts";
import {
	Button,
	Card,
	Loading,
	PageTitle,
	Problem,
	Status,
	TextField,
} from "./ui.tsx";

export default function ProjectPicker() {
	const { data, isLoading, error } = useQuery({
		queryKey: ["catalog", "projects"],
		queryFn: projects.list,
	});
	return (
		<div className="max-w-2xl">
			<PageTitle
				title="Projects"
				description="Each project is a folder; its catalog is kept inside it, so the folder can be copied, archived or moved whole."
			/>
			{isLoading && <Loading />}
			<Problem error={error} />
			{data && (
				<div className="space-y-3 mb-8">
					{data.projects.length === 0 && (
						<p className="text-text-secondary text-sm">
							No projects on this machine yet. Open a project folder, or make
							one.
						</p>
					)}
					{data.projects.map((p) => (
						<ProjectRow key={p.projectId} project={p} />
					))}
				</div>
			)}
			<OpenOrCreate />
		</div>
	);
}

function ProjectRow({ project }: { project: KnownProject }) {
	const ok = project.status === "ok";
	return (
		<Card className="flex items-center justify-between gap-4">
			<div className="min-w-0">
				<div className="flex items-center gap-2">
					<span className="font-medium text-text-primary">
						{project.name ?? "(no name read)"}
					</span>
					{!ok && <Status ok={false}>{project.status}</Status>}
				</div>
				<p
					className="text-xs text-text-secondary mt-0.5 truncate"
					title={project.folder}
				>
					{project.folder}
				</p>
				{project.detail && (
					<p className="text-xs text-warning mt-0.5">{project.detail}</p>
				)}
			</div>
			{ok && (
				<Link
					to={`/catalog/${project.projectId}`}
					className="text-sm text-accent hover:text-accent-hover px-3 py-1.5 border border-accent/30 hover:border-accent rounded shrink-0"
				>
					Open
				</Link>
			)}
		</Card>
	);
}

function OpenOrCreate() {
	const qc = useQueryClient();
	const navigate = useNavigate();
	const [folder, setFolder] = useState("");
	const [name, setName] = useState("");
	const done = (r: { projectId: string }) => {
		qc.invalidateQueries({ queryKey: ["catalog", "projects"] });
		navigate(`/catalog/${r.projectId}`);
	};
	const open = useMutation({
		mutationFn: () => projects.open(folder.trim()),
		onSuccess: done,
	});
	const create = useMutation({
		mutationFn: () => projects.create(folder.trim(), name.trim()),
		onSuccess: done,
	});
	const submit = (e: FormEvent) => {
		e.preventDefault();
		open.mutate();
	};
	return (
		<Card>
			<form onSubmit={submit} className="space-y-3">
				<h3 className="font-medium text-text-primary">
					Open or make a project
				</h3>
				<TextField
					label="Project folder"
					value={folder}
					onChange={setFolder}
					placeholder="D:\Projects\Film"
					hint="The folder that holds (or will hold) .provenancetracker. Paste it from your file manager."
				/>
				<div className="flex gap-2">
					<Button type="submit" disabled={!folder.trim() || open.isPending}>
						Open this folder's project
					</Button>
				</div>
				<Problem error={open.error} />
				<div className="border-t border-border pt-3 space-y-3">
					<TextField
						label="Name, for a new project"
						value={name}
						onChange={setName}
						placeholder="Film"
					/>
					<Button
						onClick={() => create.mutate()}
						disabled={!folder.trim() || !name.trim() || create.isPending}
					>
						Make a new project in this folder
					</Button>
					<Problem error={create.error} />
				</div>
			</form>
		</Card>
	);
}

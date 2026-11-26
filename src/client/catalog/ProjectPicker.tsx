// The projects this machine knows, and opening or making one. A project is a
// folder: its catalog is inside it, so opening one is naming its folder.

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { ApiError, projects, type KnownProject } from "./api.ts";
import PersonForm from "./Person.tsx";
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
			<div className="mt-8">
				<PersonForm />
			</div>
		</div>
	);
}

function ProjectRow({ project }: { project: KnownProject }) {
	const ok = project.status === "ok";
	const qc = useQueryClient();
	// A project that opens is forgotten from its own settings page; one that
	// cannot be opened here is forgotten from this list.
	const forget = useMutation({
		mutationFn: () => projects.forget(project.projectId),
		onSuccess: (r) =>
			qc.setQueryData(["catalog", "projects"], { projects: r.projects }),
	});
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
				<Problem error={forget.error} />
			</div>
			{!ok && (
				<Button
					quiet
					disabled={forget.isPending}
					onClick={() => {
						if (
							confirm(
								`Forget ${project.folder} on this machine? Nothing there is deleted or changed; opening the folder again brings the project back.`,
							)
						)
							forget.mutate();
					}}
				>
					Forget it here
				</Button>
			)}
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

type Done = (r: { projectId: string }) => void;

// Opening and making are two forms, each with its own folder and button, so
// Enter does what the form being filled in says, and each refusal shows
// under the button that caused it.
function OpenOrCreate() {
	const qc = useQueryClient();
	const navigate = useNavigate();
	const done: Done = (r) => {
		qc.invalidateQueries({ queryKey: ["catalog", "projects"] });
		navigate(`/catalog/${r.projectId}`);
	};
	return (
		<div className="space-y-4">
			<OpenForm done={done} />
			<CreateForm done={done} />
		</div>
	);
}

function OpenForm({ done }: { done: Done }) {
	const [folder, setFolder] = useState("");
	const open = useMutation({
		mutationFn: (takeOver: boolean) => projects.open(folder.trim(), takeOver),
		onSuccess: done,
	});
	const ready = !!folder.trim() && !open.isPending;
	// The folder holds a project this machine already has somewhere else.
	const elsewhere =
		open.error instanceof ApiError
			? ((open.error.data as { elsewhere?: { folder: string } } | null)
					?.elsewhere ?? null)
			: null;
	const submit = (e: FormEvent) => {
		e.preventDefault();
		if (ready) open.mutate(false);
	};
	return (
		<Card>
			<form onSubmit={submit} className="space-y-3">
				<h3 className="font-medium text-text-primary">Open a project</h3>
				<TextField
					label="Project folder"
					value={folder}
					onChange={(v) => {
						setFolder(v);
						open.reset();
					}}
					placeholder="D:\Projects\Film"
					hint="A folder that already holds .provenancetracker, for example one copied from another machine. Paste it from your file manager."
				/>
				<Button type="submit" disabled={!ready}>
					{open.isPending ? "Opening…" : "Open"}
				</Button>
				<Problem error={open.error} />
				{elsewhere && (
					<div className="space-y-2 text-sm text-text-secondary">
						<p>
							If this folder is a copy to look at, leave it. If it is where the
							project lives now, open it here: this machine's signing
							certificate, identity and media folders for the project then
							follow it, and the folder at{" "}
							<span className="text-text-primary break-all">
								{elsewhere.folder}
							</span>{" "}
							is no longer the one this machine opens.
						</p>
						<Button
							quiet
							disabled={open.isPending}
							onClick={() => open.mutate(true)}
						>
							This is where the project lives now: open it here
						</Button>
					</div>
				)}
			</form>
		</Card>
	);
}

function CreateForm({ done }: { done: Done }) {
	const [folder, setFolder] = useState("");
	const [name, setName] = useState("");
	const create = useMutation({
		mutationFn: () => projects.create(folder.trim(), name.trim()),
		onSuccess: done,
	});
	const ready = !!folder.trim() && !!name.trim() && !create.isPending;
	const submit = (e: FormEvent) => {
		e.preventDefault();
		if (ready) create.mutate();
	};
	return (
		<Card>
			<form onSubmit={submit} className="space-y-3">
				<h3 className="font-medium text-text-primary">Make a new project</h3>
				<TextField
					label="Project folder"
					value={folder}
					onChange={(v) => {
						setFolder(v);
						create.reset();
					}}
					placeholder="D:\Projects\Film"
					hint="The catalog is kept in .provenancetracker inside this folder. The folder is made if it does not exist yet."
				/>
				<TextField
					label="Name"
					value={name}
					onChange={(v) => {
						setName(v);
						create.reset();
					}}
					placeholder="Film"
				/>
				<Button type="submit" disabled={!ready}>
					{create.isPending ? "Making…" : "Make the project"}
				</Button>
				<Problem error={create.error} />
			</form>
		</Card>
	);
}

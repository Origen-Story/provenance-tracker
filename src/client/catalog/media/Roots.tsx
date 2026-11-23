// The project's media folders (roots): where its files are on this machine.
// A root inside the project folder travels with it; one outside it is
// placed per machine, and a copy of the project on another machine is told
// where it is there ("locate").

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { media, type Root } from "../api.ts";
import { Button, Card, Problem, Status, TextField } from "../ui.tsx";

export function Roots({
	projectId,
	roots,
}: {
	projectId: string;
	roots: Root[];
}) {
	return (
		<div className="space-y-2">
			{roots.length === 0 && (
				<p className="text-sm text-text-secondary">
					No media folders yet. Add the folder (or folders) that hold this
					project's files.
				</p>
			)}
			{roots.map((r) => (
				<RootRow key={r.id} projectId={projectId} root={r} />
			))}
			<AddRoot projectId={projectId} />
		</div>
	);
}

function useRootsAnswer(projectId: string) {
	const qc = useQueryClient();
	return () =>
		qc.invalidateQueries({ queryKey: ["catalog", projectId, "summary"] });
}

function RootRow({ projectId, root }: { projectId: string; root: Root }) {
	const done = useRootsAnswer(projectId);
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState(root.name);
	const [note, setNote] = useState(root.note);
	const [folder, setFolder] = useState("");
	const edit = useMutation({
		mutationFn: () => {
			const fields: { name?: string; note?: string } = {};
			if (name.trim() !== root.name) fields.name = name.trim();
			if (note !== root.note) fields.note = note;
			return media.editRoot(projectId, root.name, fields);
		},
		onSuccess: () => {
			done();
			setEditing(false);
		},
	});
	const locate = useMutation({
		mutationFn: () => media.locateRoot(projectId, root.name, folder.trim()),
		onSuccess: () => {
			done();
			setFolder("");
		},
	});
	const ok = root.status === "ok";
	return (
		<Card className="space-y-2">
			<div className="flex items-start justify-between gap-4">
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
					{root.note && !editing && (
						<p className="text-xs text-text-secondary mt-0.5">{root.note}</p>
					)}
					{root.warnings.map((w) => (
						<p key={w} className="text-xs text-warning mt-0.5">
							{w}
						</p>
					))}
				</div>
				<div className="flex items-center gap-2 shrink-0">
					<Status ok={ok}>{ok ? "here" : root.status}</Status>
					{!editing && (
						<Button quiet onClick={() => setEditing(true)}>
							Rename or note
						</Button>
					)}
				</div>
			</div>
			{editing && (
				<div className="grid md:grid-cols-2 gap-2">
					<TextField
						label="Name"
						value={name}
						onChange={setName}
						hint="Renaming keeps every file and its history; the folder on disk is not renamed."
					/>
					<TextField label="Note" value={note} onChange={setNote} />
					<div className="flex gap-2">
						<Button
							onClick={() => edit.mutate()}
							disabled={edit.isPending || !name.trim()}
						>
							Save
						</Button>
						<Button
							quiet
							onClick={() => {
								setEditing(false);
								setName(root.name);
								setNote(root.note);
							}}
						>
							Cancel
						</Button>
					</div>
				</div>
			)}
			<Problem error={edit.error} />
			{!ok && (
				<form
					className="flex flex-wrap items-end gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						if (folder.trim()) locate.mutate();
					}}
				>
					<div className="flex-1 min-w-64">
						<TextField
							label="Where is this folder on this machine?"
							value={folder}
							onChange={setFolder}
							placeholder="E:\Footage\Interviews"
						/>
					</div>
					<Button type="submit" disabled={!folder.trim() || locate.isPending}>
						Locate
					</Button>
				</form>
			)}
			<Problem error={locate.error} />
		</Card>
	);
}

function AddRoot({ projectId }: { projectId: string }) {
	const done = useRootsAnswer(projectId);
	const [name, setName] = useState("");
	const [folder, setFolder] = useState("");
	const [note, setNote] = useState("");
	const add = useMutation({
		mutationFn: () =>
			media.addRoot(projectId, name.trim(), folder.trim(), note),
		onSuccess: () => {
			done();
			setName("");
			setFolder("");
			setNote("");
		},
	});
	const ready = !!name.trim() && !!folder.trim() && !add.isPending;
	return (
		<Card>
			<form
				className="space-y-3"
				onSubmit={(e) => {
					e.preventDefault();
					if (ready) add.mutate();
				}}
			>
				<h4 className="font-medium text-text-primary">Add a media folder</h4>
				<div className="grid md:grid-cols-2 gap-3">
					<TextField
						label="Folder"
						value={folder}
						onChange={(v) => {
							setFolder(v);
							add.reset();
						}}
						placeholder="D:\Projects\Film\footage"
						hint="An existing folder; paste its full path. Inside the project folder, it travels with the project."
					/>
					<TextField
						label="Name"
						value={name}
						onChange={(v) => {
							setName(v);
							add.reset();
						}}
						placeholder="footage"
						hint="How the project refers to it, on every machine."
					/>
					<TextField label="Note (optional)" value={note} onChange={setNote} />
				</div>
				<Button type="submit" disabled={!ready}>
					{add.isPending ? "Adding…" : "Add the folder"}
				</Button>
				<Problem error={add.error} />
				<p className="text-xs text-text-secondary">
					Then run Import to find and read what is in it.
				</p>
			</form>
		</Card>
	);
}

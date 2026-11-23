// Bringing files in: dropped or chosen from this computer, or downloaded
// from an address, into a folder inside one of the project's media
// folders. Each is then imported (scanned, read, classified) as a job.
// Files already somewhere in a media folder need no adding: Import finds them.

import { useRef, useState, type DragEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { media, type Placed, type Root } from "../api.ts";
import { Button, Card, Problem, Select, TextField } from "../ui.tsx";
import { jobsKey } from "./Jobs.tsx";

function Where({
	roots,
	root,
	setRoot,
	folder,
	setFolder,
}: {
	roots: Root[];
	root: string;
	setRoot: (v: string) => void;
	folder: string;
	setFolder: (v: string) => void;
}) {
	return (
		<div className="grid md:grid-cols-2 gap-3">
			<Select
				label="Into the media folder"
				value={root}
				onChange={setRoot}
				options={roots.map((r) => ({ value: r.name, label: r.name }))}
			/>
			<TextField
				label="Folder inside it (optional)"
				value={folder}
				onChange={setFolder}
				placeholder="day 1/cards"
				hint="Made if it is not there. Use / between folders."
			/>
		</div>
	);
}

export function AddFiles({
	projectId,
	roots,
}: {
	projectId: string;
	roots: Root[];
}) {
	const here = roots.filter((r) => r.status === "ok");
	if (here.length === 0)
		return (
			<Card>
				<p className="text-sm text-text-secondary">
					Add a media folder on this machine first; files are placed inside one.
				</p>
			</Card>
		);
	return (
		<div className="space-y-4">
			<Upload projectId={projectId} roots={here} />
			<FromAddress projectId={projectId} roots={here} />
		</div>
	);
}

function Upload({ projectId, roots }: { projectId: string; roots: Root[] }) {
	const qc = useQueryClient();
	const [root, setRoot] = useState(roots[0].name);
	const [folder, setFolder] = useState("");
	const [over, setOver] = useState(false);
	const [placed, setPlaced] = useState<Placed[]>([]);
	const [note, setNote] = useState("");
	const input = useRef<HTMLInputElement>(null);
	const send = useMutation({
		mutationFn: (files: File[]) =>
			media.upload(projectId, root, folder.trim(), files),
		onSuccess: (r) => {
			setPlaced(r.placed);
			setNote(r.note ?? "");
			qc.invalidateQueries({ queryKey: jobsKey(projectId) });
		},
	});
	const take = (list: FileList | null) => {
		const files = [...(list ?? [])];
		if (files.length) {
			setPlaced([]);
			setNote("");
			send.mutate(files);
		}
	};
	const drop = (e: DragEvent) => {
		e.preventDefault();
		setOver(false);
		if (!send.isPending) take(e.dataTransfer.files);
	};
	return (
		<Card className="space-y-3">
			<h4 className="font-medium text-text-primary">
				Add files from this computer
			</h4>
			<Where
				roots={roots}
				root={root}
				setRoot={setRoot}
				folder={folder}
				setFolder={setFolder}
			/>
			<div
				onDragOver={(e) => {
					e.preventDefault();
					setOver(true);
				}}
				onDragLeave={() => setOver(false)}
				onDrop={drop}
				className={`border-2 border-dashed rounded-lg p-8 text-center text-sm ${over ? "border-accent bg-accent/5" : "border-border"}`}
			>
				{send.isPending ? (
					<p className="text-text-secondary">
						Copying the files into the project…
					</p>
				) : (
					<>
						<p className="text-text-primary">Drop files here</p>
						<p className="text-text-secondary text-xs mt-1">
							or{" "}
							<button
								type="button"
								className="text-accent hover:underline"
								onClick={() => input.current?.click()}
							>
								choose them
							</button>
							. They are copied in; the files you drop are left where they are.
						</p>
					</>
				)}
				<input
					ref={input}
					type="file"
					multiple
					className="hidden"
					onChange={(e) => {
						take(e.target.files);
						e.target.value = "";
					}}
				/>
			</div>
			<Problem error={send.error} />
			{placed.length > 0 && (
				<div className="text-xs space-y-0.5">
					<p className="text-text-secondary">
						{note ? "Copied in:" : "Copied in, and importing now:"}
					</p>
					{placed.map((p) => (
						<p key={`${p.root}/${p.path}`} className="text-text-primary">
							{p.root} / {p.path}
							{p.renamed && (
								<span className="text-warning">
									{" "}
									(renamed: that name was taken)
								</span>
							)}
						</p>
					))}
				</div>
			)}
			{note && <p className="text-xs text-warning">{note}</p>}
		</Card>
	);
}

function FromAddress({
	projectId,
	roots,
}: {
	projectId: string;
	roots: Root[];
}) {
	const qc = useQueryClient();
	const [root, setRoot] = useState(roots[0].name);
	const [folder, setFolder] = useState("");
	const [url, setUrl] = useState("");
	const get = useMutation({
		mutationFn: () =>
			media.download(projectId, url.trim(), root, folder.trim()),
		onSuccess: () => {
			setUrl("");
			qc.invalidateQueries({ queryKey: jobsKey(projectId) });
		},
	});
	return (
		<Card>
			<form
				className="space-y-3"
				onSubmit={(e) => {
					e.preventDefault();
					if (url.trim() && !get.isPending) get.mutate();
				}}
			>
				<h4 className="font-medium text-text-primary">
					Download from an address
				</h4>
				<TextField
					label="Address of the file"
					value={url}
					onChange={(v) => {
						setUrl(v);
						get.reset();
					}}
					placeholder="https://example.org/archive/photo.jpg"
					hint="A picture, video or sound file. The address and today's date are kept with it as where it came from."
				/>
				<Where
					roots={roots}
					root={root}
					setRoot={setRoot}
					folder={folder}
					setFolder={setFolder}
				/>
				<Button type="submit" disabled={!url.trim() || get.isPending}>
					Download
				</Button>
				<Problem error={get.error} />
				{get.isSuccess && (
					<p className="text-xs text-text-secondary">
						Downloading; see the work list above.
					</p>
				)}
			</form>
		</Card>
	);
}

// A project's settings: its name and who makes it, the identity link signed
// into its files, what signs it on this machine, and, kept apart at the foot,
// forgetting it on this machine.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";
import { projects, type ProjectSummary } from "./api.ts";
import { SigningSetUp } from "./output/SigningTab.tsx";
import {
	Card,
	Loading,
	PageTitle,
	Problem,
	SaveBar,
	Section,
	TextArea,
	TextField,
} from "./ui.tsx";

/** The settings this page edits, in its order (EDITABLE_META in fields.ts holds more). */
const KEYS = [
	"name",
	"description",
	"author",
	"organization",
	"cawg_identity_url",
] as const;
type Key = (typeof KEYS)[number];
type Draft = Record<Key, string>;

const draftOf = (settings: Record<string, string>): Draft =>
	Object.fromEntries(KEYS.map((k) => [k, settings[k] ?? ""])) as Draft;

/** What the catalog will take as the identity link (edits.ts says so too). */
function identityProblem(url: string): string | null {
	const v = url.trim();
	if (!v) return null;
	if (!URL.canParse(v) || new URL(v).protocol !== "https:")
		return "A full web address starting https://";
	return null;
}

export default function ProjectSettings() {
	const { projectId } = useParams();
	const p = projectId!;
	const { data, isLoading, error } = useQuery({
		queryKey: ["catalog", p, "summary"],
		queryFn: () => projects.summary(p),
	});
	if (isLoading) return <Loading />;
	if (error || !data)
		return <Problem error={error ?? "This project could not be read"} />;
	return (
		<div className="max-w-3xl space-y-8">
			<PageTitle title="Settings" description={data.folder} />
			<Section title="This project">
				<SettingsForm summary={data} />
			</Section>
			<Section title="What signs this project on this machine">
				<SigningSetUp projectId={p} />
			</Section>
			<Section title="Forget this project here">
				<Forget summary={data} />
			</Section>
		</div>
	);
}

function SettingsForm({ summary }: { summary: ProjectSummary }) {
	const qc = useQueryClient();
	const p = summary.projectId;
	const saved = draftOf(summary.settings);
	const [draft, setDraft] = useState<Draft>(saved);
	const [note, setNote] = useState("");
	const changed = KEYS.filter((k) => draft[k].trim() !== saved[k]);
	const urlProblem = identityProblem(draft.cawg_identity_url);
	const save = useMutation({
		mutationFn: () =>
			projects.editSettings(
				p,
				Object.fromEntries(changed.map((k) => [k, draft[k]])),
				note,
			),
		onSuccess: (r) => {
			qc.setQueryData<ProjectSummary>(["catalog", p, "summary"], (old) =>
				old ? { ...old, name: r.settings.name, settings: r.settings } : old,
			);
			qc.invalidateQueries({ queryKey: ["catalog", "projects"] });
			setDraft(draftOf(r.settings));
			setNote("");
		},
	});
	const set = (k: Key) => (v: string) => setDraft((d) => ({ ...d, [k]: v }));
	return (
		<Card className="space-y-4">
			<SaveBar
				count={changed.length}
				saving={save.isPending}
				onSave={() => save.mutate()}
				onUndo={() => setDraft(saved)}
				error={save.error}
				note={note}
				onNote={setNote}
				blocked={!draft.name.trim() || !!urlProblem}
			/>
			<TextField label="Name" value={draft.name} onChange={set("name")} />
			{!draft.name.trim() && (
				<p className="text-xs text-warning -mt-3">A project needs a name.</p>
			)}
			<TextArea
				label="Description"
				value={draft.description}
				onChange={set("description")}
				hint="For you and anyone you share the project folder with. Not signed into files."
			/>
			<div className="grid md:grid-cols-2 gap-4">
				<TextField
					label="Creator"
					value={draft.author}
					onChange={set("author")}
					hint="Filled in when you sign a source file. A finished edit's statement names its own creator."
				/>
				<TextField
					label="Organization"
					value={draft.organization}
					onChange={set("organization")}
					hint="Filled in the same way."
				/>
			</div>
			<div>
				<TextField
					label="Identity link"
					value={draft.cawg_identity_url}
					onChange={set("cawg_identity_url")}
					placeholder="https://example.org/.well-known/identity.json"
					hint="A public page or file that says who the creator is. Signed into every file you sign from this project, beside the creator's name. Publishing it is up to you; the tracker does not check what it says."
				/>
				{urlProblem && (
					<p className="text-xs text-warning mt-1">{urlProblem}</p>
				)}
			</div>
		</Card>
	);
}

function Forget({ summary }: { summary: ProjectSummary }) {
	const qc = useQueryClient();
	const navigate = useNavigate();
	const outside = summary.roots.filter((r) => !r.inProject).length;
	const forget = useMutation({
		mutationFn: () => projects.forget(summary.projectId),
		onSuccess: (r) => {
			qc.setQueryData(["catalog", "projects"], { projects: r.projects });
			qc.removeQueries({ queryKey: ["catalog", summary.projectId] });
			navigate("/catalog");
		},
	});
	return (
		<Card className="space-y-3 border-danger/40">
			<p className="text-sm text-text-secondary">
				Takes this project off this machine's list. Nothing in{" "}
				<span className="text-text-primary break-all">{summary.folder}</span> is
				deleted or changed: its catalog and media stay as they are, and opening
				the folder again brings the project back.
				{outside > 0 &&
					` Its ${outside} media folder${outside > 1 ? "s" : ""} outside the project folder will need locating again then.`}{" "}
				What signs it on this machine is forgotten too.
			</p>
			<button
				type="button"
				disabled={forget.isPending}
				onClick={() => {
					if (
						confirm(
							`Forget “${summary.name}” on this machine? Its folder, catalog and media are not touched.`,
						)
					)
						forget.mutate();
				}}
				className="text-sm text-danger px-3 py-1.5 border border-danger/40 hover:border-danger rounded transition-colors disabled:opacity-50"
			>
				{forget.isPending ? "Forgetting…" : "Forget this project here"}
			</button>
			<Problem error={forget.error} />
		</Card>
	);
}

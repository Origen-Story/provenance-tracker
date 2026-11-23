// The asset's own words: titles, description, notes, where it came from.
// Saving sends only what changed, with the person's reason if they give one.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { assets, type AssetRecord } from "../api.ts";
import { KIND_LABEL, KINDS } from "../labels.ts";
import {
	Card,
	Checkbox,
	SaveBar,
	Select,
	TextArea,
	TextField,
} from "../ui.tsx";
import { changedFields, str, useTakeAnswer } from "./shared.ts";

type Spec = { key: string; label: string; long?: boolean; hint?: string };

const GROUPS: Array<{ title: string; fields: Spec[] }> = [
	{
		title: "About it",
		fields: [
			{ key: "title", label: "Title" },
			{
				key: "public_title",
				label: "Public title",
				hint: "What a public page calls it; the title when empty.",
			},
			{
				key: "code",
				label: "Code",
				hint: "The project's own reference for it, if it has one.",
			},
			{ key: "description", label: "Description", long: true },
			{ key: "caption", label: "Caption", long: true },
		],
	},
	{
		title: "Notes",
		fields: [
			{ key: "notes", label: "Notes", long: true },
			{
				key: "usage_notes",
				label: "Usage notes",
				long: true,
				hint: "Restrictions, credits owed, where it may be shown.",
			},
		],
	},
	{
		title: "Where it came from",
		fields: [
			{ key: "source_url", label: "Source address" },
			{ key: "access_date", label: "Date found or downloaded" },
			{ key: "license", label: "Licence" },
			{ key: "license_url", label: "Licence address" },
			{ key: "original_date", label: "Original date" },
			{ key: "medium", label: "Medium" },
		],
	},
	{
		title: "Recording",
		fields: [
			{ key: "recorded_date", label: "Recorded on" },
			{ key: "recorded_location", label: "Recorded at" },
			{ key: "equipment", label: "Equipment" },
		],
	},
];

const KEYS = [
	"kind",
	"is_output",
	...GROUPS.flatMap((g) => g.fields.map((f) => f.key)),
];

function initialOf(asset: AssetRecord): Record<string, unknown> {
	return Object.fromEntries(
		KEYS.map((k) => [
			k,
			k === "is_output" ? !!asset.fields[k] : str(asset.fields[k]),
		]),
	);
}

export default function DetailsForm({
	projectId,
	asset,
}: {
	projectId: string;
	asset: AssetRecord;
}) {
	const take = useTakeAnswer(projectId, asset.id);
	const initial = initialOf(asset);
	const [draft, setDraft] = useState<Record<string, unknown>>(initial);
	const [note, setNote] = useState("");
	const recorded = {
		...asset.fields,
		code: str(asset.fields.code),
		is_output: !!asset.fields.is_output,
	};
	const changed = changedFields(recorded, draft);
	const save = useMutation({
		mutationFn: () => {
			const fields = { ...changed };
			if ("code" in fields) fields.code = str(fields.code).trim() || null;
			return assets.edit(projectId, asset.id, fields, note.trim());
		},
		onSuccess: (r) => {
			take(r);
			setDraft(initialOf(r.asset));
			setNote("");
		},
	});
	const set = (k: string) => (v: unknown) => {
		setDraft((d) => ({ ...d, [k]: v }));
		save.reset();
	};
	const count = Object.keys(changed).length;

	return (
		<Card className="space-y-6">
			<SaveBar
				count={count}
				saving={save.isPending}
				onSave={() => save.mutate()}
				onUndo={() => setDraft(initial)}
				error={save.error}
				note={note}
				onNote={setNote}
				saveLabel="Save details"
			/>
			<div className="grid md:grid-cols-2 gap-3">
				<Select
					label="Kind"
					value={str(draft.kind)}
					onChange={set("kind")}
					options={KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] ?? k }))}
				/>
				<div className="pt-6">
					<Checkbox
						label="A finished edit"
						checked={!!draft.is_output}
						onChange={set("is_output")}
						hint="A film or mix made from other assets, which can be signed with its sources."
					/>
				</div>
			</div>
			{GROUPS.map((g) => (
				<div key={g.title}>
					<h4 className="text-sm font-medium text-text-secondary mb-2">
						{g.title}
					</h4>
					<div className="grid md:grid-cols-2 gap-3">
						{g.fields.map((f) =>
							f.long ? (
								<div key={f.key} className="md:col-span-2">
									<TextArea
										label={f.label}
										value={str(draft[f.key])}
										onChange={set(f.key)}
										hint={f.hint}
									/>
								</div>
							) : (
								<TextField
									key={f.key}
									label={f.label}
									value={str(draft[f.key])}
									onChange={set(f.key)}
									hint={f.hint}
								/>
							),
						)}
					</div>
				</div>
			))}
		</Card>
	);
}

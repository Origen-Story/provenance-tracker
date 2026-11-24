// How the asset was made: its origin class, whether a person has checked
// it, and why. Classify proposes a class from what it reads in the file; a
// class a person sets is theirs and classify leaves it alone.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { originClassDef } from "@provenancetracker/core/origin-vocabulary.js";
import { assets, type AssetRecord } from "../api.ts";
import { CLASS_OPTIONS } from "../AssetsList.tsx";
import { OriginBadge } from "../badge.tsx";
import { Card, Checkbox, SaveBar, Select, TextArea } from "../ui.tsx";
import { changedFields, str, useTakeAnswer } from "./shared.ts";

const SOURCE: Record<string, string> = {
	user: "set by a person",
	"": "not set",
};

function recordedOf(asset: AssetRecord) {
	const f = asset.fields;
	return {
		origin_class: str(f.origin_class) || "unknown",
		origin_class_confirmed: !!f.origin_class_confirmed,
		origin_class_note: str(f.origin_class_note),
		ai_assisted: !!f.ai_assisted,
	};
}

export default function OriginForm({
	projectId,
	asset,
}: {
	projectId: string;
	asset: AssetRecord;
}) {
	const take = useTakeAnswer(projectId, asset.id);
	const f = asset.fields;
	const recorded = recordedOf(asset);
	const [draft, setDraft] = useState(recorded);
	const [note, setNote] = useState("");
	const changed = changedFields(recorded, draft);
	// A class picked here is checked unless the person says it is not.
	if ("origin_class" in changed && !("origin_class_confirmed" in changed))
		changed.origin_class_confirmed = draft.origin_class_confirmed;
	const save = useMutation({
		mutationFn: () => assets.edit(projectId, asset.id, changed, note.trim()),
		onSuccess: (r) => {
			take(r);
			setDraft(recordedOf(r.asset));
			setNote("");
		},
	});
	const set =
		<K extends keyof typeof recorded>(k: K) =>
		(v: (typeof recorded)[K]) => {
			setDraft((d) => ({ ...d, [k]: v }));
			save.reset();
		};
	const def = originClassDef(draft.origin_class) as {
		desc?: string;
		position: string;
	};
	const source = str(f.origin_class_source);
	const ingredients = Array.isArray(f.origin_ingredient_classes)
		? (f.origin_ingredient_classes as string[])
		: [];
	const count = Object.keys(changedFields(recorded, draft)).length;

	return (
		<Card className="space-y-3">
			<SaveBar
				count={count}
				saving={save.isPending}
				onSave={() => save.mutate()}
				onUndo={() => setDraft(recorded)}
				error={save.error}
				note={note}
				onNote={setNote}
				saveLabel="Save the class"
			/>
			<div className="flex items-center gap-2 text-sm">
				<OriginBadge
					originClass={recorded.origin_class}
					confirmed={recorded.origin_class_confirmed}
					aiAssisted={recorded.ai_assisted}
					note={recorded.origin_class_note}
					signedBy={str(f.signed_by)}
					signerName={str(f.signer_name)}
				/>
				<span className="text-text-secondary">
					{SOURCE[source] ?? `proposed by classify (rule ${source})`}
					{recorded.origin_class_confirmed ? ", checked" : ", not checked yet"}
				</span>
			</div>
			<Select
				label="Origin class"
				value={draft.origin_class}
				onChange={(v) => {
					set("origin_class")(v);
					if (v !== recorded.origin_class) set("origin_class_confirmed")(true);
					// "AI-assisted" means something only for digital work, and its box
					// is hidden for any other class; a tick left behind would be refused.
					if (
						(originClassDef(v) as { position?: string })?.position !== "digital"
					)
						set("ai_assisted")(false);
				}}
				options={CLASS_OPTIONS}
			/>
			{def.desc && <p className="text-xs text-text-secondary">{def.desc}</p>}
			{def.position === "digital" && (
				<Checkbox
					label="AI-assisted"
					checked={draft.ai_assisted}
					onChange={set("ai_assisted")}
					hint="Made by a person with some help from a model, such as generative fill on part of it."
				/>
			)}
			<Checkbox
				label="I have checked this class"
				checked={draft.origin_class_confirmed}
				onChange={set("origin_class_confirmed")}
				hint="Unchecked classes show dashed, as a proposal."
			/>
			<TextArea
				label="Reason for the class"
				value={draft.origin_class_note}
				onChange={set("origin_class_note")}
				rows={2}
			/>
			{ingredients.length > 0 && (
				<p className="text-xs text-text-secondary">
					Made from material of these classes: {ingredients.join(", ")}
				</p>
			)}
		</Card>
	);
}

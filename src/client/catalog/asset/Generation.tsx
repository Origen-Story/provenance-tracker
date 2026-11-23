// What made an AI-generated file: the platform, model and settings. Read
// from the file where it says, and corrected or filled in by a person.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { assets, type AssetRecord } from "../api.ts";
import { Button, Card, Problem, TextArea, TextField } from "../ui.tsx";
import { changedFields, str, useTakeAnswer } from "./shared.ts";

const TEXT: Array<{ key: string; label: string; long?: boolean }> = [
	{ key: "platform", label: "Platform" },
	{ key: "model_name", label: "Model" },
	{ key: "model_version", label: "Model version" },
	{ key: "generated_at", label: "Generated at" },
	{ key: "prompt", label: "Prompt", long: true },
	{ key: "negative_prompt", label: "Negative prompt", long: true },
	{ key: "seed", label: "Seed" },
	{ key: "steps", label: "Steps" },
	{ key: "cfg_scale", label: "CFG scale" },
	{ key: "sampler", label: "Sampler" },
	{ key: "scheduler", label: "Scheduler" },
	{ key: "width", label: "Width" },
	{ key: "height", label: "Height" },
	{ key: "aspect_ratio", label: "Aspect ratio" },
	{ key: "stylize", label: "Stylize" },
	{ key: "style_raw", label: "Style (raw)" },
];
/** Whole numbers, or nothing. */
const NUMBERS = new Set(["steps", "width", "height"]);
const STRUCTURED = ["loras", "controlnets", "other"];

function recordedOf(asset: AssetRecord): Record<string, string> {
	const g = asset.generation ?? {};
	return Object.fromEntries(TEXT.map((f) => [f.key, str(g[f.key])]));
}

export default function Generation({
	projectId,
	asset,
}: {
	projectId: string;
	asset: AssetRecord;
}) {
	const take = useTakeAnswer(projectId, asset.id);
	const g = asset.generation ?? {};
	const recorded = recordedOf(asset);
	const [draft, setDraft] = useState(recorded);
	const changed = changedFields(recorded, draft);
	const bad = Object.keys(changed).filter(
		(k) => NUMBERS.has(k) && !/^\d*$/.test(draft[k].trim()),
	);
	const save = useMutation({
		mutationFn: () =>
			assets.setGeneration(
				projectId,
				asset.id,
				Object.fromEntries(
					Object.entries(changed).map(([k, v]) => [
						k,
						NUMBERS.has(k) ? (str(v).trim() ? Number(v) : null) : v,
					]),
				),
			),
		onSuccess: (r) => {
			take(r);
			setDraft(recordedOf(r.asset));
		},
	});
	const set = (k: string) => (v: string) => {
		setDraft((d) => ({ ...d, [k]: v }));
		save.reset();
	};
	const structured = STRUCTURED.filter((k) => {
		const v = g[k];
		return v && (Array.isArray(v) ? v.length : Object.keys(v as object).length);
	});
	const count = Object.keys(changed).length;
	return (
		<Card className="space-y-3">
			{!asset.generation && (
				<p className="text-sm text-text-secondary">
					Nothing recorded yet. Fill in what you know and save.
				</p>
			)}
			<div className="grid md:grid-cols-2 gap-3">
				{TEXT.map((f) =>
					f.long ? (
						<div key={f.key} className="md:col-span-2">
							<TextArea
								label={f.label}
								value={draft[f.key]}
								onChange={set(f.key)}
							/>
						</div>
					) : (
						<TextField
							key={f.key}
							label={f.label}
							value={draft[f.key]}
							onChange={set(f.key)}
						/>
					),
				)}
			</div>
			{structured.map((k) => (
				<div key={k}>
					<h4 className="text-xs text-text-secondary mb-1">
						{k} (as read from the file)
					</h4>
					<pre className="text-xs bg-app-bg border border-border rounded p-2 overflow-auto max-h-48">
						{JSON.stringify(g[k], null, 2)}
					</pre>
				</div>
			))}
			{bad.length > 0 && (
				<p className="text-xs text-warning">
					{bad.join(", ")}: a whole number, or nothing.
				</p>
			)}
			<Button
				onClick={() => save.mutate()}
				disabled={!count || bad.length > 0 || save.isPending}
			>
				{save.isPending ? "Saving…" : "Save the generation details"}
			</Button>
			<Problem error={save.error} />
		</Card>
	);
}

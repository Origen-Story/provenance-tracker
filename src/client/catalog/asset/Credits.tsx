// Who made the asset, and for whom: one row per credit.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { assets, type AssetRecord, type Credit } from "../api.ts";
import { Button, Card, Problem, TextField } from "../ui.tsx";
import { useTakeAnswer } from "./shared.ts";

export default function Credits({
	projectId,
	asset,
}: {
	projectId: string;
	asset: AssetRecord;
}) {
	return (
		<Card className="space-y-3">
			{asset.credits.length === 0 && (
				<p className="text-sm text-text-secondary">No credits yet.</p>
			)}
			{asset.credits.map((c) => (
				<CreditRow
					key={c.id}
					projectId={projectId}
					assetId={asset.id}
					credit={c}
				/>
			))}
			<AddCredit projectId={projectId} assetId={asset.id} />
		</Card>
	);
}

function CreditRow({
	projectId,
	assetId,
	credit,
}: {
	projectId: string;
	assetId: number;
	credit: Credit;
}) {
	const take = useTakeAnswer(projectId, assetId);
	const [draft, setDraft] = useState({
		role: credit.role,
		name: credit.name,
		on_behalf_of: credit.on_behalf_of,
	});
	const changed = Object.fromEntries(
		Object.entries(draft).filter(
			([k, v]) => v !== credit[k as keyof typeof draft],
		),
	);
	const save = useMutation({
		mutationFn: () => assets.editCredit(projectId, assetId, credit.id, changed),
		onSuccess: take,
	});
	const remove = useMutation({
		mutationFn: () => assets.removeCredit(projectId, assetId, credit.id),
		onSuccess: take,
	});
	const set = (k: keyof typeof draft) => (v: string) =>
		setDraft((d) => ({ ...d, [k]: v }));
	return (
		<div className="border-b border-border pb-3 space-y-2">
			<div className="grid md:grid-cols-3 gap-2">
				<TextField label="Role" value={draft.role} onChange={set("role")} />
				<TextField label="Name" value={draft.name} onChange={set("name")} />
				<TextField
					label="On behalf of"
					value={draft.on_behalf_of}
					onChange={set("on_behalf_of")}
				/>
			</div>
			{credit.stated_by && (
				<p className="text-xs text-text-secondary">
					Stated by {credit.stated_by}
				</p>
			)}
			<div className="flex gap-2">
				<Button
					onClick={() => save.mutate()}
					disabled={!Object.keys(changed).length || save.isPending}
				>
					Save
				</Button>
				<Button
					quiet
					onClick={() => remove.mutate()}
					disabled={remove.isPending}
				>
					Remove this credit
				</Button>
			</div>
			<Problem error={save.error ?? remove.error} />
		</div>
	);
}

function AddCredit({
	projectId,
	assetId,
}: {
	projectId: string;
	assetId: number;
}) {
	const take = useTakeAnswer(projectId, assetId);
	const empty = { role: "", name: "", on_behalf_of: "" };
	const [draft, setDraft] = useState(empty);
	const add = useMutation({
		mutationFn: () => assets.addCredit(projectId, assetId, draft),
		onSuccess: (r) => {
			take(r);
			setDraft(empty);
		},
	});
	const set = (k: keyof typeof draft) => (v: string) => {
		setDraft((d) => ({ ...d, [k]: v }));
		add.reset();
	};
	return (
		<form
			className="space-y-2"
			onSubmit={(e) => {
				e.preventDefault();
				if (draft.name.trim()) add.mutate();
			}}
		>
			<h4 className="text-sm font-medium text-text-secondary">Add a credit</h4>
			<div className="grid md:grid-cols-3 gap-2">
				<TextField
					label="Role"
					value={draft.role}
					onChange={set("role")}
					placeholder="Photographer"
				/>
				<TextField label="Name" value={draft.name} onChange={set("name")} />
				<TextField
					label="On behalf of"
					value={draft.on_behalf_of}
					onChange={set("on_behalf_of")}
				/>
			</div>
			<Button type="submit" disabled={!draft.name.trim() || add.isPending}>
				Add
			</Button>
			<Problem error={add.error} />
		</form>
	);
}

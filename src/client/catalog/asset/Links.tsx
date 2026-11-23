// How this asset relates to others: what it was made with, enhanced copies,
// the edits that used it. Links a person makes or removes are recorded with
// their name; timeline imports and extract make the rest.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { assets, type AssetRecord } from "../api.ts";
import { LINK_LABEL, LINK_TYPES } from "../labels.ts";
import { Button, Card, Problem, Select, TextField } from "../ui.tsx";
import { assetKey } from "./shared.ts";

const METHOD: Record<string, string> = {
	manual: "linked by a person",
	timeline: "from a timeline",
	filename_pattern: "matched by file name",
};

export default function Links({
	projectId,
	asset,
}: {
	projectId: string;
	asset: AssetRecord;
}) {
	const qc = useQueryClient();
	const refresh = (other?: number) => {
		qc.invalidateQueries({ queryKey: assetKey(projectId, asset.id) });
		if (other) qc.invalidateQueries({ queryKey: assetKey(projectId, other) });
		qc.invalidateQueries({ queryKey: ["catalog", projectId, "assets"] });
	};
	const unlink = useMutation({
		mutationFn: (r: { id: number; other: number }) =>
			assets.unlink(projectId, r.id),
		onSuccess: (_d, r) => refresh(r.other),
	});
	return (
		<Card className="space-y-3">
			{asset.relationships.length === 0 && (
				<p className="text-sm text-text-secondary">
					Not linked to other assets.
				</p>
			)}
			{asset.relationships.length > 0 && (
				<ul className="divide-y divide-border text-sm">
					{asset.relationships.map((r) => (
						<li key={r.id} className="py-2 flex items-center gap-3">
							<span className="text-text-secondary w-44 shrink-0">
								{/* direction names the other asset's side; the label is this one's */}
								{LINK_LABEL[r.type]?.[
									r.direction === "parent" ? "child" : "parent"
								] ?? r.type}
							</span>
							<Link
								to={`../${r.otherAssetId}`}
								relative="path"
								className="text-accent hover:text-accent-hover truncate"
							>
								{r.otherTitle}
							</Link>
							<span
								className="text-xs text-text-secondary ml-auto shrink-0"
								title={r.note}
							>
								{METHOD[r.matchMethod] ?? r.matchMethod}
								{r.confidence < 1 &&
									` · ${Math.round(r.confidence * 100)}% sure`}
							</span>
							<Button
								quiet
								onClick={() =>
									unlink.mutate({ id: r.id, other: r.otherAssetId })
								}
								disabled={unlink.isPending}
							>
								Unlink
							</Button>
						</li>
					))}
				</ul>
			)}
			<Problem error={unlink.error} />
			<AddLink projectId={projectId} asset={asset} done={refresh} />
		</Card>
	);
}

function AddLink({
	projectId,
	asset,
	done,
}: {
	projectId: string;
	asset: AssetRecord;
	done: (other: number) => void;
}) {
	// "child" means this asset is the one made from the other.
	const [side, setSide] = useState<"child" | "parent">("child");
	const [type, setType] = useState("ingredient");
	const [words, setWords] = useState("");
	const [other, setOther] = useState<{ id: number; title: string } | null>(
		null,
	);
	const [note, setNote] = useState("");
	const found = useQuery({
		queryKey: ["catalog", projectId, "assets", { q: words, limit: 8 }],
		queryFn: () => assets.list(projectId, { q: words, limit: 8 }),
		enabled: words.trim().length >= 2 && !other,
	});
	const link = useMutation({
		mutationFn: () =>
			assets.link(projectId, {
				parent_id: side === "child" ? other!.id : asset.id,
				child_id: side === "child" ? asset.id : other!.id,
				type,
				note: note.trim(),
			}),
		onSuccess: () => {
			done(other!.id);
			setOther(null);
			setWords("");
			setNote("");
		},
	});
	const options = LINK_TYPES.map((t) => ({
		value: t,
		label: LINK_LABEL[t][side],
	}));
	return (
		<div className="border-t border-border pt-3 space-y-2">
			<h4 className="text-sm font-medium text-text-secondary">
				Link to another asset
			</h4>
			<div className="grid md:grid-cols-2 gap-2">
				<Select
					label="Which way"
					value={side}
					onChange={(v) => setSide(v as "child" | "parent")}
					options={[
						{ value: "child", label: "This asset was made from the other" },
						{ value: "parent", label: "The other was made from this asset" },
					]}
				/>
				<Select label="How" value={type} onChange={setType} options={options} />
			</div>
			{other ? (
				<p className="text-sm">
					The other asset:{" "}
					<span className="text-text-primary">{other.title}</span>{" "}
					<button
						type="button"
						className="text-xs text-accent ml-2"
						onClick={() => setOther(null)}
					>
						choose another
					</button>
				</p>
			) : (
				<div>
					<TextField
						label="Find the other asset"
						value={words}
						onChange={setWords}
						placeholder="Type part of its title or file name"
					/>
					{found.data && (
						<ul className="mt-1 border border-border rounded divide-y divide-border text-sm">
							{found.data.assets
								.filter((a) => a.id !== asset.id)
								.map((a) => (
									<li key={a.id}>
										<button
											type="button"
											className="w-full text-left px-3 py-1.5 hover:bg-card-hover"
											onClick={() =>
												setOther({ id: a.id, title: a.displayTitle })
											}
										>
											{a.displayTitle}
										</button>
									</li>
								))}
							{found.data.assets.length === 0 && (
								<li className="px-3 py-1.5 text-text-secondary">
									Nothing matches.
								</li>
							)}
						</ul>
					)}
				</div>
			)}
			<TextField label="Note (optional)" value={note} onChange={setNote} />
			<Button onClick={() => link.mutate()} disabled={!other || link.isPending}>
				Link
			</Button>
			<Problem error={link.error} />
		</div>
	);
}

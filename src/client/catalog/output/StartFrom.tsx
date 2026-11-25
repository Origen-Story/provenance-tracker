// A new export of a film starts from an earlier finished edit (D50): one copy
// of its public details, credits, statement and clip classes, so they are not
// typed again. Offered until the edit has a statement or has started from one.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { assets, type AssetRecord } from "../api.ts";
import { assetKey } from "../asset/shared.ts";
import { Button, Card, Problem, Select } from "../ui.tsx";

/** The earlier edit this one started from: the link's other side is its parent. */
export function startedFromLink(asset: AssetRecord) {
	return asset.relationships.find(
		(r) => r.type === "started_from" && r.direction === "parent",
	);
}

export default function StartFrom({
	projectId,
	asset,
}: {
	projectId: string;
	asset: AssetRecord;
}) {
	const qc = useQueryClient();
	const { data } = useQuery({
		queryKey: ["catalog", projectId, "assets", { outputs: true }],
		queryFn: () => assets.list(projectId, { outputs: true, limit: 200 }),
	});
	const earlier = (data?.assets ?? [])
		.filter((a) => a.id !== asset.id && !a.removedAt)
		.sort((a, b) => b.id - a.id);
	const [choice, setChoice] = useState("");
	const fromId = Number(choice || earlier[0]?.id || 0);
	const start = useMutation({
		mutationFn: () => assets.startFrom(projectId, asset.id, fromId),
		onSuccess: (answer) => {
			qc.setQueryData(assetKey(projectId, asset.id), answer.asset);
			qc.invalidateQueries({ queryKey: assetKey(projectId, asset.id) });
			qc.invalidateQueries({ queryKey: assetKey(projectId, fromId) });
			qc.invalidateQueries({ queryKey: ["catalog", projectId, "assets"] });
		},
	});
	if (earlier.length === 0) return null;
	return (
		<Card className="space-y-3">
			<div>
				<h2 className="text-sm font-medium text-text-primary">
					Start from an earlier edit
				</h2>
				<p className="text-sm text-text-secondary">
					A new export of the same film? Copy the earlier edit's public title,
					description, licence, credits, statement, thumbnail and the classes
					you gave its clips, once. Anything already filled in here is kept. The
					two edits stay separate afterwards.
				</p>
			</div>
			<div className="flex flex-wrap items-end gap-3">
				<div className="min-w-72">
					<Select
						label="Earlier edit"
						value={String(fromId)}
						onChange={setChoice}
						options={earlier.map((a) => ({
							value: String(a.id),
							label: `${a.displayTitle}${a.file ? ` (${a.file.path.split("/").pop()})` : ""}`,
						}))}
					/>
				</div>
				<Button
					onClick={() => start.mutate()}
					disabled={!fromId || start.isPending}
				>
					{start.isPending ? "Copying…" : "Copy its details"}
				</Button>
			</div>
			{start.error && <Problem error={start.error} />}
		</Card>
	);
}

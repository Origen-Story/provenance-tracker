// What the parts of the asset page share: the query key, and putting the
// API's answer to an edit in place so every part shows the same record.

import { useQueryClient } from "@tanstack/react-query";
import type { AssetRecord } from "../api.ts";

export const assetKey = (projectId: string, id: number) => [
	"catalog",
	projectId,
	"asset",
	id,
];

export function useTakeAnswer(projectId: string, id: number) {
	const qc = useQueryClient();
	return (answer: { asset: AssetRecord }) => {
		qc.setQueryData(assetKey(projectId, id), answer.asset);
		qc.invalidateQueries({ queryKey: ["catalog", projectId, "assets"] });
		qc.invalidateQueries({ queryKey: ["catalog", projectId, "summary"] });
	};
}

/** The fields whose draft differs from the record, as the API takes them. */
export function changedFields(
	record: Record<string, unknown>,
	draft: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(draft))
		if (JSON.stringify(v) !== JSON.stringify(record[k])) out[k] = v;
	return out;
}

export const str = (v: unknown) =>
	v === null || v === undefined ? "" : String(v);

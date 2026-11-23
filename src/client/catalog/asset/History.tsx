// Every change to the asset's own fields: who, when, from what to what, and why.

import type { AssetRecord } from "../api.ts";
import { Card, when } from "../ui.tsx";

const show = (v: unknown) => {
	if (v === null || v === undefined || v === "") return "—";
	const s = typeof v === "string" ? v : JSON.stringify(v);
	return s.length > 80 ? `${s.slice(0, 80)}…` : s;
};

export default function History({ asset }: { asset: AssetRecord }) {
	if (asset.history.length === 0)
		return (
			<Card>
				<p className="text-sm text-text-secondary">No changes recorded.</p>
			</Card>
		);
	return (
		<Card className="overflow-x-auto">
			<table className="w-full text-xs">
				<thead className="text-text-secondary text-left">
					<tr>
						<th className="py-1 pr-3 font-normal">When</th>
						<th className="py-1 pr-3 font-normal">Who</th>
						<th className="py-1 pr-3 font-normal">Field</th>
						<th className="py-1 pr-3 font-normal">From</th>
						<th className="py-1 pr-3 font-normal">To</th>
						<th className="py-1 font-normal">Why</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-border">
					{asset.history.map((h, i) => (
						<tr key={i} className="align-top">
							<td className="py-1 pr-3 whitespace-nowrap">{when(h.at)}</td>
							<td className="py-1 pr-3">
								{h.actor}
								{h.actorKind !== "person" && (
									<span className="text-text-secondary"> ({h.actorKind})</span>
								)}
							</td>
							<td className="py-1 pr-3 font-mono">{h.field}</td>
							<td className="py-1 pr-3 text-text-secondary">
								{show(h.oldValue)}
							</td>
							<td className="py-1 pr-3">{show(h.newValue)}</td>
							<td className="py-1 text-text-secondary">{h.note}</td>
						</tr>
					))}
				</tbody>
			</table>
		</Card>
	);
}

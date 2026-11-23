// What the output pages share: which file is the cut, its newest timeline,
// how a match is named, and picking an asset for a timeline's source.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { assets, type AssetRecord } from "../api.ts";
import { assetKey } from "../asset/shared.ts";
import { Button } from "../ui.tsx";

/** The output's own newest file (never a signed copy): what a timeline belongs to and what is signed. */
export function ownCut(asset: AssetRecord) {
	const own = asset.contents.filter((c) => !c.signedCopy);
	return own[own.length - 1] ?? null;
}

/** The newest timeline of the cut, as signing uses; and how many others the asset has. */
export function currentTimeline(asset: AssetRecord) {
	const cut = ownCut(asset);
	const forCut = asset.timelines.filter(
		(t) => cut && t.contentSha256 === cut.sha256,
	);
	return {
		current: forCut[forCut.length - 1] ?? null,
		others: asset.timelines.filter((t) => t !== forCut[forCut.length - 1]),
	};
}

/** Everything the output page shows hangs under the asset's key, so one refresh covers it. */
export const timelineKey = (
	projectId: string,
	id: number,
	timelineId: number,
) => [...assetKey(projectId, id), "timeline", timelineId];
export const previewKey = (projectId: string, id: number) => [
	...assetKey(projectId, id),
	"preview",
];

/** How a source was tied to an asset, strongest first. */
export const METHOD_LABEL: Record<string, string> = {
	path: "same file",
	hash: "identical copy",
	filename_size: "same name and size",
	filename: "same name only: check it",
	manual: "you picked it",
	unmatched: "no match",
	sequence: "nested sequence",
	generator: "title or generator",
};

export const METHOD_HELP: Record<string, string> = {
	path: "The timeline points at this exact file.",
	hash: "The file the timeline points at is byte for byte this asset's, though its path or name differs.",
	filename_size:
		"Same file name and size as this asset: very likely the same file.",
	filename: "Only the file name matches. Check this is the right asset.",
	manual: "Nothing in the files ties them; a person chose it.",
	unmatched:
		"No asset in the project matches. Pick one, or add the file and import it first.",
};

/** Seconds from frames, at the timeline's rate. */
export const secondsOf = (frames: number, fps: number | null) =>
	fps ? frames / fps : null;

/** Find an asset by its name or words and pick it. */
export function AssetPicker({
	projectId,
	onPick,
	onCancel,
	exclude,
}: {
	projectId: string;
	onPick: (id: number) => void;
	onCancel: () => void;
	/** The output itself, which is never its own source. */
	exclude?: number;
}) {
	const [q, setQ] = useState("");
	const found = useQuery({
		queryKey: ["catalog", projectId, "assets", "pick", q],
		queryFn: () => assets.list(projectId, { q, limit: 8 }),
		enabled: q.trim().length > 1,
	});
	const list = (found.data?.assets ?? []).filter((a) => a.id !== exclude);
	return (
		<div className="space-y-1 min-w-64">
			<div className="flex gap-2">
				<input
					autoFocus
					value={q}
					onChange={(e) => setQ(e.target.value)}
					placeholder="Search by name or words"
					className="flex-1 bg-app-bg border border-border rounded px-2 py-1 text-xs text-text-primary"
				/>
				<Button quiet onClick={onCancel}>
					Cancel
				</Button>
			</div>
			{q.trim().length > 1 && !found.isLoading && list.length === 0 && (
				<p className="text-xs text-text-secondary">Nothing matches.</p>
			)}
			<ul className="text-xs">
				{list.map((a) => (
					<li key={a.id}>
						<button
							type="button"
							onClick={() => onPick(a.id)}
							className="w-full text-left px-2 py-1 rounded hover:bg-card-hover text-text-primary"
							title={a.file ? `${a.file.root} / ${a.file.path}` : ""}
						>
							{a.displayTitle}
							{a.file && (
								<span className="text-text-secondary">
									{" "}
									· {a.file.root} / {a.file.path}
								</span>
							)}
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}

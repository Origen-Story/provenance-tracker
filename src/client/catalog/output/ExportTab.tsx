// The public export of a signed copy: the JSON file a public page shows.
// It is made from that signing's record, so it shows what is in that file,
// not the timeline as it is now.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { outputs, type AssetRecord } from "../api.ts";
import { assetKey } from "../asset/shared.ts";
import { bytes, SIGNED_STATUS } from "../labels.ts";
import { Card, Loading, Problem, when } from "../ui.tsx";
import { fmtClock } from "./strip.tsx";

export default function ExportTab({
	projectId,
	asset,
}: {
	projectId: string;
	asset: AssetRecord;
}) {
	const signed = asset.signatures
		.filter((s) => s.kind === "output")
		.slice()
		.reverse();
	const [chosen, setChosen] = useState<number | null>(null);
	const selected = chosen ?? signed[0]?.id ?? null;
	const e = useQuery({
		queryKey: [...assetKey(projectId, asset.id), "export", selected],
		queryFn: () => outputs.publicExport(projectId, selected!),
		enabled: selected != null,
		retry: false,
	});
	if (signed.length === 0)
		return (
			<Card>
				<p className="text-sm text-text-secondary">
					Sign the edit on the Signing tab first. The public export is made from
					a signed copy.
				</p>
			</Card>
		);
	const d = e.data;
	const untitled =
		d?.ingredients.filter((i) => i.title === i.fileName).length ?? 0;
	return (
		<div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6 items-start">
			<div className="space-y-3">
				<Card className="space-y-2 text-xs text-text-secondary">
					<p>
						A JSON file for the public viewer: the composition strip, the
						statement, the ingredients with their public titles, and how the
						signed copy read back. It holds file names but no paths.
					</p>
					<p>
						Publish the signed copy beside it: the export carries its SHA-256,
						so anyone can check the download.
					</p>
				</Card>
				{signed.map((s) => (
					<label
						key={s.id}
						className={`flex items-center gap-2 border rounded-lg p-2.5 cursor-pointer ${selected === s.id ? "border-accent bg-accent/5" : "border-border bg-card-bg"}`}
					>
						<input
							type="radio"
							name="export-signature"
							checked={selected === s.id}
							onChange={() => setChosen(s.id)}
						/>
						<span className="text-sm text-text-primary">v{s.version}</span>
						<span className="text-xs text-text-secondary">
							{SIGNED_STATUS[s.status] ?? s.status}
						</span>
						<span className="text-xs text-text-secondary ml-auto">
							{when(s.signedAt)}
						</span>
					</label>
				))}
			</div>
			<div>
				{e.isLoading && <Loading />}
				<Problem error={e.error} />
				{d && selected != null && (
					<Card className="space-y-3">
						<div className="flex flex-wrap items-center gap-2">
							<h4 className="font-medium text-text-primary">{d.film.title}</h4>
							{d.film.durationSeconds != null && (
								<span className="text-xs text-text-secondary">
									{fmtClock(d.film.durationSeconds)}
								</span>
							)}
							<a
								href={outputs.publicExportUrl(projectId, selected)}
								download
								className="ml-auto text-sm text-accent hover:text-accent-hover px-3 py-1.5 border border-accent/30 hover:border-accent rounded"
							>
								Download the export
							</a>
						</div>
						<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
							<dt className="text-text-secondary">Ingredients</dt>
							<dd className="text-text-primary">
								{d.ingredients.length}
								{untitled > 0 && (
									<span className="text-warning">
										{" "}
										· {untitled} without a public title (the page shows the file
										name)
									</span>
								)}
							</dd>
							<dt className="text-text-secondary">Timeline</dt>
							<dd className="text-text-primary">
								{d.composition.picture?.intervals.length ?? 0} picture and{" "}
								{d.composition.audio?.intervals.length ?? 0} sound sections
							</dd>
							<dt className="text-text-secondary">Statement</dt>
							<dd className="text-text-primary truncate">
								{d.statement.text ? (
									`${d.statement.text.slice(0, 90)}${d.statement.text.length > 90 ? "…" : ""}`
								) : (
									<span className="text-warning">empty</span>
								)}
							</dd>
							<dt className="text-text-secondary">Signed file</dt>
							<dd
								className="text-text-primary truncate"
								title={d.signedFile.sha256}
							>
								{d.signedFile.fileName} · {bytes(d.signedFile.bytes)} · SHA-256{" "}
								<span className="font-mono">
									{d.signedFile.sha256.slice(0, 12)}…
								</span>
							</dd>
							<dt className="text-text-secondary">Signature</dt>
							<dd className="text-text-primary">
								{d.signature.statusLabel}
								{d.signature.signer?.commonName
									? `, ${d.signature.signer.commonName}`
									: ""}
								{d.signature.timestamped
									? ", time-stamped"
									: ", no trusted time stamp"}
							</dd>
						</dl>
						{d.untracked.length > 0 && (
							<p className="text-xs text-warning">
								{d.untracked.length} clip{d.untracked.length === 1 ? "" : "s"}{" "}
								not tied to an asset. The page lists them by time only.
							</p>
						)}
						<details>
							<summary className="text-xs text-text-secondary cursor-pointer">
								Show the JSON
							</summary>
							<pre className="mt-2 text-[10px] leading-snug max-h-96 overflow-auto bg-app-bg rounded p-2">
								{JSON.stringify(d, null, 2)}
							</pre>
						</details>
					</Card>
				)}
			</div>
		</div>
	);
}

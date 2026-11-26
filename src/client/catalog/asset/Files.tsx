// The asset's files: each version of its bytes, where each is on this
// machine (or was), its technical values, and what each extractor read.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { assets, type AssetRecord, type Reading } from "../api.ts";
import { bytes } from "../labels.ts";
import { Card, Problem, when } from "../ui.tsx";

const TECHNICAL: Record<string, string> = {
	mime_type: "Type",
	duration_seconds: "Length (s)",
	width: "Width",
	height: "Height",
	frame_rate: "Frame rate",
	video_codec: "Video codec",
	audio_codec: "Audio codec",
	sample_rate: "Sample rate",
	channels: "Channels",
	bits_per_sample: "Bits per sample",
};

const shown = (v: unknown) => v !== null && v !== undefined && v !== "";

export default function Files({
	projectId,
	asset,
}: {
	projectId: string;
	asset: AssetRecord;
}) {
	if (asset.contents.length === 0)
		return (
			<Card>
				<p className="text-sm text-text-secondary">No files recorded.</p>
			</Card>
		);
	return (
		<div className="space-y-3">
			{asset.contents.map((c, i) => (
				<Card key={c.sha256} className="space-y-3 text-sm">
					<div className="flex flex-wrap items-baseline gap-x-3">
						<span className="font-medium text-text-primary">
							{c.signedCopy
								? "Signed copy"
								: i === 0
									? "Current version"
									: "Earlier version"}
						</span>
						<span className="text-xs text-text-secondary">
							{bytes(c.size)} · first seen {when(c.createdAt)}
						</span>
						<code className="text-xs text-text-secondary" title={c.sha256}>
							SHA-256 {c.sha256.slice(0, 12)}…
						</code>
					</div>
					<ul className="text-xs space-y-0.5">
						{c.places.map((p) => (
							<li
								key={`${p.root}/${p.path}`}
								className={p.live ? "text-text-primary" : "text-text-secondary"}
							>
								{p.root} / {p.path}
								{!p.live && " (no longer there)"}
							</li>
						))}
					</ul>
					{c.technical && (
						<dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-xs">
							{Object.entries(TECHNICAL)
								.filter(([k]) => shown(c.technical![k]))
								.map(([k, label]) => (
									<div key={k}>
										<dt className="text-text-secondary">{label}</dt>
										<dd className="text-text-primary">
											{String(c.technical![k])}
										</dd>
									</div>
								))}
						</dl>
					)}
					{c.readings.length > 0 && (
						<div>
							<h4 className="text-xs text-text-secondary mb-1">
								What was read from it
							</h4>
							<ul className="space-y-1">
								{c.readings.map((r) => (
									<ReadingRow key={r.id} projectId={projectId} reading={r} />
								))}
							</ul>
						</div>
					)}
				</Card>
			))}
		</div>
	);
}

/**
 * What a reading of the file's Content Credentials comes to (D67): who they
 * name, whether that verified, and if not, why, in the reader's own words.
 * A name from credentials that did not verify is shown as what the file
 * says, never as who signed it.
 */
function Credentials({ read }: { read: NonNullable<Reading["credentials"]> }) {
	const sound =
		read.verdict === "valid" || read.verdict === "unrecognised_issuer";
	const who = [
		read.signer,
		read.issuer && read.issuer !== read.signer ? `(${read.issuer})` : "",
	]
		.filter(Boolean)
		.join(" ");
	return (
		<div className="ml-4 mt-0.5 space-y-0.5">
			<p className={sound ? "text-text-secondary" : "text-warning"}>
				{sound
					? `Signed by ${who || "an unnamed signer"}: ${read.label.toLowerCase()}.`
					: `Its credentials name ${who || "no signer"}, and they did not verify: ${read.label.toLowerCase()}. A signed film and its public page give the name as unverified, never as who signed.`}
				{read.generator && ` Made with ${read.generator}.`}
				{read.contentMatches &&
					!sound &&
					" The file is still the one that was signed."}
			</p>
			{!sound &&
				read.failures.map((f) => (
					<p key={f.code} className="text-text-secondary">
						{f.code}
						{f.explanation && `: ${f.explanation}`}
					</p>
				))}
		</div>
	);
}

function ReadingRow({
	projectId,
	reading,
}: {
	projectId: string;
	reading: Reading;
}) {
	const [open, setOpen] = useState(false);
	const full = useQuery({
		queryKey: ["catalog", projectId, "reading", reading.id],
		queryFn: () => assets.reading(projectId, reading.id),
		enabled: open,
	});
	const odd = reading.status !== "ok" && reading.status !== "absent";
	return (
		<li className="text-xs">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="text-left text-text-secondary hover:text-text-primary"
			>
				{open ? "▾" : "▸"}{" "}
				<span className="text-text-primary">{reading.kind}</span> by{" "}
				{reading.extractor} {reading.version} ·{" "}
				<span className={odd ? "text-warning" : ""}>{reading.status}</span>
				{reading.fromSidecar && " · from a sidecar"} ·{" "}
				{when(reading.observedAt)}
			</button>
			{reading.credentials && <Credentials read={reading.credentials} />}
			{open && (
				<div className="mt-1 ml-4">
					<Problem error={full.error} />
					{full.data && (
						<pre className="bg-app-bg border border-border rounded p-2 overflow-auto max-h-80">
							{JSON.stringify(
								{
									data: full.data.data,
									error: full.data.error ?? undefined,
									warnings: full.data.warnings.length
										? full.data.warnings
										: undefined,
									validation: full.data.validation ?? undefined,
								},
								null,
								2,
							)}
						</pre>
					)}
				</div>
			)}
		</li>
	);
}

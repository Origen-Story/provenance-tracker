// Signing a source asset (D42): its Content Credentials go to a small .c2pa
// sidecar beside the file, named like it; the file itself is not touched.
// Signing again keeps the previous sidecar as name.vN.c2pa. The manifest
// says how the file was made from the asset's origin class, so that comes
// first.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { projects, type AssetRecord } from "../api.ts";
import { engineLabel, IDENTITY_STATUS, SIGNED_STATUS } from "../labels.ts";
import { Interrupted, useSignJob, useSigning } from "../output/SigningTab.tsx";
import { Button, Card, Checkbox, Problem, TextField, when } from "../ui.tsx";
import { str } from "./shared.ts";

export default function SignSidecar({
	projectId,
	asset,
}: {
	projectId: string;
	asset: AssetRecord;
}) {
	const f = asset.fields;
	const [open, setOpen] = useState(false);
	const [creator, setCreator] = useState("");
	const [organization, setOrganization] = useState("");
	// A generated asset was made with its platform and model, as recorded.
	const g = asset.generation;
	const [tool, setTool] = useState(
		g
			? [str(g.platform), str(g.model_name), str(g.model_version)]
					.filter(Boolean)
					.join(" ")
			: "",
	);
	const [ai, setAi] = useState(str(f.kind) === "generated");
	const [optOut, setOptOut] = useState(true);
	const [timestamp, setTimestamp] = useState(true);
	const signing = useSigning(projectId);
	// The project's own creator and organization (its settings) fill in the form.
	const summary = useQuery({
		queryKey: ["catalog", projectId, "summary"],
		queryFn: () => projects.summary(projectId),
	});
	const { start, job, busy, interrupted } = useSignJob(projectId, asset.id);
	const sidecars = asset.signatures.filter((s) => s.kind === "asset");
	const running = job?.state === "running";
	const problem = signing.data?.problem ?? null;
	const confirmed = !!f.origin_class_confirmed;
	return (
		<Card className="space-y-3">
			{sidecars.length > 0 && (
				<ul className="text-xs text-text-secondary space-y-0.5">
					{sidecars
						.slice()
						.reverse()
						.map((s) => (
							<li key={s.id}>
								Sidecar v{s.version} by {s.signerName || "an unnamed signer"}{" "}
								with {engineLabel(s.engine, s.engineVersion)},{" "}
								{when(s.signedAt)} · {SIGNED_STATUS[s.status] ?? s.status}
								{s.timestamped && " · time-stamped"}
								{s.identity &&
									` · identity of ${s.identity.name} (${IDENTITY_STATUS[s.identity.status] ?? s.identity.status})`}
							</li>
						))}
				</ul>
			)}
			{!open ? (
				<div className="flex items-center gap-3">
					<Button
						onClick={() => {
							const d = summary.data?.settings;
							if (d && !creator) setCreator(d.author ?? "");
							if (d && !organization) setOrganization(d.organization ?? "");
							setOpen(true);
						}}
					>
						{sidecars.length ? "Sign it again…" : "Sign this file…"}
					</Button>
					<span className="text-xs text-text-secondary">
						Writes a .c2pa sidecar beside the file; the file itself is not
						touched.
					</span>
				</div>
			) : (
				<form
					className="space-y-3"
					onSubmit={(e) => {
						e.preventDefault();
						start.mutate({
							creator_name: creator.trim(),
							organization: organization.trim(),
							tool_used: tool.trim(),
							is_ai_generated: ai,
							training_mining_opt_out: optOut,
							timestamp,
						});
					}}
				>
					<p className="text-xs text-text-secondary">
						The credentials say how the file was made from its origin class
						{confirmed
							? "."
							: ", which is only proposed so far: confirm it above first."}{" "}
						Signing again keeps the earlier sidecar as <code>.vN.c2pa</code>.
					</p>
					<div className="grid md:grid-cols-2 gap-3">
						<TextField
							label="Who made it"
							value={creator}
							onChange={setCreator}
						/>
						<TextField
							label="Organisation (optional)"
							value={organization}
							onChange={setOrganization}
						/>
						<TextField
							label="Tool used (optional)"
							value={tool}
							onChange={setTool}
							placeholder="Adobe Audition 25, a generator's name"
						/>
					</div>
					<Checkbox
						label="Made by AI"
						checked={ai}
						onChange={setAi}
						hint="Says so in the credentials whatever the origin class."
					/>
					<Checkbox
						label="Opt out of AI training and data mining"
						checked={optOut}
						onChange={setOptOut}
					/>
					<Checkbox
						label="Add a trusted time stamp"
						checked={timestamp}
						onChange={setTimestamp}
						hint="Sends a hash of the credentials, not the file, to DigiCert's time-stamp server."
					/>
					{problem && (
						<p className="text-xs text-warning">
							{problem}. Set it up on a finished edit's Signing tab (
							<Link
								to={`/catalog/${projectId}/outputs`}
								className="text-accent hover:underline"
							>
								Outputs
							</Link>
							).
						</p>
					)}
					<div className="flex gap-2">
						<Button
							type="submit"
							disabled={
								!creator.trim() ||
								!!problem ||
								start.isPending ||
								running ||
								!!busy
							}
						>
							{running ? "Signing…" : "Sign"}
						</Button>
						<Button quiet onClick={() => setOpen(false)}>
							Cancel
						</Button>
					</div>
					<Problem error={start.error} />
					{job?.state === "failed" && <Problem error={job.error} />}
					{interrupted && <Interrupted />}
					{job?.state === "done" && (
						<p className="text-sm text-accent">
							Signed: the sidecar is listed above.
						</p>
					)}
				</form>
			)}
		</Card>
	);
}

// Signing a finished edit: the certificate this machine signs the project
// with, signing a new copy (a job: c2patool reads the film and each source),
// and the signed copies so far.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fileUrl, outputs, projects, type AssetRecord } from "../api.ts";
import { SIGNED_STATUS, engineLabel, IDENTITY_STATUS } from "../labels.ts";
import { jobsKey, useJobs } from "../media/Jobs.tsx";
import {
	Button,
	Card,
	Checkbox,
	Problem,
	Section,
	Status,
	TextField,
	when,
} from "../ui.tsx";
import { previewKey } from "./shared.tsx";
import Thumbnail from "./Thumbnail.tsx";
import Reveals, {
	revealedAgain,
	startingChoice,
	type WithholdChoice,
} from "./Reveals.tsx";

export const signingKey = (projectId: string) => [
	"catalog",
	projectId,
	"signing",
];

export function useSigning(projectId: string) {
	return useQuery({
		queryKey: signingKey(projectId),
		queryFn: () => outputs.signing(projectId),
	});
}

export default function SigningTab({
	projectId,
	asset,
}: {
	projectId: string;
	asset: AssetRecord;
}) {
	return (
		<div className="max-w-4xl space-y-8">
			<Section title="Sign this edit">
				<SignOutput projectId={projectId} asset={asset} />
			</Section>
			<Section title="What verifiers show">
				<Thumbnail projectId={projectId} asset={asset} />
			</Section>
			<Section title="Signed copies">
				<SignedCopies projectId={projectId} asset={asset} />
			</Section>
			<Section title="What signs this project on this machine">
				<SigningSetUp projectId={projectId} />
			</Section>
		</div>
	);
}

/** Start signing, and follow it while it runs. Shared with a source asset's sidecar. */
export function useSignJob(projectId: string, assetId: number) {
	const qc = useQueryClient();
	const jobs = useJobs(projectId);
	const [jobId, setJobId] = useState<string | null>(null);
	const [startedAt, setStartedAt] = useState(0);
	const start = useMutation({
		mutationFn: (fields: Record<string, unknown>) =>
			outputs.sign(projectId, assetId, fields),
		onSuccess: (r) => {
			setJobId(r.job.id);
			setStartedAt(Date.now());
			qc.invalidateQueries({ queryKey: jobsKey(projectId) });
		},
	});
	const job = jobs.data?.jobs.find((j) => j.id === jobId) ?? null;
	const busy = jobs.data?.jobs.find((j) => j.state === "running") ?? null;
	// The server keeps its jobs in memory: if it restarted, a list fetched
	// after this job started no longer has it, and nothing will finish it.
	const interrupted =
		jobId !== null && job === null && jobs.dataUpdatedAt > startedAt;
	return { start, job, busy, interrupted };
}

/** What to say when a signing job vanished with a server restart. */
export function Interrupted() {
	return (
		<p className="text-sm text-warning">
			The signing was interrupted: the tracker's server restarted while it ran,
			so no signed copy was recorded. Sign again.
		</p>
	);
}

function SignOutput({
	projectId,
	asset,
}: {
	projectId: string;
	asset: AssetRecord;
}) {
	const [timestamp, setTimestamp] = useState(true);
	const signing = useSigning(projectId);
	const preview = useQuery({
		queryKey: previewKey(projectId, asset.id),
		queryFn: () => outputs.preview(projectId, asset.id),
	});
	// What to keep out of the signed film (D62): starts from the last signing.
	const [choice, setChoice] = useState<WithholdChoice | null>(null);
	const reveals = preview.data?.reveals ?? [];
	const last = preview.data?.lastWithheld ?? null;
	const chosen = choice ?? startingChoice(reveals, last);
	const again = revealedAgain(chosen, last, reveals);
	const withholding = chosen.redact.size + chosen.leaveOut.size > 0;
	const { start, job, busy, interrupted } = useSignJob(projectId, asset.id);
	const next =
		Math.max(
			0,
			...asset.signatures
				.filter((s) => s.kind === "output")
				.map((s) => s.version),
		) + 1;
	const blockers = [
		...(signing.data && signing.data.problem ? [signing.data.problem] : []),
		...(preview.data?.blockers ?? []),
	];
	const running = job?.state === "running";
	return (
		<Card className="space-y-3">
			<p className="text-sm text-text-secondary">
				Writes a new file beside the cut, <code>…signed.v{next}</code>, with
				Content Credentials: the cut as parent, each asset the timeline uses
				placed as an ingredient with its class and when it plays, the thumbnail
				picked below, and the saved statement. The cut itself is not changed.
				Ingredients that carry credentials of their own keep them inside the new
				file.
			</p>
			{preview.data?.statement && (
				<details
					className="border border-border rounded-lg p-3"
					open={reveals.some((r) => r.reveal.items.length > 0)}
				>
					<summary className="text-sm text-text-primary cursor-pointer">
						What the signed film will reveal
						{withholding &&
							` · keeping ${chosen.redact.size + chosen.leaveOut.size} out`}
					</summary>
					<div className="mt-3">
						<Reveals
							statement={preview.data.statement}
							identityName={preview.data.identity?.name ?? null}
							signerName={signing.data?.certificate?.commonName ?? null}
							reveals={reveals}
							choice={chosen}
							onChange={setChoice}
							disabled={running}
						/>
					</div>
				</details>
			)}
			{again.length > 0 && (
				<p className="text-xs text-warning">
					The last signed copy kept out {again.join("; ")}. This one would
					reveal {again.length === 1 ? "it" : "them"}.
				</p>
			)}
			<Checkbox
				label="Add a trusted time stamp"
				checked={timestamp}
				onChange={setTimestamp}
				hint="Sends a hash of the credentials, not the film, to DigiCert's time-stamp server."
			/>
			{blockers.length > 0 && (
				<div className="text-xs text-warning space-y-0.5">
					{blockers.map((b) => (
						<p key={b}>{b}</p>
					))}
				</div>
			)}
			<div className="flex items-center gap-3">
				<Button
					onClick={() =>
						start.mutate({
							timestamp,
							withhold: {
								redact: [...chosen.redact],
								leave_out: [...chosen.leaveOut],
							},
						})
					}
					disabled={blockers.length > 0 || start.isPending || running || !!busy}
				>
					{running ? "Signing…" : `Sign a new copy (v${next})`}
				</Button>
				{busy && !running && (
					<span className="text-xs text-text-secondary">
						Waiting for other work to finish.
					</span>
				)}
			</div>
			<Problem error={start.error} />
			{job?.state === "failed" && <Problem error={job.error} />}
			{interrupted && <Interrupted />}
			{job?.state === "done" && (
				<p className="text-sm text-accent">
					Signed. The new copy is listed below.
				</p>
			)}
		</Card>
	);
}

function SignedCopies({
	projectId,
	asset,
}: {
	projectId: string;
	asset: AssetRecord;
}) {
	const summary = useQuery({
		queryKey: ["catalog", projectId, "summary"],
		queryFn: () => projects.summary(projectId),
	});
	const folders = new Map(
		(summary.data?.roots ?? []).map((r) => [r.name, r.folder]),
	);
	const signed = asset.signatures
		.filter((s) => s.kind === "output")
		.slice()
		.reverse();
	if (signed.length === 0)
		return (
			<Card>
				<p className="text-sm text-text-secondary">Not signed yet.</p>
			</Card>
		);
	return (
		<div className="space-y-2">
			{signed.map((s) => {
				const content = asset.contents.find((c) => c.sha256 === s.signedSha256);
				const place =
					content?.places.find((p) => p.live) ?? content?.places[0] ?? null;
				const folder = place ? folders.get(place.root) : null;
				const full = place && folder ? joinPath(folder, place.path) : null;
				const ok = s.status === "valid" || s.status === "unrecognised_issuer";
				return (
					<Card key={s.id} className="space-y-1.5">
						<div className="flex flex-wrap items-center gap-2">
							<span className="text-sm font-medium text-text-primary">
								v{s.version}
							</span>
							<span className="text-sm text-text-primary truncate">
								{place ? `${place.root} / ${place.path}` : "file not found"}
							</span>
							<Status ok={ok}>
								{SIGNED_STATUS[s.status] ?? (s.status || "not read back")}
							</Status>
							<span className="ml-auto text-xs text-text-secondary">
								{when(s.signedAt)}
							</span>
						</div>
						<p className="text-xs text-text-secondary">
							Signed by {s.signerName || "an unnamed signer"} with{" "}
							{engineLabel(s.engine, s.engineVersion)}
							{s.timestamped ? ", time-stamped" : ", no trusted time stamp"}
							{s.identity &&
								`, with the identity of ${s.identity.name} (${IDENTITY_STATUS[s.identity.status] ?? s.identity.status})`}
							{place &&
								!place.live &&
								". The file is not where it was last seen"}
						</p>
						<div className="flex flex-wrap gap-3 text-xs">
							{place?.live && (
								<a
									href={fileUrl(projectId, s.signedSha256)}
									// Its own name; a bare download attribute saves it as "file".
									download={place.path.split("/").pop()}
									className="text-accent hover:underline"
								>
									Download the signed copy
								</a>
							)}
						</div>
						{full && (
							<p className="text-xs text-text-secondary break-all">
								Check it yourself, from the tracker's folder:{" "}
								<code className="bg-border/40 px-1 rounded select-all">
									tools\c2patool\c2patool.exe "{full}"
								</code>
							</p>
						)}
					</Card>
				);
			})}
		</div>
	);
}

/** A root's folder and a catalog path (always /), in the folder's own style. */
function joinPath(folder: string, rel: string) {
	const sep = folder.includes("\\") ? "\\" : "/";
	return `${folder.replace(/[\\/]+$/, "")}${sep}${rel.split("/").join(sep)}`;
}

/** The two key pairs a project has on this machine, and how each is spoken of. */
const PAIRS = {
	signing: {
		get: outputs.signing,
		set: outputs.setSigning,
		clear: outputs.clearSigning,
		key: signingKey,
		notSet: "not set up",
		certificateHint: "Its full path. A PEM file with the certificate chain.",
		forget:
			"Forget the certificate and key for this project on this machine? The files are not touched.",
		about: "",
	},
	identity: {
		get: outputs.identity,
		set: outputs.setIdentity,
		clear: outputs.clearIdentity,
		key: (projectId: string) => ["catalog", projectId, "identity"],
		notSet: "none: files are signed without one",
		certificateHint:
			"Its full path. A PEM file: an identity certificate issued to you, not the one that signs.",
		forget:
			"Forget your identity for this project on this machine? Files are then signed without it. The files are not touched.",
		about:
			'Says who the creator is in every file signed here (a CAWG identity), signed with its own certificate, apart from the certificate that signs. For trying it out: npm run cert:generate -- --name "Your Name" <folder> makes a test one.',
	},
} as const;

export function SigningSetUp({
	projectId,
	pair = "signing",
}: {
	projectId: string;
	/** Which pair: what signs (D41), or the creator's identity (D55). */
	pair?: keyof typeof PAIRS;
}) {
	const qc = useQueryClient();
	const words = PAIRS[pair];
	const status = useQuery({
		queryKey: words.key(projectId),
		queryFn: () => words.get(projectId),
	});
	const [certificate, setCertificate] = useState("");
	const [key, setKey] = useState("");
	const [editing, setEditing] = useState(false);
	const take = (s: Awaited<ReturnType<typeof outputs.signing>>) => {
		qc.setQueryData(words.key(projectId), s);
		qc.invalidateQueries({ queryKey: ["catalog", projectId, "asset"] });
		setEditing(false);
		setCertificate("");
		setKey("");
	};
	const save = useMutation({
		mutationFn: () => words.set(projectId, certificate.trim(), key.trim()),
		onSuccess: take,
	});
	const forget = useMutation({
		mutationFn: () => words.clear(projectId),
		onSuccess: take,
	});
	const s = status.data;
	const c = s?.certificate;
	return (
		<Card className="space-y-3">
			<Problem error={status.error} />
			{s && (
				<div className="space-y-1 text-sm">
					<div className="flex items-center gap-2">
						<Status ok={s.configured && !s.problem}>
							{!s.configured
								? words.notSet
								: s.problem
									? "needs attention"
									: "ready"}
						</Status>
						{s.problem && (
							<span className="text-warning text-xs">{s.problem}</span>
						)}
					</div>
					{c && (
						<p className="text-xs text-text-secondary">
							Certificate for{" "}
							<span className="text-text-primary">{c.commonName}</span>, issued
							by {c.issuer}, valid until {c.validTo.slice(0, 10)}. Fingerprint{" "}
							<span className="font-mono">{c.fingerprint.slice(0, 16)}…</span>
						</p>
					)}
					{words.about && (
						<p className="text-xs text-text-secondary">{words.about}</p>
					)}
					<p className="text-xs text-text-secondary">
						Kept in this machine's settings, never in the project: a copy of the
						project elsewhere is set up there. The files' paths are not shown
						again.
					</p>
				</div>
			)}
			{editing || (s && !s.configured && pair === "signing") ? (
				<form
					className="space-y-3"
					onSubmit={(e) => {
						e.preventDefault();
						if (certificate.trim() && key.trim()) save.mutate();
					}}
				>
					<div className="grid md:grid-cols-2 gap-3">
						<TextField
							label="Certificate file"
							value={certificate}
							onChange={setCertificate}
							placeholder="C:\Certificates\signer.pem"
							hint={words.certificateHint}
						/>
						<TextField
							label="Private key file"
							value={key}
							onChange={setKey}
							placeholder="C:\Certificates\signer.key"
							hint="Its full path. Read only when signing; never sent back."
						/>
					</div>
					<div className="flex gap-2">
						<Button
							type="submit"
							disabled={!certificate.trim() || !key.trim() || save.isPending}
						>
							{save.isPending ? "Checking…" : "Use these files"}
						</Button>
						{editing && (
							<Button quiet onClick={() => setEditing(false)}>
								Cancel
							</Button>
						)}
					</div>
					<Problem error={save.error} />
				</form>
			) : s && !s.configured ? (
				// Only the identity gets here unset: it is optional.
				<Button quiet onClick={() => setEditing(true)}>
					Set up your identity…
				</Button>
			) : (
				s?.configured && (
					<div className="flex gap-2">
						<Button quiet onClick={() => setEditing(true)}>
							Use other files
						</Button>
						<Button
							quiet
							disabled={forget.isPending}
							onClick={() => {
								if (confirm(words.forget)) forget.mutate();
							}}
						>
							Forget them here
						</Button>
					</div>
				)
			)}
			<Problem error={forget.error} />
		</Card>
	);
}

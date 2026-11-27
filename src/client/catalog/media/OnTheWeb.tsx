// Files in this project that keep their Content Credentials on the web and
// were not fetched (D74). Shown on the Media page once a read has met one:
// the first time, it explains what a fetch reveals and offers the three
// modes; after that, one question per host not on the list, never per file.
// A choice that lets files be fetched reads them, when no other work runs.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { media, projects, type WaitingHost } from "../api.ts";
import { Button, Card, Problem } from "../ui.tsx";
import { ModeChoice, useWebCredentialChanges } from "../WebCredentials.tsx";
import {
	WHAT_A_FETCH_REVEALS,
	filesWord,
	hasNotice,
	hostName,
	noticeOf,
} from "../web-credentials.ts";
import { jobsKey, useJobs } from "./Jobs.tsx";

export const onTheWebKey = (projectId: string) => [
	"catalog",
	projectId,
	"credentials-on-the-web",
];

const list = (hosts: WaitingHost[]): string =>
	hosts.map((w) => `${filesWord(w.files)} at ${hostName(w)}`).join(", ");

export function OnTheWeb({ projectId }: { projectId: string }) {
	const qc = useQueryClient();
	const { data, error } = useQuery({
		queryKey: onTheWebKey(projectId),
		queryFn: () => projects.credentialsOnTheWeb(projectId),
	});
	const jobs = useJobs(projectId);
	const working = jobs.data?.jobs.some((j) => j.state === "running") ?? false;
	const read = useMutation({
		mutationFn: () => media.start(projectId, "extract"),
		onSuccess: () => qc.invalidateQueries({ queryKey: jobsKey(projectId) }),
	});
	const { setMode, decide } = useWebCredentialChanges();
	// After a choice, read what it lets this machine fetch, unless work is
	// running: the button below stays for that.
	const thenRead = async () => {
		const now = await qc.fetchQuery({
			queryKey: onTheWebKey(projectId),
			queryFn: () => projects.credentialsOnTheWeb(projectId),
			staleTime: 0,
		});
		if (!working && now.waiting.some((w) => w.state === "read")) read.mutate();
	};
	if (error) return <Problem error={error} />;
	if (!data) return null;
	const notice = noticeOf(data.waiting);
	if (!hasNotice(notice)) return null;
	const busy = setMode.isPending || decide.isPending || read.isPending;
	return (
		<Card className="space-y-4 border-warning/40">
			<h4 className="text-sm text-text-primary">
				Content Credentials kept on the web
			</h4>
			{notice.choose.length > 0 && (
				<div className="space-y-3">
					<p className="text-sm text-text-primary">
						{list(notice.choose)}{" "}
						{notice.choose.reduce((n, w) => n + w.files, 0) === 1
							? "carries"
							: "carry"}{" "}
						only a web address for their Content Credentials. Nothing has been
						fetched.
					</p>
					<p className="text-xs text-text-secondary">
						{WHAT_A_FETCH_REVEALS} Choose once what this machine does; it holds
						for every project here, and you can change it on the{" "}
						<Link to="/catalog" className="text-accent hover:underline">
							Projects page
						</Link>
						.
					</p>
					<ModeChoice
						current={data.credentialsOnTheWeb.mode}
						onChoose={(m) => setMode.mutate(m, { onSuccess: thenRead })}
						busy={busy}
					/>
				</div>
			)}
			{notice.ask.map((w) => (
				<div key={hostName(w)} className="space-y-2">
					<p className="text-sm text-text-primary">
						{filesWord(w.files)} {w.files === 1 ? "names" : "name"}{" "}
						<strong>{hostName(w)}</strong>, which is not on this machine's list.
						Not fetched.
					</p>
					<p className="text-xs text-text-secondary">{WHAT_A_FETCH_REVEALS}</p>
					<div className="flex gap-3">
						<Button
							disabled={busy}
							onClick={() =>
								decide.mutate(
									{ host: w.host!, decision: "allow" },
									{ onSuccess: thenRead },
								)
							}
						>
							Allow {w.host}
						</Button>
						<Button
							quiet
							disabled={busy}
							onClick={() =>
								decide.mutate({ host: w.host!, decision: "leave" })
							}
						>
							Leave it
						</Button>
					</div>
				</div>
			))}
			{notice.read.length > 0 && (
				<div className="space-y-2">
					<p className="text-sm text-text-primary">
						{list(notice.read)}: this machine fetches from{" "}
						{notice.read.length === 1 ? "that host" : "those hosts"} now.
						{notice.read.some((w) => w.outcome === "failed") &&
							` The last try failed (${notice.read.find((w) => w.outcome === "failed")?.detail ?? "the request failed"}).`}
					</p>
					<Button disabled={busy || working} onClick={() => read.mutate()}>
						{working ? "Other work is running…" : "Read them now"}
					</Button>
				</div>
			)}
			{notice.told.length > 0 && (
				<ul className="text-xs text-text-secondary space-y-1">
					{notice.told.map(({ host, why }) => (
						<li key={hostName(host)}>
							{filesWord(host.files)} at {hostName(host)}: not fetched, because{" "}
							{why}.
						</li>
					))}
				</ul>
			)}
			<Problem error={setMode.error ?? decide.error ?? read.error} />
		</Card>
	);
}

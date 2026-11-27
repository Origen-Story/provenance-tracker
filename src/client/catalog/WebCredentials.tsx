// What this machine does about Content Credentials a file keeps on the web
// (D74): never fetch them, fetch them from hosts on a list, or from any host.
// This machine's setting, not a project's, so it sits on the Projects page
// beside the person's name. The Media page asks the same question the first
// time a project meets such a file (media/OnTheWeb.tsx).

import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { machine, type WebCredentialMode, type WebCredentials } from "./api.ts";
import { machineKey, useMachine } from "./Person.tsx";
import { Button, Card, Problem, TextField } from "./ui.tsx";
import {
	MODES,
	WHAT_A_FETCH_REVEALS,
	hostsInForce,
	modeSentence,
} from "./web-credentials.ts";

/** Keep every page's picture of this machine, and of what projects wait on, current. */
export function useWebCredentialChanges() {
	const qc = useQueryClient();
	const changed = (r: { credentialsOnTheWeb: WebCredentials }) => {
		qc.setQueryData(machineKey, (old: { person: string | null } | undefined) =>
			old ? { ...old, credentialsOnTheWeb: r.credentialsOnTheWeb } : old,
		);
		return qc.invalidateQueries({
			predicate: (q) => q.queryKey.at(-1) === "credentials-on-the-web",
		});
	};
	const setMode = useMutation({
		mutationFn: (mode: WebCredentialMode) => machine.setWebCredentialMode(mode),
		onSuccess: changed,
	});
	const decide = useMutation({
		mutationFn: (v: { host: string; decision: "allow" | "leave" | "forget" }) =>
			machine.decideHost(v.host, v.decision),
		onSuccess: changed,
	});
	return { setMode, decide };
}

/** The three modes, as buttons that say what each does. */
export function ModeChoice({
	current,
	onChoose,
	busy,
}: {
	current: WebCredentialMode | null;
	onChoose: (mode: WebCredentialMode) => void;
	busy: boolean;
}) {
	return (
		<ul className="space-y-2">
			{MODES.map((m) => (
				<li key={m.mode} className="flex items-start gap-3">
					<div className="w-56 shrink-0">
						<Button
							onClick={() => onChoose(m.mode)}
							disabled={busy || current === m.mode}
							quiet={!m.recommended}
						>
							{m.label}
						</Button>
					</div>
					<p className="text-xs text-text-secondary pt-1.5">
						{current === m.mode && (
							<span className="text-accent">Chosen. </span>
						)}
						{m.recommended && current !== m.mode && (
							<span className="text-text-primary">Recommended. </span>
						)}
						{m.hint}
					</p>
				</li>
			))}
		</ul>
	);
}

export default function WebCredentialsForm() {
	const current = useMachine();
	const { setMode, decide } = useWebCredentialChanges();
	const [host, setHost] = useState("");
	const c = current.data?.credentialsOnTheWeb;
	if (!c) return <Problem error={current.error} />;
	const add = (e: FormEvent) => {
		e.preventDefault();
		if (!host.trim()) return;
		decide.mutate(
			{ host: host.trim(), decision: "allow" },
			{ onSuccess: () => setHost("") },
		);
	};
	const busy = setMode.isPending || decide.isPending;
	const yours = c.hosts.filter((h) => !c.left.includes(h));
	return (
		<Card className="space-y-4">
			<div>
				<h3 className="text-sm text-text-primary mb-1">
					Content Credentials kept on the web
				</h3>
				<p className="text-xs text-text-secondary">
					Some files carry only a web address for their Content Credentials
					(Adobe Firefly video does this). {WHAT_A_FETCH_REVEALS} This machine{" "}
					{modeSentence(c.mode)}.
				</p>
			</div>
			<ModeChoice
				current={c.mode}
				onChoose={(m) => setMode.mutate(m)}
				busy={busy}
			/>
			<div className="space-y-2">
				<h4 className="text-sm text-text-primary">The list</h4>
				{c.mode !== "listed" && (
					<p className="text-xs text-text-secondary">
						The list is in force only when "Only from hosts on the list" is
						chosen.
					</p>
				)}
				<ul className="text-sm divide-y divide-border">
					{hostsInForce(c).map((h) => (
						<li key={h} className="flex items-center justify-between py-1.5">
							<span className="text-text-primary">
								{h}
								{c.builtIn.includes(h) && (
									<span className="text-xs text-text-secondary">
										{" "}
										(built in)
									</span>
								)}
							</span>
							<Button
								quiet
								disabled={busy}
								onClick={() =>
									decide.mutate({
										host: h,
										decision: yours.includes(h) ? "forget" : "leave",
									})
								}
							>
								{yours.includes(h) ? "Take off" : "Leave"}
							</Button>
						</li>
					))}
					{c.left.map((h) => (
						<li key={h} className="flex items-center justify-between py-1.5">
							<span className="text-text-secondary">
								{h}
								<span className="text-xs"> (left: not fetched from)</span>
							</span>
							<Button
								quiet
								disabled={busy}
								onClick={() => decide.mutate({ host: h, decision: "forget" })}
							>
								{c.builtIn.includes(h) ? "Fetch from it again" : "Forget"}
							</Button>
						</li>
					))}
				</ul>
				<form onSubmit={add} className="flex items-end gap-3">
					<div className="flex-1">
						<TextField
							label="Add a host"
							value={host}
							onChange={(v) => {
								setHost(v);
								decide.reset();
							}}
							placeholder="credentials.example.org"
							hint="A host name, or an https address to take the host from."
						/>
					</div>
					<Button type="submit" disabled={busy || !host.trim()}>
						Add
					</Button>
				</form>
			</div>
			<Problem error={setMode.error ?? decide.error} />
		</Card>
	);
}

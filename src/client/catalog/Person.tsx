// The name edits from this machine are recorded under (this machine's
// settings, never a project's). Edits are refused until it is set, so the
// Projects page asks for it first.

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { machine } from "./api.ts";
import { Button, Card, Problem, TextField } from "./ui.tsx";

export const machineKey = ["catalog", "machine"];

export function useMachine() {
	return useQuery({ queryKey: machineKey, queryFn: machine.get });
}

export default function PersonForm() {
	const qc = useQueryClient();
	const current = useMachine();
	const [name, setName] = useState<string | null>(null);
	const saved = current.data?.person ?? "";
	const value = name ?? saved;
	const save = useMutation({
		mutationFn: () => machine.setPerson(value.trim()),
		onSuccess: (r) => {
			qc.setQueryData(machineKey, r);
			setName(null);
		},
	});
	const changed = value.trim() !== saved;
	const submit = (e: FormEvent) => {
		e.preventDefault();
		if (changed && value.trim()) save.mutate();
	};
	return (
		<Card>
			<form onSubmit={submit} className="space-y-3">
				{current.data && !saved && (
					<p className="text-sm text-warning">
						Set your name before editing: every change is recorded under it.
					</p>
				)}
				<TextField
					label="Your name on this machine"
					value={value}
					onChange={(v) => {
						setName(v);
						save.reset();
					}}
					placeholder="A. Person"
					hint="Recorded with each change you make, in every project, from this machine. Kept in this machine's settings, not in a project."
				/>
				<div className="flex items-center gap-3">
					<Button
						type="submit"
						disabled={!changed || !value.trim() || save.isPending}
					>
						{save.isPending ? "Saving…" : "Save my name"}
					</Button>
					{save.isSuccess && !changed && (
						<span className="text-xs text-accent">Saved.</span>
					)}
				</div>
				<Problem error={current.error ?? save.error} />
			</form>
		</Card>
	);
}

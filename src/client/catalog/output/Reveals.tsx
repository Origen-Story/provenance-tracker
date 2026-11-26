// Review before signing (Phase 8 step 4, D62): what the signed film will
// reveal, and the choice to keep some of it out. What the tracker writes
// itself (names, notes, the statement) is shown to be changed at its source.
// What sources carry in their own credentials can be kept out: an assertion is
// redacted (the file then says something was removed, and why), or a
// source's credentials are left out entirely, for what a redaction cannot
// reach. The public record shows what is in the file, so this one review
// covers both (decision 7). Choices start from the last signing of this edit
// (withhold-choice.ts).

import type { BuiltStatement, SourceReveal } from "../api.ts";
import type { WithholdChoice } from "./withhold-choice.ts";

const KIND_WORDS: Record<string, string> = {
	identity: "Identity",
	metadata: "Metadata",
	author: "Author",
	location: "Location",
	device: "Device",
	generation: "Generation details",
};

export default function Reveals({
	statement,
	identityName,
	signerName,
	reveals,
	choice,
	onChange,
	disabled,
}: {
	statement: BuiltStatement | null;
	identityName: string | null;
	signerName: string | null;
	reveals: SourceReveal[];
	choice: WithholdChoice;
	onChange: (next: WithholdChoice) => void;
	disabled?: boolean;
}) {
	const toggleRedact = (uri: string, on: boolean) => {
		const redact = new Set(choice.redact);
		if (on) redact.add(uri);
		else redact.delete(uri);
		onChange({ ...choice, redact });
	};
	const toggleLeaveOut = (id: number, on: boolean) => {
		const leaveOut = new Set(choice.leaveOut);
		if (on) leaveOut.add(id);
		else leaveOut.delete(id);
		onChange({ ...choice, leaveOut });
	};
	const names = (statement?.ingredients ?? []).map((i) => i.title);
	const notes = (statement?.ingredients ?? []).filter((i) => i.note.trim());
	return (
		<div className="space-y-4">
			<div className="space-y-1.5">
				<h4 className="text-sm font-medium text-text-primary">
					What the tracker writes into the signed film
				</h4>
				<p className="text-xs text-text-secondary">
					Readable by anyone who has the signed film, and shown on its public
					page. Change these where they come from: the statement, or a source's
					public title and note on its page.
				</p>
				<ul className="text-sm text-text-primary space-y-0.5 list-disc pl-5">
					<li>
						The statement, by{" "}
						{[statement?.author, statement?.organization]
							.filter(Boolean)
							.join(", ") || "no author given"}
					</li>
					<li>
						{names.length} source file name{names.length === 1 ? "" : "s"}
						{names.length > 0 && (
							<span className="text-xs text-text-secondary">
								{" "}
								({names.slice(0, 3).join(", ")}
								{names.length > 3 ? ", …" : ""})
							</span>
						)}
					</li>
					{notes.length > 0 && (
						<li>
							{notes.length} note{notes.length === 1 ? "" : "s"} on sources
						</li>
					)}
					{identityName && <li>Your identity: {identityName}</li>}
					{signerName && <li>The signing certificate's name: {signerName}</li>}
				</ul>
			</div>

			<div className="space-y-2">
				<h4 className="text-sm font-medium text-text-primary">
					What sources carry in their own credentials
				</h4>
				{reveals.length === 0 ? (
					<p className="text-xs text-text-secondary">
						No source of this edit carries credentials of its own.
					</p>
				) : (
					<p className="text-xs text-text-secondary">
						These travel inside the signed film. Keep an item out and it is
						removed, and the film records that something was removed, and why.
						Some things can only be removed by leaving that source's credentials
						out entirely; readers then can no longer check where that source
						came from.
					</p>
				)}
				{reveals.map((r) => {
					const out = choice.leaveOut.has(r.assetId);
					return (
						<fieldset
							key={r.assetId}
							className="border border-border rounded-lg p-3 space-y-2"
						>
							<legend className="px-1 text-sm text-text-primary">
								{r.title}
								{r.parent ? " (the cut itself)" : ""}
							</legend>
							{r.reveal.unreadable ? (
								<p className="text-xs text-warning">
									Its Content Credentials could not be read (
									{r.reveal.unreadable}), so what they say cannot be shown here.
									They can only be left out.
								</p>
							) : (
								<p className="text-xs text-text-secondary">
									{r.reveal.manifests} manifest
									{r.reveal.manifests === 1 ? "" : "s"}, signed by{" "}
									{r.reveal.signers.join(", ") || "unnamed signers"}
									{r.reveal.otherAssertions > 0 &&
										` · ${r.reveal.otherAssertions} other assertions that say nothing personal`}
								</p>
							)}
							{r.reveal.items.length === 0 && !r.reveal.unreadable && (
								<p className="text-xs text-text-secondary">
									Nothing personal found in them.
								</p>
							)}
							<ul className="space-y-1.5">
								{r.reveal.items.map((i) => (
									<li key={i.uri} className="text-sm">
										<label
											className={`flex items-start gap-2 ${i.redactable && !out && !disabled ? "cursor-pointer" : ""}`}
										>
											<input
												type="checkbox"
												className="mt-1"
												disabled={!i.redactable || out || disabled}
												checked={out || choice.redact.has(i.uri)}
												onChange={(e) => toggleRedact(i.uri, e.target.checked)}
											/>
											<span>
												<span className="text-text-primary">
													{KIND_WORDS[i.kind] ?? i.kind}: {i.what}
												</span>
												{i.values.length > 0 && (
													<span className="block text-xs text-text-secondary break-all">
														{i.values.join(" · ")}
													</span>
												)}
												{!i.redactable && (
													<span className="block text-xs text-warning">
														Cannot be removed on its own: leave this source's
														credentials out to keep it out.
													</span>
												)}
											</span>
										</label>
									</li>
								))}
							</ul>
							<label
								className={`flex items-center gap-2 text-sm text-text-primary ${disabled ? "" : "cursor-pointer"}`}
							>
								<input
									type="checkbox"
									disabled={disabled}
									checked={out}
									onChange={(e) => toggleLeaveOut(r.assetId, e.target.checked)}
								/>
								Leave all of this source's own credentials out
							</label>
						</fieldset>
					);
				})}
			</div>
		</div>
	);
}

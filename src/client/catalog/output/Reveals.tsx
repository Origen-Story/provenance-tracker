// Review before signing (Phase 8 step 4, D62; D64): what the signed film
// will reveal, and the choice to keep some of it out. Three things go into
// it, and each is shown in full:
//
// - what the tracker writes itself (names, notes, the statement), changed at
//   its source;
// - what the cut and the thumbnail carry in their own metadata, outside any
//   credentials, changed where the file is made;
// - what sources carry in their own credentials. This can be kept out: an
//   assertion is redacted (the file then says something was removed, and
//   why), or a source's credentials are left out entirely, for what a
//   redaction cannot reach.
//
// The public record shows what is in the file, so this one review covers
// both (decision 7). Choices start from the last signing of this edit
// (withhold-choice.ts).

import type { ReactNode } from "react";
import type { BuiltStatement, FileCarries, SourceReveal } from "../api.ts";
import type { WithholdChoice } from "./withhold-choice.ts";

const KIND_WORDS: Record<string, string> = {
	identity: "Identity",
	metadata: "Metadata",
	author: "Author",
	location: "Location",
	device: "Device",
	generation: "Generation details",
	names: "File names",
	other: "Other",
};

const DETAIL_WORDS: Record<string, string> = {
	path: "A folder or file path",
	location: "A location",
	person: "A person or owner",
	device: "A device or program",
	text: "Text",
};

const plural = (n: number, one: string, many = `${one}s`) =>
	`${n} ${n === 1 ? one : many}`;

/** A count that opens into the whole list: nothing is only counted. */
function Listed({ summary, items }: { summary: string; items: ReactNode[] }) {
	if (items.length === 0) return null;
	return (
		<li>
			<details>
				<summary className="cursor-pointer">{summary}</summary>
				<ul className="mt-1 mb-1 space-y-0.5 list-[circle] pl-5 text-xs text-text-secondary break-all">
					{items.map((item, i) => (
						<li key={i}>{item}</li>
					))}
				</ul>
			</details>
		</li>
	);
}

export default function Reveals({
	statement,
	identityName,
	signerName,
	reveals,
	sourceSigners,
	filesCarry,
	choice,
	onChange,
	disabled,
}: {
	statement: BuiltStatement | null;
	identityName: string | null;
	signerName: string | null;
	reveals: SourceReveal[];
	/** Who signed each source that names a signer, whatever the choice. */
	sourceSigners: Array<{ assetId: number; title: string; signer: string }>;
	filesCarry: FileCarries[];
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
	const ingredients = statement?.ingredients ?? [];
	const notes = ingredients.filter((i) => i.note.trim());
	const titled = ingredients.filter((i) => i.publicTitle.trim());
	const clips = [
		...new Set(
			(statement?.unresolved ?? []).map((u) => u.clip.trim()).filter(Boolean),
		),
	];
	// A source whose credentials are left out is not named by its signer.
	const named = sourceSigners.filter((s) => !choice.leaveOut.has(s.assetId));
	return (
		<div className="space-y-4">
			<div className="space-y-1.5">
				<h4 className="text-sm font-medium text-text-primary">
					What the tracker writes into the signed film
				</h4>
				<p className="text-xs text-text-secondary">
					Readable by anyone who has the signed film, and shown on its public
					page. Change these where they come from: the statement, the timeline,
					or a source's file name, public title and note on its page.
				</p>
				<ul className="text-sm text-text-primary space-y-0.5 list-disc pl-5">
					<li>
						The statement, by{" "}
						{[statement?.author, statement?.organization]
							.filter(Boolean)
							.join(", ") || "no author given"}
					</li>
					{statement?.output.title && (
						<li>
							The film's file name: {statement.output.title}
							{statement.output.publicTitle &&
								`, and its public title: ${statement.output.publicTitle}`}
						</li>
					)}
					{statement?.output.sequence && (
						<li>The sequence's name: {statement.output.sequence}</li>
					)}
					<Listed
						summary={plural(ingredients.length, "source file name")}
						items={ingredients.map((i) => i.title)}
					/>
					<Listed
						summary={plural(titled.length, "public title")}
						items={titled.map((i) => `${i.title}: ${i.publicTitle}`)}
					/>
					<Listed
						summary={`${plural(notes.length, "note")} on sources`}
						items={notes.map((i) => `${i.title}: ${i.note}`)}
					/>
					<Listed
						summary={`${plural(clips.length, "clip name")} the timeline has no tracked file for`}
						items={clips}
					/>
					<Listed
						summary={`Who signed ${plural(named.length, "source")}, as its own credentials say`}
						items={named.map((s) => `${s.title}: ${s.signer}`)}
					/>
					{identityName && <li>Your identity: {identityName}</li>}
					{signerName && <li>The signing certificate's name: {signerName}</li>}
				</ul>
			</div>

			{filesCarry.length > 0 && (
				<div className="space-y-1.5">
					<h4 className="text-sm font-medium text-text-primary">
						What the cut and the thumbnail carry in their own metadata
					</h4>
					<p className="text-xs text-text-secondary">
						The signed copy is the cut's own bytes with credentials added, and
						the thumbnail is embedded as it is, so whatever their metadata says
						is published with the film. The tracker never changes a file: to
						remove any of this, change the export settings where the file is
						made, and export again.
					</p>
					{filesCarry.map((f) => (
						<div key={`${f.role}-${f.assetId}`} className="text-sm">
							<p className="text-text-primary">
								{f.title} ({f.role === "cut" ? "the cut" : "the thumbnail"})
							</p>
							{!f.read ? (
								<p className="text-xs text-warning">
									Not read yet, so nothing can be shown. Read the project's
									files on the Media page.
								</p>
							) : f.details.length === 0 ? (
								<p className="text-xs text-text-secondary">
									Nothing found that names a person, a place, a device or a
									folder.
								</p>
							) : (
								<ul className="space-y-0.5 list-disc pl-5 text-xs text-text-secondary break-all">
									{f.details.map((d) => (
										<li key={`${d.tag}-${d.value}`}>
											<span className="text-text-primary">
												{DETAIL_WORDS[d.kind] ?? d.kind}
											</span>{" "}
											({d.tag}): {d.value}
										</li>
									))}
									{f.more > 0 && <li>and {f.more} more</li>}
								</ul>
							)}
						</div>
					))}
				</div>
			)}

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
						These travel inside the signed film. Everything they say is listed,
						except what only binds or pictures the file. Keep an item out and it
						is removed, and the film records that something was removed, and
						why. Some things can only be removed by leaving that source's
						credentials out entirely; readers then can no longer check where
						that source came from.
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
									{plural(r.reveal.manifests, "manifest")}, signed by{" "}
									{r.reveal.signers.join(", ") || "unnamed signers"}
									{r.reveal.generators.length > 0 &&
										` · made with ${r.reveal.generators.join(", ")}`}
									{r.reveal.otherAssertions > 0 &&
										` · ${r.reveal.otherAssertions} more that only bind or picture the file (hashes, thumbnails, time stamps, plain edit steps)`}
								</p>
							)}
							{r.reveal.items.length === 0 && !r.reveal.unreadable && (
								<p className="text-xs text-text-secondary">
									They say nothing else.
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

// What a person chooses to keep out of a signed film (D62, D63), as the
// Signing tab holds it: where the choice starts, what it would reveal that
// the last signed copy kept out, and what stops signing. Pure, so it is
// tested without a page.

import type { SourceReveal, WithheldBefore } from "../api.ts";

export interface WithholdChoice {
	/** Addresses of the assertions to redact. */
	redact: Set<string>;
	/** Asset ids of the sources whose credentials are left out entirely. */
	leaveOut: Set<number>;
}

/**
 * The last signing's choices as the server carried them to the sources as
 * they are now, kept to what the review lists.
 */
export function startingChoice(
	reveals: SourceReveal[],
	last: WithheldBefore | null,
): WithholdChoice {
	const uris = new Set(
		reveals.flatMap((r) =>
			r.reveal.items.filter((i) => i.redactable).map((i) => i.uri),
		),
	);
	const ids = new Set(reveals.map((r) => r.assetId));
	return {
		redact: new Set((last?.redact ?? []).filter((u) => uris.has(u))),
		leaveOut: new Set((last?.leaveOut ?? []).filter((id) => ids.has(id))),
	};
}

/**
 * What this choice reveals that the last signing kept out, in words; empty
 * when nothing. A redaction is followed to the address it has now, so a
 * re-rendered source is still recognised.
 */
export function revealedAgain(
	choice: WithholdChoice,
	last: WithheldBefore | null,
	reveals: SourceReveal[],
): string[] {
	if (!last) return [];
	const out: string[] = [];
	for (const r of reveals)
		if (last.leftOut.includes(r.assetId) && !choice.leaveOut.has(r.assetId))
			out.push(`all of ${r.title}'s own credentials`);
	for (const kept of last.redactions) {
		const source = reveals.find((r) =>
			r.reveal.items.some((i) => kept.now.includes(i.uri)),
		);
		// Nothing of it left to reveal, or its whole source is left out.
		if (!source || choice.leaveOut.has(source.assetId)) continue;
		if (kept.now.some((uri) => !choice.redact.has(uri))) out.push(kept.what);
	}
	return out;
}

/**
 * The sources whose credentials could not be read and are not left out:
 * what they say cannot be reviewed, so signing waits for the choice.
 */
export function unreviewed(
	choice: WithholdChoice,
	reveals: SourceReveal[],
): string[] {
	return reveals
		.filter((r) => r.reveal.unreadable && !choice.leaveOut.has(r.assetId))
		.map((r) => r.title);
}

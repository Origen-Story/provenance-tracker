// Pure: which sequence of a timeline file belongs to a finished edit (Phase 8
// step 6). A whole-project export holds every sequence in the project; on
// 15 Nov 2026 the tracker took the first one without saying so, a 631-second
// assembly instead of the 146-second film. So:
//   - a sequence the person chose is used;
//   - a file with one sequence is that one;
//   - otherwise the one whose length matches the edit's own file, if exactly
//     one does;
//   - otherwise the tracker refuses to guess and lists them, so the person
//     can choose.

/** One sequence of a timeline file, as the formats' sequences() lists them. */
export interface SequenceInfo {
	index: number;
	name: string;
	/** Its length; null when the file does not say. */
	seconds: number | null;
	fps?: number | null;
}

/** The sequence to use and why, or a refusal to guess with the sequences to choose from. */
export type SequenceChoice<S extends SequenceInfo = SequenceInfo> =
	| { index: number; by: "chosen" | "only" | "length" }
	| { refuse: string; choices: S[] };

/** How far a sequence's length may be from the file's and still be "the same": half a second, or a frame if longer. */
export function lengthTolerance(fps?: number | null): number {
	return Math.max(0.5, fps ? 1 / fps : 0);
}

const secondsText = (s: number | null | undefined): string =>
	s == null ? "unknown length" : `${Math.round(s * 10) / 10} s`;

/**
 * @param list the file's sequences
 * @param opts.requested the sequence a person chose
 * @param opts.outputSeconds the length of the edit's own file
 */
export function chooseSequence<S extends SequenceInfo>(
	list: S[],
	opts: { requested?: number | null; outputSeconds?: number | null } = {},
): SequenceChoice<S> {
	const requested = opts.requested ?? null;
	const outputSeconds = opts.outputSeconds ?? null;
	if (!list.length)
		return { refuse: "The timeline file holds no sequence.", choices: [] };
	if (requested !== null) {
		const chosen = list.find((s) => s.index === requested);
		return chosen
			? { index: chosen.index, by: "chosen" }
			: {
					refuse: `The timeline file has no sequence ${requested}; it holds ${list.length}.`,
					choices: list,
				};
	}
	if (list.length === 1) return { index: list[0].index, by: "only" };
	if (outputSeconds !== null && outputSeconds > 0) {
		const close = list.filter(
			(s) =>
				s.seconds != null &&
				Math.abs(s.seconds - outputSeconds) <= lengthTolerance(s.fps),
		);
		if (close.length === 1) return { index: close[0].index, by: "length" };
		const why = close.length
			? `${close.length} of them are as long as this edit's file (${secondsText(outputSeconds)})`
			: `none is as long as this edit's file (${secondsText(outputSeconds)})`;
		return {
			refuse: `This timeline file holds ${list.length} sequences, and ${why}. Choose the one this edit was exported from.`,
			choices: list,
		};
	}
	return {
		refuse: `This timeline file holds ${list.length} sequences, and this edit's file has no known length to tell them apart. Choose the one it was exported from.`,
		choices: list,
	};
}

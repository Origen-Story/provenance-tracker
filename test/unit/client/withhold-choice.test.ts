// The Signing tab's choice of what to keep out of a signed film (D62, D63):
// where it starts, what it would reveal again, and what waits on a choice.

import { describe, expect, it } from "vitest";
import type {
	SourceReveal,
	WithheldBefore,
} from "../../../src/client/catalog/api.ts";
import {
	revealedAgain,
	startingChoice,
	unreviewed,
} from "../../../src/client/catalog/output/withhold-choice.ts";

const item = (uri: string, redactable = true) => ({
	uri,
	manifest: "m",
	label: "cawg.identity",
	kind: "identity" as const,
	what: "Who made this source",
	values: ["A. Person"],
	redactable,
});

const source = (
	assetId: number,
	title: string,
	uris: string[],
	unreadable?: string,
): SourceReveal => ({
	assetId,
	title,
	parent: assetId === 1,
	reveal: {
		manifests: unreadable ? 0 : 1,
		signers: [],
		items: uris.map((u) => item(u)),
		otherAssertions: 0,
		...(unreadable ? { unreadable } : {}),
	},
});

// The cut was re-rendered since the last signing: its identity was at "old"
// and is at "new" now. The still's credentials were left out.
const reveals = [
	source(1, "film.mp4", ["new", "other"]),
	source(2, "still.png", ["s"]),
];
const last: WithheldBefore = {
	redact: ["new"],
	leaveOut: [2],
	redactions: [{ assetId: 1, what: "an identity in film.mp4", now: ["new"] }],
	leftOut: [2],
	notes: ["The last signed copy kept out an identity in film.mp4. …"],
};

describe("startingChoice", () => {
	it("starts from the last signing's choices as they were carried to the sources now", () => {
		const choice = startingChoice(reveals, last);
		expect([...choice.redact]).toEqual(["new"]);
		expect([...choice.leaveOut]).toEqual([2]);
	});

	it("starts with nothing kept out before the first signing, and drops what the review does not list", () => {
		expect(startingChoice(reveals, null)).toEqual({
			redact: new Set(),
			leaveOut: new Set(),
		});
		const stale = { ...last, redact: ["gone"], leaveOut: [9] };
		expect(startingChoice(reveals, stale)).toEqual({
			redact: new Set(),
			leaveOut: new Set(),
		});
	});
});

describe("revealedAgain", () => {
	it("says nothing while the choice keeps out what the last signing kept out", () => {
		expect(revealedAgain(startingChoice(reveals, last), last, reveals)).toEqual(
			[],
		);
	});

	it("names a redaction the choice no longer makes, at the address it has now", () => {
		expect(
			revealedAgain(
				{ redact: new Set(), leaveOut: new Set([2]) },
				last,
				reveals,
			),
		).toEqual(["an identity in film.mp4"]);
	});

	it("names a source whose credentials the choice no longer leaves out", () => {
		expect(
			revealedAgain(
				{ redact: new Set(["new"]), leaveOut: new Set() },
				last,
				reveals,
			),
		).toEqual(["all of still.png's own credentials"]);
	});

	it("does not count a redaction whose whole source is left out, or one the sources no longer carry", () => {
		expect(
			revealedAgain(
				{ redact: new Set(), leaveOut: new Set([1, 2]) },
				last,
				reveals,
			),
		).toEqual([]);
		const dropped = {
			...last,
			redactions: [{ assetId: 1, what: "an identity in film.mp4", now: [] }],
		};
		expect(
			revealedAgain(
				{ redact: new Set(), leaveOut: new Set([2]) },
				dropped,
				reveals,
			),
		).toEqual([]);
	});
});

describe("unreviewed", () => {
	it("lists sources whose credentials could not be read until they are left out", () => {
		const broken = [...reveals, source(3, "clip.mov", [], "a broken manifest")];
		expect(
			unreviewed({ redact: new Set(), leaveOut: new Set() }, broken),
		).toEqual(["clip.mov"]);
		expect(
			unreviewed({ redact: new Set(), leaveOut: new Set([3]) }, broken),
		).toEqual([]);
	});
});

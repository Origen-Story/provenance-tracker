// The review before signing, rendered to text (D62, D64): what a person is
// shown, without a browser. The choices behind it are in withhold-choice.test.ts.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
	BuiltStatement,
	FileCarries,
	SourceReveal,
} from "../../../src/client/catalog/api.ts";
import Reveals from "../../../src/client/catalog/output/Reveals.tsx";

const ingredient = (title: string, over: Record<string, unknown> = {}) =>
	({
		ref: "ing-1",
		title,
		publicTitle: "",
		originClass: "digitalCapture",
		position: "captured",
		classSetBy: "creator",
		fileCredentials: "none",
		classClaimedByFile: null,
		signedBy: "",
		signerName: "",
		aiAssisted: false,
		note: "",
		pictureSeconds: 1,
		audioSeconds: 0,
		...over,
	}) as unknown as BuiltStatement["ingredients"][number];

const statement = {
	text: "A film.",
	author: "A. Maker",
	organization: "",
	editedWith: "",
	output: {
		title: "film.mp4",
		publicTitle: "",
		originClass: "composite",
		sequence: "Client pitch v3",
		durationSeconds: 10,
		fps: 25,
	},
	composition: {},
	ingredients: [
		ingredient("take.mov", { note: "Shot on a phone." }),
		ingredient("still.png", { publicTitle: "The harbour" }),
	],
	unresolved: [
		{
			clip: "Nested Sequence 02",
			track: "V1",
			startSeconds: 0,
			endSeconds: 1,
			reason: "nested sequence",
		},
	],
	editorGeneratedClips: 0,
} as BuiltStatement;

const reveals: SourceReveal[] = [
	{
		assetId: 2,
		title: "still.png",
		parent: false,
		reveal: {
			manifests: 1,
			signers: ["Example Camera Co"],
			generators: ["Example Camera 2.1"],
			otherAssertions: 3,
			items: [
				{
					uri: "self#jumbf=/c2pa/urn:c2pa:cam",
					manifest: "urn:c2pa:cam",
					label: "",
					kind: "names",
					what: "File names it records",
					values: ["IMG_0042.jpg"],
					redactable: false,
				},
				{
					uri: "self#jumbf=/c2pa/urn:c2pa:cam/c2pa.assertions/c2pa.metadata",
					manifest: "urn:c2pa:cam",
					label: "c2pa.metadata",
					kind: "location",
					what: "Where it was made (location)",
					values: ["41,24.2028N"],
					redactable: true,
				},
			],
		},
	},
	{
		assetId: 3,
		title: "clip.mov",
		parent: false,
		reveal: {
			manifests: 0,
			signers: [],
			generators: [],
			otherAssertions: 0,
			items: [],
			unreadable: "a broken manifest",
		},
	},
];

const filesCarry: FileCarries[] = [
	{
		assetId: 1,
		title: "film.mp4",
		role: "cut",
		read: true,
		details: [
			{
				tag: "WindowsAtomUncProjectPath",
				value: "D:\\Work\\Example Client\\cut.prproj",
				kind: "path",
			},
		],
		more: 2,
	},
	{
		assetId: 9,
		title: "poster.png",
		role: "thumbnail",
		read: false,
		details: [],
		more: 0,
	},
];

const render = (leaveOut: number[] = [], verified = true) =>
	renderToStaticMarkup(
		createElement(Reveals, {
			statement,
			identityName: null,
			signerName: "Example Signer",
			reveals,
			sourceSigners: [
				{
					assetId: 2,
					title: "still.png",
					signer: "Example Camera Co",
					verified,
				},
			],
			filesCarry,
			choice: { redact: new Set<string>(), leaveOut: new Set(leaveOut) },
			onChange: () => {},
		}),
	)
		// As read, not as marked up: React's own markers between pieces of
		// text go, and each tag is a break.
		.replace(/<!-- -->/g, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/&#x27;/g, "'")
		.replace(/\s+/g, " ");

describe("the review before signing, as shown", () => {
	const text = render();

	it("lists what the tracker writes in full: every name, note, title, the sequence, unmatched clips, and who signed each source", () => {
		for (const said of [
			"The statement, by A. Maker",
			"The film's file name: film.mp4",
			"The sequence's name: Client pitch v3",
			"2 source file names",
			"take.mov",
			"1 public title",
			"still.png: The harbour",
			"1 note on sources",
			"take.mov: Shot on a phone.",
			"1 clip name the timeline has no tracked file for",
			"Nested Sequence 02",
			"Who signed 1 source, as its own credentials say",
			"still.png: Example Camera Co",
			"The signing certificate's name: Example Signer",
		])
			expect(text).toContain(said);
	});

	it("shows what the cut and the thumbnail carry in their own metadata, and says when one has not been read", () => {
		expect(text).toContain("film.mp4 (the cut)");
		expect(text).toContain(
			"A folder or file path (WindowsAtomUncProjectPath): D:\\Work\\Example Client\\cut.prproj",
		);
		expect(text).toContain("and 2 more");
		expect(text).toContain("poster.png (the thumbnail)");
		expect(text).toContain("Not read yet, so nothing can be shown.");
	});

	it("lists everything a source's credentials say, what made them, and what cannot be removed on its own", () => {
		expect(text).toContain(
			"1 manifest, whose signature names Example Camera Co · made with Example Camera 2.1 · 3 more that only bind or picture the file",
		);
		expect(text).toContain("File names: File names it records");
		expect(text).toContain("Cannot be removed on its own");
		expect(text).toContain("Location: Where it was made (location)");
		expect(text).toContain("41,24.2028N");
		expect(text).not.toContain("nothing personal");
	});

	it("says when a source's credentials could not be read", () => {
		expect(text).toContain(
			"Its Content Credentials could not be read (a broken manifest), so what they say cannot be shown here. They can only be left out.",
		);
	});

	it("never says a source was signed by a name its credentials give when that signature could not be verified (D67)", () => {
		const unverified = render([], false);
		expect(unverified).toContain(
			"Who the credentials of 1 source name as signer",
		);
		expect(unverified).toContain(
			"still.png: Example Camera Co (that signature could not be verified)",
		);
		expect(unverified).not.toContain("Who signed");
		// What a source's credentials carry is worded the same either way: the
		// review does not know whether those signatures verify.
		for (const shown of [text, unverified])
			expect(shown).not.toContain("signed by");
	});

	it("no longer names the signer of a source whose credentials are left out", () => {
		const left = render([2]);
		expect(left).not.toContain("Who signed");
		expect(left).not.toContain("still.png: Example Camera Co");
	});
});

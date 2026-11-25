import { describe, it, expect } from "vitest";
import path from "node:path";
import { readFileSync } from "node:fs";
import { validate } from "../helpers/json-schema-lite.js";

// The repository root, from packages/core/test/manifest/.
const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const statementSchema = JSON.parse(
	readFileSync(
		path.join(ROOT, "spec", "creator-statement.v3.schema.json"),
		"utf8",
	),
);
import {
	buildOutputManifest,
	buildCreatorStatement,
	buildAssetManifest,
	versionedSignedPath,
	placedAssetRefs,
	outputClassOf,
	STATEMENT_LABEL,
	STATEMENT_VERSION,
	PARENT_LABEL,
	sidecarPathFor,
	archivedSidecarPath,
	planSidecar,
	cleanPublicTitle,
	PUBLIC_TITLE_MAX,
	compactIntervals,
	thumbnailFormatOf,
} from "../../src/manifest/build.js";
import { parse as parseXmeml } from "../../src/timeline/formats/xmeml.js";
import { segmentsFromTimeline } from "../../src/timeline/breakdown.js";

const SAMPLE_XMEML = readFileSync(
	path.join(
		import.meta.dirname,
		"..",
		"fixtures",
		"timeline",
		"sample.xmeml.xml",
	),
	"utf8",
);

const IPTC = "http://cv.iptc.org/newscodes/digitalsourcetype/";
const GENERATOR = { name: "provenance-tracker", version: "0.0.0-test" };
const dir = path.join(path.sep, "media", "project");

// A 10 s edit: a camera take on V1 for 0-6 s, a generated clip on V1 for
// 6-10 s, a title on V2 over 0-2 s, and a voice on A1 throughout.
const assets = new Map([
	[
		"produced:11",
		{
			filePath: path.join(dir, "take-01.mp4"),
			originClass: "computationalCapture",
			originClassConfirmed: true,
			originClassNote: "The phone stopped signing after a system update.",
			publicTitle: "  Street interview,\n phone camera ",
			c2paSummary: null,
		},
	],
	[
		"ai:21",
		{
			filePath: path.join(dir, "gen-01.mp4"),
			originClass: "trainedAlgorithmicMedia",
			originClassConfirmed: false,
			signedBy: "tool",
			signerName: "Gen Tool",
			c2paSummary: {
				claimGenerator: "Gen Tool",
				ingredients: [],
				signatureInfo: { issuer: "Gen Inc", commonName: "Gen Tool" },
				assertions: [
					{
						label: "c2pa.actions.v2",
						data: {
							actions: [
								{
									action: "c2pa.created",
									digitalSourceType: `${IPTC}trainedAlgorithmicMedia`,
								},
							],
						},
					},
				],
			},
		},
	],
	[
		"produced:12",
		{
			filePath: path.join(dir, "voice.wav"),
			originClass: "digitalCapture",
			originClassConfirmed: true,
			c2paSummary: null,
		},
	],
]);

const seg = (o) => ({
	enabled: true,
	trackKind: "video",
	trackIndex: 1,
	sourceKind: "file",
	...o,
});
const segments = [
	seg({
		startFrame: 0,
		endFrame: 180,
		matchedAssetRef: "produced:11",
		clipName: "take-01",
	}),
	seg({
		startFrame: 180,
		endFrame: 300,
		matchedAssetRef: "ai:21",
		clipName: "gen-01",
	}),
	seg({
		trackIndex: 2,
		startFrame: 0,
		endFrame: 60,
		sourceKind: "generator",
		clipName: "Title",
	}),
	seg({
		trackKind: "audio",
		startFrame: 0,
		endFrame: 300,
		matchedAssetRef: "produced:12",
		clipName: "voice",
	}),
	seg({
		trackIndex: 3,
		startFrame: 30,
		endFrame: 60,
		clipName: "missing.mov",
		startSeconds: 1,
		endSeconds: 2,
	}),
	seg({
		startFrame: 0,
		endFrame: 300,
		enabled: false,
		matchedAssetRef: "produced:99",
		clipName: "disabled",
	}),
];
const L = (type, id) => ({ matchedAssetRef: `${type}:${id}` });
const composition = {
	durationSeconds: 10,
	fps: 30,
	picture: {
		intervals: [
			{
				startSeconds: 0,
				endSeconds: 2,
				positions: ["captured", "digital"],
				layers: [{}, L("produced", 11)],
			},
			{
				startSeconds: 2,
				endSeconds: 6,
				positions: ["captured"],
				layers: [L("produced", 11)],
			},
			{
				startSeconds: 6,
				endSeconds: 10,
				positions: ["synthetic"],
				layers: [L("ai", 21)],
			},
		],
		byPosition: {
			captured: { seconds: 4, percent: 40 },
			synthetic: { seconds: 4, percent: 40 },
		},
		mixed: {
			seconds: 2,
			percent: 20,
			combos: { "captured+digital": { seconds: 2, percent: 20 } },
		},
		gap: { seconds: 0, percent: 0 },
	},
	audio: {
		intervals: [
			{
				startSeconds: 0,
				endSeconds: 10,
				positions: ["captured"],
				layers: [L("produced", 12)],
			},
		],
		byPosition: { captured: { seconds: 10, percent: 100 } },
		mixed: { seconds: 0, percent: 0, combos: {} },
		gap: { seconds: 0, percent: 0 },
	},
};
const output = {
	ref: "produced:1",
	type: "produced",
	id: 1,
	filePath: path.join(dir, "final.mp4"),
	publicTitle: "A Short Film",
	originClass: "compositeSynthetic",
	originClassConfirmed: false,
};
const timeline = { sequenceName: "Final", fps: 30 };
const statement = {
	text: "  A short film about provenance.  ",
	authorName: "A. Creator",
	organization: "Example Studio",
	softwareAgent: "Premiere Pro",
	identityUrl: "https://example.org/id",
};

describe("placedAssetRefs", () => {
	it("lists enabled matched assets in order of first use, once each, without the output", () => {
		expect(
			placedAssetRefs(
				[
					...segments,
					seg({
						startFrame: 0,
						endFrame: 1,
						matchedAssetRef: "produced:1",
					}),
				],
				"produced:1",
			),
		).toEqual(["produced:11", "produced:12", "ai:21"]);
	});
});

describe("buildCreatorStatement", () => {
	const s = buildCreatorStatement({
		output,
		timeline,
		composition,
		segments,
		assets,
		statement,
		statedAt: "2026-11-13T10:00:00Z",
	});

	it("carries the creator's words and who says them", () => {
		expect(s).toMatchObject({
			version: 3,
			statedAt: "2026-11-13T10:00:00Z",
			text: "A short film about provenance.",
			author: "A. Creator",
			organization: "Example Studio",
			editedWith: "Premiere Pro",
		});
	});

	it("names the output by file name only, never a path", () => {
		expect(s.output).toMatchObject({
			title: "final.mp4",
			publicTitle: "A Short Film",
			originClass: "compositeSynthetic",
			digitalSourceType: `${IPTC}compositeSynthetic`,
			durationSeconds: 10,
			fps: 30,
		});
		expect(JSON.stringify(s)).not.toContain(dir);
	});

	it("copies the composition numbers per lane", () => {
		expect(s.composition.picture.byPosition.captured).toEqual({
			seconds: 4,
			percent: 40,
		});
		expect(s.composition.picture.mixed.combos["captured+digital"]).toEqual({
			seconds: 2,
			percent: 20,
		});
		expect(s.composition.audio.byPosition.captured.percent).toBe(100);
	});

	it("records, per ingredient, the class, who set it, what the file itself claims, and the note", () => {
		const [take, voice, gen] = s.ingredients;
		expect(take).toMatchObject({
			ref: "ing-1",
			title: "take-01.mp4",
			publicTitle: "Street interview, phone camera",
			originClass: "computationalCapture",
			position: "captured",
			classSetBy: "creator",
			fileCredentials: "none",
			classClaimedByFile: null,
			signedBy: "",
			note: "The phone stopped signing after a system update.",
			pictureSeconds: 6,
			audioSeconds: 0,
		});
		expect(voice).toMatchObject({
			title: "voice.wav",
			publicTitle: "",
			audioSeconds: 10,
			pictureSeconds: 0,
		});
		expect(gen).toMatchObject({
			title: "gen-01.mp4",
			classSetBy: "proposal",
			fileCredentials: "present",
			classClaimedByFile: "trainedAlgorithmicMedia",
			signedBy: "tool",
			signerName: "Gen Tool",
			position: "synthetic",
			pictureSeconds: 4,
		});
	});

	it("keeps the C2PA ingredient title as the file name, whatever the public title", () => {
		const { ingredients } = buildOutputManifest({
			output,
			timeline,
			composition,
			segments,
			assets,
			statement,
			statedAt: "x",
			generator: GENERATOR,
		});
		expect(ingredients.find((i) => i.label === "ing-1").title).toBe(
			"take-01.mp4",
		);
		expect(ingredients[0].title).toBe("final.mp4");
	});

	it("carries what plays when, by ingredient ref, so the public strip is covered by the signature", () => {
		// Placed in order of first use: take (ing-1), voice (ing-2), generated clip (ing-3).
		expect(s.composition.picture.intervals).toEqual([
			{
				start: 0,
				end: 2,
				positions: ["captured", "digital"],
				refs: ["ing-1"],
				untracked: 1,
			},
			{ start: 2, end: 6, positions: ["captured"], refs: ["ing-1"] },
			{ start: 6, end: 10, positions: ["synthetic"], refs: ["ing-3"] },
		]);
		expect(s.composition.audio.intervals).toEqual([
			{ start: 0, end: 10, positions: ["captured"], refs: ["ing-2"] },
		]);
	});

	it("merges adjacent intervals that read the same", () => {
		const refOf = new Map([["produced:11", "ing-1"]]);
		const lane = {
			intervals: [
				{
					startSeconds: 0,
					endSeconds: 1,
					positions: ["captured"],
					layers: [L("produced", 11)],
				},
				{
					startSeconds: 1,
					endSeconds: 3,
					positions: ["captured"],
					layers: [L("produced", 11)],
				},
				{ startSeconds: 3, endSeconds: 4, positions: [], layers: [] },
			],
		};
		expect(compactIntervals(lane, refOf)).toEqual([
			{ start: 0, end: 3, positions: ["captured"], refs: ["ing-1"] },
			{ start: 3, end: 4, positions: [], refs: [] },
		]);
	});

	it("lists clips it could not tie to an asset, and counts editor-made titles", () => {
		expect(s.unresolved).toEqual([
			{
				clip: "missing.mov",
				track: "V3",
				startSeconds: 1,
				endSeconds: 2,
				reason: "no tracked asset",
				originClass: "unknown",
				position: "unknown",
			},
		]);
		expect(s.editorGeneratedClips).toBe(1);
	});

	it("keeps the class the creator gave an untracked clip, such as a nested sequence (v3)", () => {
		const nested = seg({
			trackIndex: 4,
			startFrame: 30,
			endFrame: 90,
			sourceKind: "sequence",
			clipName: "subclip",
			originClass: "compositeSynthetic",
		});
		const v3 = buildCreatorStatement({
			output,
			timeline,
			composition,
			segments: [...segments, nested],
			assets,
			statement,
			statedAt: "2026-11-13T10:00:00Z",
		});
		expect(v3.unresolved.at(-1)).toEqual({
			clip: "subclip",
			track: "V4",
			startSeconds: 1,
			endSeconds: 3,
			reason: "nested sequence",
			originClass: "compositeSynthetic",
			position: "hybrid",
		});
	});
});

describe("the creator statement and its schema (spec/creator-statement.v3.schema.json)", () => {
	const args = {
		output,
		timeline,
		composition,
		segments,
		assets,
		statement,
		statedAt: "2026-11-13T10:00:00Z",
	};

	it("the schema's version is the builder's version", () => {
		expect(statementSchema.properties.version.const).toBe(STATEMENT_VERSION);
	});

	it("a statement the builder makes is valid, with every field described (no extra ones)", () => {
		expect(validate(statementSchema, buildCreatorStatement(args))).toEqual([]);
	});

	it("so is one with an unresolved nested sequence", () => {
		const nested = seg({
			trackIndex: 4,
			startFrame: 30,
			endFrame: 90,
			sourceKind: "sequence",
			clipName: "subclip",
			originClass: "compositeSynthetic",
		});
		expect(
			validate(
				statementSchema,
				buildCreatorStatement({ ...args, segments: [...segments, nested] }),
			),
		).toEqual([]);
	});

	it("and so is the assertion actually placed in the manifest", () => {
		const m = buildOutputManifest({ ...args, generator: GENERATOR });
		const data = m.definition.assertions.find(
			(a) => a.label === STATEMENT_LABEL,
		).data;
		expect(validate(statementSchema, data)).toEqual([]);
	});

	it("catches a statement that drifts from the schema", () => {
		const s = buildCreatorStatement(args);
		expect(validate(statementSchema, { ...s, extra: 1 })).not.toEqual([]);
		expect(validate(statementSchema, { ...s, version: 2 })).not.toEqual([]);
		const { unresolved: _omitted, ...missing } = s;
		expect(validate(statementSchema, missing)).not.toEqual([]);
	});
});

describe("outputClassOf", () => {
	it("uses a class the creator confirmed", () => {
		expect(
			outputClassOf(
				{ originClass: "compositeCapture", originClassConfirmed: true },
				composition,
			),
		).toBe("compositeCapture");
	});
	it("otherwise follows the composition", () => {
		expect(
			outputClassOf(
				{ originClass: "unknown", originClassConfirmed: false },
				composition,
			),
		).toBe("compositeSynthetic");
	});
});

describe("buildOutputManifest", () => {
	const m = buildOutputManifest({
		output,
		timeline,
		composition,
		segments,
		assets,
		statement,
		statedAt: "t",
		generator: GENERATOR,
	});
	const actions = m.definition.assertions.find(
		(a) => a.label === "c2pa.actions.v2",
	).data.actions;

	it("opens the export as the parent and places each asset with its source type", () => {
		expect(m.ingredients[0]).toEqual({
			label: PARENT_LABEL,
			relationship: "parentOf",
			title: "final.mp4",
			useInput: true,
		});
		expect(
			m.ingredients.slice(1).map((i) => [i.label, i.relationship, i.title]),
		).toEqual([
			["ing-1", "componentOf", "take-01.mp4"],
			["ing-2", "componentOf", "voice.wav"],
			["ing-3", "componentOf", "gen-01.mp4"],
		]);
		expect(actions[0]).toMatchObject({
			action: "c2pa.opened",
			digitalSourceType: `${IPTC}compositeSynthetic`,
			softwareAgent: { name: "Premiere Pro" },
			parameters: { ingredientIds: [PARENT_LABEL] },
		});
		expect(
			actions
				.slice(1)
				.map((a) => [
					a.action,
					a.digitalSourceType,
					a.parameters.ingredientIds[0],
				]),
		).toEqual([
			["c2pa.placed", `${IPTC}computationalCapture`, "ing-1"],
			["c2pa.placed", `${IPTC}digitalCapture`, "ing-2"],
			["c2pa.placed", `${IPTC}trainedAlgorithmicMedia`, "ing-3"],
		]);
	});

	it("gives each placement the stretch of the edit it plays in, as a C2PA temporal range (D17)", () => {
		const ranges = actions
			.slice(1)
			.map((a) => [
				a.parameters.ingredientIds[0],
				a.changes.map((c) => c.region.map((r) => [r.type, r.time])),
			]);
		expect(ranges).toEqual([
			["ing-1", [[["temporal", { type: "npt", start: "0", end: "6" }]]]],
			["ing-2", [[["temporal", { type: "npt", start: "0", end: "10" }]]]],
			["ing-3", [[["temporal", { type: "npt", start: "6", end: "10" }]]]],
		]);
	});

	it("writes no thumbnail unless one is given, and no resources", () => {
		expect(m.definition.thumbnail).toBeUndefined();
		expect(m.resources).toEqual([]);
	});

	it("includes the statement, the author with the identity URL, and the training opt-out, and no unsigned CAWG assertion", () => {
		const labels = m.definition.assertions.map((a) => a.label);
		expect(labels).toEqual([
			"c2pa.actions.v2",
			STATEMENT_LABEL,
			"stds.schema-org.CreativeWork",
			"c2pa.training-mining",
		]);
		expect(m.definition.assertions[1].data).toBe(m.statement);
		expect(m.definition.assertions[2].data.author[0]).toEqual({
			"@type": "Person",
			name: "A. Creator",
			url: "https://example.org/id",
		});
		expect(m.definition.claim_generator_info).toEqual([GENERATOR]);
	});

	it("leaves the source type off an asset whose class is unknown", () => {
		const a = new Map(assets);
		a.set("produced:11", { ...a.get("produced:11"), originClass: "unknown" });
		const placed = buildOutputManifest({
			output,
			timeline,
			composition,
			segments,
			assets: a,
			statement,
			statedAt: "t",
			generator: GENERATOR,
		}).definition.assertions[0].data.actions[1];
		expect(placed.digitalSourceType).toBeUndefined();
	});

	it("refuses without a file or a timeline", () => {
		expect(() =>
			buildOutputManifest({
				output: { id: 1 },
				composition,
				segments,
				assets,
				generator: GENERATOR,
			}),
		).toThrow(/no file/);
		expect(() =>
			buildOutputManifest({
				output,
				composition: null,
				segments,
				assets,
				generator: GENERATOR,
			}),
		).toThrow(/timeline/);
	});
});

describe("placed actions per stretch of the edit (D17)", () => {
	const build = (segs, tl = timeline) =>
		buildOutputManifest({
			output,
			timeline: tl,
			composition,
			segments: segs,
			assets,
			statement,
			statedAt: "t",
			generator: GENERATOR,
		}).definition.assertions[0].data.actions.slice(1);
	const span = (a) => [
		a.parameters.ingredientIds[0],
		a.changes?.[0].region[0].time.start,
		a.changes?.[0].region[0].time.end,
	];

	it("gives a clip used twice two actions, in time order", () => {
		const acts = build([
			seg({ startFrame: 0, endFrame: 30, matchedAssetRef: "produced:11" }),
			seg({ startFrame: 30, endFrame: 90, matchedAssetRef: "ai:21" }),
			seg({ startFrame: 90, endFrame: 150, matchedAssetRef: "produced:11" }),
		]);
		expect(acts.map(span)).toEqual([
			["ing-1", "0", "1"],
			["ing-2", "1", "3"],
			["ing-1", "3", "5"],
		]);
	});

	it("keeps every cut: a take cut into pieces that follow each other is one action per piece", () => {
		const acts = build([
			seg({ startFrame: 0, endFrame: 45, matchedAssetRef: "produced:11" }),
			seg({ startFrame: 45, endFrame: 90, matchedAssetRef: "produced:11" }),
			seg({ startFrame: 90, endFrame: 96, matchedAssetRef: "produced:11" }),
		]);
		expect(acts.map(span)).toEqual([
			["ing-1", "0", "1.5"],
			["ing-1", "1.5", "3"],
			["ing-1", "3", "3.2"],
		]);
	});

	it("keeps a picture and its sound apart when they are offset (a J- or L-cut), and overlapping uses apart", () => {
		const acts = build([
			seg({ startFrame: 0, endFrame: 60, matchedAssetRef: "produced:11" }),
			seg({
				trackKind: "audio",
				startFrame: 0,
				endFrame: 90,
				matchedAssetRef: "produced:11",
			}),
			seg({
				trackIndex: 2,
				startFrame: 30,
				endFrame: 120,
				matchedAssetRef: "produced:11",
			}),
		]);
		expect(acts.map(span)).toEqual([
			["ing-1", "0", "2"],
			["ing-1", "0", "3"],
			["ing-1", "1", "4"],
		]);
	});

	it("drops only identical copies: a picture with its linked sound, a stereo pair", () => {
		const acts = build([
			seg({ startFrame: 0, endFrame: 60, matchedAssetRef: "produced:11" }),
			seg({
				trackKind: "audio",
				startFrame: 0,
				endFrame: 60,
				matchedAssetRef: "produced:11",
			}),
			seg({
				trackKind: "audio",
				trackIndex: 2,
				startFrame: 0,
				endFrame: 60,
				matchedAssetRef: "produced:11",
			}),
			// Another asset over the same range is its own placement.
			seg({ startFrame: 0, endFrame: 60, matchedAssetRef: "ai:21" }),
		]);
		expect(acts.map(span)).toEqual([
			["ing-1", "0", "2"],
			["ing-2", "0", "2"],
		]);
	});

	it("rounds to the millisecond at a broadcast frame rate", () => {
		const acts = build(
			[seg({ startFrame: 100, endFrame: 200, matchedAssetRef: "produced:11" })],
			{ ...timeline, fps: 30000 / 1001 },
		);
		expect(acts.map(span)).toEqual([["ing-1", "3.337", "6.673"]]);
	});

	it("still places an asset when the times are unknown, without a range", () => {
		const acts = build(
			[seg({ startFrame: 0, endFrame: 30, matchedAssetRef: "produced:11" })],
			{ ...timeline, fps: null },
		);
		expect(acts).toHaveLength(1);
		expect(acts[0].changes).toBeUndefined();
		expect(acts[0].parameters.ingredientIds).toEqual(["ing-1"]);
	});

	it("matches the clips of the sample timeline, its disabled clip left out", () => {
		const t = parseXmeml(SAMPLE_XMEML);
		const refs = new Map();
		const matches = new Map();
		for (const track of t.tracks)
			for (const c of track.clips)
				if (c.file?.id) {
					const ref = `produced:${c.file.id}`;
					refs.set(ref, {
						filePath: path.join(dir, c.file.name),
						originClass: "digitalCapture",
					});
					matches.set(c.id, { asset: { ref } });
				}
		const segs = segmentsFromTimeline(t, matches);
		const acts = buildOutputManifest({
			output,
			timeline: { sequenceName: t.sequence.name, fps: t.sequence.fps },
			composition,
			segments: segs,
			assets: refs,
			statement,
			statedAt: "t",
			generator: GENERATOR,
		}).definition.assertions[0].data.actions.slice(1);
		// Clip 01 is on V1, A1 and A2 over frames 0-100: identical copies, one
		// placement. The
		// rest are 100-200, 300-400 and 350-420, at 29.97 frames a second.
		expect(acts.map(span)).toEqual([
			["ing-1", "0", "3.337"],
			["ing-2", "3.337", "6.673"],
			["ing-3", "10.01", "13.347"],
			["ing-4", "11.678", "14.014"],
		]);
		// The disabled clip is not an ingredient at all.
		expect(acts).toHaveLength(4);
	});
});

describe("the claim thumbnail (D17)", () => {
	const SHA = "ab".repeat(32);
	const withThumb = (thumbnail) =>
		buildOutputManifest({
			output,
			timeline,
			composition,
			segments,
			assets,
			statement,
			statedAt: "t",
			generator: GENERATOR,
			thumbnail,
		});

	it("names the picked image by its hash in the definition, and tells the signer its file", () => {
		const file = path.join(dir, "poster.jpg");
		const m = withThumb({ sha256: SHA, format: "image/jpeg", filePath: file });
		expect(m.definition.thumbnail).toEqual({
			format: "image/jpeg",
			identifier: `${SHA}.jpg`,
		});
		expect(m.resources).toEqual([{ identifier: `${SHA}.jpg`, filePath: file }]);
		expect(JSON.stringify(m.definition)).not.toContain(dir);
	});

	it("takes a PNG", () => {
		expect(
			withThumb({ sha256: SHA, format: "image/png", filePath: "p.png" })
				.definition.thumbnail.identifier,
		).toBe(`${SHA}.png`);
	});

	it("refuses another format, a name that is not a hash, or no file", () => {
		expect(() =>
			withThumb({ sha256: SHA, format: "image/gif", filePath: "x.gif" }),
		).toThrow(/JPEG or PNG/);
		expect(() =>
			withThumb({ sha256: "../x", format: "image/png", filePath: "x.png" }),
		).toThrow(/SHA-256/);
		expect(() => withThumb({ sha256: SHA, format: "image/png" })).toThrow(
			/no file/,
		);
	});
});

describe("thumbnailFormatOf", () => {
	it("knows JPEG and PNG by their first bytes, and nothing else", () => {
		expect(thumbnailFormatOf(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
			"image/jpeg",
		);
		expect(
			thumbnailFormatOf(
				Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]),
			),
		).toBe("image/png");
		expect(thumbnailFormatOf(Buffer.from("GIF89a"))).toBeNull();
		expect(thumbnailFormatOf(Buffer.alloc(0))).toBeNull();
		expect(thumbnailFormatOf(null)).toBeNull();
	});
});

describe("buildAssetManifest", () => {
	it("declares how a file without credentials was made", () => {
		const { definition, ingredients } = buildAssetManifest({
			title: "voice.wav",
			originClass: "digitalCapture",
			toolUsed: "Recorder",
			authorName: "A",
			generator: GENERATOR,
		});
		expect(ingredients).toEqual([]);
		expect(definition.assertions[0].data.actions).toEqual([
			{
				action: "c2pa.created",
				digitalSourceType: `${IPTC}digitalCapture`,
				softwareAgent: { name: "Recorder" },
			},
		]);
	});
	it("lets the signer mark a file AI-generated whatever its class", () => {
		const { definition } = buildAssetManifest({
			title: "x.wav",
			originClass: "digitalCapture",
			isAiGenerated: true,
			generator: GENERATOR,
		});
		expect(definition.assertions[0].data.actions[0].digitalSourceType).toBe(
			`${IPTC}trainedAlgorithmicMedia`,
		);
	});
	it("keeps existing credentials as the parent", () => {
		const { definition, ingredients } = buildAssetManifest({
			title: "clip.mp4",
			originClass: "computationalCapture",
			hasManifest: true,
			generator: GENERATOR,
		});
		expect(ingredients).toEqual([
			{
				label: PARENT_LABEL,
				relationship: "parentOf",
				title: "clip.mp4",
				useInput: true,
			},
		]);
		expect(definition.assertions[0].data.actions[0]).toMatchObject({
			action: "c2pa.opened",
			parameters: { ingredientIds: [PARENT_LABEL] },
		});
	});
	it("refuses to invent a source type for an unknown class", () => {
		expect(() =>
			buildAssetManifest({
				title: "x",
				originClass: "unknown",
				generator: GENERATOR,
			}),
		).toThrow(/origin class/);
	});
	it("omits the training opt-out when asked", () => {
		const { definition } = buildAssetManifest({
			title: "x",
			originClass: "digitalCapture",
			trainingMiningOptOut: false,
			generator: GENERATOR,
		});
		expect(definition.assertions.map((a) => a.label)).not.toContain(
			"c2pa.training-mining",
		);
	});
});

describe("versionedSignedPath", () => {
	const input = path.join(dir, "final.mp4");
	it("takes the first free version beside the input", () => {
		const taken = new Set([path.join(dir, "final.signed.v1.mp4")]);
		expect(versionedSignedPath(input, (p) => taken.has(p))).toEqual({
			path: path.join(dir, "final.signed.v2.mp4"),
			version: 2,
		});
	});
	it("does not stack suffixes when given a signed copy", () => {
		expect(
			versionedSignedPath(path.join(dir, "final.signed.v3.mp4"), () => false)
				.path,
		).toBe(path.join(dir, "final.signed.v1.mp4"));
	});
});

describe("sidecar naming and re-signing (D13)", () => {
	const input = path.join(dir, "take-01.mp4");
	const sidecar = path.join(dir, "take-01.c2pa");

	it("names the sidecar like the file, where C2PA readers look", () => {
		expect(sidecarPathFor(input)).toBe(sidecar);
		expect(archivedSidecarPath(input, 2)).toBe(
			path.join(dir, "take-01.v2.c2pa"),
		);
	});

	it("writes version 1 when there is no sidecar yet", () => {
		expect(
			planSidecar({
				inputPath: input,
				sidecarExists: false,
				currentSignature: null,
				latestVersion: 0,
			}),
		).toEqual({ action: "write", version: 1, sidecarPath: sidecar });
	});

	it("archives its own earlier sidecar under that signature's version before writing the next", () => {
		expect(
			planSidecar({
				inputPath: input,
				sidecarExists: true,
				currentSignature: { id: 7, version: 2 },
				latestVersion: 2,
			}),
		).toEqual({
			action: "rotate",
			version: 3,
			sidecarPath: sidecar,
			archive: {
				signatureId: 7,
				from: sidecar,
				to: path.join(dir, "take-01.v2.c2pa"),
			},
		});
	});

	it("refuses to replace a .c2pa it did not write", () => {
		const p = planSidecar({
			inputPath: input,
			sidecarExists: true,
			currentSignature: null,
			latestVersion: 0,
		});
		expect(p.action).toBe("refuse");
		expect(p.reason).toMatch(/take-01\.c2pa.*did not write/);
	});
});

describe("cleanPublicTitle", () => {
	it("makes one trimmed line of plain text", () => {
		expect(cleanPublicTitle("  Street\r\n  interview\t(take 2) ")).toBe(
			"Street interview (take 2)",
		);
		expect(cleanPublicTitle("a\u0000b")).toBe("a b");
	});
	it("treats missing values as empty", () => {
		expect(cleanPublicTitle(undefined)).toBe("");
		expect(cleanPublicTitle(null)).toBe("");
		expect(cleanPublicTitle("   ")).toBe("");
	});
	it("caps the length without leaving a trailing space", () => {
		const long = "word ".repeat(60);
		const out = cleanPublicTitle(long);
		expect(out.length).toBeLessThanOrEqual(PUBLIC_TITLE_MAX);
		expect(out).toBe(out.trim());
	});
});

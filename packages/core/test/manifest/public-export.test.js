import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildOutputManifest } from "../../src/manifest/build.js";
import {
	buildPublicExport,
	buildPublicExportV1,
	publicExportFileName,
	matchReadBack,
	EXPORT_FORMAT,
	EXPORT_FORMAT_VERSION,
} from "../../src/manifest/public-export.js";
import { validate } from "../helpers/json-schema-lite.js";

// The repository root, from packages/core/test/manifest/.
const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const schemaOf = (v) =>
	JSON.parse(
		readFileSync(
			path.join(ROOT, "spec", `public-export.v${v}.schema.json`),
			"utf8",
		),
	);
const SCHEMA = schemaOf(3);
const SCHEMA_V2 = schemaOf(2);
const SCHEMA_V1 = schemaOf(1);
const GENERATOR = { name: "provenance-tracker", version: "0.0.0-test" };
const dir = path.join(path.sep, "media", "project");

// An 8 s edit: a phone take with a public title, then an AI clip, over a
// voice track; one clip on V2 the tracker could not match.
const assets = new Map([
	[
		"produced:11",
		{
			filePath: path.join(dir, "PXL_0001.mp4"),
			publicTitle: "Street interview",
			originClass: "computationalCapture",
			originClassConfirmed: true,
			originClassNote: "Credentials missing after a phone update.",
			c2paSummary: null,
		},
	],
	[
		"ai:21",
		{
			filePath: path.join(dir, "gen-01.mp4"),
			originClass: "trainedAlgorithmicMedia",
			signedBy: "tool",
			signerName: "Gen Tool",
			c2paSummary: {
				claimGenerator: "Gen Tool",
				ingredients: [],
				assertions: [
					{
						label: "c2pa.actions.v2",
						data: {
							actions: [
								{
									action: "c2pa.created",
									digitalSourceType:
										"http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
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
		endFrame: 120,
		matchedAssetRef: "produced:11",
	}),
	seg({
		startFrame: 120,
		endFrame: 240,
		matchedAssetRef: "ai:21",
	}),
	seg({
		trackKind: "audio",
		startFrame: 0,
		endFrame: 240,
		matchedAssetRef: "produced:12",
	}),
	seg({
		trackIndex: 2,
		startFrame: 30,
		endFrame: 60,
		clipName: "private-name.mov",
		startSeconds: 1,
		endSeconds: 2,
	}),
];
const L = (type, id) => ({ matchedAssetRef: `${type}:${id}` });
const composition = {
	durationSeconds: 8,
	fps: 30,
	picture: {
		intervals: [
			{
				startSeconds: 0,
				endSeconds: 1,
				positions: ["captured"],
				layers: [L("produced", 11)],
			},
			{
				startSeconds: 1,
				endSeconds: 2,
				positions: ["captured", "unknown"],
				layers: [{}, L("produced", 11)],
			},
			{
				startSeconds: 2,
				endSeconds: 4,
				positions: ["captured"],
				layers: [L("produced", 11)],
			},
			{
				startSeconds: 4,
				endSeconds: 8,
				positions: ["synthetic"],
				layers: [L("ai", 21)],
			},
		],
		byPosition: {
			captured: { seconds: 3, percent: 37.5 },
			synthetic: { seconds: 4, percent: 50 },
		},
		mixed: {
			seconds: 1,
			percent: 12.5,
			combos: { "captured+unknown": { seconds: 1, percent: 12.5 } },
		},
		gap: { seconds: 0, percent: 0 },
	},
	audio: {
		intervals: [
			{
				startSeconds: 0,
				endSeconds: 8,
				positions: ["captured"],
				layers: [L("produced", 12)],
			},
		],
		byPosition: { captured: { seconds: 8, percent: 100 } },
		mixed: { seconds: 0, percent: 0, combos: {} },
		gap: { seconds: 0, percent: 0 },
	},
};
const output = {
	ref: "produced:1",
	type: "produced",
	id: 1,
	filePath: path.join(dir, "film.mp4"),
	publicTitle: "How This Film Was Made",
	originClass: "compositeSynthetic",
};
const { statement } = buildOutputManifest({
	output,
	timeline: { sequenceName: "Seq", fps: 30 },
	composition,
	segments,
	assets,
	statement: {
		text: "Made with a phone and one AI shot.",
		authorName: "A. Creator",
	},
	statedAt: "2026-11-14T09:00:00Z",
	generator: GENERATOR,
});

// A c2patool read-back: valid apart from trust, the AI clip's own manifest carried in.
const report = {
	active_manifest: "urn:ours",
	manifests: {
		"urn:ours": {
			// c2patool renames ingredients by assertion, in the order given (seen on 0.27.1).
			ingredients: [
				{
					label: "c2pa.ingredient.v3",
					title: "film.mp4",
					relationship: "parentOf",
				},
				{
					label: "c2pa.ingredient.v3__1",
					title: "PXL_0001.mp4",
					relationship: "componentOf",
				},
				{
					label: "c2pa.ingredient.v3__2",
					title: "voice.wav",
					relationship: "componentOf",
				},
				{
					label: "c2pa.ingredient.v3__3",
					title: "gen-01.mp4",
					relationship: "componentOf",
					active_manifest: "urn:gen",
				},
			],
			signature_info: {
				issuer: "Dev CA",
				common_name: "Dev Signer",
				alg: "Es256",
				time: "2026-11-14T09:00:01Z",
			},
		},
		"urn:gen": {},
	},
	validation_results: {
		activeManifest: {
			success: [{ code: "assertion.bmffHash.match" }],
			failure: [{ code: "signingCredential.untrusted" }],
		},
	},
};
const signature = {
	id: 5,
	kind: "output",
	version: 2,
	signedPath: path.join(dir, "film.signed.v2.mp4"),
	signedHash: "ab".repeat(32),
	signedSize: 123456789,
	statementJson: JSON.stringify(statement),
	reportJson: JSON.stringify(report),
	createdAt: new Date("2026-11-14T09:00:02Z"),
};
const e = buildPublicExport({
	signature,
	generatedAt: "2026-11-14T10:00:00Z",
	generator: GENERATOR,
});

describe("buildPublicExport", () => {
	it("matches the published schema", () => {
		expect(validate(SCHEMA, e)).toEqual([]);
		expect(e).toMatchObject({
			format: EXPORT_FORMAT,
			formatVersion: EXPORT_FORMAT_VERSION,
		});
	});

	it("names the film and each ingredient by public title, keeping the file name beside it", () => {
		expect(e.film).toMatchObject({
			title: "How This Film Was Made",
			fileName: "film.mp4",
			durationSeconds: 8,
			position: "hybrid",
		});
		expect(e.ingredients.map((i) => [i.ref, i.title, i.fileName])).toEqual([
			["ing-1", "Street interview", "PXL_0001.mp4"],
			["ing-2", "voice.wav", "voice.wav"],
			["ing-3", "gen-01.mp4", "gen-01.mp4"],
		]);
	});

	it("carries the strip as signed, by ingredient ref", () => {
		expect(e.composition.picture.intervals).toEqual([
			{ start: 0, end: 1, positions: ["captured"], refs: ["ing-1"] },
			{
				start: 1,
				end: 2,
				positions: ["captured", "unknown"],
				refs: ["ing-1"],
				untracked: 1,
			},
			{ start: 2, end: 4, positions: ["captured"], refs: ["ing-1"] },
			{ start: 4, end: 8, positions: ["synthetic"], refs: ["ing-3"] },
		]);
		expect(e.composition.audio.byPosition.captured.percent).toBe(100);
	});

	it("says which ingredients kept their own credentials inside the signed file", () => {
		expect(e.ingredients.find((i) => i.ref === "ing-3")).toMatchObject({
			credentialsInSignedFile: "present",
			fileCredentials: "present",
			signerName: "Gen Tool",
		});
		expect(e.ingredients.find((i) => i.ref === "ing-1")).toMatchObject({
			credentialsInSignedFile: "none",
			fileCredentials: "none",
			note: "Credentials missing after a phone update.",
			classSetBy: "creator",
		});
	});

	it("describes the signed file, and the file, the signer and the identity as separate results (D57)", () => {
		expect(e.signedFile).toEqual({
			fileName: "film.signed.v2.mp4",
			sha256: "ab".repeat(32),
			bytes: 123456789,
			version: 2,
			signedAt: "2026-11-14T09:00:02.000Z",
			url: null,
		});
		expect(e.page).toEqual({ url: null });
		expect(e.file).toEqual({ status: "matches", hashVerified: true });
		expect(e.signer).toEqual({
			status: "unrecognised_issuer",
			statusLabel: "Valid, unrecognised issuer",
			commonName: "Dev Signer",
			issuer: "Dev CA",
			// This signing was recorded without a fingerprint.
			certificateSha256: "",
			algorithm: "Es256",
			timeStamp: {
				time: "2026-11-14T09:00:01Z",
				authority: "",
				trusted: null,
			},
			manifestCount: 2,
			failures: ["signingCredential.untrusted"],
		});
		// No identity in the file: nothing, rather than "missing".
		expect(e.identity).toBeNull();
		expect(e.withheld).toEqual({ fromRecord: 0, fromSignedFile: 0 });
		expect(e).not.toHaveProperty("signature");
	});

	it("holds no paths, no database ids and no names of untracked clips", () => {
		const json = JSON.stringify(e);
		expect(json).not.toContain(dir);
		expect(json).not.toContain("private-name");
		// Numeric ids; vocabulary.positions[].id is a position name such as "captured".
		expect(json).not.toMatch(
			/"(id|assetId|projectId|matchedAssetId|signatureId)":\d/,
		);
		expect(json).not.toContain("matchedAsset");
		expect(e.untracked).toEqual([
			{
				track: "V2",
				startSeconds: 1,
				endSeconds: 2,
				reason: "no tracked asset",
				originClass: "unknown",
				position: "unknown",
			},
		]);
	});

	it("includes labels for the classes it uses, so a viewer needs no other vocabulary", () => {
		expect(Object.keys(e.vocabulary.classes).sort()).toEqual([
			"compositeSynthetic",
			"computationalCapture",
			"digitalCapture",
			"trainedAlgorithmicMedia",
		]);
		expect(e.vocabulary.positions.map((p) => p.id)).toEqual([
			"captured",
			"digital",
			"assisted",
			"hybrid",
			"synthetic",
			"unknown",
		]);
	});

	it("carries a source's unverified signer as unverified, so a page never calls it who signed (D67)", () => {
		const said = {
			...statement,
			ingredients: statement.ingredients.map((i, n) =>
				n === 0
					? { ...i, signedBy: "unverified", signerName: "Example AI Inc." }
					: i,
			),
		};
		const out = buildPublicExport({
			signature: { ...signature, statementJson: JSON.stringify(said) },
			generatedAt: "2026-11-14T10:00:00Z",
			generator: GENERATOR,
		});
		expect(validate(SCHEMA, out)).toEqual([]);
		expect(out.ingredients[0]).toMatchObject({
			signedBy: "unverified",
			signerName: "Example AI Inc.",
		});
	});

	it("refuses a copy signed before the statement carried the timeline", () => {
		const old = {
			...signature,
			statementJson: JSON.stringify({
				...statement,
				version: 1,
				composition: { picture: {}, audio: {} },
			}),
		};
		expect(() =>
			buildPublicExport({
				signature: old,
				generatedAt: "x",
				generator: GENERATOR,
			}),
		).toThrow(/Sign the output again/);
	});

	it("refuses an asset sidecar signature", () => {
		expect(() =>
			buildPublicExport({
				signature: { ...signature, kind: "asset" },
				generatedAt: "x",
				generator: GENERATOR,
			}),
		).toThrow(/signed output/);
	});
});

describe("publicExportFileName", () => {
	it("names the export after the signed file", () => {
		expect(publicExportFileName(path.join(dir, "film.signed.v2.mp4"))).toBe(
			"film.signed.v2.provenance.json",
		);
	});
});

describe("matchReadBack", () => {
	const ours = [
		{ ref: "ing-1", title: "a.mp4" },
		{ ref: "ing-2", title: "b.wav" },
	];
	const parent = {
		label: "c2pa.ingredient.v3",
		title: "film.mp4",
		relationship: "parentOf",
	};
	it("uses our label when the reader kept it", () => {
		const rb = [
			parent,
			{ label: "ing-2", title: "b.wav", relationship: "componentOf" },
			{ label: "ing-1", title: "a.mp4", relationship: "componentOf" },
		];
		expect(matchReadBack(ours, rb).map((m) => m.label)).toEqual([
			"ing-1",
			"ing-2",
		]);
	});
	it("otherwise pairs by position among placed ingredients when the file name agrees", () => {
		const rb = [
			parent,
			{ label: "x__1", title: "a.mp4", relationship: "componentOf" },
			{ label: "x__2", title: "b.wav", relationship: "componentOf" },
		];
		expect(matchReadBack(ours, rb).map((m) => m.label)).toEqual([
			"x__1",
			"x__2",
		]);
	});
	it("falls back to a unique file name, and gives up rather than guess", () => {
		const rb = [
			parent,
			{ label: "x__1", title: "b.wav", relationship: "componentOf" },
			{ label: "x__2", title: "c.mov", relationship: "componentOf" },
		];
		expect(matchReadBack(ours, rb).map((m) => m?.label ?? null)).toEqual([
			null,
			"x__1",
		]);
	});
});

describe("export format 2's additions (D57)", () => {
	const at = { generatedAt: "2026-11-14T10:00:00Z", generator: GENERATOR };
	const withReport = (changes) =>
		buildPublicExport({
			signature: {
				...signature,
				reportJson: JSON.stringify(changes(structuredClone(report))),
			},
			...at,
		});

	it("carries where the signed copy is published, https only", () => {
		const published = buildPublicExport({
			signature,
			publication: {
				fileUrl: "https://media.example.org/film.signed.v2.mp4",
				pageUrl: "https://example.org/films/film",
				withheld: ["ingredient.note", "ingredient.fileName:ing-3"],
			},
			...at,
		});
		expect(validate(SCHEMA, published)).toEqual([]);
		expect(published.signedFile.url).toBe(
			"https://media.example.org/film.signed.v2.mp4",
		);
		expect(published.page.url).toBe("https://example.org/films/film");
		// How many details were left out, never which.
		expect(published.withheld).toEqual({ fromRecord: 2, fromSignedFile: 0 });
		expect(JSON.stringify(published)).not.toContain("ingredient.note");
		for (const bad of [
			"http://media.example.org/film.mp4",
			"javascript:alert(1)",
			"https://user:pass@media.example.org/film.mp4",
			"not an address",
		]) {
			const x = buildPublicExport({
				signature,
				publication: { fileUrl: bad, pageUrl: bad, withheld: [] },
				...at,
			});
			expect([x.signedFile.url, x.page.url], bad).toEqual([null, null]);
		}
		expect(
			validate(SCHEMA, {
				...published,
				page: { url: "http://example.org/films/film" },
			}),
		).toEqual([
			'$.page.url: "http://example.org/films/film" does not match ^https://\\S+$',
		]);
	});

	it("names who issued the time stamp, and says when that authority is not on the C2PA list", () => {
		const x = withReport((r) => {
			r.validation_results.activeManifest.success.push({
				code: "timeStamp.validated",
				explanation:
					"timestamp message digest matched: Example Timestamp Responder 2026",
			});
			r.validation_results.activeManifest.informational = [
				{
					code: "timeStamp.untrusted",
					explanation:
						"timestamp cert untrusted: Example Timestamp Responder 2026",
				},
			];
			return r;
		});
		expect(x.signer.timeStamp).toEqual({
			time: "2026-11-14T09:00:01Z",
			authority: "Example Timestamp Responder 2026",
			trusted: false,
		});
		expect(validate(SCHEMA, x)).toEqual([]);
	});

	it("reads the creator's identity apart from the claim", () => {
		const x = withReport((r) => {
			const ours = r.manifests[r.active_manifest];
			ours.assertions = [
				...(ours.assertions || []),
				{
					label: "cawg.identity",
					data: {
						signer_payload: {
							referenced_assertions: [{ url: "self#jumbf=c2pa.hash.bmff.v3" }],
							role: ["cawg.creator"],
						},
						signature_info: {
							common_name: "A. Maker",
							issuer: "Example ID CA",
						},
					},
				},
			];
			r.validation_results.activeManifest.failure.push({
				code: "cawg.x509.credential.untrusted",
			});
			return r;
		});
		expect(x.identity).toEqual({
			status: "unrecognised_issuer",
			name: "A. Maker",
			issuer: "Example ID CA",
			roles: ["cawg.creator"],
		});
		// The identity's codes never change the claim's result.
		expect(x.signer.status).toBe("unrecognised_issuer");
		expect(x.signer.failures).toEqual(["signingCredential.untrusted"]);
		expect(validate(SCHEMA, x)).toEqual([]);
	});

	it("keeps a changed file apart from a signature that otherwise checks out", () => {
		const changed = withReport((r) => {
			r.validation_results.activeManifest.success = [];
			r.validation_results.activeManifest.failure.push({
				code: "assertion.bmffHash.mismatch",
			});
			return r;
		});
		expect(changed.file).toEqual({ status: "changed", hashVerified: false });
		expect(changed.signer.status).toBe("unrecognised_issuer");
		const broken = withReport((r) => {
			r.validation_results.activeManifest.failure.push({
				code: "claimSignature.mismatch",
			});
			return r;
		});
		expect(broken.signer.status).toBe("invalid");
		expect(broken.file.status).toBe("matches");
	});

	it("counts what was redacted from ingredients' credentials in the signed file, never what", () => {
		const x = buildPublicExport({
			signature: {
				...signature,
				definitionJson: JSON.stringify({
					redactions: [
						"self#jumbf=/c2pa/urn:example/c2pa.assertions/cawg.identity",
					],
				}),
			},
			...at,
		});
		expect(x.withheld).toEqual({ fromRecord: 0, fromSignedFile: 1 });
		expect(JSON.stringify(x)).not.toContain("urn:example");
	});
});

describe("export format 1, still built for the Postgres migration's check", () => {
	it("is as it was: one signature block, and its own schema", () => {
		const v1 = buildPublicExportV1({
			signature,
			generatedAt: "2026-11-14T10:00:00Z",
			generator: GENERATOR,
		});
		expect(validate(SCHEMA_V1, v1)).toEqual([]);
		expect(v1.formatVersion).toBe(1);
		expect(v1.signature).toMatchObject({
			status: "unrecognised_issuer",
			hashVerified: true,
			issuerRecognised: false,
			signer: { commonName: "Dev Signer", issuer: "Dev CA" },
		});
		// Format 2 is format 1 with that block replaced, and nothing else changed.
		const only1 = { ...v1 };
		delete only1.signature;
		const only2 = { ...e, formatVersion: 1 };
		for (const k of ["page", "file", "signer", "identity", "withheld"])
			delete only2[k];
		only2.signedFile = { ...e.signedFile };
		delete only2.signedFile.url;
		expect(only2).toEqual(only1);
	});
});

describe("a source type is written only when it is a vocabulary address", () => {
	it("leaves out a stored value that is anything else, in the film and in a source", () => {
		const stored = JSON.parse(signature.statementJson);
		stored.output.digitalSourceType = "javascript:alert(document.domain)";
		stored.ingredients[0].digitalSourceType =
			"https://example.org/not-a-vocabulary";
		const out = buildPublicExport({
			signature: { ...signature, statementJson: JSON.stringify(stored) },
			generatedAt: "2026-11-14T10:00:00Z",
			generator: GENERATOR,
		});
		expect(out.film.digitalSourceType).toBeNull();
		// The class's own address stands in for a source.
		expect(out.ingredients[0].digitalSourceType).toBe(
			e.ingredients[0].digitalSourceType,
		);
		expect(validate(SCHEMA, out)).toEqual([]);
		// The genuine ones are untouched.
		expect(e.film.digitalSourceType).toMatch(
			/^http:\/\/cv\.iptc\.org\/newscodes\/digitalsourcetype\/[A-Za-z]+$/,
		);
	});
});

describe("export format 3: the signing certificate's fingerprint (D72)", () => {
	const build = (certificateSha256) =>
		buildPublicExport({
			signature: { ...signature, certificateSha256 },
			generatedAt: "2026-11-14T10:00:00Z",
			generator: GENERATOR,
		});

	it("carries the fingerprint kept at signing, and nothing that is not one", () => {
		const fingerprint = "cd".repeat(32);
		const out = build(fingerprint);
		expect(out.formatVersion).toBe(3);
		expect(out.signer.certificateSha256).toBe(fingerprint);
		expect(validate(SCHEMA, out)).toEqual([]);
		for (const not of [
			"",
			undefined,
			null,
			"CD".repeat(32),
			"cd".repeat(31),
			"x",
		])
			expect(build(not).signer.certificateSha256, String(not)).toBe("");
		// No signature, no signer's certificate, whatever the row says.
		const none = buildPublicExport({
			signature: {
				...signature,
				certificateSha256: fingerprint,
				reportJson: JSON.stringify({}),
			},
			generatedAt: "2026-11-14T10:00:00Z",
			generator: GENERATOR,
		});
		expect(none.signer.status).toBe("absent");
		expect(none.signer.certificateSha256).toBe("");
	});

	it("is format 2 with that one field added", () => {
		const { certificateSha256, ...signer } = build("cd".repeat(32)).signer;
		expect(certificateSha256).toBe("cd".repeat(32));
		expect(validate(SCHEMA_V2, { ...e, formatVersion: 2, signer })).toEqual([]);
		// And format 3's schema refuses a record without it.
		expect(validate(SCHEMA, { ...e, signer })).not.toEqual([]);
	});
});

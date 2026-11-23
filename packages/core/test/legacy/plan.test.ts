import { describe, it, expect } from "vitest";
import { parseCopyText } from "../../src/legacy/copy-text.ts";
import { legacyProjects, planProject } from "../../src/legacy/plan.ts";
import { LEGACY_TABLES } from "../../src/legacy/tables.ts";
import { FILES, fixtureText } from "./fixture.ts";

const plan = (text = fixtureText(), project = 1) =>
	planProject(parseCopyText(text), project);

describe("the dump's shape", () => {
	it("is refused with a table or column the migration does not know", () => {
		expect(() =>
			plan(
				fixtureText(undefined, { extraColumn: ["public.assets", "new_thing"] }),
			),
		).toThrow(
			/public\.assets has a column the migration does not know: new_thing/,
		);
		expect(() =>
			plan(fixtureText(undefined, { extraTable: "public.new_table" })),
		).toThrow(/a table the migration does not know: public\.new_table/);
	});

	it("is refused when a column the migration expects is missing", () => {
		expect(() =>
			plan(
				fixtureText(undefined, {
					omitColumn: ["public.signatures", "report_json"],
				}),
			),
		).toThrow(/public\.signatures has no column report_json/);
	});

	it("knows every column with a use and a reason", () => {
		for (const [table, rule] of Object.entries(LEGACY_TABLES)) {
			expect(rule.note, table).not.toBe("");
			for (const [col, r] of Object.entries(rule.columns)) {
				expect(
					["carried", "checked", "not-carried", "implied"],
					`${table}.${col}`,
				).toContain(r.use);
				expect(r.note, `${table}.${col}`).not.toBe("");
			}
		}
	});
});

describe("planProject", () => {
	it("lists the projects in the dump", () => {
		expect(legacyProjects(parseCopyText(fixtureText()))).toEqual([
			{ id: 1, name: "Demo film" },
			{ id: 2, name: "Other project" },
		]);
	});

	it("takes only the chosen project's rows", () => {
		const other = plan(fixtureText(), 2);
		expect(other.assets.map((a) => a.ref)).toEqual(["produced:3"]);
		expect(other.timelines).toEqual([]);
		expect(other.signatures).toEqual([]);
		expect(plan().assets.map((a) => a.ref)).toEqual([
			"ai:1",
			"archival:1",
			"produced:1",
			"produced:2",
		]);
	});

	it("carries the project's settings, with its times in UTC", () => {
		expect(plan().project).toEqual({
			legacyId: 1,
			name: "Demo film",
			description: "A made-up project",
			codePrefix: "DM",
			cawgIdentityUrl: "",
			cawgIdentityName: "",
			createdAt: "2026-10-01T08:00:00.123Z",
			updatedAt: "2026-10-02T09:00:00.500Z",
		});
		expect(plan().schemaMigrations).toBe(2);
	});

	it("makes an AI asset a generated one, with its code, generation and readings", () => {
		const ai = plan().assets[0];
		expect(ai.evidence).toEqual({ legacy: "public.assets", id: 1 });
		expect(ai.createdAt).toBe("2026-11-01T08:00:00.000Z");
		expect(ai.updatedAt).toBe("2026-11-02T08:00:00.999Z");
		expect(ai.fields).toMatchObject({
			kind: "generated",
			code: "DM-001",
			description: "A generated door",
			origin_class: "trainedAlgorithmicMedia",
			origin_class_confirmed: true,
			origin_class_source: "platform_parser",
			signed_by: "tool",
			origin_ingredient_classes: [],
		});
		expect(ai.file).toEqual(FILES.gen);
		expect(ai.generation).toEqual({
			fields: {
				platform: "firefly",
				generated_at: "",
				prompt: "a wooden door\tin rain",
				negative_prompt: "",
				model_name: "Example model",
				model_version: "",
				seed: "",
				// Postgres's 0 meant "not known".
				steps: null,
				cfg_scale: "",
				sampler: "",
				scheduler: "",
				width: 1024,
				height: null,
				aspect_ratio: "",
				stylize: "",
				style_raw: "",
				loras: [{ name: "x" }],
				controlnets: [],
				other: { style: "photo" },
			},
			at: "2026-11-01T08:00:01.000Z",
			evidence: { legacy: "public.generation_params", id: 3 },
		});
		expect(ai.observations).toEqual([
			{
				kind: "legacy-c2pa",
				data: '{"claim_generator":"Example Generator"}',
				observedAt: "2026-11-01T08:00:02.000Z",
				evidence: { legacy: "public.asset_metadata", id: 7 },
			},
		]);
	});

	it("makes an archival asset one with credits for its creator and institution", () => {
		const old = plan().assets[1];
		expect(old.fields).toMatchObject({
			kind: "archival",
			title: "Old photo",
			source_url: "https://example.org/item/1",
			license: "CC0",
			medium: "map",
			origin_class: "digitalCapture",
		});
		expect(old.credits).toEqual([
			{ role: "creator", name: "A. Photographer" },
			{ role: "institution", name: "Example City Archive" },
		]);
		expect(old.observations).toEqual([
			{
				kind: "legacy-exif",
				data: '{"Make":"Example"}',
				observedAt: "2026-11-01T07:00:00.000Z",
				evidence: {
					legacy: "public.archival_assets",
					id: 1,
					column: "exif_json",
				},
			},
		]);
	});

	it("makes a produced asset one, an output keeping its output fields", () => {
		const [, , rec, cut] = plan().assets;
		expect(rec.fields).toMatchObject({
			kind: "produced",
			title: "rec.wav",
			is_output: false,
		});
		expect(rec.observations.map((o) => o.kind)).toEqual(["legacy-c2pa"]);
		expect(cut.fields).toMatchObject({
			kind: "produced",
			title: "The cut",
			is_output: true,
			output_source: "timeline",
			recorded_date: "2026-11-01",
			recorded_location: "Somewhere",
			origin_ingredient_classes: ["digitalCapture", "trainedAlgorithmicMedia"],
		});
		expect(cut.credits).toEqual([{ role: "creator", name: "An Editor" }]);
	});

	it("notes a file name that differs from the path's, and a source type that differs from the class", () => {
		const p = plan(
			fixtureText((rows) => {
				rows["public.assets"][0].digital_source_type = "algorithmicMedia";
			}),
		);
		expect(p.notes).toEqual([
			'ai:1: digital_source_type is "algorithmicMedia" but origin_class is "trainedAlgorithmicMedia"; origin_class is carried',
			'produced:2: filename is "cut-renamed.mp4" but the file is "cut.mp4"; the file is what is tracked',
		]);
		expect(p.blocking).toEqual([]);
	});

	it("lists every value not carried, hiding key paths", () => {
		const u = plan().uncarried.map(
			(v) => `${v.table} ${v.id} ${v.column} ${v.value}`,
		);
		// Empty values and defaults (is_active, asset_type, in_place) are not listed.
		expect(u).toEqual([
			"public.projects 1 certificate_path null",
			"public.projects 1 private_key_path null",
			"public.assets 1 mime_type image/png",
			"public.archival_assets 1 image_url https://example.org/item/1.jpg",
			"public.archival_assets 1 notion_page_id abc123",
			"public.produced_assets 1 duration_seconds 2.5",
			"public.creator_statements 5 created_at 2026-11-05 10:00:00+01",
		]);
		expect(JSON.stringify(plan().uncarried)).not.toContain("dev.key");
	});

	it("links each pair of assets, and blocks a link to an asset outside the project", () => {
		expect(plan().relationships).toEqual([
			{
				parent: "ai:1",
				child: "produced:2",
				fields: {
					type: "output_of",
					match_method: "timeline",
					confidence: 0.9,
					note: "",
				},
				createdAt: "2026-11-03T11:00:00.000Z",
				evidence: { legacy: "public.asset_relationships", id: 1 },
			},
			expect.objectContaining({ parent: "produced:1", child: "produced:2" }),
		]);
		const p = plan(
			fixtureText((rows) => {
				rows["public.asset_relationships"][1].parent_asset_id = 3;
			}),
		);
		expect(p.blocking).toEqual([
			"public.asset_relationships 2 links produced:3 and produced:2, but produced:3 is not in this project",
		]);
	});

	it("groups a timeline's clips by source, each source with one match", () => {
		const [t] = plan().timelines;
		expect(t).toMatchObject({
			evidence: { legacy: "public.timelines", id: 4 },
			asset: "produced:2",
			format: "xmeml",
			file_name: "cut.xml",
			file: {
				path: FILES.timeline.path,
				sha256: FILES.timeline.sha256,
				size: null,
			},
			timebase: 25,
			fps: 25,
			primary_track_index: 2,
			breakdown: '{"total":10}',
			notes: '["a note"]',
			importedAt: "2026-11-04T09:00:00.000Z",
			updatedAt: "2026-11-04T09:05:00.000Z",
		});
		expect(
			t.sources.map((s) => [
				s.source_key,
				s.kind,
				s.asset,
				s.match_method,
				s.clips.map((c) => c.evidence.id),
			]),
		).toEqual([
			["file-1", "file", "produced:1", "hash", [10, 11]],
			["file-2", "file", "ai:1", "path", [12]],
			["gen-slug", "generator", null, "unmatched", [13]],
		]);
		const clip = t.sources[1].clips[0];
		expect(clip).toEqual({
			evidence: { legacy: "public.timeline_segments", id: 12 },
			track_kind: "video",
			track_index: 1,
			clip_key: "clipitem-3",
			name: "gen.png",
			enabled: true,
			start_frame: 100,
			end_frame: 250,
			in_frame: null,
			out_frame: null,
			start_seconds: null,
			end_seconds: null,
			origin_class: "algorithmicMedia",
			sort_order: 2,
		});
	});

	it("blocks clips of one source that disagree on its match", () => {
		const p = plan(
			fixtureText((rows) => {
				rows["public.timeline_segments"][1].match_method = "path";
			}),
		);
		expect(p.blocking).toEqual([
			'public.timelines 4: clips of the source "file-1" disagree on match_method (segment 11); the catalog matches per source',
		]);
	});

	it("blocks a clip matched to an asset outside the project", () => {
		const p = plan(
			fixtureText((rows) => {
				rows["public.timeline_segments"][2].matched_asset_type = "produced";
				rows["public.timeline_segments"][2].matched_asset_id = 3;
			}),
		);
		expect(p.blocking).toEqual([
			"public.timeline_segments 12 is matched to produced:3, which is not in this project",
		]);
	});

	it("links a signing to the statement saved before it, and not to one saved after", () => {
		const [s] = plan().signatures;
		expect(s).toEqual({
			legacyId: 8,
			asset: "produced:2",
			kind: "output",
			version: 1,
			source: { path: FILES.cut.path, sha256: FILES.cut.sha256, size: null },
			signed: FILES.signed,
			definition: '{"title":"cut.mp4"}',
			statement: '{"text":"Made from a recording and one generated image."}',
			report: '{"validation_state":"Valid"}',
			status: "unrecognised_issuer",
			signerName: "Example Signer",
			signerIssuer: "Example CA",
			timestamped: true,
			signedAt: "2026-11-06T09:00:00.250Z",
			statementLegacyId: 5,
		});
		expect(plan().statements).toEqual([
			{
				legacyId: 5,
				asset: "produced:2",
				text: "Made from a recording and one generated image.",
				author: "An Editor",
				organization: "Example Studio",
				editedWith: "Example Editor 1",
				savedAt: "2026-11-05T09:10:00.000Z",
			},
		]);
		const later = plan(
			fixtureText((rows) => {
				rows["public.creator_statements"][0].updated_at =
					"2026-11-07 10:00:00+01";
			}),
		);
		expect(later.signatures[0].statementLegacyId).toBeNull();
	});

	it("ignores a stored hash that is not a SHA-256, with a note", () => {
		const p = plan(
			fixtureText((rows) => {
				rows["public.produced_assets"][0].file_hash = "md5:abc";
			}),
		);
		expect(p.assets[2].file.sha256).toBeNull();
		expect(p.notes).toContain(
			"produced:1: the stored hash is not a SHA-256 (md5:abc); it is ignored",
		);
	});

	it("names the row and column of a value it cannot read", () => {
		expect(() =>
			plan(
				fixtureText((rows) => {
					rows["public.assets"][0].origin_ingredient_classes = "[not json";
				}),
			),
		).toThrow(/public\.assets 1 origin_ingredient_classes/);
	});
});

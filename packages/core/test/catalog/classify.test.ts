import { describe, it, expect } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import {
	classifyCatalog,
	exifDate,
	generationFields,
} from "../../src/catalog/classify.ts";
import { createRow, editRow, type Actor } from "../../src/catalog/edit.ts";
import { placeWriter } from "../../src/catalog/locations.ts";
import { assetRecord } from "../../src/catalog/read.ts";
import { finishRun, startRun } from "../../src/catalog/runs.ts";
import { PERSON, TEST_TOOL, sha } from "../helpers/catalog.ts";
import { catalogsForTests } from "../helpers/catalog-tests.ts";

const { catalog } = catalogsForTests();
const AT = "2026-11-23T12:00:00.000Z";
const AI =
	"http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";
const CAPTURE = "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture";

/** A manifest store as c2patool returns it, with one actions assertion. */
function store(opts: {
	generator: string;
	signer: string;
	/** The signer certificate's issuer; the signer's own name if not given. */
	issuer?: string;
	action: string;
	sourceType?: string;
	ingredients?: unknown[];
	/**
	 * What the reader found: a signer on the trust list, a claim that verified
	 * under a certificate no list knows (the usual case, and the default), or
	 * a signature that does not verify.
	 */
	read?: "trusted" | "unrecognised" | "broken";
}) {
	const read = opts.read ?? "unrecognised";
	return {
		validation_results: {
			activeManifest: {
				success:
					read === "trusted"
						? [
								{ code: "claimSignature.validated" },
								{ code: "signingCredential.trusted" },
							]
						: [],
				failure:
					read === "broken"
						? [
								{ code: "claimSignature.mismatch" },
								{ code: "signingCredential.untrusted" },
							]
						: read === "unrecognised"
							? [{ code: "signingCredential.untrusted" }]
							: [],
			},
		},
		active_manifest: "m1",
		manifests: {
			m1: {
				claim_generator_info: [{ name: opts.generator }],
				assertions: [
					{
						label: "c2pa.actions.v2",
						data: {
							actions: [
								{
									action: opts.action,
									...(opts.sourceType
										? { digitalSourceType: opts.sourceType }
										: {}),
								},
							],
						},
					},
				],
				ingredients: opts.ingredients ?? [],
				signature_info: {
					issuer: opts.issuer ?? opts.signer,
					common_name: opts.signer,
				},
			},
		},
	};
}

const COMFY = {
	prompt: JSON.stringify({
		"1": {
			class_type: "CheckpointLoaderSimple",
			inputs: { ckpt_name: "example-model.safetensors" },
		},
		"2": {
			class_type: "CLIPTextEncode",
			inputs: { text: "a wooden door in rain" },
		},
		"3": {
			class_type: "KSampler",
			inputs: {
				seed: 42,
				steps: 20,
				cfg: 7,
				sampler_name: "euler",
				scheduler: "normal",
			},
		},
		"4": {
			class_type: "EmptyLatentImage",
			inputs: { width: 1024, height: 768 },
		},
	}),
};

/** A catalog world: one root, and helpers to add files and what was read from them. */
function world() {
	const db = catalog();
	const root = Number(
		createRow(
			db,
			"roots",
			{ name: "media", folder_in_project: "media" },
			PERSON,
		),
	);
	const scan = startRun(db, { kind: "scan", tool: TEST_TOOL, now: AT });
	const scanActor: Actor = {
		kind: "tool",
		name: "provenancetracker-test 0.0.0",
		runId: scan,
	};
	let n = 0;
	/** A file found by a scan: an unsorted asset, its content and place. */
	const file = (path: string) => {
		const id = Number(
			createRow(
				db,
				"assets",
				{ kind: "unsorted" },
				{ actor: scanActor, now: AT },
			),
		);
		const content = sha((++n).toString(16));
		createRow(
			db,
			"contents",
			{ sha256: content, size: 10, asset_id: id, first_run_id: scan },
			{ actor: scanActor, now: AT },
		);
		placeWriter(db)({
			sha256: content,
			rootId: root,
			path,
			modifiedMs: 0,
			runId: scan,
		});
		return { id, content };
	};
	const read = (
		content: string,
		kind: string,
		status: string,
		data: unknown = null,
		/** The sidecar that was read, for a sidecar reading. */
		source: string | null = null,
	) => {
		const run = startRun(db, { kind: "extract", tool: TEST_TOOL, now: AT });
		const r = db
			.prepare(
				"INSERT INTO observations (content_sha256, source_sha256, run_id, kind, extractor, extractor_version, status, data, observed_at) VALUES (?, ?, ?, ?, 'x', '1', ?, ?, ?)",
			)
			.run(
				content,
				source,
				run,
				kind,
				status,
				data === null ? null : JSON.stringify(data),
				AT,
			);
		finishRun(db, run, { outcome: "ok", now: AT });
		return Number(r.lastInsertRowid);
	};
	finishRun(db, scan, { outcome: "ok", now: AT });
	return { db, file, read };
}

const asset = (db: DatabaseSync, id: number) =>
	db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as Record<
		string,
		unknown
	>;

describe("classify", () => {
	it("makes an unsorted file a model signed as generated, with its class, rule and signer", () => {
		const { db, file, read } = world();
		const f = file("sound/theme.wav");
		const c2pa = read(
			f.content,
			"c2pa",
			"ok",
			store({
				generator: "Example Audio AI",
				signer: "Example Audio Inc.",
				action: "c2pa.created",
				sourceType: AI,
			}),
		);
		const report = classifyCatalog(db, { tool: TEST_TOOL, now: () => AT });
		expect(report).toMatchObject({
			examined: 1,
			changed: 1,
			generationAdded: 0,
		});
		expect(asset(db, f.id)).toMatchObject({
			kind: "generated",
			origin_class: "trainedAlgorithmicMedia",
			origin_class_source: "c2pa_generated_action",
			origin_class_confirmed: 0,
			signed_by: "tool",
			signer_name: "Example Audio Inc.",
		});
		const h = db
			.prepare(
				"SELECT actor_kind, actor, run_id, field, evidence FROM history WHERE table_name = 'assets' AND row_key = ? AND run_id = ?",
			)
			.all(String(f.id), report.runId!) as Array<Record<string, unknown>>;
		expect(h.map((e) => e.field).sort()).toEqual([
			"kind",
			"origin_class",
			"origin_class_source",
			"signed_by",
			"signer_name",
		]);
		expect(
			h.every(
				(e) =>
					e.actor_kind === "tool" && e.actor === "provenancetracker-test 0.0.0",
			),
		).toBe(true);
		expect(JSON.parse(h[0].evidence as string)).toEqual({
			rule: "c2pa_generated_action",
			kind_rule: "c2pa_generated_action",
			content: f.content,
			readings: { c2pa: c2pa },
			platform: "unknown",
		});
		expect(
			db
				.prepare("SELECT kind, outcome FROM runs WHERE id = ?")
				.get(report.runId!),
		).toEqual({ kind: "classify", outcome: "ok" });
	});

	it("recognises an AI platform from what the file holds, and adds its generation details", () => {
		const { db, file, read } = world();
		const f = file("ai/door.png");
		read(f.content, "png-text", "ok", COMFY);
		read(f.content, "exif", "ok", {
			MIMEType: "image/png",
			CreateDate: "2026:10:15 12:00:00",
		});
		const report = classifyCatalog(db, { tool: TEST_TOOL, now: () => AT });
		expect(report.generationAdded).toBe(1);
		expect(asset(db, f.id)).toMatchObject({
			kind: "generated",
			origin_class: "trainedAlgorithmicMedia",
			origin_class_source: "platform_parser",
		});
		expect(
			db
				.prepare(
					"SELECT platform, model_name, prompt, seed, steps, cfg_scale, sampler, scheduler, width, height, generated_at FROM generation WHERE asset_id = ?",
				)
				.get(f.id),
		).toEqual({
			platform: "comfyui",
			model_name: "example-model.safetensors",
			prompt: "a wooden door in rain",
			seed: "42",
			steps: 20,
			cfg_scale: "7",
			sampler: "euler",
			scheduler: "normal",
			width: 1024,
			height: 768,
			generated_at: "2026-10-15",
		});
	});

	it("makes a camera's signed capture produced, and leaves a file that says nothing unsorted, with no rule written", () => {
		const { db, file, read } = world();
		const cam = file("camera/PXL_1.mp4");
		read(
			cam.content,
			"c2pa",
			"ok",
			store({
				generator: "Pixel Camera",
				signer: "Google LLC",
				action: "c2pa.created",
				sourceType: CAPTURE,
				read: "trusted",
			}),
		);
		const plain = file("notes/readme.txt");
		read(plain.content, "exif", "ok", { MIMEType: "text/plain" });
		read(plain.content, "c2pa", "absent");
		classifyCatalog(db, { tool: TEST_TOOL, now: () => AT });
		expect(asset(db, cam.id)).toMatchObject({
			kind: "produced",
			origin_class: "digitalCapture",
			origin_class_source: "c2pa_capture_action",
			signed_by: "device",
		});
		expect(asset(db, plain.id)).toMatchObject({
			kind: "unsorted",
			origin_class: "unknown",
			origin_class_source: "",
		});
		expect(
			db
				.prepare(
					"SELECT count(*) AS n FROM history WHERE row_key = ? AND table_name = 'assets' AND run_id IS NOT NULL AND field <> 'kind'",
				)
				.get(String(plain.id)),
		).toEqual({ n: 0 });
	});

	it("reads a .c2pa sidecar when the file has no manifest of its own", () => {
		const { db, file, read } = world();
		const f = file("camera/RAW_1.cr2");
		read(f.content, "c2pa", "absent");
		read(
			f.content,
			"c2pa-sidecar",
			"ok",
			store({
				generator: "Example Camera",
				signer: "Example Camera Co",
				action: "c2pa.created",
				sourceType: CAPTURE,
			}),
		);
		classifyCatalog(db, { tool: TEST_TOOL, now: () => AT });
		expect(asset(db, f.id)).toMatchObject({
			kind: "produced",
			origin_class: "digitalCapture",
		});
	});

	it("never changes what a person set, what came from Postgres, or a confirmed class", () => {
		const { db, file, read } = world();
		const generated = () =>
			store({
				generator: "Example AI",
				signer: "Example AI Inc.",
				action: "c2pa.created",
				sourceType: AI,
			});
		const mine = file("a.wav");
		const legacy = file("b.wav");
		const confirmed = file("c.wav");
		for (const f of [mine, legacy, confirmed])
			read(f.content, "c2pa", "ok", generated());
		editRow(
			db,
			"assets",
			mine.id,
			{ kind: "produced", origin_class: "digitalCapture" },
			PERSON,
		);
		editRow(
			db,
			"assets",
			legacy.id,
			{ kind: "archival", origin_class: "print", signed_by: "creator" },
			{ actor: { kind: "legacy", name: "Postgres import" }, now: AT },
		);
		editRow(
			db,
			"assets",
			confirmed.id,
			{ origin_class: "digitalCreation", origin_class_confirmed: true },
			{ actor: { kind: "tool", name: "an old run" }, now: AT },
		);
		const report = classifyCatalog(db, { tool: TEST_TOOL, now: () => AT });
		expect(asset(db, mine.id)).toMatchObject({
			kind: "produced",
			origin_class: "digitalCapture",
		});
		expect(asset(db, legacy.id)).toMatchObject({
			kind: "archival",
			origin_class: "print",
		});
		expect(asset(db, confirmed.id)).toMatchObject({
			origin_class: "digitalCreation",
		});
		// Who signed the file is what the file says: kept current where a tool or nobody set it.
		expect(asset(db, mine.id)).toMatchObject({
			signed_by: "tool",
			signer_name: "Example AI Inc.",
		});
		expect(asset(db, legacy.id)).toMatchObject({ signed_by: "creator" });
		// Kind is proposed only for unsorted assets, so a sorted one has none to keep.
		const kept = report.assets.flatMap((a) =>
			a.kept.map((k) => `${a.assetId} ${k.field} ${k.by}`),
		);
		expect(kept).toEqual([
			`${mine.id} origin_class person`,
			`${legacy.id} origin_class legacy`,
			`${legacy.id} signed_by legacy`,
			`${confirmed.id} origin_class confirmed`,
		]);
	});

	it("reads an asset's own file, never its signed copy", () => {
		const { db, file, read } = world();
		const f = file("exports/film.mp4");
		read(
			f.content,
			"c2pa",
			"ok",
			store({
				generator: "Example Editor",
				signer: "Example Editor Co",
				action: "c2pa.created",
				sourceType: CAPTURE,
			}),
		);
		const signRun = startRun(db, { kind: "sign", tool: TEST_TOOL, now: AT });
		const signed = sha("f");
		// Created later than the film's own file: newest, but a signed copy.
		createRow(
			db,
			"contents",
			{ sha256: signed, size: 11, asset_id: f.id, first_run_id: signRun },
			{
				actor: { kind: "tool", name: "t", runId: signRun },
				now: "2026-12-01T00:00:00.000Z",
			},
		);
		db.prepare(
			"INSERT INTO signatures (asset_id, kind, version, source_sha256, signed_sha256, run_id, engine, definition, signed_at) VALUES (?, 'output', 1, ?, ?, ?, 'c2patool', '{}', ?)",
		).run(f.id, f.content, signed, signRun, AT);
		finishRun(db, signRun, { outcome: "ok", now: AT });
		read(
			signed,
			"c2pa",
			"ok",
			store({
				generator: "provenance-tracker",
				signer: "A. Maker",
				action: "c2pa.opened",
			}),
		);
		const report = classifyCatalog(db, { tool: TEST_TOOL, now: () => AT });
		expect(report.assets[0].contentSha256).toBe(f.content);
		expect(asset(db, f.id)).toMatchObject({
			origin_class: "digitalCapture",
			signer_name: "Example Editor Co",
		});
	});

	it("calls a file device-signed only under a trusted signer, and names no signer from a broken claim (D67)", () => {
		const { db, file, read } = world();
		const words = {
			generator: "Pixel Camera",
			signer: "Google LLC",
			action: "c2pa.created",
			sourceType: CAPTURE,
		};
		const real = file("takes/real.mp4");
		const lookalike = file("takes/lookalike.mp4");
		const forged = file("takes/forged.mp4");
		read(real.content, "c2pa", "ok", store({ ...words, read: "trusted" }));
		// The same words under a certificate anyone could make.
		read(lookalike.content, "c2pa", "ok", store(words));
		// The same words, and a signature that does not verify.
		read(forged.content, "c2pa", "ok", store({ ...words, read: "broken" }));
		classifyCatalog(db, { tool: TEST_TOOL, now: () => AT });
		expect(asset(db, real.id)).toMatchObject({
			signed_by: "device",
			signer_name: "Google LLC",
		});
		expect(asset(db, lookalike.id)).toMatchObject({
			signed_by: "tool",
			signer_name: "Google LLC",
		});
		// Nobody is said to have signed it: the name is kept as what its
		// credentials say, marked as not verified. The class it declares is
		// still proposed, for a person to confirm or not.
		expect(asset(db, forged.id)).toMatchObject({
			signed_by: "unverified",
			signer_name: "Google LLC",
			origin_class: "digitalCapture",
			origin_class_confirmed: 0,
		});
		// The asset's page can say why, in the reader's own words.
		const reading = (id: number) =>
			assetRecord(db, id)!.contents[0].readings.find((r) => r.kind === "c2pa")!
				.credentials;
		expect(reading(forged.id)).toEqual({
			signer: "Google LLC",
			issuer: "Google LLC",
			generator: "Pixel Camera",
			verdict: "invalid",
			label: "Invalid",
			contentMatches: false,
			failures: [
				{ code: "claimSignature.mismatch", explanation: "" },
				{ code: "signingCredential.untrusted", explanation: "" },
			],
		});
		expect(reading(real.id)).toMatchObject({
			signer: "Google LLC",
			verdict: "valid",
			failures: [],
		});
		expect(reading(lookalike.id)).toMatchObject({
			verdict: "unrecognised_issuer",
		});
	});

	it("knows a file as signed by the creator only by the catalog's own signing record, never by a name (D67)", () => {
		const { db, file, read } = world();
		const mine = {
			generator: "provenance-tracker",
			signer: "A. Creator",
			issuer: "Studio Dev Root CA",
			action: "c2pa.created",
			sourceType: CAPTURE,
		};
		// The project has signed with a certificate of that name before.
		const film = file("exports/film.mp4");
		const signRun = startRun(db, { kind: "sign", tool: TEST_TOOL, now: AT });
		const signedFilm = sha("e");
		createRow(
			db,
			"contents",
			{
				sha256: signedFilm,
				size: 11,
				asset_id: film.id,
				first_run_id: signRun,
			},
			{ actor: { kind: "tool", name: "t", runId: signRun }, now: AT },
		);
		db.prepare(
			"INSERT INTO signatures (asset_id, kind, version, source_sha256, signed_sha256, run_id, engine, signer_name, signer_issuer, certificate_sha256, definition, signed_at) VALUES (?, 'output', 1, ?, ?, ?, 'c2pa-node', 'A. Creator', 'Studio Dev Root CA', ?, '{}', ?)",
		).run(film.id, film.content, signedFilm, signRun, "c".repeat(64), AT);

		// A file that names the same signer and issuer, and this tracker as its
		// generator: anyone can make that certificate and write those words.
		const lookalike = file("takes/take-01.mp4");
		read(lookalike.content, "c2pa", "ok", store(mine));

		// A take the project signed itself, into a sidecar the catalog recorded.
		const take = file("takes/take-02.mp4");
		const sidecar = sha("d");
		createRow(
			db,
			"contents",
			{ sha256: sidecar, size: 12, asset_id: take.id, first_run_id: signRun },
			{ actor: { kind: "tool", name: "t", runId: signRun }, now: AT },
		);
		db.prepare(
			"INSERT INTO signatures (asset_id, kind, version, source_sha256, signed_sha256, run_id, engine, signer_name, signer_issuer, certificate_sha256, definition, signed_at) VALUES (?, 'asset', 1, ?, ?, ?, 'c2pa-node', 'A. Creator', 'Studio Dev Root CA', ?, '{}', ?)",
		).run(take.id, take.content, sidecar, signRun, "c".repeat(64), AT);
		finishRun(db, signRun, { outcome: "ok", now: AT });
		read(take.content, "c2pa", "absent");
		read(take.content, "c2pa-sidecar", "ok", store(mine), sidecar);

		// And one with a sidecar the catalog did not write, saying the same.
		const other = file("takes/take-03.mp4");
		read(other.content, "c2pa", "absent");
		read(
			other.content,
			"c2pa-sidecar",
			"ok",
			store(mine),
			file("takes/take-03.c2pa").content,
		);

		const report = classifyCatalog(db, { tool: TEST_TOOL, now: () => AT });
		expect(asset(db, lookalike.id)).toMatchObject({
			signed_by: "tool",
			signer_name: "A. Creator",
		});
		expect(asset(db, other.id).signed_by).toBe("tool");
		expect(asset(db, take.id)).toMatchObject({
			signed_by: "creator",
			signer_name: "A. Creator",
		});
		// The evidence names the certificate, by its fingerprint.
		expect(
			report.assets.find((a) => a.assetId === take.id)?.evidence,
		).toMatchObject({ signed_here_with: "c".repeat(64) });
		expect(
			report.assets.find((a) => a.assetId === lookalike.id)?.evidence,
		).not.toHaveProperty("signed_here_with");
	});

	it("changes nothing when run again, follows a newer reading, and writes nothing on a dry run", () => {
		const { db, file, read } = world();
		const f = file("x.wav");
		read(
			f.content,
			"c2pa",
			"ok",
			store({
				generator: "Example AI",
				signer: "Example AI Inc.",
				action: "c2pa.created",
				sourceType: AI,
			}),
		);
		const dry = classifyCatalog(db, { tool: TEST_TOOL, dryRun: true });
		expect(dry.runId).toBeNull();
		expect(dry.changed).toBe(1);
		expect(asset(db, f.id).kind).toBe("unsorted");
		expect(
			db
				.prepare("SELECT count(*) AS n FROM runs WHERE kind = 'classify'")
				.get(),
		).toEqual({ n: 0 });

		classifyCatalog(db, { tool: TEST_TOOL, now: () => AT });
		const again = classifyCatalog(db, { tool: TEST_TOOL, now: () => AT });
		expect(again.changed).toBe(0);

		// A newer reading (a re-read with a newer reader): a tool's value follows it.
		read(
			f.content,
			"c2pa",
			"ok",
			store({
				generator: "Example AI",
				signer: "Example AI Ltd",
				action: "c2pa.created",
				sourceType: AI,
			}),
		);
		classifyCatalog(db, { tool: TEST_TOOL, now: () => AT });
		expect(asset(db, f.id).signer_name).toBe("Example AI Ltd");
	});

	it("is not misled by a reader that was not available on some machine (D51)", () => {
		const { db, file, read } = world();
		const f = file("y.wav");
		read(
			f.content,
			"c2pa",
			"ok",
			store({
				generator: "Example AI",
				signer: "Example AI Inc.",
				action: "c2pa.created",
				sourceType: AI,
			}),
		);
		// Read again where the library was not installed: says nothing about the file.
		read(f.content, "c2pa", "unavailable");
		classifyCatalog(db, { tool: TEST_TOOL, now: () => AT });
		expect(asset(db, f.id)).toMatchObject({
			kind: "generated",
			signer_name: "Example AI Inc.",
		});
	});

	it("leaves removed assets alone", () => {
		const { db, file, read } = world();
		const f = file("gone.wav");
		read(
			f.content,
			"c2pa",
			"ok",
			store({
				generator: "Example AI",
				signer: "S",
				action: "c2pa.created",
				sourceType: AI,
			}),
		);
		editRow(db, "assets", f.id, { removed_at: AT }, PERSON);
		expect(
			classifyCatalog(db, { tool: TEST_TOOL, now: () => AT }),
		).toMatchObject({ examined: 0, changed: 0 });
	});
});

describe("exifDate and generationFields", () => {
	it("reads ExifTool dates as YYYY-MM-DD, and none for an empty one", () => {
		expect(exifDate("2026:10:15 12:00:00")).toBe("2026-10-15");
		expect(exifDate({ rawValue: "2026:10:15 12:00:00+01:00" })).toBe(
			"2026-10-15",
		);
		expect(exifDate("0000:00:00 00:00:00")).toBe("");
		expect(exifDate(undefined)).toBe("");
	});

	it("maps a parser's output to the catalog's fields, with 0 as not known", () => {
		expect(
			generationFields(
				"example",
				{
					modelName: "m",
					steps: 0,
					width: "512",
					loras: "not a list",
					otherParams: { a: 1 },
				},
				{},
			),
		).toMatchObject({
			platform: "example",
			model_name: "m",
			steps: null,
			width: 512,
			height: null,
			loras: [],
			controlnets: [],
			other: { a: 1 },
			generated_at: "",
		});
	});
});

import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createRow } from "../../src/catalog/edit.ts";
import { startRun } from "../../src/catalog/runs.ts";
import { catalogsForTests } from "../helpers/catalog-tests.ts";
import { sha, TEST_TOOL } from "../helpers/catalog.ts";

const t = catalogsForTests();
const AT = "2026-11-21T12:00:00.000Z";

/** A content with ExifTool readings, newest last. */
function withReadings(
	db: DatabaseSync,
	c: string,
	...readings: Array<{ status?: string; version?: string; data: unknown }>
) {
	const runId = startRun(db, { kind: "extract", tool: TEST_TOOL, now: AT });
	const opts = {
		actor: { kind: "tool" as const, name: "test", runId },
		now: AT,
	};
	const assetId = createRow(db, "assets", { kind: "unsorted" }, opts);
	createRow(
		db,
		"contents",
		{ sha256: sha(c), size: 1, asset_id: assetId, first_run_id: runId },
		opts,
	);
	for (const r of readings)
		db.prepare(
			`INSERT INTO observations (content_sha256, run_id, kind, extractor, extractor_version, status, data, observed_at)
			 VALUES (?, ?, 'exif', 'exiftool', ?, ?, ?, ?)`,
		).run(
			sha(c),
			runId,
			r.version ?? "13.0",
			r.status ?? "ok",
			r.status === "unreadable" ? null : JSON.stringify(r.data),
			AT,
		);
	return sha(c);
}

function technical(db: DatabaseSync, content: string) {
	return db
		.prepare("SELECT * FROM technical WHERE content_sha256 = ?")
		.get(content) as Record<string, unknown> | undefined;
}

describe("the technical view", () => {
	it("reads an MP4's values under their MP4 names", () => {
		const db = t.catalog();
		const c = withReadings(db, "a", {
			data: {
				MIMEType: "video/mp4",
				Duration: 272.8239,
				ImageWidth: 3840,
				ImageHeight: 2160,
				VideoFrameRate: 29.994,
				CompressorID: "hvc1",
				AudioFormat: "mp4a",
				AudioSampleRate: 48000,
				AudioChannels: 2,
				AudioBitsPerSample: 16,
			},
		});
		expect(technical(db, c)).toMatchObject({
			mime_type: "video/mp4",
			duration_seconds: 272.8239,
			width: 3840,
			height: 2160,
			frame_rate: 29.994,
			video_codec: "hvc1",
			audio_codec: "mp4a",
			sample_rate: 48000,
			channels: 2,
			bits_per_sample: 16,
			exiftool_version: "13.0",
		});
	});

	it("reads a WAV's values under their WAV names, and a duration given as Value × Scale", () => {
		const db = t.catalog();
		const c = withReadings(db, "b", {
			data: {
				MIMEType: "audio/x-wav",
				Duration: { Scale: 1 / 90000, Value: 13127040 },
				Encoding: "Microsoft PCM",
				SampleRate: 48000,
				NumChannels: 2,
				BitsPerSample: 24,
			},
		});
		const row = technical(db, c)!;
		expect(row).toMatchObject({
			audio_codec: "Microsoft PCM",
			sample_rate: 48000,
			channels: 2,
			bits_per_sample: 24,
			width: null,
		});
		expect(row.duration_seconds as number).toBeCloseTo(145.856, 3);
	});

	it("ignores an image's Encoding and BitsPerSample, which are not audio", () => {
		const db = t.catalog();
		const c = withReadings(db, "c", {
			data: {
				MIMEType: "image/png",
				ImageWidth: 301,
				ImageHeight: 200,
				BitsPerSample: 8,
				Encoding: "x",
			},
		});
		expect(technical(db, c)).toMatchObject({
			width: 301,
			height: 200,
			audio_codec: null,
			bits_per_sample: null,
			duration_seconds: null,
		});
	});

	it("uses the newest successful reading, so a newer ExifTool's values win", () => {
		const db = t.catalog();
		const c = withReadings(
			db,
			"d",
			{ version: "12.0", data: { MIMEType: "video/quicktime", ImageWidth: 1 } },
			{
				version: "13.0",
				data: { MIMEType: "video/quicktime", ImageWidth: 1920 },
			},
			{ version: "14.0", status: "unreadable", data: null },
		);
		expect(technical(db, c)).toMatchObject({
			width: 1920,
			exiftool_version: "13.0",
		});
	});

	it("has no row for a content nobody has read yet", () => {
		const db = t.catalog();
		const c = withReadings(db, "e");
		expect(technical(db, c)).toBeUndefined();
	});
});

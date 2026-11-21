import { afterAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { crc32 } from "node:zlib";
import { editRow, type Actor } from "@provenancetracker/core/catalog/edit.ts";
import { verifyCatalog } from "@provenancetracker/core/catalog/verify.ts";
import { makeObservation } from "@provenancetracker/core/extraction/observation.ts";
import { endExifTool } from "../src/extract/exiftool.ts";
import {
	extractProject,
	machineReaders,
	SIDECAR,
	type Reader,
} from "../src/extract.ts";
import type { Machine } from "../src/machine.ts";
import {
	createProject,
	openProject,
	type OpenProject,
} from "../src/project.ts";
import { addRoot } from "../src/roots.ts";
import { scanProject } from "../src/scan.ts";
import { machinesForTests } from "./helpers/machine.ts";

const t = machinesForTests();
const ME: Actor = { kind: "person", name: "A. Maker" };
afterAll(() => endExifTool());

const sha = (b: Buffer | string) =>
	createHash("sha256").update(b).digest("hex");

/** A real 1×1 PNG, with valid CRCs, carrying text chunks. */
function png(text: Record<string, string> = {}): Buffer {
	const chunk = (name: string, data: Buffer) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(name, "ascii"), data])));
		return Buffer.concat([len, Buffer.from(name, "ascii"), data, crc]);
	};
	const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]);
	// One grey pixel: filter byte 0, value 0x80, deflated.
	const idat = Buffer.from("789c63680000008200 81".replace(/ /g, ""), "hex");
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", ihdr),
		...Object.entries(text).map(([k, v]) =>
			chunk("tEXt", Buffer.from(`${k}\0${v}`, "latin1")),
		),
		chunk("IDAT", idat),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

const XMP = (
	title: string,
) => `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title}</rdf:li></rdf:Alt></dc:title>
</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;

/** A stand-in C2PA reader: every file has no manifest; a sidecar is read "ok". */
function fakeC2pa(version = "0.0.1", calls: string[] = []): Reader[] {
	return [
		{
			kind: "c2pa",
			extractor: "c2patool",
			version,
			read: async (f) => {
				calls.push(path.basename(f));
				return makeObservation({
					kind: "c2pa",
					extractor: "c2patool",
					version,
					status: "absent",
				});
			},
		},
		{
			kind: "c2pa-sidecar",
			extractor: "c2patool",
			version,
			read: async (f, sidecar) => {
				calls.push(`${path.basename(f)} + ${path.basename(sidecar!)}`);
				return makeObservation({
					kind: "c2pa-sidecar",
					extractor: "c2patool",
					version,
					status: "ok",
					data: { active_manifest: "m", manifests: { m: {} } },
					validation: {
						state: "Valid",
						failures: [],
						statuses: [],
						results: null,
					},
				});
			},
		},
	];
}

async function readers(
	m: Machine,
	c2pa: Reader[] = fakeC2pa(),
): Promise<Reader[]> {
	const real = (await machineReaders(m)).filter(
		(r) => r.extractor !== "c2patool",
	);
	return [...real, ...c2pa];
}

function setup(): { m: Machine; p: OpenProject; media: string } {
	const m = t.machine();
	const made = createProject(t.folder("film"), { name: "Film", machine: m });
	const p = t.track(openProject(made.folder, { machine: m }));
	const media = t.folder("Media");
	addRoot(p, m, { name: "media", folder: media, actor: ME });
	return { m, p, media };
}

function put(folder: string, rel: string, bytes: Buffer | string): void {
	const file = path.join(folder, ...rel.split("/"));
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, bytes);
}

function observations(p: OpenProject) {
	return p.db
		.prepare(
			`SELECT content_sha256 AS sha256, source_sha256 AS source, kind, extractor, extractor_version AS version,
			        status, data FROM observations ORDER BY id`,
		)
		.all() as Array<{
		sha256: string;
		source: string | null;
		kind: string;
		extractor: string;
		version: string;
		status: string;
		data: string | null;
	}>;
}

describe("extractProject", () => {
	it("reads each file once with each reader, and keeps what they said", async () => {
		const { m, p, media } = setup();
		const still = png({ parameters: "a harbour at dawn, steps 30" });
		put(media, "still.png", still);
		put(media, "notes.txt", "shot list");
		await scanProject(p, m);
		const report = await extractProject(p, m, { readers: await readers(m) });
		expect(report.outcome).toBe("ok");
		expect(report.contents).toBe(2);
		expect(report.written).toEqual({
			"exif ok": 2,
			"c2pa absent": 2,
			"png-text ok": 1,
			"png-text absent": 1,
		});
		const forStill = observations(p).filter((o) => o.sha256 === sha(still));
		const exif = JSON.parse(forStill.find((o) => o.kind === "exif")!.data!);
		expect(exif).toMatchObject({
			MIMEType: "image/png",
			ImageWidth: 1,
			ImageHeight: 1,
		});
		// Where the file sits is not part of what it says.
		expect(exif.FileName).toBeUndefined();
		expect(
			JSON.parse(forStill.find((o) => o.kind === "png-text")!.data!),
		).toEqual({
			parameters: "a harbour at dawn, steps 30",
		});
		const run = p.db
			.prepare("SELECT kind, outcome FROM runs WHERE id = ?")
			.get(report.runId);
		expect(run).toEqual({ kind: "extract", outcome: "ok" });
		expect(verifyCatalog(p.db)).toEqual([]);
	});

	it("reads nothing the second time, and again only for a reader's new version", async () => {
		const { m, p, media } = setup();
		put(media, "a.txt", "a");
		await scanProject(p, m);
		await extractProject(p, m, { readers: await readers(m) });
		const again = await extractProject(p, m, { readers: await readers(m) });
		expect(again).toMatchObject({ contents: 0, written: {} });
		const calls: string[] = [];
		const newer = await extractProject(p, m, {
			readers: await readers(m, fakeC2pa("0.0.2", calls)),
		});
		expect(newer.written).toEqual({ "c2pa absent": 1 });
		expect(calls).toEqual(["a.txt"]);
		// The old reading stays beside the new one.
		expect(
			observations(p)
				.filter((o) => o.kind === "c2pa")
				.map((o) => o.version),
		).toEqual(["0.0.1", "0.0.2"]);
		// Asked to, it reads everything again, beside what it read before.
		const before = observations(p).length;
		const forced = await extractProject(p, m, {
			readers: await readers(m),
			again: true,
		});
		expect(forced.contents).toBe(1);
		expect(observations(p).length).toBe(before + 3);
	});

	it("reads identical files once", async () => {
		const { m, p, media } = setup();
		put(media, "a.txt", "same");
		put(media, "copy/a.txt", "same");
		await scanProject(p, m);
		const calls: string[] = [];
		const report = await extractProject(p, m, {
			readers: await readers(m, fakeC2pa("0.0.1", calls)),
		});
		expect(report.contents).toBe(1);
		expect(calls).toEqual(["a.txt"]);
	});

	it("reads an .xmp sidecar as part of its file, and files the sidecar under it", async () => {
		const { m, p, media } = setup();
		put(media, "day 1/IMG_1.CR2", "raw bytes");
		put(media, "day 1/IMG_1.xmp", XMP("Street interview"));
		await scanProject(p, m);
		const report = await extractProject(p, m, { readers: await readers(m) });
		expect(report.sidecars).toBe(1);
		const sidecarObs = observations(p).filter((o) => o.kind === "xmp-sidecar");
		expect(sidecarObs).toHaveLength(1);
		expect(sidecarObs[0]).toMatchObject({
			sha256: sha("raw bytes"),
			source: sha(XMP("Street interview")),
			status: "ok",
		});
		expect(JSON.parse(sidecarObs[0].data!).Title).toBe("Street interview");
		const assets = p.db
			.prepare(
				`SELECT a.kind, l.path FROM assets a JOIN contents c ON c.asset_id = a.id
				 JOIN locations l ON l.content_sha256 = c.sha256 ORDER BY l.path`,
			)
			.all();
		expect(assets).toEqual([
			{ kind: "unsorted", path: "day 1/IMG_1.CR2" },
			{ kind: SIDECAR, path: "day 1/IMG_1.xmp" },
		]);
		expect(
			p.db.prepare("SELECT type, match_method FROM relationships").all(),
		).toEqual([{ type: "sidecar_of", match_method: "filename_pattern" }]);
		expect(verifyCatalog(p.db)).toEqual([]);

		// A second extract links nothing twice; an edited sidecar is read again.
		await extractProject(p, m, { readers: await readers(m) });
		expect(
			p.db.prepare("SELECT count(*) AS n FROM relationships").get(),
		).toEqual({ n: 1 });
		put(media, "day 1/IMG_1.xmp", XMP("Street interview, take 2"));
		await scanProject(p, m);
		const reread = await extractProject(p, m, { readers: await readers(m) });
		expect(reread.written).toMatchObject({ "xmp-sidecar ok": 1 });
		expect(
			observations(p).filter((o) => o.kind === "xmp-sidecar"),
		).toHaveLength(2);
	});

	it("never overrides a kind a person chose for a sidecar's asset", async () => {
		const { m, p, media } = setup();
		put(media, "a.mov", "video");
		put(media, "a.xmp", XMP("x"));
		await scanProject(p, m);
		const xmpAsset = (
			p.db
				.prepare(
					"SELECT c.asset_id AS id FROM contents c JOIN locations l ON l.content_sha256 = c.sha256 WHERE l.path = 'a.xmp'",
				)
				.get() as { id: number }
		).id;
		editRow(p.db, "assets", xmpAsset, { kind: "archival" }, { actor: ME });
		await extractProject(p, m, { readers: await readers(m) });
		expect(
			p.db.prepare("SELECT kind FROM assets WHERE id = ?").get(xmpAsset),
		).toEqual({ kind: "archival" });
	});

	it("reads a .c2pa sidecar against the file it sits beside", async () => {
		const { m, p, media } = setup();
		put(media, "still.jpg", "jpeg");
		put(media, "still.c2pa", "manifest store");
		await scanProject(p, m);
		const calls: string[] = [];
		const report = await extractProject(p, m, {
			readers: await readers(m, fakeC2pa("0.0.1", calls)),
		});
		expect(calls).toContain("still.jpg + still.c2pa");
		expect(report.written["c2pa-sidecar ok"]).toBe(1);
		const row = p.db
			.prepare(
				"SELECT content_sha256 AS sha256, source_sha256 AS source, validation FROM observations WHERE kind = 'c2pa-sidecar'",
			)
			.get() as { sha256: string; source: string; validation: string };
		expect(row).toMatchObject({
			sha256: sha("jpeg"),
			source: sha("manifest store"),
		});
		expect(JSON.parse(row.validation).state).toBe("Valid");
	});

	it("skips a file that changed since the scan, and reads it after the next scan", async () => {
		const { m, p, media } = setup();
		put(media, "a.txt", "one");
		await scanProject(p, m);
		put(media, "a.txt", "one, then more");
		const report = await extractProject(p, m, { readers: await readers(m) });
		expect(report.skipped).toEqual([
			expect.objectContaining({
				path: "a.txt",
				reason: "changed or gone since the last scan; scan again",
			}),
		]);
		expect(observations(p)).toEqual([]);
		await scanProject(p, m);
		expect(
			(await extractProject(p, m, { readers: await readers(m) })).contents,
		).toBe(1);
	});

	it("stops between reads when asked, keeping what it read", async () => {
		const { m, p, media } = setup();
		put(media, "a.txt", "a");
		put(media, "b.txt", "b");
		await scanProject(p, m);
		const stop = new AbortController();
		const report = await extractProject(p, m, {
			readers: await readers(m),
			signal: stop.signal,
			onProgress: ({ done }) => {
				if (done === 2) stop.abort();
			},
		});
		expect(report.outcome).toBe("cancelled");
		expect(observations(p)).toHaveLength(2);
		const rest = await extractProject(p, m, { readers: await readers(m) });
		expect(Object.values(rest.written).reduce((a, b) => a + b, 0)).toBe(4);
	});

	it("runs with this machine's own readers, c2patool included when it is here", async () => {
		const { m, p, media } = setup();
		put(media, "still.png", png());
		await scanProject(p, m);
		const report = await extractProject(p, m);
		const c2pa = observations(p).find((o) => o.kind === "c2pa")!;
		// No manifest in the file, or no c2patool on this machine (CI does not fetch it).
		expect(["absent", "unavailable"]).toContain(c2pa.status);
		expect(report.written["exif ok"]).toBe(1);
	});
});

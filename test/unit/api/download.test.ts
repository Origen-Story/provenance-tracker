// A download saved into the incoming folder (D66): every error of the
// streams involved is the download's own failure, in words. No network: the
// address and its answer are stand-ins.

import { afterEach, describe, expect, it } from "vitest";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { download } from "../../../src/server/api/download.ts";

const temps: string[] = [];
afterEach(() => {
	for (const d of temps.splice(0))
		rmSync(d, {
			recursive: true,
			force: true,
			maxRetries: 10,
			retryDelay: 100,
		});
});

const answering = (body: string, type = "image/png") => ({
	url: "https://archive.example/picture.png",
	userAgent: "test",
	lookup: async () => [{ address: "93.184.216.34" }],
	fetchImpl: async () =>
		new Response(body, { headers: { "content-type": type } }),
});

describe("download", () => {
	it("saves what the address gives, with its hash and size", async () => {
		const incoming = mkdtempSync(path.join(tmpdir(), "pt-dl-"));
		temps.push(incoming);
		const d = await download({ ...answering("png bytes"), incoming });
		expect(d).toMatchObject({
			name: "picture.png",
			mediaType: "image/png",
			size: 9,
		});
		expect(d.sha256).toMatch(/^[0-9a-f]{64}$/);
		expect(readFileSync(d.file, "utf8")).toBe("png bytes");
	});

	it("fails in words, without the folder's path, when the file cannot be written", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "pt-dl-"));
		temps.push(dir);
		// The incoming folder is not there: the write cannot even start. With no
		// handler on the write stream this was an uncaught error, which stops
		// the server.
		const incoming = path.join(dir, "not-there");
		const failure = await download({
			...answering("png bytes"),
			incoming,
		}).catch((err: Error) => err);
		expect(failure).toBeInstanceOf(Error);
		expect((failure as Error).message).toBe(
			"The download could not be saved on this machine (ENOENT)",
		);
		expect((failure as Error).message).not.toContain(dir);
	});

	it("keeps nothing of a download that turns out too large", async () => {
		const incoming = mkdtempSync(path.join(tmpdir(), "pt-dl-"));
		temps.push(incoming);
		mkdirSync(incoming, { recursive: true });
		await expect(
			download({ ...answering("more than four"), incoming, maxBytes: 4 }),
		).rejects.toThrow(/larger than 4 bytes; it was not kept/);
		expect(readdirSync(incoming)).toEqual([]);
	});
});

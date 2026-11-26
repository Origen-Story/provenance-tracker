// A download saved into the incoming folder (D66): every error of the
// streams involved is the download's own failure, in words. Its name ends as
// a picture, video or sound does, and it has a time limit (D73). No network:
// the address and its answer are stand-ins.

import { afterEach, describe, expect, it } from "vitest";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { download } from "../../../src/server/api/download.ts";
import { requestAt } from "../../../src/server/lib/core/public-url.ts";

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

const folder = () => {
	const incoming = mkdtempSync(path.join(tmpdir(), "pt-dl-"));
	temps.push(incoming);
	return incoming;
};

describe("the name a download is kept under (D73)", () => {
	it("ends as media does, whatever the address calls the file", async () => {
		const d = await download({
			...answering("not a film", "video/mp4"),
			url: "https://archive.example/clip.mp4.exe",
			incoming: folder(),
		});
		expect(d.name).toBe("clip.mp4.exe.mp4");
	});

	it("ends as media does, whatever name the server's headers offer", async () => {
		const d = await download({
			url: "https://archive.example/picture.png",
			userAgent: "test",
			lookup: async () => [{ address: "93.184.216.34" }],
			fetchImpl: async () =>
				new Response("bytes", {
					headers: {
						"content-type": "image/jpeg",
						"content-disposition": 'attachment; filename="holiday.scr"',
					},
				}),
			incoming: folder(),
		});
		expect(d.name).toBe("holiday.scr.jpg");
	});

	it("refuses, before saving a byte, a file it has no media ending for", async () => {
		const incoming = folder();
		let read = false;
		const failure = await download({
			url: "https://archive.example/tool.exe",
			userAgent: "test",
			lookup: async () => [{ address: "93.184.216.34" }],
			fetchImpl: async () =>
				new Response(
					new ReadableStream(
						{
							pull(controller) {
								read = true;
								controller.close();
							},
						},
						// Asked for a piece only when someone reads.
						{ highWaterMark: 0 },
					),
					{ headers: { "content-type": "image/x-unknown" } },
				),
			incoming,
		}).catch((err: Error) => err);
		expect((failure as Error).message).toBe(
			'The address gave image/x-unknown under the name "tool.exe", and neither is a kind of picture, video or sound this tool knows an ending for. Download it yourself and add it as a file.',
		);
		expect(read).toBe(false);
		expect(readdirSync(incoming)).toEqual([]);
	});
});

describe("how long a download may take (D73)", () => {
	const base = {
		url: "https://archive.example/picture.png",
		userAgent: "test",
		lookup: async () => [{ address: "93.184.216.34" }],
	};
	/** A body that sends a piece every `everyMs`, `pieces` times, and then nothing more, without ending. */
	const trickle = (everyMs: number, pieces: number) => {
		let sent = 0;
		return new Response(
			new ReadableStream<Uint8Array>({
				async pull(controller) {
					if (sent >= pieces) return new Promise<void>(() => {});
					await new Promise((r) => setTimeout(r, everyMs));
					sent++;
					controller.enqueue(new Uint8Array([1, 2, 3]));
				},
			}),
			{ headers: { "content-type": "image/png" } },
		);
	};

	it("gives up on an address that does not answer", async () => {
		const incoming = folder();
		await expect(
			download({
				...base,
				fetchImpl: () => new Promise<Response>(() => {}),
				incoming,
				limits: { answerMs: 30 },
			}),
		).rejects.toThrow("The address did not answer within 0.03 seconds.");
		expect(readdirSync(incoming)).toEqual([]);
	});

	it("gives up when the file stops arriving, and keeps nothing of it", async () => {
		const incoming = folder();
		await expect(
			download({
				...base,
				fetchImpl: async () => trickle(1, 2),
				incoming,
				limits: { quietMs: 60 },
			}),
		).rejects.toThrow(
			"The download stopped arriving: nothing came for 0.06 seconds. Nothing of it was kept.",
		);
		expect(readdirSync(incoming)).toEqual([]);
	});

	it("gives up on a file that keeps arriving for too long", async () => {
		const incoming = folder();
		await expect(
			download({
				...base,
				// Never quiet for long, never finished.
				fetchImpl: async () => trickle(5, 1_000_000),
				incoming,
				limits: { quietMs: 5_000, wholeMs: 120 },
			}),
		).rejects.toThrow(
			"The download took longer than 0.12 seconds and was stopped. Nothing of it was kept.",
		);
		expect(readdirSync(incoming)).toEqual([]);
	});

	it("still says Stopped when the person stops the job", async () => {
		const incoming = folder();
		const stop = new AbortController();
		setTimeout(() => stop.abort(), 30);
		await expect(
			download({
				...base,
				fetchImpl: async () => trickle(1, 2),
				incoming,
				signal: stop.signal,
			}),
		).rejects.toThrow("Stopped");
		expect(readdirSync(incoming)).toEqual([]);
	});

	it("leaves a download that arrives in time alone", async () => {
		const incoming = folder();
		let sent = 0;
		const d = await download({
			...base,
			fetchImpl: async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						async pull(controller) {
							await new Promise((r) => setTimeout(r, 5));
							if (++sent > 4) controller.close();
							else controller.enqueue(new Uint8Array([sent]));
						},
					}),
					{ headers: { "content-type": "image/png" } },
				),
			incoming,
			limits: { answerMs: 2_000, quietMs: 2_000, wholeMs: 5_000 },
		});
		expect(d.size).toBe(4);
		expect([...readFileSync(d.file)]).toEqual([1, 2, 3, 4]);
	});
});

describe("a time limit, with the client that makes real requests (D73)", () => {
	let server: Server;
	let closed: Promise<void>;
	const listen = (answer: (res: ServerResponse) => void) =>
		new Promise<number>((resolve) => {
			server = createServer((_req, res) => answer(res));
			// Settles when the tracker's connection to the server has gone.
			closed = new Promise<void>((gone) =>
				server.on("connection", (socket) => socket.on("close", () => gone())),
			);
			server.listen(0, "127.0.0.1", () =>
				resolve((server.address() as AddressInfo).port),
			);
		});
	afterEach(
		() =>
			new Promise<void>((done) => {
				server.closeAllConnections();
				server.close(() => done());
			}),
	);
	// The address looks public to the check; the request goes to this machine.
	const toThisMachine = (port: number) => ({
		url: `http://archive.example:${port}/picture.png`,
		userAgent: "test",
		lookup: async () => [{ address: "93.184.216.34" }],
		fetchImpl: (url: string, init: RequestInit) =>
			requestAt(url, init, "127.0.0.1"),
	});

	it("closes the connection to an address that does not answer", async () => {
		const port = await listen(() => {});
		const incoming = folder();
		await expect(
			download({
				...toThisMachine(port),
				incoming,
				limits: { answerMs: 100 },
			}),
		).rejects.toThrow("The address did not answer within 0.1 seconds.");
		await closed;
		expect(readdirSync(incoming)).toEqual([]);
	});

	it("closes the connection when the file stops arriving", async () => {
		const port = await listen((res) => {
			res.writeHead(200, { "content-type": "image/png" });
			res.write("the first piece, and then nothing");
		});
		const incoming = folder();
		await expect(
			download({
				...toThisMachine(port),
				incoming,
				limits: { quietMs: 100 },
			}),
		).rejects.toThrow(
			"The download stopped arriving: nothing came for 0.1 seconds. Nothing of it was kept.",
		);
		await closed;
		expect(readdirSync(incoming)).toEqual([]);
	});

	it("closes the connection when it refuses the file by its name", async () => {
		const port = await listen((res) => {
			res.writeHead(200, { "content-type": "image/x-unknown" });
			res.write("a file that will not be taken");
		});
		const incoming = folder();
		await expect(
			download({
				...toThisMachine(port),
				url: `http://archive.example:${port}/tool.exe`,
				incoming,
			}),
		).rejects.toThrow(/neither is a kind of picture, video or sound/);
		await closed;
		expect(readdirSync(incoming)).toEqual([]);
	});

	it("saves a file that arrives whole", async () => {
		const port = await listen((res) => {
			res.writeHead(200, { "content-type": "image/png" });
			res.end("png bytes");
		});
		const d = await download({ ...toThisMachine(port), incoming: folder() });
		expect(d).toMatchObject({ name: "picture.png", size: 9 });
		expect(readFileSync(d.file, "utf8")).toBe("png bytes");
	});
});

// Pure tests for the file-type helpers; the preview route's type gate.
import { describe, it, expect } from "vitest";
import {
	getMimeType,
	isPreviewable,
} from "../../../src/server/lib/core/file-utils.js";

describe("isPreviewable", () => {
	it("accepts pictures, video and sound, whatever the case of the extension", () => {
		for (const p of [
			"a.png",
			"A.JPG",
			"clip.mov",
			"P:\\media\\take 01.MP4",
			"/media/voice.wav",
			"bed.mp3",
			"logo.svg",
			"x.webm",
			"x.m4a",
		]) {
			expect(isPreviewable(p), p).toBe(true);
		}
	});

	it("refuses keys, environment files, documents and anything unknown", () => {
		for (const p of [
			"certs/dev-key.pem",
			"certs/dev-cert.pem",
			".env",
			".env.local",
			"C:\\repo\\.env",
			"notes.txt",
			"catalog.sqlite",
			"id_rsa",
			"script.js",
			"page.html",
			"report.pdf",
			"backup.dump",
			"data.json",
			"",
			null,
			undefined,
		]) {
			expect(isPreviewable(p), String(p)).toBe(false);
		}
	});

	it("judges the last extension only, so a disguised name does not pass", () => {
		expect(isPreviewable("key.png.pem")).toBe(false);
		expect(isPreviewable("photo.pem.png")).toBe(true);
		expect(isPreviewable(".png")).toBe(false);
	});
});

describe("getMimeType", () => {
	it("falls back to a generic type for unknown extensions", () => {
		expect(getMimeType("a.pem")).toBe("application/octet-stream");
		expect(getMimeType("a.ogg")).toBe("audio/ogg");
	});
});

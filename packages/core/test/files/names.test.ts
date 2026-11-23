import { describe, it, expect } from "vitest";
import {
	freeName,
	isMediaType,
	offeredFileName,
	safeFileName,
	withExtension,
} from "../../src/files/names.ts";

describe("safeFileName", () => {
	it("keeps a plain name, accents included", () => {
		expect(safeFileName("Entrevista Peña.wav")).toBe("Entrevista Peña.wav");
	});

	it("keeps only the last part of a path, from either kind of slash", () => {
		expect(safeFileName("../../etc/passwd")).toBe("passwd");
		expect(safeFileName("C:\\Users\\x\\photo.jpg")).toBe("photo.jpg");
	});

	it("replaces what file systems refuse, and drops leading dots and trailing dots or spaces", () => {
		expect(safeFileName('a<b>c:d"e|f?g*h.png')).toBe("a_b_c_d_e_f_g_h.png");
		expect(safeFileName("line\nbreak\u0000.txt")).toBe("line_break_.txt");
		expect(safeFileName(".hidden")).toBe("hidden");
		expect(safeFileName("name. . ")).toBe("name");
	});

	it("never gives an empty or reserved name, and shortens a long stem", () => {
		expect(safeFileName("")).toBe("file");
		expect(safeFileName("***", "download")).toBe("download");
		expect(safeFileName("con.txt")).toBe("_con.txt");
		expect(safeFileName(`${"x".repeat(300)}.mp4`)).toBe(
			`${"x".repeat(120)}.mp4`,
		);
	});
});

describe("names from outside, however long", () => {
	it("are read in time linear in their length (CodeQL js/polynomial-redos)", () => {
		const started = performance.now();
		// Tabs become "_", and the name is cut to at most 120 characters (a
		// trailing space then trimmed).
		const cut = safeFileName(`a${" \t".repeat(50_000)}b`);
		expect(cut.startsWith("a _")).toBe(true);
		expect(cut.length).toBeLessThanOrEqual(120);
		// Spaces and dots at the ends are trimmed, however many.
		expect(safeFileName(`${" .".repeat(50_000)}x${" .".repeat(50_000)}`)).toBe(
			"x",
		);
		expect(
			offeredFileName(
				`attachment; filename*=${" ".repeat(100_000)}`,
				"https://x.test/y.jpg",
			),
		).toBe("y.jpg");
		expect(performance.now() - started).toBeLessThan(500);
	});
});

describe("freeName", () => {
	it("gives the name if free, else the next numbered one", () => {
		const taken = new Set(["clip.mp4", "clip (2).mp4", "notes"]);
		expect(freeName("other.mp4", (n) => taken.has(n))).toBe("other.mp4");
		expect(freeName("clip.mp4", (n) => taken.has(n))).toBe("clip (3).mp4");
		expect(freeName("notes", (n) => taken.has(n))).toBe("notes (2)");
	});
});

describe("offeredFileName", () => {
	it("prefers Content-Disposition's filename*, then filename, then the URL's last part, decoded", () => {
		expect(
			offeredFileName(
				`attachment; filename*=UTF-8''Pe%C3%B1a%20square.jpg`,
				"https://x.test/a",
			),
		).toBe("Peña square.jpg");
		expect(
			offeredFileName('inline; filename="town square.jpg"', "https://x.test/a"),
		).toBe("town square.jpg");
		expect(
			offeredFileName(
				null,
				"https://x.test/files/Pla%C3%A7a%20Reial.jpg?w=200",
			),
		).toBe("Plaça Reial.jpg");
		expect(offeredFileName(null, "https://x.test/")).toBe("");
		expect(offeredFileName(null, "not a url")).toBe("");
	});
});

describe("media types", () => {
	it("takes pictures, video and sound only, and adds a missing extension", () => {
		expect(["image/jpeg", "video/mp4", "audio/x-wav"].every(isMediaType)).toBe(
			true,
		);
		expect(
			["text/html", "application/pdf", "image/", ""].some(isMediaType),
		).toBe(false);
		expect(withExtension("photo", "image/jpeg")).toBe("photo.jpg");
		expect(withExtension("photo.png", "image/jpeg")).toBe("photo.png");
		expect(withExtension("photo", "image/x-unknown")).toBe("photo");
	});
});

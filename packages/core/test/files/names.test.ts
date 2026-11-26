import { describe, it, expect } from "vitest";
import {
	freeName,
	isMediaType,
	MEDIA_ENDINGS,
	mediaFileName,
	offeredFileName,
	safeFileName,
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
	it("takes pictures, video and sound only", () => {
		expect(["image/jpeg", "video/mp4", "audio/x-wav"].every(isMediaType)).toBe(
			true,
		);
		expect(
			["text/html", "application/pdf", "image/", ""].some(isMediaType),
		).toBe(false);
	});

	it("keeps a media ending, whatever case it is in", () => {
		expect(mediaFileName("photo.png", "image/jpeg")).toBe("photo.png");
		expect(mediaFileName("CLIP.MOV", "video/quicktime")).toBe("CLIP.MOV");
		expect(mediaFileName("take 3.aiff", "audio/x-unknown")).toBe("take 3.aiff");
	});

	it("gives a name with no ending the usual one of its type", () => {
		expect(mediaFileName("photo", "image/jpeg")).toBe("photo.jpg");
		expect(mediaFileName("download", "audio/x-wav")).toBe("download.wav");
	});

	it("never leaves an ending that is not a picture, video or sound", () => {
		// The name and the type both come from someone else's server.
		expect(mediaFileName("clip.mp4.exe", "video/mp4")).toBe("clip.mp4.exe.mp4");
		expect(mediaFileName("holiday.jpg.lnk", "image/jpeg")).toBe(
			"holiday.jpg.lnk.jpg",
		);
		expect(mediaFileName("image.php", "image/png")).toBe("image.php.png");
		expect(mediaFileName("setup.bat", "audio/mpeg")).toBe("setup.bat.mp3");
	});

	it("has no name for a type it knows no ending for, unless the name ends as media does", () => {
		expect(mediaFileName("photo", "image/x-unknown")).toBeNull();
		expect(mediaFileName("tool.exe", "image/x-unknown")).toBeNull();
		// A type named like a property every object has is not a known type.
		expect(mediaFileName("photo", "constructor")).toBeNull();
		expect(mediaFileName("photo", "toString")).toBeNull();
	});

	it("counts as media endings only short, lower-case ones that start with a dot", () => {
		for (const ending of MEDIA_ENDINGS)
			expect(ending).toMatch(/^[.][a-z0-9]{2,5}$/);
		for (const program of [
			".exe",
			".bat",
			".cmd",
			".com",
			".scr",
			".msi",
			".lnk",
			".ps1",
			".js",
			".vbs",
			".sh",
			".app",
			".html",
		])
			expect(MEDIA_ENDINGS.has(program)).toBe(false);
	});
});

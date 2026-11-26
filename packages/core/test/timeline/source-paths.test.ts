import { describe, expect, it } from "vitest";
import { pathurlToPath } from "../../src/timeline/formats/xmeml.js";
import { mayOpenSourcePath } from "../../src/timeline/source-paths.ts";

// Path strings only: nothing here opens a file, and none of these names exists.
describe("mayOpenSourcePath (D65)", () => {
	describe("on Windows", () => {
		const folders = ["P:\\Demo\\media", "D:\\Footage"];
		const may = (p: unknown) => mayOpenSourcePath(p, folders, "win32");

		it("takes a full local path inside a media folder, in either slash and any case", () => {
			expect(may("P:\\Demo\\media\\clip.mov")).toBe(true);
			expect(may("P:/Demo/media/day 1/clip.mov")).toBe(true);
			expect(may("p:\\demo\\MEDIA\\clip.mov")).toBe(true);
			expect(may("D:\\Footage\\a\\b\\c.wav")).toBe(true);
		});

		it("refuses a path outside every media folder, however it is spelt", () => {
			expect(may("P:\\Demo\\notes.txt")).toBe(false);
			expect(may("C:\\Users\\someone\\.ssh\\id_ed25519")).toBe(false);
			// A folder whose name only starts like a media folder's.
			expect(may("P:\\Demo\\media-old\\clip.mov")).toBe(false);
			// Out through "..".
			expect(may("P:\\Demo\\media\\..\\..\\Windows\\win.ini")).toBe(false);
			expect(may("P:/Demo/media/../secret.mov")).toBe(false);
			// The media folder itself is not a file in it.
			expect(may("P:\\Demo\\media")).toBe(false);
			expect(may("P:\\Demo\\media\\")).toBe(false);
		});

		it("refuses another computer and device paths, whatever folder they claim", () => {
			for (const p of [
				"\\\\host\\share\\clip.mov",
				"//host/share/clip.mov",
				"\\\\host@SSL\\DavWWWRoot\\clip.mov",
				"\\\\?\\P:\\Demo\\media\\clip.mov",
				"\\\\.\\P:\\Demo\\media\\clip.mov",
				"\\\\?\\UNC\\host\\share\\clip.mov",
				"\\/host/share/clip.mov",
			])
				expect(may(p), p).toBe(false);
			// Even when a media folder is itself a share: its files are matched
			// by the catalog's own paths, never opened from a timeline's.
			expect(
				mayOpenSourcePath(
					"\\\\nas\\media\\clip.mov",
					["\\\\nas\\media"],
					"win32",
				),
			).toBe(false);
		});

		it("refuses what is not a full path: relative, drive-relative, rooted on no drive, empty, not text", () => {
			for (const p of [
				"clip.mov",
				"media\\clip.mov",
				"P:clip.mov",
				"\\Demo\\media\\clip.mov",
				"/Demo/media/clip.mov",
				"",
				"P:\\Demo\\media\\clip.mov\0.txt",
				null,
				undefined,
				42,
			])
				expect(may(p), String(p)).toBe(false);
		});
	});

	describe("elsewhere", () => {
		const folders = ["/Volumes/Media/demo"];
		it("takes a path inside a media folder and refuses the rest", () => {
			const may = (p: unknown) => mayOpenSourcePath(p, folders, "linux");
			expect(may("/Volumes/Media/demo/clip.mov")).toBe(true);
			expect(may("/Volumes/Media/demo/../other/clip.mov")).toBe(false);
			expect(may("/etc/passwd")).toBe(false);
			expect(may("//host/share/clip.mov")).toBe(false);
			expect(may("demo/clip.mov")).toBe(false);
			// Linux tells "Demo" from "demo"; macOS does not.
			expect(may("/Volumes/Media/Demo/clip.mov")).toBe(false);
			expect(
				mayOpenSourcePath("/Volumes/Media/Demo/clip.mov", folders, "darwin"),
			).toBe(true);
		});
	});

	it("refuses every network form a timeline's file address can take", () => {
		const folders = ["P:\\Demo\\media"];
		for (const url of [
			"file://///host/share/clip.mov",
			"file:////host/share/clip.mov",
			"file://host/share/clip.mov",
			"file://localhost//host/share/clip.mov",
			"file:///%5C%5Chost%5Cshare%5Cclip.mov",
			"file://localhost/%5C%5C%3F%5CP%3A%5CDemo%5Cmedia%5Cclip.mov",
			"\\\\host\\share\\clip.mov",
		]) {
			const p = pathurlToPath(url);
			expect(mayOpenSourcePath(p, folders, "win32"), `${url} -> ${p}`).toBe(
				false,
			);
		}
		// And the ordinary form still goes through.
		expect(
			mayOpenSourcePath(
				pathurlToPath("file://localhost/P%3a/Demo/media/Clip%2001.mp4"),
				folders,
				"win32",
			),
		).toBe(true);
	});
});

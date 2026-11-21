import { describe, expect, it } from "vitest";
import {
	fromCatalogPath,
	isCatalogPath,
	isFullPath,
	isWithin,
	locateFile,
	overlaps,
	toCatalogPath,
} from "../../src/catalog/paths.ts";

describe("isCatalogPath", () => {
	it("accepts relative paths with / between folders", () => {
		for (const p of [
			"a.mov",
			"interviews/a.mov",
			"..notes/a.mov",
			"a..b/c",
			"Café/ñ.wav",
		])
			expect(isCatalogPath(p), p).toBe(true);
	});

	it("refuses anything that could point outside its root, or two ways of writing one file", () => {
		for (const p of [
			"",
			"/a",
			"C:/a",
			"c:a",
			"a\\b",
			"../a",
			"a/../b",
			"a/..",
			"./a",
			"a/./b",
			"a//b",
			"a/",
		])
			expect(isCatalogPath(p), p).toBe(false);
	});
});

describe("isFullPath", () => {
	it("on Windows needs a drive or a share", () => {
		expect(isFullPath("D:\\Media", "win32")).toBe(true);
		expect(isFullPath("d:/Media", "win32")).toBe(true);
		expect(isFullPath("\\\\nas\\media", "win32")).toBe(true);
		expect(isFullPath("\\Media", "win32")).toBe(false);
		expect(isFullPath("D:Media", "win32")).toBe(false);
		expect(isFullPath("Media", "win32")).toBe(false);
	});

	it("elsewhere needs a leading /", () => {
		expect(isFullPath("/Volumes/Media", "darwin")).toBe(true);
		expect(isFullPath("Media", "linux")).toBe(false);
	});
});

describe("toCatalogPath and fromCatalogPath", () => {
	it("turn a Windows path into catalog form and back", () => {
		const rel = toCatalogPath(
			"D:\\Media",
			"D:\\Media\\Interviews\\a.mov",
			"win32",
		);
		expect(rel).toBe("Interviews/a.mov");
		expect(fromCatalogPath("D:\\Media", rel!, "win32")).toBe(
			"D:\\Media\\Interviews\\a.mov",
		);
	});

	it("ignore case on Windows and keep the file's own spelling", () => {
		expect(
			toCatalogPath("d:\\media\\", "D:\\MEDIA\\Interviews\\A.mov", "win32"),
		).toBe("Interviews/A.mov");
	});

	it("ignore case on macOS, but not on Linux", () => {
		expect(
			toCatalogPath("/Volumes/media", "/Volumes/Media/a.mov", "darwin"),
		).toBe("a.mov");
		expect(toCatalogPath("/srv/media", "/srv/Media/a.mov", "linux")).toBeNull();
	});

	it("work from a drive's top and from a network share", () => {
		expect(toCatalogPath("E:\\", "E:\\clip.mov", "win32")).toBe("clip.mov");
		expect(
			toCatalogPath("\\\\nas\\media", "\\\\nas\\media\\a\\b.wav", "win32"),
		).toBe("a/b.wav");
		expect(toCatalogPath("/", "/srv/a.mov", "linux")).toBe("srv/a.mov");
	});

	it("give null outside the root, on another drive, for the root itself, or for a partial path", () => {
		expect(toCatalogPath("D:\\Media", "D:\\Other\\a.mov", "win32")).toBeNull();
		expect(toCatalogPath("D:\\Media", "E:\\Media\\a.mov", "win32")).toBeNull();
		expect(toCatalogPath("D:\\Media", "D:\\Media", "win32")).toBeNull();
		expect(toCatalogPath("D:\\Media", "D:\\Media2\\a.mov", "win32")).toBeNull();
		expect(toCatalogPath("D:\\Media", "\\Media\\a.mov", "win32")).toBeNull();
		expect(
			toCatalogPath("/srv/media", "/srv/media/../x.mov", "linux"),
		).toBeNull();
	});

	it("keep a folder whose name starts with two dots", () => {
		expect(
			toCatalogPath("/srv/media", "/srv/media/..notes/a.txt", "linux"),
		).toBe("..notes/a.txt");
	});

	it("refuse to build a path from anything but a catalog path and a full root", () => {
		expect(() => fromCatalogPath("D:\\Media", "../secret", "win32")).toThrow(
			"Not a catalog path",
		);
		expect(() => fromCatalogPath("D:\\Media", "a\\b", "win32")).toThrow(
			"Not a catalog path",
		);
		expect(() => fromCatalogPath("Media", "a", "win32")).toThrow("full path");
	});
});

describe("isWithin and overlaps", () => {
	it("know a folder is within itself and its parents", () => {
		expect(isWithin("D:\\Media", "D:\\Media", "win32")).toBe(true);
		expect(isWithin("D:\\Media", "d:\\media\\a", "win32")).toBe(true);
		expect(isWithin("D:\\Media\\a", "D:\\Media", "win32")).toBe(false);
		expect(isWithin("D:\\Media", "D:\\Media2", "win32")).toBe(false);
		expect(isWithin("/a", "/a/..b", "linux")).toBe(true);
		expect(isWithin("/a", "/a/../b", "linux")).toBe(false);
	});

	it("say two folders overlap when either holds the other", () => {
		expect(overlaps("D:\\Media", "D:\\Media\\Interviews", "win32")).toBe(true);
		expect(overlaps("D:\\Media\\Interviews", "D:\\Media", "win32")).toBe(true);
		expect(overlaps("D:\\Media", "E:\\Media", "win32")).toBe(false);
		expect(overlaps("/srv/a", "/srv/b", "linux")).toBe(false);
	});
});

describe("locateFile", () => {
	it("finds the root a file is in and its path there", () => {
		const roots = [
			{ id: 1, folder: "D:\\Footage" },
			{ id: 2, folder: "E:\\Archive" },
		];
		expect(locateFile(roots, "E:\\Archive\\1910\\plate.tif", "win32")).toEqual({
			rootId: 2,
			path: "1910/plate.tif",
		});
		expect(locateFile(roots, "C:\\Elsewhere\\a.mov", "win32")).toBeNull();
	});
});

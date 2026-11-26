import { describe, expect, it } from "vitest";
import { fileCarries, MAX_DETAILS } from "../../src/manifest/file-carries.ts";

// An editor's export as ExifTool reads it (made up): flat tag names, with
// XMP structures nested.
const exported = {
	FileType: "MP4",
	ImageWidth: 1920,
	Duration: 12.5,
	CreatorTool: "Example Editor 25.0 (Windows)",
	WindowsAtomUncProjectPath: "\\\\?\\D:\\Work\\Example Client\\cut.prproj",
	Artist: "A. Person",
	GPSLatitude: 41.4036,
	GPSVersionID: "2.3.0.0",
	GPSPosition: "41.4036 N, 2.1744 E",
	SerialNumber: "SN123",
	Make: "Example",
	Title: "Rough cut 3",
	CompressorName: "a codec",
	History: [
		{ Action: "saved", SoftwareAgent: "Example Editor", When: "2026-11-01" },
	],
	Ingredients: [{ FilePath: "interview.mov", InstanceID: "xmp.iid:1" }],
	HandlerDescription: "made at C:\\Users\\aperson\\Videos",
	EncodedBy: "see /Users/aperson/Movies/cut",
	Software: "\\\\studio-nas\\projects\\cut",
};

describe("fileCarries (D64)", () => {
	const { details, more } = fileCarries(exported);
	const of = (tag: string) => details.find((d) => d.tag === tag);

	it("lists paths, places, people, devices and free text, each as what it is", () => {
		expect(of("WindowsAtomUncProjectPath")).toEqual({
			tag: "WindowsAtomUncProjectPath",
			value: "\\\\?\\D:\\Work\\Example Client\\cut.prproj",
			kind: "path",
		});
		expect(of("Artist")?.kind).toBe("person");
		expect(of("GPSLatitude")).toMatchObject({
			value: "41.4036",
			kind: "location",
		});
		expect(of("GPSPosition")?.kind).toBe("location");
		expect(of("SerialNumber")?.kind).toBe("device");
		expect(of("Make")?.kind).toBe("device");
		expect(of("CreatorTool")?.kind).toBe("device");
		expect(of("Title")?.kind).toBe("text");
		expect(more).toBe(0);
	});

	it("reads inside structures, naming each level", () => {
		expect(of("Ingredients.FilePath")).toMatchObject({
			value: "interview.mov",
			kind: "path",
		});
		expect(of("History.SoftwareAgent")?.kind).toBe("text");
	});

	it("finds a path on someone's machine whatever the tag is called", () => {
		// A drive letter, a home folder and a network share.
		expect(of("HandlerDescription")).toMatchObject({
			value: "made at C:\\Users\\aperson\\Videos",
			kind: "path",
		});
		expect(of("EncodedBy")?.kind).toBe("path");
		expect(of("Software")?.kind).toBe("path");
	});

	it("leaves out what only describes the picture and sound", () => {
		for (const tag of [
			"FileType",
			"ImageWidth",
			"Duration",
			"GPSVersionID",
			"CompressorName",
		])
			expect(of(tag)).toBeUndefined();
	});

	it("lists a limited number and counts the rest; nothing for a file not read", () => {
		const many = Object.fromEntries(
			Array.from({ length: MAX_DETAILS + 5 }, (_, i) => [
				`Comment${i}`,
				`c${i}`,
			]),
		);
		const r = fileCarries(many);
		expect(r.details).toHaveLength(MAX_DETAILS);
		expect(r.more).toBe(5);
		expect(fileCarries(null)).toEqual({ details: [], more: 0 });
	});
});

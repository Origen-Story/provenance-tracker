import { describe, expect, it } from "vitest";
import {
	c2paTypeOf,
	mediaTypeForSigning,
	UNKNOWN_TYPE,
} from "../../src/manifest/formats.ts";

describe("the media type the C2PA library is told a file is", () => {
	it("knows the types C2PA carries credentials in, whatever the case of the extension", () => {
		expect(c2paTypeOf("cut.mp4")).toBe("video/mp4");
		expect(c2paTypeOf("Take 1.MOV")).toBe("video/quicktime");
		expect(c2paTypeOf("still.JPEG")).toBe("image/jpeg");
		expect(c2paTypeOf("music.wav")).toBe("audio/wav");
		expect(c2paTypeOf("C:\\media\\a.b\\voice.m4a")).toBe("audio/mp4");
		expect(c2paTypeOf("/media/plates/frame.png")).toBe("image/png");
		expect(c2paTypeOf("credentials.c2pa")).toBe("application/c2pa");
	});

	it("has none for other files, which still go in as ingredients without credentials", () => {
		expect(c2paTypeOf("edit.prproj")).toBeNull();
		expect(c2paTypeOf("README")).toBeNull();
		expect(c2paTypeOf(".hidden")).toBeNull();
		expect(c2paTypeOf("folder.mp4/file")).toBeNull();
		expect(mediaTypeForSigning("edit.prproj")).toBe(UNKNOWN_TYPE);
		expect(mediaTypeForSigning("cut.mp4")).toBe("video/mp4");
	});
});

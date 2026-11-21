import { describe, expect, it } from "vitest";
import { c2patoolObservation } from "../../src/extraction/c2patool-read.ts";

describe("c2patoolObservation", () => {
	it("calls a file type C2PA cannot be embedded in absent, keeping c2patool's reason", () => {
		const obs = c2patoolObservation({
			err: { code: "1", stderr: "Error: Unsupported file type\n" },
			version: "0.27.1",
		});
		expect(obs).toMatchObject({
			status: "absent",
			error:
				"c2patool does not read this file type (Error: Unsupported file type)",
			data: null,
		});
	});

	it("still calls any other failure unreadable", () => {
		expect(
			c2patoolObservation({
				err: { code: "1", stderr: "Error: claim signature is not valid" },
				version: "0.27.1",
			}).status,
		).toBe("unreadable");
	});
});

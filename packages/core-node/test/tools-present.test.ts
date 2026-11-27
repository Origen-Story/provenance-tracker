// The signing tests skip themselves where a tool is missing, so a developer
// without openssl or the helper programs still gets a green run. In CI that
// kindness would hide a broken install: every signing test would be skipped
// and the run would pass. So where PT_REQUIRE_TOOLS is set (the workflow sets
// it), the tools those tests need must all be there.

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { libraryBinary, loadLibrary } from "../src/extract/c2pa-library.ts";
import { c2patoolPath, c2patoolProblem } from "../src/extract/c2patool.ts";
import { haveOpenssl } from "./helpers/cert.ts";

const required = !!process.env.PT_REQUIRE_TOOLS;

describe.runIf(required)(
	"the tools the signing tests need (PT_REQUIRE_TOOLS)",
	() => {
		it("has openssl, to make throwaway certificates", () => {
			expect(haveOpenssl).toBe(true);
		});

		it("has the pinned C2PA library, and it loads", async () => {
			expect(libraryBinary({})).not.toHaveProperty("unavailable");
			expect(await loadLibrary({})).not.toHaveProperty("unavailable");
		});

		it("has the pinned c2patool, and it runs", () => {
			expect(c2patoolProblem({})).toBeNull();
			expect(
				spawnSync(c2patoolPath({}, process.platform), ["--version"]).status,
			).toBe(0);
		});
	},
);

describe.runIf(!required)("the tools the signing tests need", () => {
	it("are not insisted on here: signing tests skip where one is missing", () => {
		expect(required).toBe(false);
	});
});

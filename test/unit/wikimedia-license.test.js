import { describe, it, expect } from "vitest";
import {
	classifyLicense,
	extractText,
} from "../../src/server/lib/search/wikimedia.js";

describe("extractText", () => {
	it("turns a Commons HTML field into plain text", () => {
		expect(
			extractText({ value: '<a href="/wiki/User:X">Jane Doe</a> (photo)' }),
		).toBe("Jane Doe (photo)");
		expect(extractText(null)).toBe("");
	});

	it("leaves no tag behind when tags are nested to survive one pass", () => {
		expect(extractText({ value: "<scr<b>ipt>alert(1)</scr</b>ipt>" })).toBe(
			"alert(1)",
		);
		expect(extractText({ value: "a < b > c" })).toBe("a  c");
		expect(extractText({ value: "1 < 2" })).toBe("1  2");
	});
});

describe("classifyLicense", () => {
	describe("green (safe to use)", () => {
		it.each([
			["Public domain"],
			["PD-old"],
			["PD"],
			["CC0"],
			["cc0 1.0"],
			["Copyrighted free use"],
		])("%s → green", (license) => {
			expect(classifyLicense(license)).toBe("green");
		});
	});

	describe("yellow (attribution required)", () => {
		it.each([
			["CC BY 4.0"],
			["CC-BY-SA-3.0"],
			["CC BY-SA 4.0"],
			["Attribution"],
		])("%s → yellow", (license) => {
			expect(classifyLicense(license)).toBe("yellow");
		});
	});

	describe("red (restricted or unknown)", () => {
		it.each([
			["CC BY-NC 4.0"],
			["CC BY-NC-SA 3.0"],
			["CC BY-ND 4.0"],
			["GFDL"],
			["All rights reserved"],
			["Some unknown license"],
			[""],
			[null],
			[undefined],
		])("%s → red", (license) => {
			expect(classifyLicense(license)).toBe("red");
		});
	});

	it("treats NC ahead of BY (prevents false yellow on CC BY-NC)", () => {
		// Regression: "CC BY-NC-SA" contains "cc by" and "-nc" — the -nc check
		// must win so an NC license isn't classified as plain attribution.
		expect(classifyLicense("CC BY-NC-SA 4.0")).toBe("red");
	});
});

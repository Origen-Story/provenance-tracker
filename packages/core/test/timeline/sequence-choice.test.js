import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
	chooseSequence,
	lengthTolerance,
} from "../../src/timeline/sequence-choice.js";
import {
	listSequences,
	parseTimeline,
} from "../../src/timeline/formats/index.js";

const FIXTURES = path.join(import.meta.dirname, "..", "fixtures", "timeline");
const read = (f) => readFileSync(path.join(FIXTURES, f), "utf8");
const PROJECT = read("project-export.xmeml.xml");
const SAMPLE = read("sample.xmeml.xml");

describe("a whole-project export (Phase 8 step 6)", () => {
	it("lists the project's own sequences, never one nested inside a clip", () => {
		expect(listSequences(PROJECT)).toEqual([
			{
				index: 0,
				name: "Film v12",
				durationFrames: 4380,
				fps: 30,
				seconds: 146,
			},
			{
				index: 1,
				name: "Assembly v1",
				durationFrames: 18930,
				fps: 30,
				seconds: 631,
			},
			{
				index: 2,
				name: "Film v11",
				durationFrames: 4320,
				fps: 30,
				seconds: 144,
			},
		]);
		expect(listSequences(SAMPLE)).toHaveLength(1);
	});

	it("parses the sequence asked for, and refuses one it does not hold", () => {
		expect(parseTimeline(PROJECT, { sequence: 1 }).sequence.name).toBe(
			"Assembly v1",
		);
		expect(parseTimeline(PROJECT).sequence.name).toBe("Film v12");
		expect(() => parseTimeline(PROJECT, { sequence: 3 })).toThrow(
			/no sequence 3; the file holds 3/,
		);
	});
});

describe("chooseSequence", () => {
	const list = listSequences(PROJECT);

	it("takes the only one, or the one a person chose", () => {
		expect(chooseSequence(listSequences(SAMPLE))).toEqual({
			index: 0,
			by: "only",
		});
		expect(chooseSequence(list, { requested: 2 })).toEqual({
			index: 2,
			by: "chosen",
		});
		expect(chooseSequence(list, { requested: 7 })).toMatchObject({
			refuse: "The timeline file has no sequence 7; it holds 3.",
		});
	});

	it("takes the one as long as the edit's own file, within half a second", () => {
		expect(chooseSequence(list, { outputSeconds: 146.2 })).toEqual({
			index: 0,
			by: "length",
		});
		expect(chooseSequence(list, { outputSeconds: 631 })).toEqual({
			index: 1,
			by: "length",
		});
		expect(lengthTolerance(30)).toBe(0.5);
		expect(lengthTolerance(1)).toBe(1);
	});

	it("refuses to guess, listing the choices, when none or several match or the length is unknown", () => {
		const none = chooseSequence(list, { outputSeconds: 300 });
		expect(none).toMatchObject({
			refuse:
				"This timeline file holds 3 sequences, and none is as long as this edit's file (300 s). Choose the one this edit was exported from.",
		});
		expect(none.choices.map((c) => c.name)).toEqual([
			"Film v12",
			"Assembly v1",
			"Film v11",
		]);
		const twins = [
			{ index: 0, name: "A", seconds: 146, fps: 30 },
			{ index: 1, name: "B", seconds: 146.1, fps: 30 },
		];
		expect(chooseSequence(twins, { outputSeconds: 146 }).refuse).toMatch(
			/2 of them are as long as this edit's file/,
		);
		expect(chooseSequence(list).refuse).toMatch(/no known length/);
		expect(chooseSequence([]).refuse).toBe(
			"The timeline file holds no sequence.",
		);
	});
});

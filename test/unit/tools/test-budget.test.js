import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
	BUDGET_VARIABLE,
	DEFAULT_BUDGET_SECONDS,
	LONGEST_BUDGET_SECONDS,
	testBudgetSeconds,
} from "../../../scripts/lib/test-budget.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

describe("the test run's time budget", () => {
	it("is 60 s when nothing names another", () => {
		expect(DEFAULT_BUDGET_SECONDS).toBe(60);
		expect(testBudgetSeconds({})).toBe(60);
		expect(testBudgetSeconds({ [BUDGET_VARIABLE]: "" })).toBe(60);
	});

	it("is what a workflow names, from the default to the longest", () => {
		expect(testBudgetSeconds({ [BUDGET_VARIABLE]: "60" })).toBe(60);
		expect(testBudgetSeconds({ [BUDGET_VARIABLE]: "180" })).toBe(180);
		expect(
			testBudgetSeconds({ [BUDGET_VARIABLE]: String(LONGEST_BUDGET_SECONDS) }),
		).toBe(LONGEST_BUDGET_SECONDS);
	});

	it("refuses a budget that would shorten the rule, switch it off, or is not a number", () => {
		for (const bad of [
			"0",
			"59",
			String(LONGEST_BUDGET_SECONDS + 1),
			"99999",
			"-180",
			"180s",
			"1e2",
			"180.5",
			" 180",
			"Infinity",
			"none",
		])
			expect(
				() => testBudgetSeconds({ [BUDGET_VARIABLE]: bad }),
				bad,
			).toThrow(/takes a whole number of seconds from 60 to/);
	});

	it("is named by the CI workflow for its test job, within what the rule allows", () => {
		const workflow = readFileSync(
			path.join(ROOT, ".github", "workflows", "ci.yml"),
			"utf8",
		);
		const named = [
			...workflow.matchAll(
				new RegExp(`^\\s+${BUDGET_VARIABLE}: "([^"]*)"$`, "gm"),
			),
		].map((m) => m[1]);
		expect(named).toHaveLength(1);
		expect(testBudgetSeconds({ [BUDGET_VARIABLE]: named[0] })).toBe(180);
	});

	it("is what the test command enforces", () => {
		const script = readFileSync(
			path.join(ROOT, "scripts", "test.mjs"),
			"utf8",
		);
		expect(script).toContain("testBudgetSeconds(process.env)");
		expect(script).not.toMatch(/BUDGET_SECONDS = [0-9]/);
	});
});

// Bring an older catalog up to the current format, one step at a time.
//
// Each format after the first has one step from the format before it. Every
// format's sample catalog stays in the tests, and the tests upgrade every
// sample on every change.

import type { DatabaseSync } from "node:sqlite";
import {
	CATALOG_FORMAT,
	inspectCatalog,
	inTransaction,
	prepareConnection,
	refusalMessage,
} from "./format.ts";
import type { Tool } from "./create.ts";
import { forgetColumns } from "./columns.ts";
import { UPGRADE_1_TO_2_SQL } from "./schema-v2.ts";

export interface UpgradeStep {
	from: number;
	to: number;
	/** SQL that turns a catalog of format `from` into format `to`, ending with PRAGMA user_version = to. */
	sql: string;
}

export const UPGRADES: readonly UpgradeStep[] = [
	// Where a signed copy is published (D56).
	{ from: 1, to: 2, sql: UPGRADE_1_TO_2_SQL },
];

export interface UpgradeOptions {
	/**
	 * Where the copy of the file as it was before the upgrade was saved. The
	 * caller saves it first (core never touches files); it is recorded in each
	 * upgrade run so the catalog says where to find its own past.
	 */
	backup: string;
	tool: Tool;
	now?: string;
	/** For tests; the real steps and format by default. */
	steps?: readonly UpgradeStep[];
	target?: number;
}

/**
 * Apply each step from the catalog's format to the target, each in its own
 * transaction with an upgrade run recorded in it. A step that fails rolls
 * back, leaving the catalog at the last format it reached.
 * @returns the steps applied, in order
 */
export function upgradeCatalog(
	db: DatabaseSync,
	opts: UpgradeOptions,
): Array<{ from: number; to: number }> {
	const steps = opts.steps ?? UPGRADES;
	const target = opts.target ?? CATALOG_FORMAT;
	if (!opts.backup?.trim())
		throw new Error(
			"Save a copy of the catalog before upgrading it, and say where",
		);
	const state = inspectCatalog(db);
	if (state.state === "current" && target === CATALOG_FORMAT) return [];
	if (state.state !== "older" && state.state !== "current") {
		throw new Error(
			refusalMessage(state) ??
				`Cannot upgrade a catalog that is ${state.state}`,
		);
	}
	prepareConnection(db);
	const applied: Array<{ from: number; to: number }> = [];
	let format = state.format;
	while (format < target) {
		const step = steps.find((s) => s.from === format);
		if (!step || step.to !== format + 1)
			throw new Error(
				`No upgrade step from catalog format ${format} to ${format + 1}`,
			);
		const now = opts.now ?? new Date().toISOString();
		inTransaction(db, () => {
			db.exec(step.sql);
			const reached = inspectCatalog(db);
			if (reached.state === "foreign" || reached.state === "empty")
				throw new Error(`Upgrade step ${step.from}→${step.to} broke the file`);
			if (reached.format !== step.to)
				throw new Error(
					`Upgrade step ${step.from}→${step.to} left the catalog at format ${reached.format}`,
				);
			db.prepare(
				`INSERT INTO runs (kind, tool, tool_version, started_at, finished_at, outcome, summary)
				 VALUES ('upgrade', ?, ?, ?, ?, 'ok', ?)`,
			).run(
				opts.tool.name,
				opts.tool.version,
				now,
				now,
				JSON.stringify({
					from: step.from,
					to: step.to,
					backup: opts.backup,
				}),
			);
		});
		forgetColumns(db);
		applied.push({ from: step.from, to: step.to });
		format = step.to;
	}
	return applied;
}

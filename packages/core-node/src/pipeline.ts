// The usual way files come into a project: scan the roots, read what each new
// file says, then say what each asset is. Each step is its own run, as when
// they are run one by one from the command line.

import {
	classifyCatalog,
	type ClassifyReport,
} from "@provenancetracker/core/catalog/classify.ts";
import { extractProject, type ExtractReport, type Reader } from "./extract.ts";
import type { Machine } from "./machine.ts";
import type { OpenProject } from "./project.ts";
import { scanProject, type ScanReport } from "./scan.ts";
import { TOOL } from "./tool.ts";

export type Step = "scan" | "extract" | "classify";

export interface StepProgress {
	step: Step;
	done: number;
	total: number;
	file: string;
}

export interface ImportReport {
	scan: ScanReport | null;
	extract: ExtractReport | null;
	classify: ClassifyReport | null;
	/** True when it was stopped; the steps after the one stopped did not run. */
	cancelled: boolean;
}

/**
 * Scan, extract and classify, in that order. A cancelled scan or extract
 * stops there; what each step finished is kept.
 */
export async function importFiles(
	project: OpenProject,
	machine: Machine,
	opts: {
		roots?: string[];
		readers?: Reader[];
		signal?: AbortSignal;
		onProgress?: (p: StepProgress) => void;
	} = {},
): Promise<ImportReport> {
	const report: ImportReport = {
		scan: null,
		extract: null,
		classify: null,
		cancelled: false,
	};
	report.scan = await scanProject(project, machine, {
		roots: opts.roots,
		signal: opts.signal,
		onProgress: (p) =>
			opts.onProgress?.({
				step: "scan",
				done: p.hashed,
				total: p.toHash,
				file: p.file,
			}),
	});
	if (report.scan.outcome === "cancelled")
		return { ...report, cancelled: true };
	report.extract = await extractProject(project, machine, {
		roots: opts.roots,
		readers: opts.readers,
		signal: opts.signal,
		onProgress: (p) =>
			opts.onProgress?.({
				step: "extract",
				done: p.done,
				total: p.total,
				file: p.file,
			}),
	});
	if (report.extract.outcome === "cancelled")
		return { ...report, cancelled: true };
	opts.onProgress?.({ step: "classify", done: 0, total: 1, file: "" });
	report.classify = classifyCatalog(project.db, { tool: TOOL });
	return report;
}

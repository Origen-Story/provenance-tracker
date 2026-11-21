// What a c2patool run means, as an observation (D21). Pure: the caller runs
// the program and passes its output. c2patool prints the manifest store as
// JSON; a file with no manifest exits non-zero with a message instead.
//
// c2patool is not the last word on validity: every release so far misreads
// genuine Pixel video as invalid (D15). The observation keeps what it said.

import {
	c2paValidation,
	makeObservation,
	type Observation,
} from "./observation.ts";

/** "c2patool 0.27.1\n" → "0.27.1"; null when no version number is present. */
export function parseToolVersion(output: unknown): string | null {
	const m = String(output || "").match(/\bv?(\d+\.\d+\.\d+(?:[-+][\w.]+)?)\b/);
	return m ? m[1] : null;
}

/**
 * The active manifest of a manifest store. c2pa-node 0.5.x gives
 * `active_manifest` as the manifest object itself; c2patool and newer readers
 * give a label into `manifests`. Both are accepted.
 */
export function activeManifestOf(
	store: unknown,
): Record<string, unknown> | null {
	if (!store || typeof store !== "object") return null;
	const s = store as {
		active_manifest?: unknown;
		manifests?: Record<string, unknown>;
	};
	const active = s.active_manifest ?? null;
	if (active && typeof active === "object")
		return active as Record<string, unknown>;
	if (typeof active === "string" && s.manifests)
		return (s.manifests[active] as Record<string, unknown>) ?? null;
	return null;
}

export interface C2patoolRun {
	stdout?: string;
	err?: { code?: string; stderr?: string; message?: string } | null;
	version: string | null;
}

/** A c2patool run as an observation. */
export function c2patoolObservation({
	stdout,
	err,
	version,
}: C2patoolRun): Observation {
	const base = { kind: "c2pa" as const, extractor: "c2patool", version };
	if (err) {
		if (err.code === "ENOENT")
			return makeObservation({
				...base,
				status: "unavailable",
				error:
					"c2patool was not found. Run npm run tools:fetch or set C2PATOOL_PATH.",
			});
		// A non-zero exit usually means "no manifest"; c2patool's wording tells
		// that apart from a real failure.
		const stderr = (err.stderr || "").trim();
		if (/no.*manifest|no.*claim|jumbf.*not.*found/i.test(stderr))
			return makeObservation({ ...base, status: "absent" });
		// A format C2PA cannot be embedded in (HTML, JSON, scripts, PSD…): there
		// is no manifest in it to read. Absent, with c2patool's reason kept, not
		// "unreadable", which would say a manifest might be there.
		if (/unsupported file type/i.test(stderr))
			return makeObservation({
				...base,
				status: "absent",
				error: `c2patool does not read this file type (${stderr})`,
			});
		return makeObservation({
			...base,
			status: "unreadable",
			error: `c2patool: ${stderr || err.message}`,
		});
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout ?? "");
	} catch (e) {
		return makeObservation({
			...base,
			status: "unreadable",
			error: `c2patool JSON parse: ${(e as Error).message}`,
		});
	}
	if (!activeManifestOf(parsed))
		return makeObservation({ ...base, status: "absent" });
	return makeObservation({
		...base,
		status: "ok",
		data: parsed,
		validation: c2paValidation(parsed),
	});
}

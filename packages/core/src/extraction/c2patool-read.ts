// What is still read from c2patool's output, and from any reader's manifest
// store. Pure. c2patool no longer reads files for the catalog: every release
// so far misreads genuine Pixel video as invalid (D15), so the C2PA library
// reads (D51, c2pa-library-read.ts) and c2patool only signs where a machine
// chooses it.

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

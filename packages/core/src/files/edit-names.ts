// Pure: which earlier finished edit a new export most likely continues
// (Phase 8 step 6, D60). Editors name revisions by a version at the end:
// "RoughCutV1" then "RoughCutV2", "film_v11" then "film_v12", "Cut 3" then
// "Cut 4". With the version and the extension set aside, the names agree.
// A suggestion only: the person confirms it before anything is copied.

/** A file name with its extension, a trailing version and separators set aside, in lower case. */
export function editStem(fileName: string): string {
	let s = fileName.toLowerCase().replace(/\.[a-z0-9]{1,5}$/, "");
	s = s.replace(/\.signed\.v\d+$/, "");
	// "v12", "_v3", " version 2", "-final", "(2)", "_1", " 3"
	for (let i = 0; i < 3; i++)
		s = s
			.replace(/[\s._-]*\(\d+\)$/, "")
			.replace(/[\s._-]*(v|ver|version)\s*\d+[a-z]?$/, "")
			.replace(/[\s._-]*(final|draft|export)$/, "")
			.replace(/[\s._-]+\d{1,3}$/, "");
	return s.replace(/[\s._-]+/g, " ").trim();
}

/**
 * The earlier edit whose file name matches this one's once versions are set
 * aside: the newest such edit (highest id), or null if none matches.
 */
export function suggestEarlierEdit(
	fileName: string,
	candidates: ReadonlyArray<{ id: number; fileName: string }>,
): number | null {
	const stem = editStem(fileName);
	if (!stem) return null;
	const same = candidates
		.filter((c) => c.fileName && editStem(c.fileName) === stem)
		.sort((a, b) => b.id - a.id);
	return same[0]?.id ?? null;
}

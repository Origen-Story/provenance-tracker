// Pure helpers for guessing an enhancer's source file from its name.
//
// Topaz Video AI appends the model and a number to the source stem
// (clip.mp4 -> clip_prob4.mov, clip_iris2.mov). Topaz Gigapixel appends a
// "-gigapixel-<model>-<scale>x..." tail (photo.png -> photo-gigapixel-
// redefine-realistic-2x-faceai v2.png). Stripping the tail gives a stem to
// look up among the project's assets. The match is a suggestion: it links
// with confidence 0.7 and the user can unlink it.

const TOPAZ_VIDEO_TAIL = /_(?:prob|iris|amq|ghq|thm|nyx|thd|thf|ahq|alq|aaa|apo|apf|dione|gaia|artemis|proteus|rhea|rxl|hyperion|chronos|chf)[a-z]*-?\d*(?:_\d+x)?$/i;
const GIGAPIXEL_TAIL = /-gigapixel-.*$/i;

export function stripExtension(filename) {
	return String(filename || '').replace(/\.[^./\\]+$/, '');
}

/**
 * Returns the probable source stem for a Topaz output filename, or null when
 * the name carries no Topaz pattern.
 */
export function topazSourceBasename(filename) {
	const stem = stripExtension(filename);
	if (GIGAPIXEL_TAIL.test(stem)) return stem.replace(GIGAPIXEL_TAIL, '').trim();
	if (TOPAZ_VIDEO_TAIL.test(stem)) return stem.replace(TOPAZ_VIDEO_TAIL, '');
	return null;
}

/**
 * @param {string} sourceStem    from topazSourceBasename
 * @param {Array<{type:string,id:number,filename:string}>} index  the project's assets
 * @param {{type:string,id:number}} [self]  the asset being linked, excluded
 */
export function findSourceCandidates(sourceStem, index, self = null) {
	if (!sourceStem) return [];
	const want = sourceStem.toLowerCase();
	return (index || []).filter(entry => {
		if (self && entry.type === self.type && entry.id === self.id) return false;
		return stripExtension(entry.filename).toLowerCase() === want;
	});
}

/**
 * Split a search box query into terms for a forgiving name search. People
 * type a clip name as they see it ("Firefly Antoni Gaudi") while files are
 * stored with underscores or hyphens, so spaces, underscores and hyphens all
 * separate terms and every term must match somewhere. Each term is escaped
 * for SQL LIKE (`%`, `_` and `\` are literals) and wrapped in wildcards.
 */
export function searchTerms(q, max = 6) {
	return String(q || '').toLowerCase().split(/[\s_\-]+/).filter(Boolean).slice(0, max)
		.map(t => `%${t.replace(/[\\%_]/g, '\\$&')}%`);
}

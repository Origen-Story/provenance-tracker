// Pure matching of timeline clips to tracked assets. IO (file size, hash)
// is injected so the logic is testable with an in-memory index.
//
// Match order and confidence:
//   path           1.0  the clip's path equals an asset's filePath or originalFilePath
//   hash           1.0  SHA-256 of the file at the clip's path equals an asset's fileHash
//                       (catches a source renamed on disk after placement)
//   filename_size  0.9  same basename and the same byte size
//   filename       0.4  same basename only (weak; shown for review)
//   unmatched      0

export function normalizePath(p) {
	return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function basename(p) {
	return String(p || '').split(/[\\/]/).pop() || '';
}

/**
 * @param {Array<{type:string,id:number,filename?:string,filePath:string,originalFilePath?:string|null,fileHash?:string,fileSize?:number,originClass?:string,originClassConfirmed?:boolean}>} assets
 */
export function buildMatchIndex(assets) {
	const byPath = new Map();
	const byHash = new Map();
	const byName = new Map();
	for (const a of assets || []) {
		const entry = { ...a, filename: a.filename || basename(a.filePath) };
		for (const p of [a.filePath, a.originalFilePath]) {
			const key = normalizePath(p);
			if (key && !byPath.has(key)) byPath.set(key, entry);
		}
		if (a.fileHash && !byHash.has(a.fileHash)) byHash.set(a.fileHash, entry);
		const name = entry.filename.toLowerCase();
		if (name) {
			if (!byName.has(name)) byName.set(name, []);
			byName.get(name).push(entry);
		}
	}
	return { byPath, byHash, byName };
}

function result(asset, method, confidence, candidates = []) {
	return { asset: asset || null, method, confidence, candidates };
}

/**
 * @param {Array<{key:string,path:string,name?:string}>} clips  one per distinct source file
 * @param {{byPath:Map,byHash:Map,byName:Map}} index
 * @param {{statSize?:(path:string)=>Promise<number|null>, hashFile?:(path:string)=>Promise<string|null>}} io
 * @returns {Promise<Map<string,{asset:object|null,method:string,confidence:number,candidates:object[]}>>}
 */
export async function matchClips(clips, index, io = {}) {
	const out = new Map();
	const hashCache = new Map();
	const sizeCache = new Map();
	const sizeOf = async (p) => {
		if (!io.statSize || !p) return null;
		if (!sizeCache.has(p)) sizeCache.set(p, await io.statSize(p).catch(() => null));
		return sizeCache.get(p);
	};
	const hashOf = async (p) => {
		if (!io.hashFile || !p) return null;
		if (!hashCache.has(p)) hashCache.set(p, await io.hashFile(p).catch(() => null));
		return hashCache.get(p);
	};

	for (const clip of clips) {
		const path = clip.path || '';
		const name = (clip.name || basename(path)).toLowerCase();

		const byPath = index.byPath.get(normalizePath(path));
		if (byPath) { out.set(clip.key, result(byPath, 'path', 1)); continue; }

		const hash = await hashOf(path);
		const byHash = hash ? index.byHash.get(hash) : null;
		if (byHash) { out.set(clip.key, result(byHash, 'hash', 1)); continue; }

		const named = index.byName.get(name) || [];
		if (named.length) {
			const size = await sizeOf(path);
			const sized = size != null ? named.find(a => a.fileSize === size) : null;
			if (sized) { out.set(clip.key, result(sized, 'filename_size', 0.9, named)); continue; }
			out.set(clip.key, result(named[0], 'filename', 0.4, named));
			continue;
		}

		out.set(clip.key, result(null, 'unmatched', 0));
	}
	return out;
}

// Distinct source files referenced by a parsed timeline, keyed so every clip
// of the same file shares one match.
export function sourcesFromTimeline(timeline) {
	const seen = new Map();
	for (const track of timeline.tracks) {
		for (const c of track.clips) {
			if (c.sourceKind !== 'file' || !c.file) continue;
			const key = c.file.id || c.file.path;
			if (!seen.has(key)) seen.set(key, { key, path: c.file.path, name: c.file.name });
		}
	}
	return [...seen.values()];
}

// Map every clip id to the match of its source file.
export function matchesByClip(timeline, matchesBySource) {
	const map = new Map();
	for (const track of timeline.tracks) {
		for (const c of track.clips) {
			if (c.sourceKind !== 'file' || !c.file) continue;
			const key = c.file.id || c.file.path;
			const m = matchesBySource.get(key);
			if (m) map.set(c.id, m);
		}
	}
	return map;
}

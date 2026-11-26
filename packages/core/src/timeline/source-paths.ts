// Pure: whether a path that a timeline file names may be opened (D65).
//
// A timeline says where each source was on the editor's machine, and that
// text comes from a file someone else may have made. Matching a source by
// its size or its bytes means opening that path, so the path is opened only
// when it is a full local path inside one of the project's media folders,
// which the person chose and the tracker reads anyway. Anything else is
// never touched, and the source is matched by its name.
//
// A path on another computer is refused whatever folder it claims to be in:
// on Windows, merely asking whether such a file exists connects to that
// computer and offers it the user's login. That covers network shares
// ("\\host\share", "//host/share", WebDAV's "\\host@SSL\…") and the device
// forms ("\\?\…", "\\.\…"), which all start with two slashes.

import { isFullPath, isWithin, type Platform } from "../catalog/paths.ts";

/**
 * True when `file` may be opened to match a timeline's source: a full local
 * path that is inside one of `folders` (the project's media folders on this
 * machine), not one of them itself.
 */
export function mayOpenSourcePath(
	file: unknown,
	folders: readonly string[],
	platform: Platform,
): file is string {
	if (typeof file !== "string" || file === "" || file.includes("\0"))
		return false;
	// Another computer, or a device: never, on any system.
	if (/^[\\/]{2}/.test(file)) return false;
	if (!isFullPath(file, platform)) return false;
	return folders.some(
		(folder) =>
			!/^[\\/]{2}/.test(folder) &&
			isWithin(folder, file, platform) &&
			!isWithin(file, folder, platform),
	);
}

// Rules for the import routes (pure).
//
// `module` arrives in the request and picks the managed-storage folder, so it
// must be one of the known names: anything else (a typo, or "../../somewhere")
// is refused, never used as a folder name.
//
// "Delete originals" removes a source file only after the tracker has made
// its own copy of it. A file tracked in place is the original (D12), and a
// duplicate was not imported at all, so neither is ever deleted.

export const MODULE_FOLDERS = Object.freeze({
	archival: "archival-images",
	"ai-assets": "ai-assets",
	produced: "produced-assets",
});

export const IMPORT_MODULES = Object.freeze(Object.keys(MODULE_FOLDERS));

export function isImportModule(module) {
	return typeof module === "string" && Object.hasOwn(MODULE_FOLDERS, module);
}

// The storage folder for a module, or null when the name is not a known one.
export function moduleFolder(module) {
	return isImportModule(module) ? MODULE_FOLDERS[module] : null;
}

export function mayDeleteSource({
	deleteOriginal,
	inPlace,
	duplicate,
	copied,
}) {
	return deleteOriginal === true && !inPlace && !duplicate && copied === true;
}

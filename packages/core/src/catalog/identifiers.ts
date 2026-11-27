// Schemes the pages suggest for a credited person's identifier (format 3,
// D75). The catalog takes any scheme, kept in lower case: these are the ones
// most people have. Pure, with no imports, so a page can use it too.

export const IDENTIFIER_SCHEMES: ReadonlyArray<{
	scheme: string;
	label: string;
	/** What one looks like. */
	example: string;
}> = [
	{ scheme: "orcid", label: "ORCID", example: "0000-0002-1825-0097" },
	{ scheme: "isni", label: "ISNI", example: "0000 0001 2103 2683" },
	{ scheme: "wikidata", label: "Wikidata", example: "Q42" },
	{ scheme: "viaf", label: "VIAF", example: "113230702" },
	{ scheme: "url", label: "Web address", example: "https://example.org/me" },
];

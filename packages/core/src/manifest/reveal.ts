// Pure: what a source's own Content Credentials would reveal once they travel
// inside a signed film (Phase 8 step 4, D62). An ingredient that carries
// credentials brings its whole manifest store into the signed file: its own
// manifest and those of its ingredients. This lists, from a reading of the
// source (a library manifest store), everything in it except what is known
// to say nothing about anyone (D64): each item with what it says, and the
// JUMBF address a redaction needs.
//
// Redaction removes one assertion and records that it was removed, and why
// (c2pa.redacted). Not everything may be redacted: an action assertion (where
// AI generation details sit) and the hashes that bind the file may not, a
// manifest's signer is in its signature, and the file names a manifest
// records are in its claim. Those can only be kept, or the source's
// credentials left out entirely.

export type RevealKind =
	| "identity"
	| "metadata"
	| "author"
	| "location"
	| "device"
	| "generation"
	| "names"
	| "other";

export interface RevealItem {
	/** JUMBF address of the assertion: what a redaction names. For file names, the manifest's own address. */
	uri: string;
	/** The manifest it is in, and the assertion's label there ("" for file names). */
	manifest: string;
	label: string;
	kind: RevealKind;
	/** What it says, in a few words for the person deciding. */
	what: string;
	/** The values it would reveal, briefly (names, accounts, places). */
	values: string[];
	/** Whether it can be redacted on its own; if not, only leaving the source's credentials out removes it. */
	redactable: boolean;
}

export interface Reveal {
	/** Manifests the source brings in (its own and its ingredients'). */
	manifests: number;
	/** Their labels: what a signed copy must not hold once a source's credentials are left out. */
	manifestLabels: string[];
	/** Who signed each of them: a signer is in the signature and cannot be redacted. */
	signers: string[];
	/** The programs that made them, as each manifest names its own. */
	generators: string[];
	/** Everything they say that is not known to be harmless. */
	items: RevealItem[];
	/** Assertions known to say nothing about anyone: hashes, thumbnails, time stamps, plain actions. */
	otherAssertions: number;
	/**
	 * Set when the source has credentials (or may have) and the reader failed
	 * on them: nothing in them can be listed, so they can only be left out.
	 */
	unreadable?: string;
}

/** A source of a signed film, with what its own credentials would reveal. */
export interface RevealSource {
	assetId: number;
	/** Its file name, for messages. */
	title?: string;
	reveal: Reveal;
}

type Store = {
	manifests?: Record<
		string,
		{
			title?: string;
			claim_generator_info?: Array<{ name?: string; version?: string }>;
			ingredients?: Array<{ title?: string }>;
			assertions?: Array<{ label?: string; data?: unknown }>;
			signature_info?: { common_name?: string; issuer?: string };
		}
	>;
};

const MAX_VALUES = 8;

/** The JUMBF address of an assertion in a manifest, as c2pa.redacted and addRedaction name it. */
export function assertionUri(manifest: string, label: string): string {
	return `self#jumbf=/c2pa/${manifest}/c2pa.assertions/${label}`;
}

/**
 * Every string inside a value, briefly, at most a few. With `keys`, only
 * what sits under a matching key, and a number there counts too (a latitude
 * may be written as one).
 */
function strings(value: unknown, keys?: RegExp): string[] {
	const out: string[] = [];
	const walk = (v: unknown, key: string) => {
		if (out.length >= MAX_VALUES) return;
		if (typeof v === "string" || (keys && typeof v === "number")) {
			if (!keys || keys.test(key)) {
				const s = String(v).trim();
				if (s && !out.includes(s))
					out.push(s.length > 80 ? `${s.slice(0, 77)}…` : s);
			}
		} else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
		else if (v && typeof v === "object")
			for (const [k, x] of Object.entries(v))
				// A JSON-LD @context declares vocabularies; it says nothing about anyone.
				if (k !== "@context") walk(x, k);
	};
	walk(value, "");
	return out;
}

/** The first few of a list, without repeats. */
const few = (list: string[]) => [...new Set(list)].slice(0, MAX_VALUES);

const GENERATION_KEYS = /prompt|description|details|instructions|negative/i;
const LOCATION_KEYS =
	/gps|latitude|longitude|location|city|state|province|country|sublocation/i;
// "CreatorTool" names a program, not a person.
const PERSON_KEYS =
	/artist|creator(?!tool)|author|by-?line|owner|copyright|rights|credit|contact|email/i;
const DEVICE_KEYS = /serial|imei|make|model|lens|software|tool|device|host/i;

/**
 * Assertions known to say nothing about anyone: the hashes that bind the
 * file, thumbnails, the ingredient records (their file names are listed with
 * the manifest's), a time stamp and a certificate's status. Everything not
 * named here is listed (D64).
 */
const HARMLESS =
	/^c2pa\.(hash\.|thumbnail\.|ingredient(\.|$)|time-stamp$|certificate-status$)/;

/** Metadata about the file or its making: EXIF, IPTC, the C2PA metadata assertion, and any other that calls itself metadata. */
const METADATA = /^(stds\.(exif|iptc)|c2pa\.metadata)|\.metadata$/;

/** What an action may say that tells nothing: what was done, with what, to which ingredient, and when. */
const ACTION_PLAIN = [
	"action",
	"digitalSourceType",
	"when",
	"softwareAgent",
	"instanceId",
	"reason",
	"changed",
];
const PARAMETER_PLAIN = [
	"ingredientIds",
	"ingredients",
	"redacted",
	"instanceId",
];

const without = (value: unknown, keys: string[]): Record<string, unknown> =>
	Object.fromEntries(
		Object.entries(
			value && typeof value === "object" && !Array.isArray(value) ? value : {},
		).filter(([k]) => !keys.includes(k)),
	);

/** What an actions assertion says beyond plain actions: free text in an action, its parameters, or the regions it names. */
function actionsSay(data: unknown): unknown {
	const d = (data ?? {}) as { actions?: unknown };
	const actions = Array.isArray(d.actions) ? d.actions : [];
	return {
		...without(d, ["actions", "softwareAgents", "allActionsIncluded"]),
		actions: actions.map((a: { parameters?: unknown; changes?: unknown }) => ({
			...without(a, [...ACTION_PLAIN, "parameters", "changes"]),
			parameters: without(a?.parameters, PARAMETER_PLAIN),
			// A change's region is a time or a shape; only its words can tell.
			changes: (Array.isArray(a?.changes) ? a.changes : []).map(
				(c: { description?: unknown; region?: unknown }) => ({
					description: c?.description,
					region: (Array.isArray(c?.region) ? c.region : []).map(
						(r: Record<string, unknown>) => ({
							name: r?.name,
							description: r?.description,
							identifier: r?.identifier,
						}),
					),
				}),
			),
		})),
	};
}

/** What one assertion reveals, or null when it is known to say nothing about anyone. */
function classify(
	manifest: string,
	label: string,
	data: unknown,
): RevealItem | null {
	const base = { uri: assertionUri(manifest, label), manifest, label };
	const plain = label.replace(/__\d+$/, "");
	if (plain.startsWith("cawg.identity")) {
		const ids = (data as { verifiedIdentities?: unknown })?.verifiedIdentities;
		return {
			...base,
			kind: "identity",
			what: "Who made this source: an identity, with any accounts linked to it",
			values: strings(ids ?? data, /^(name|username|uri|id)$/),
			redactable: true,
		};
	}
	if (plain.startsWith("cawg.metadata"))
		return {
			...base,
			kind: "metadata",
			what: "Descriptive metadata: creators, rights, descriptions",
			values: strings(data),
			redactable: true,
		};
	if (plain === "stds.schema-org.CreativeWork")
		return {
			...base,
			kind: "author",
			what: "Who is named as its author",
			values: strings((data as { author?: unknown })?.author ?? data, /^name$/),
			redactable: true,
		};
	if (METADATA.test(plain)) {
		// Listed whatever it holds; what tells most decides how it is named.
		const where = strings(data, LOCATION_KEYS);
		const who = strings(data, PERSON_KEYS);
		const device = strings(data, DEVICE_KEYS);
		const kind = where.length
			? "location"
			: who.length
				? "author"
				: device.length
					? "device"
					: "metadata";
		return {
			...base,
			kind,
			what: {
				location: "Where it was made (location)",
				author: "Who is named in its metadata",
				device: "The device or program that made it",
				metadata: "Metadata about the file",
			}[kind],
			values: few([...where, ...who, ...device, ...strings(data)]),
			redactable: true,
		};
	}
	if (plain.startsWith("c2pa.actions")) {
		const said = actionsSay(data);
		const generation = strings(said, GENERATION_KEYS);
		const all = strings(said);
		if (!all.length) return null;
		return {
			...base,
			kind: generation.length ? "generation" : "other",
			what: generation.length
				? "How it was made: generation details such as a prompt or a description"
				: "Other details in its record of how it was made",
			values: few([...generation, ...all]),
			// C2PA does not allow redacting an actions assertion.
			redactable: false,
		};
	}
	if (/^(c2pa|cawg)\.training-mining$/.test(plain)) {
		// Permissions, from a fixed list of words; only anything else tells.
		const said = strings(data).filter(
			(s) => !/^(allowed|notAllowed|constrained)$/.test(s),
		);
		if (!said.length) return null;
		return {
			...base,
			kind: "other",
			what: "Conditions on training and data mining, in its own words",
			values: said,
			redactable: true,
		};
	}
	if (HARMLESS.test(plain)) return null;
	return {
		...base,
		kind: "other",
		what: `Something else it says (${plain})`,
		values: strings(data),
		redactable: true,
	};
}

/** What a source's manifest store would reveal inside a signed film. */
export function revealOf(store: Store | null | undefined): Reveal {
	const manifests = Object.entries(store?.manifests ?? {});
	const items: RevealItem[] = [];
	let otherAssertions = 0;
	const signers: string[] = [];
	const generators: string[] = [];
	const add = (list: string[], value: string) => {
		if (value && !list.includes(value)) list.push(value);
	};
	for (const [label, m] of manifests) {
		add(signers, m.signature_info?.common_name ?? "");
		for (const g of Array.isArray(m.claim_generator_info)
			? m.claim_generator_info
			: [])
			add(generators, [g?.name, g?.version].filter(Boolean).join(" "));
		// The names a manifest records are in its claim: its own title, and the
		// title of each file it was made from.
		const names = [
			m.title,
			...(Array.isArray(m.ingredients) ? m.ingredients : []).map(
				(i) => i?.title,
			),
		].filter((n): n is string => typeof n === "string" && !!n.trim());
		const distinct = [...new Set(names)];
		if (distinct.length)
			items.push({
				uri: `self#jumbf=/c2pa/${label}`,
				manifest: label,
				label: "",
				kind: "names",
				what: "File names it records: its own, and those of the files it was made from",
				values:
					distinct.length > MAX_VALUES
						? [
								...distinct.slice(0, MAX_VALUES),
								`and ${distinct.length - MAX_VALUES} more`,
							]
						: distinct,
				redactable: false,
			});
		for (const a of m.assertions ?? []) {
			const item = a.label ? classify(label, a.label, a.data) : null;
			if (item) items.push(item);
			else otherAssertions++;
		}
	}
	return {
		manifests: manifests.length,
		manifestLabels: manifests.map(([label]) => label),
		signers,
		generators,
		items,
		otherAssertions,
	};
}

/**
 * What a signed copy still holds of what was to be kept out of it, read from
 * its read-back; empty when all of it is gone. A redacted assertion is no
 * longer listed in its manifest, and a source whose credentials were left
 * out leaves none of its manifests behind.
 * @param kept.redact the addresses redacted
 * @param kept.manifests the manifest labels that only left-out sources carried
 */
export function stillCarried(
	report: Store | null | undefined,
	kept: { redact: readonly string[]; manifests: readonly string[] },
): string[] {
	if (!report?.manifests)
		return ["the signed copy's credentials could not be read back"];
	const problems: string[] = [];
	for (const uri of kept.redact) {
		const at = /^self#jumbf=\/c2pa\/(.+)\/c2pa\.assertions\/([^/]+)$/.exec(uri);
		if (!at) {
			problems.push(`${uri} is not an assertion's address`);
			continue;
		}
		const [, manifest, label] = at;
		if (report.manifests[manifest]?.assertions?.some((a) => a.label === label))
			problems.push(`${label} is still in the signed copy`);
	}
	for (const label of kept.manifests)
		if (Object.hasOwn(report.manifests, label))
			problems.push(
				`the credentials of a source that was left out are still in the signed copy`,
			);
	return [...new Set(problems)];
}

/** A person's choices, checked against what can be withheld: redactable addresses, and sources that carry credentials. */
export interface Withhold {
	redact: string[];
	/** Asset ids of sources whose credentials are left out entirely. */
	leaveOut: number[];
}

/**
 * The choices that make sense for these sources: an address only if some
 * source's credentials have it and it may be redacted; a source only if it
 * carries credentials. Anything else is refused by name.
 * @returns the problems, empty when every choice is valid
 */
export function checkWithhold(
	choice: Withhold,
	sources: ReadonlyArray<RevealSource>,
): string[] {
	const problems: string[] = [];
	const redactable = new Set(
		sources.flatMap((s) =>
			s.reveal.items.filter((i) => i.redactable).map((i) => i.uri),
		),
	);
	const carrying = new Set(sources.filter(carries).map((s) => s.assetId));
	for (const uri of choice.redact)
		if (!redactable.has(uri))
			problems.push(
				`${uri} is not something in these sources' credentials that can be redacted`,
			);
	for (const id of choice.leaveOut)
		if (!carrying.has(id))
			problems.push(
				`Asset ${id} is not a source here that carries credentials`,
			);
	// Credentials nobody could read cannot be reviewed, so they cannot travel.
	for (const s of sources)
		if (s.reveal.unreadable && !choice.leaveOut.includes(s.assetId))
			problems.push(
				`${nameOf(s)} has Content Credentials that could not be read (${s.reveal.unreadable}), so what they say cannot be shown. Leave its credentials out to sign`,
			);
	return problems;
}

/** Whether a source has credentials of its own that would travel, read or not. */
const carries = (s: RevealSource) =>
	s.reveal.manifests > 0 || !!s.reveal.unreadable;

const nameOf = (s: { assetId: number | null; title?: string }) =>
	s.title || (s.assetId === null ? "a source" : `asset ${s.assetId}`);

/**
 * Whether two readings of a source would put the same things in a signed
 * film: the same manifests and signers, and the same items at the same
 * addresses with the same values. Signing compares what it reads with what
 * the review showed, and refuses when they differ.
 */
export function sameReveal(a: Reveal, b: Reveal): boolean {
	const plain = (r: Reveal) =>
		JSON.stringify([
			r.manifestLabels,
			r.signers,
			r.generators,
			r.items.map((i) => [i.uri, i.kind, i.values, i.redactable]),
			r.otherAssertions,
			!!r.unreadable,
		]);
	return plain(a) === plain(b);
}

/**
 * A redaction as a signing remembers it: by source, assertion and kind, as
 * well as by address. The address holds the label of the manifest the
 * assertion was in, and a re-rendered file is signed afresh under a new
 * label, so the address alone is lost with every re-render.
 */
export interface RememberedRedaction {
	/** The source it was in; null in a record made before sources were remembered. */
	assetId: number | null;
	/** That source's file name then, for messages. */
	title: string;
	/** The assertion's label in its manifest. */
	label: string;
	/** Null in a record made before kinds were remembered. */
	kind: RevealKind | null;
	/** The address it had in that signing. */
	uri: string;
}

/** What a signing kept out, as the next one starts from it. */
export interface Remembered {
	redact: RememberedRedaction[];
	/** Asset ids of sources whose credentials were left out entirely. */
	leaveOut: number[];
}

const KIND_WORDS: Record<RevealKind, string> = {
	identity: "an identity",
	metadata: "descriptive metadata",
	author: "an author's name",
	location: "a location",
	device: "device details",
	generation: "generation details",
	names: "file names",
	other: "something else it says",
};

/** Whether a value read from a catalog is one of the kinds. */
export const isRevealKind = (v: unknown): v is RevealKind =>
	typeof v === "string" && Object.hasOwn(KIND_WORDS, v);

/** An assertion's label without the counter a repeated label gets. */
const plainLabel = (label: string) => label.replace(/__\d+$/, "");

/** The assertion label an address ends with. */
const labelOfUri = (uri: string) => uri.split("/").pop() ?? "";

/** How a choice is remembered: each address with the source, label and kind it has now. */
export function rememberRedactions(
	uris: readonly string[],
	sources: ReadonlyArray<RevealSource>,
): RememberedRedaction[] {
	return uris.map((uri) => {
		for (const s of sources) {
			const item = s.reveal.items.find((i) => i.uri === uri);
			if (item)
				return {
					assetId: s.assetId,
					title: s.title ?? "",
					label: item.label,
					kind: item.kind,
					uri,
				};
		}
		return {
			assetId: null,
			title: "",
			label: labelOfUri(uri),
			kind: null,
			uri,
		};
	});
}

/** One thing the last signing kept out, and where it is in the sources now. */
export interface CarriedItem {
	/** The source it was in; null when the record does not say. */
	assetId: number | null;
	/** What it is, in words: "an identity in film.mp4". */
	what: string;
	/** Its address or addresses now; empty when the sources no longer carry it. */
	now: string[];
}

export interface Carried {
	/** The last signing's choices as they apply to these sources. */
	withhold: Withhold;
	/** Each redaction the last signing made, and where it is now. */
	redactions: CarriedItem[];
	/**
	 * What a person should be told, in sentences: what was found at a new
	 * address and kept out again, and what was dropped because the sources no
	 * longer carry it. Empty when every choice applies exactly as it was.
	 */
	notes: string[];
}

/**
 * Carry the last signing's choices to the sources as they are now, so a new
 * signed copy never quietly reveals what the last one kept out.
 *
 * A redaction whose address is still in its source is kept as it is. One
 * whose address is gone from its source (the source was re-rendered, so its
 * manifest has a new label) is looked for there by its assertion label and
 * by its kind, and every redactable match is kept out: when in doubt, more
 * is withheld, and the person is told. What no source carries any more is
 * dropped, and the person is told that too.
 *
 * An address names a manifest by its label, and two sources can hold the same
 * manifest (a still, and a cut that used it). So an address still found in
 * another source stays redacted, but it never stands in for looking in the
 * source the choice was made about.
 */
export function carryWithheld(
	last: Remembered,
	sources: ReadonlyArray<RevealSource>,
): Carried {
	const redact = new Set<string>();
	const redactions: CarriedItem[] = [];
	const notes: string[] = [];
	const redactableIn = (s: RevealSource) =>
		s.reveal.items.filter((i) => i.redactable);
	const has = (s: RevealSource, uri: string) =>
		redactableIn(s).some((i) => i.uri === uri);
	for (const r of last.redact) {
		const source = sources.find((s) => s.assetId === r.assetId);
		const where = nameOf({
			assetId: r.assetId,
			title: source?.title || r.title,
		});
		const what = `${r.kind ? KIND_WORDS[r.kind] : `"${plainLabel(r.label)}"`} in ${where}`;
		const now: string[] = sources.some((s) => has(s, r.uri)) ? [r.uri] : [];
		// Where to look again: in its own source when the address is gone from
		// it; in every source for a record that names none and matches nowhere.
		const within =
			r.assetId === null
				? now.length
					? []
					: sources
				: source && !has(source, r.uri)
					? [source]
					: [];
		const label = plainLabel(r.label || labelOfUri(r.uri));
		const found = within.flatMap((s) =>
			redactableIn(s)
				.filter(
					(i) => plainLabel(i.label) === label || (r.kind && i.kind === r.kind),
				)
				.map((i) => i.uri),
		);
		for (const uri of found) if (!now.includes(uri)) now.push(uri);
		for (const uri of now) redact.add(uri);
		redactions.push({ assetId: r.assetId, what, now });
		if (found.length)
			notes.push(
				`The last signed copy kept out ${what}. The file has changed since, so it was looked for again and is kept out of this copy too (${found.length} ${found.length === 1 ? "item" : "items"}).`,
			);
		else if (now.length) continue;
		else if (r.assetId !== null && !source)
			notes.push(
				`The last signed copy kept out ${what}. That file is no longer a source of this edit, so there is nothing to keep out.`,
			);
		else
			notes.push(
				`The last signed copy kept out ${what}. The file no longer carries it, so there is nothing to keep out.`,
			);
	}
	const leaveOut: number[] = [];
	for (const id of new Set(last.leaveOut)) {
		const source = sources.find((s) => s.assetId === id);
		if (source && carries(source)) leaveOut.push(id);
		else
			notes.push(
				source
					? `The last signed copy left out all of ${nameOf(source)}'s own credentials. The file carries none now, so there is nothing to leave out.`
					: `The last signed copy left out the credentials of asset ${id}. It is no longer a source of this edit.`,
			);
	}
	return { withhold: { redact: [...redact], leaveOut }, redactions, notes };
}

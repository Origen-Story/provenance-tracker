// Pure: what a source's own Content Credentials would reveal once they travel
// inside a signed film (Phase 8 step 4, D62). An ingredient that carries
// credentials brings its whole manifest store into the signed file: its own
// manifest and those of its ingredients. This lists, from the stored reading
// of the source (the catalog's c2pa observation, a library manifest store),
// what in it says something about a person, a place or a device, each with
// the JUMBF address a redaction needs.
//
// Redaction removes one assertion and records that it was removed, and why
// (c2pa.redacted). Not everything may be redacted: an action assertion (where
// AI generation details sit) and the hashes that bind the file may not, and a
// manifest's signer is in its signature. Those can only be kept, or the
// source's credentials left out entirely.

export type RevealKind =
	"identity" | "metadata" | "author" | "location" | "device" | "generation";

export interface RevealItem {
	/** JUMBF address of the assertion: what a redaction names. */
	uri: string;
	/** The manifest it is in, and the assertion's label there. */
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
	/** Who signed each of them: a signer is in the signature and cannot be redacted. */
	signers: string[];
	items: RevealItem[];
	/** Assertions that say nothing personal (hashes, ingredients, thumbnails, plain actions). */
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

/** Every string inside a value, briefly, at most a few. */
function strings(value: unknown, keys?: RegExp): string[] {
	const out: string[] = [];
	const walk = (v: unknown, key: string) => {
		if (out.length >= MAX_VALUES) return;
		if (typeof v === "string") {
			if (!keys || keys.test(key)) {
				const s = v.trim();
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

const GENERATION_KEYS = /prompt|description|details|instructions|negative/i;
const LOCATION_KEYS =
	/gps|latitude|longitude|location|city|country|sublocation/i;
const DEVICE_KEYS = /serial|imei|owner/i;

/** What one assertion reveals, or null when it says nothing personal. */
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
	if (plain.startsWith("stds.exif") || plain.startsWith("stds.iptc")) {
		const where = strings(data, LOCATION_KEYS);
		const device = strings(data, DEVICE_KEYS);
		if (!where.length && !device.length) return null;
		return {
			...base,
			kind: where.length ? "location" : "device",
			what: where.length
				? "Where it was made (location)"
				: "The device that made it (serial numbers)",
			values: [...where, ...device].slice(0, MAX_VALUES),
			redactable: true,
		};
	}
	if (plain.startsWith("c2pa.actions")) {
		const actions =
			(data as { actions?: Array<{ parameters?: unknown }> })?.actions ?? [];
		const said = actions.flatMap((a) => strings(a.parameters, GENERATION_KEYS));
		if (!said.length) return null;
		return {
			...base,
			kind: "generation",
			what: "How it was made: generation details such as a prompt or a description",
			values: said.slice(0, MAX_VALUES),
			// C2PA does not allow redacting an actions assertion.
			redactable: false,
		};
	}
	return null;
}

/** What a source's manifest store would reveal inside a signed film. */
export function revealOf(store: Store | null | undefined): Reveal {
	const manifests = Object.entries(store?.manifests ?? {});
	const items: RevealItem[] = [];
	let otherAssertions = 0;
	const signers: string[] = [];
	for (const [label, m] of manifests) {
		const who = m.signature_info?.common_name;
		if (who && !signers.includes(who)) signers.push(who);
		for (const a of m.assertions ?? []) {
			const item = a.label ? classify(label, a.label, a.data) : null;
			if (item) items.push(item);
			else otherAssertions++;
		}
	}
	return { manifests: manifests.length, signers, items, otherAssertions };
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
			r.manifests,
			r.signers,
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

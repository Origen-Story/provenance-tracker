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
	sources: ReadonlyArray<{ assetId: number; reveal: Reveal }>,
): string[] {
	const problems: string[] = [];
	const redactable = new Set(
		sources.flatMap((s) =>
			s.reveal.items.filter((i) => i.redactable).map((i) => i.uri),
		),
	);
	const carrying = new Set(
		sources.filter((s) => s.reveal.manifests > 0).map((s) => s.assetId),
	);
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
	return problems;
}

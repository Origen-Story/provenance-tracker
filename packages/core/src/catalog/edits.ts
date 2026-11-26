// A person's edits to a catalog, with the rules the app has always applied
// (roadmap Phase 6, D38). Every change goes through edit.ts, so it is made
// with its history row in one transaction, under the person's name.
//
// Each function takes only the fields a person may set, by name, and refuses
// anything else, so a request body is never written whole.

import type { DatabaseSync } from "node:sqlite";
import { ORIGIN_CLASSES, originClassDef } from "../origin-vocabulary.js";
import { cleanPublicTitle } from "../manifest/build.js";
import { classifyCatalog } from "./classify.ts";
import type { Tool } from "./create.ts";
import {
	createRow,
	editRow,
	removeRow,
	setMeta,
	type Actor,
	type ChangeOptions,
} from "./edit.ts";
import { EDITABLE, EDITABLE_META } from "./fields.ts";
import { inTransaction } from "./format.ts";
import {
	carryClassesInto,
	refreshTimelines,
	saveStatement,
	startedFrom,
	timelinesUsing,
} from "./timelines.ts";

import { EditError, NotFoundError } from "./errors.ts";
import { publicationOf, type Publication } from "./publications.ts";
import { RELATION_LINK, type EditRelation } from "./revisions.ts";

export { EditError, NotFoundError };

export const ASSET_KINDS: readonly string[] = [
	"unsorted",
	"generated",
	"archival",
	"produced",
	"sidecar",
];

/** The kinds of link a person makes; sidecar_of is extract's. */
export const LINK_TYPES: readonly string[] = [
	"ingredient",
	"derived_from",
	"output_of",
	// A finished edit made from another (a vertical cut, a trailer, a transcode), D60.
	"made_from",
];

/** The asset fields a person may set. The rest are a tool's or derived. */
export const PERSON_ASSET_FIELDS: readonly string[] = [
	"code",
	"kind",
	"is_output",
	"output_source",
	"title",
	"public_title",
	"description",
	"caption",
	"notes",
	"usage_notes",
	"original_date",
	"medium",
	"recorded_date",
	"recorded_location",
	"equipment",
	"source_url",
	"access_date",
	"license",
	"license_url",
	"origin_class",
	"origin_class_confirmed",
	"origin_class_note",
	"origin_ingredient_classes",
	"ai_assisted",
];

const NOTE_MAX = 2000;

export interface PersonEdit {
	/** The person making the change. */
	actor: Actor;
	/** Why, in their words. */
	note?: string;
	now?: string;
	/** Runs classify on the assets whose class follows this one (an upscale of it). */
	tool: Tool;
}

function only(
	input: Record<string, unknown>,
	allowed: readonly string[],
	what: string,
): Record<string, unknown> {
	const unknown = Object.keys(input).filter((k) => !allowed.includes(k));
	if (unknown.length)
		throw new EditError(
			`${what} has no field${unknown.length > 1 ? "s" : ""} ${unknown.join(", ")} that can be set`,
		);
	return { ...input };
}

function assetRow(db: DatabaseSync, id: number): Record<string, unknown> {
	const row = db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as
		Record<string, unknown> | undefined;
	if (!row) throw new NotFoundError("There is no such asset");
	return row;
}

function change(opts: PersonEdit): ChangeOptions {
	return { actor: opts.actor, note: opts.note ?? "", now: opts.now };
}

/** The assets that derive from this one (an upscale of it), whose class follows its. */
function derivedChildren(db: DatabaseSync, id: number): number[] {
	return (
		db
			.prepare(
				"SELECT child_id FROM relationships WHERE parent_id = ? AND type = 'derived_from'",
			)
			.all(id) as Array<{ child_id: number }>
	).map((r) => r.child_id);
}

/**
 * Change an asset's fields. Setting its class makes it the person's (source
 * "user") and confirmed, unless they say it is not; "AI-assisted" is kept
 * only for a class of digital work. Assets derived from it are classified
 * again, so an upscale follows its source.
 * @returns the fields that changed
 */
export function editAsset(
	db: DatabaseSync,
	id: number,
	input: Record<string, unknown>,
	opts: PersonEdit,
): string[] {
	const fields = only(input, PERSON_ASSET_FIELDS, "An asset");
	const current = assetRow(db, id);
	if ("kind" in fields && !ASSET_KINDS.includes(fields.kind as string))
		throw new EditError(
			`kind must be one of ${ASSET_KINDS.join(", ")}, not ${JSON.stringify(fields.kind)}`,
		);
	if ("public_title" in fields)
		fields.public_title = cleanPublicTitle(fields.public_title);
	if ("origin_class_note" in fields)
		fields.origin_class_note = String(fields.origin_class_note ?? "")
			.trim()
			.slice(0, NOTE_MAX);
	if ("origin_class" in fields) {
		if (!ORIGIN_CLASSES.includes(fields.origin_class as string))
			throw new EditError(
				`Unknown origin class: ${JSON.stringify(fields.origin_class)}`,
			);
		fields.origin_class_source = "user";
		if (!("origin_class_confirmed" in fields))
			fields.origin_class_confirmed = true;
	}
	if ("origin_ingredient_classes" in fields) {
		const list = fields.origin_ingredient_classes;
		if (
			!Array.isArray(list) ||
			list.some((c) => !ORIGIN_CLASSES.includes(c as string))
		)
			throw new EditError(
				"origin_ingredient_classes must be a list of origin classes",
			);
	}
	const cls = (fields.origin_class ?? current.origin_class) as string;
	if (originClassDef(cls)?.position !== "digital") {
		// The flag only means something for digital work with no AI in its pixels.
		if (fields.ai_assisted === true)
			throw new EditError(
				`"AI-assisted" applies only to digital work; ${cls} is not`,
			);
		if (current.ai_assisted === 1 || "ai_assisted" in fields)
			fields.ai_assisted = false;
	}
	try {
		return inTransaction(db, () => {
			const done = editRow(db, "assets", id, fields, change(opts));
			// What is on screen changed for the timelines that use it.
			if (done.includes("origin_class") || done.includes("ai_assisted"))
				refreshTimelines(db, timelinesUsing(db, id), {
					tool: opts.tool,
					now: opts.now,
				});
			if (done.includes("origin_class")) {
				const children = derivedChildren(db, id);
				if (children.length)
					classifyCatalog(db, {
						tool: opts.tool,
						assetIds: children,
						now: opts.now ? () => opts.now! : undefined,
					});
			}
			return done;
		});
	} catch (err) {
		if (err instanceof EditError || err instanceof NotFoundError) throw err;
		// A value of the wrong type (edit.ts checks each one).
		throw new EditError((err as Error).message);
	}
}

/** Mark an asset removed (assets are never deleted), or bring it back. */
export function setRemoved(
	db: DatabaseSync,
	id: number,
	removed: boolean,
	opts: PersonEdit,
): void {
	const current = assetRow(db, id);
	const at = opts.now ?? new Date().toISOString();
	if (removed === (current.removed_at !== null)) return;
	editRow(db, "assets", id, { removed_at: removed ? at : null }, change(opts));
}

const CREDIT_FIELDS = ["role", "name", "on_behalf_of", "sort_order"];

/** Add a credit: who made the asset, in what role. The person adding it is who says so. */
export function addCredit(
	db: DatabaseSync,
	assetId: number,
	input: Record<string, unknown>,
	opts: PersonEdit,
): number {
	const fields = only(input, CREDIT_FIELDS, "A credit");
	assetRow(db, assetId);
	for (const f of ["role", "name"])
		if (typeof fields[f] !== "string" || !(fields[f] as string).trim())
			throw new EditError(`A credit needs a ${f}`);
	if (fields.sort_order === undefined)
		fields.sort_order = (
			db
				.prepare(
					"SELECT coalesce(max(sort_order) + 1, 0) AS n FROM credits WHERE asset_id = ?",
				)
				.get(assetId) as { n: number }
		).n;
	try {
		return Number(
			createRow(
				db,
				"credits",
				{ asset_id: assetId, stated_by: opts.actor.name, ...fields },
				change(opts),
			),
		);
	} catch (err) {
		throw new EditError((err as Error).message);
	}
}

function creditOf(db: DatabaseSync, assetId: number, creditId: number): void {
	const row = db
		.prepare("SELECT asset_id FROM credits WHERE id = ?")
		.get(creditId) as { asset_id: number } | undefined;
	if (!row || row.asset_id !== assetId)
		throw new NotFoundError("There is no such credit on this asset");
}

export function editCredit(
	db: DatabaseSync,
	assetId: number,
	creditId: number,
	input: Record<string, unknown>,
	opts: PersonEdit,
): string[] {
	const fields = only(input, CREDIT_FIELDS, "A credit");
	creditOf(db, assetId, creditId);
	for (const f of ["role", "name"])
		if (
			f in fields &&
			(typeof fields[f] !== "string" || !(fields[f] as string).trim())
		)
			throw new EditError(`A credit needs a ${f}`);
	try {
		return editRow(db, "credits", creditId, fields, change(opts));
	} catch (err) {
		throw new EditError((err as Error).message);
	}
}

export function removeCredit(
	db: DatabaseSync,
	assetId: number,
	creditId: number,
	opts: PersonEdit,
): void {
	creditOf(db, assetId, creditId);
	removeRow(db, "credits", creditId, change(opts));
}

/** Set an AI asset's generation details, making the row if it has none. */
export function setGeneration(
	db: DatabaseSync,
	assetId: number,
	input: Record<string, unknown>,
	opts: PersonEdit,
): string[] {
	const fields = only(
		input,
		Object.keys(EDITABLE.generation.fields),
		"Generation details",
	);
	assetRow(db, assetId);
	try {
		if (db.prepare("SELECT 1 FROM generation WHERE asset_id = ?").get(assetId))
			return editRow(db, "generation", assetId, fields, change(opts));
		createRow(db, "generation", { asset_id: assetId, ...fields }, change(opts));
		return Object.keys(fields);
	} catch (err) {
		throw new EditError((err as Error).message);
	}
}

/**
 * Link two assets: the child is made from the parent (ingredient), is an
 * enhanced copy of it (derived_from), or is an edit that used it (output_of).
 * Asking again for a link that exists gives that link. A derived_from child
 * is classified again, so it follows its parent's class.
 * @returns the link's id
 */
export function linkAssets(
	db: DatabaseSync,
	input: Record<string, unknown>,
	opts: PersonEdit,
): number {
	const fields = only(
		input,
		["parent_id", "child_id", "type", "note"],
		"A link",
	);
	const parent = Number(fields.parent_id);
	const child = Number(fields.child_id);
	const type = String(fields.type ?? "");
	if (!LINK_TYPES.includes(type))
		throw new EditError(
			`A link's type is one of ${LINK_TYPES.join(", ")}, not ${JSON.stringify(type)}`,
		);
	if (!Number.isSafeInteger(parent) || !Number.isSafeInteger(child))
		throw new EditError("A link needs a parent_id and a child_id");
	if (parent === child)
		throw new EditError("An asset cannot be linked to itself");
	assetRow(db, parent);
	assetRow(db, child);
	const existing = db
		.prepare(
			"SELECT id FROM relationships WHERE parent_id = ? AND child_id = ? AND type = ?",
		)
		.get(parent, child, type) as { id: number } | undefined;
	if (existing) return existing.id;
	return inTransaction(db, () => {
		const id = Number(
			createRow(
				db,
				"relationships",
				{
					parent_id: parent,
					child_id: child,
					type,
					match_method: "manual",
					confidence: 1,
					note: String(fields.note ?? ""),
				},
				change(opts),
			),
		);
		if (type === "derived_from")
			classifyCatalog(db, {
				tool: opts.tool,
				assetIds: [child],
				now: opts.now ? () => opts.now! : undefined,
			});
		return id;
	});
}

export function unlink(db: DatabaseSync, id: number, opts: PersonEdit): void {
	if (!db.prepare("SELECT 1 FROM relationships WHERE id = ?").get(id))
		throw new NotFoundError("There is no such link");
	removeRow(db, "relationships", id, change(opts));
}

// What a claim thumbnail can be, by file name. Signing checks the bytes.
const THUMBNAIL_FILE = /\.(jpe?g|png)$/i;

/** The image a finished edit is shown by in its credentials (thumbnail_of; D52), or null. */
export function thumbnailOf(db: DatabaseSync, outputId: number): number | null {
	const row = db
		.prepare(
			"SELECT child_id FROM relationships WHERE parent_id = ? AND type = 'thumbnail_of' ORDER BY id DESC LIMIT 1",
		)
		.get(outputId) as { child_id: number } | undefined;
	return row?.child_id ?? null;
}

/** An asset's own newest file name the catalog still sees (never a signed copy), or null. */
function ownFileName(db: DatabaseSync, assetId: number): string | null {
	const row = db
		.prepare(
			`SELECT l.path FROM contents c
			 JOIN locations l ON l.content_sha256 = c.sha256 AND l.gone_run_id IS NULL
			 WHERE c.asset_id = ?
			   AND NOT EXISTS (SELECT 1 FROM signatures s WHERE s.signed_sha256 = c.sha256)
			 ORDER BY c.created_at DESC, c.rowid DESC, l.path LIMIT 1`,
		)
		.get(assetId) as { path: string } | undefined;
	return row ? row.path.split("/").pop()! : null;
}

/**
 * Pick the image a finished edit is shown by in its credentials, its claim
 * thumbnail (D17, D52), or none (imageId null). The image is an asset in the
 * catalog, a JPEG or PNG, so signing knows its exact bytes. One per edit:
 * picking another replaces the link, in one transaction, under the person's
 * name. The edit's signed copies are not changed; the next one carries it.
 * @returns the link's id, or null when there is none now
 */
export function setThumbnail(
	db: DatabaseSync,
	outputId: number,
	imageId: number | null,
	opts: PersonEdit,
): number | null {
	const output = assetRow(db, outputId);
	if (output.is_output !== 1)
		throw new EditError("A thumbnail is for a finished edit (an output)");
	if (output.removed_at !== null)
		throw new EditError("This asset is removed; restore it first");
	if (imageId !== null) {
		if (!Number.isSafeInteger(imageId))
			throw new EditError("Say which image is the thumbnail");
		if (imageId === outputId)
			throw new EditError("An edit cannot be its own thumbnail");
		const image = assetRow(db, imageId);
		if (image.removed_at !== null)
			throw new EditError("That image is removed; restore it first");
		const name = ownFileName(db, imageId);
		if (!name || !THUMBNAIL_FILE.test(name))
			throw new EditError(
				"A thumbnail is a JPEG or PNG image the catalog has found",
			);
	}
	const current = db
		.prepare(
			"SELECT id, child_id FROM relationships WHERE parent_id = ? AND type = 'thumbnail_of' ORDER BY id",
		)
		.all(outputId) as Array<{ id: number; child_id: number }>;
	if (current.length === 1 && current[0].child_id === imageId)
		return current[0].id;
	if (current.length === 0 && imageId === null) return null;
	return inTransaction(db, () => {
		for (const link of current)
			removeRow(db, "relationships", link.id, change(opts));
		if (imageId === null) return null;
		return Number(
			createRow(
				db,
				"relationships",
				{
					parent_id: outputId,
					child_id: imageId,
					type: "thumbnail_of",
					match_method: "manual",
					confidence: 1,
					note: "",
				},
				change(opts),
			),
		);
	});
}

/** The finished edit's details a new export of it starts with (D50). */
export const STARTED_FROM_FIELDS: readonly string[] = [
	"public_title",
	"description",
	"caption",
	"usage_notes",
	"license",
	"license_url",
];

export interface StartedFrom {
	from: number;
	fields: string[];
	credits: number;
	statement: boolean;
	/** The earlier edit's thumbnail was taken (D52). */
	thumbnail: boolean;
	clipClasses: number;
}

/**
 * Start a new export as a finished edit from an earlier one (D50), once: it is
 * marked a finished edit, made "produced" unless a person chose its kind, and takes the earlier edit's public details (only
 * where its own are empty), its credits (if it has none), its newest statement
 * (if it has none), its thumbnail (if it has none) and, in its timeline, the
 * classes a person gave the same clips. A copy, not a link: changing either edit afterwards leaves the other
 * as it was. The started_from link records where the copy came from.
 */
export function startFromEdit(
	db: DatabaseSync,
	assetId: number,
	fromId: number,
	opts: PersonEdit,
	/** The next revision of it (the default), or made from it (D60). */
	as: EditRelation = "revision",
): StartedFrom {
	if (!Number.isSafeInteger(fromId))
		throw new EditError("Say which finished edit to start from");
	if (!Object.hasOwn(RELATION_LINK, as))
		throw new EditError(
			'An edit starts from another as its next revision ("revision") or as something made from it ("made_from")',
		);
	if (assetId === fromId)
		throw new EditError("An edit cannot start from itself");
	const asset = assetRow(db, assetId);
	const from = assetRow(db, fromId);
	if (asset.removed_at !== null)
		throw new EditError("This asset is removed; restore it first");
	if (from.is_output !== 1)
		throw new EditError("Start only from a finished edit");
	const already = startedFrom(db, assetId);
	if (already !== null)
		throw new EditError(
			`This edit already started from asset ${already}; change its details directly`,
		);
	const evidence = { started_from: fromId };
	const ch: ChangeOptions = {
		...change(opts),
		note: opts.note || `Started from asset ${fromId}`,
		evidence,
	};
	return inTransaction(db, () => {
		const values: Record<string, unknown> = {};
		if (asset.is_output !== 1) values.is_output = true;
		// A finished edit is something made. Its kind changes unless a person
		// chose it: classify can read an editor's own credentials on the export
		// (Premiere writes them) as an AI-generated asset.
		const kindBy = db
			.prepare(
				"SELECT actor_kind FROM history WHERE table_name = 'assets' AND row_key = ? AND field = 'kind' ORDER BY id DESC LIMIT 1",
			)
			.get(String(assetId)) as { actor_kind: string } | undefined;
		if (asset.kind !== "produced" && kindBy?.actor_kind !== "person")
			values.kind = "produced";
		for (const f of STARTED_FROM_FIELDS)
			if (!String(asset[f] ?? "").trim() && String(from[f] ?? "").trim())
				values[f] = from[f];
		const fields = editRow(db, "assets", assetId, values, ch);

		let credits = 0;
		const has = (sql: string) => !!db.prepare(sql).get(assetId);
		if (!has("SELECT 1 FROM credits WHERE asset_id = ?")) {
			const rows = db
				.prepare(
					"SELECT role, name, on_behalf_of, sort_order FROM credits WHERE asset_id = ? ORDER BY sort_order, id",
				)
				.all(fromId) as Array<Record<string, unknown>>;
			for (const r of rows) {
				createRow(
					db,
					"credits",
					{ asset_id: assetId, stated_by: opts.actor.name, ...r },
					ch,
				);
				credits++;
			}
		}

		let statement = false;
		if (!has("SELECT 1 FROM statements WHERE asset_id = ?")) {
			const s = db
				.prepare(
					"SELECT text, author, organization, edited_with FROM statements WHERE asset_id = ? ORDER BY id DESC LIMIT 1",
				)
				.get(fromId) as
				| {
						text: string;
						author: string;
						organization: string;
						edited_with: string;
				  }
				| undefined;
			if (s) {
				saveStatement(
					db,
					assetId,
					{
						text: s.text,
						author: s.author,
						organization: s.organization,
						editedWith: s.edited_with,
					},
					{ now: opts.now },
				);
				statement = true;
			}
		}

		let thumbnail = false;
		const fromThumbnail = thumbnailOf(db, fromId);
		if (
			fromThumbnail !== null &&
			thumbnailOf(db, assetId) === null &&
			assetRow(db, fromThumbnail).removed_at === null
		) {
			createRow(
				db,
				"relationships",
				{
					parent_id: assetId,
					child_id: fromThumbnail,
					type: "thumbnail_of",
					match_method: "manual",
					confidence: 1,
					note: "",
				},
				ch,
			);
			thumbnail = true;
		}

		createRow(
			db,
			"relationships",
			{
				parent_id: fromId,
				child_id: assetId,
				type: RELATION_LINK[as],
				match_method: "manual",
				confidence: 1,
				note: "",
			},
			ch,
		);
		const clipClasses = carryClassesInto(db, assetId, fromId, ch, opts.tool);
		return {
			from: fromId,
			fields,
			credits,
			statement,
			thumbnail,
			clipClasses,
		};
	});
}

/**
 * Say whether this edit is the next revision of the edit it started from, or
 * something made from it (D60): its link changes kind, with history. Existing
 * started_from links read as "next revision" until a person says otherwise.
 * @returns the link's id
 */
export function setEditRelation(
	db: DatabaseSync,
	assetId: number,
	as: unknown,
	opts: PersonEdit,
): number {
	if (typeof as !== "string" || !Object.hasOwn(RELATION_LINK, as))
		throw new EditError(
			'Say "revision" (the next revision) or "made_from" (made from it)',
		);
	assetRow(db, assetId);
	const link = db
		.prepare(
			"SELECT id, type FROM relationships WHERE child_id = ? AND type IN ('started_from', 'made_from') ORDER BY id DESC LIMIT 1",
		)
		.get(assetId) as { id: number; type: string } | undefined;
	if (!link)
		throw new EditError(
			"This edit did not start from another; start it from one first",
		);
	const type = RELATION_LINK[as as EditRelation];
	if (link.type !== type)
		editRow(db, "relationships", link.id, { type }, change(opts));
	return link.id;
}

/**
 * Change the project's settings (name, description, author, ...).
 * @returns the settings that changed
 */
export function editSettings(
	db: DatabaseSync,
	input: Record<string, unknown>,
	opts: PersonEdit,
): string[] {
	const fields = only(input, EDITABLE_META, "The project's settings");
	for (const [k, v] of Object.entries(fields))
		if (typeof v !== "string")
			throw new EditError(`The project setting ${k} takes text`);
	if ("name" in fields && !(fields.name as string).trim())
		throw new EditError("A project needs a name");
	// Signed into every file as where the creator's identity is published: a
	// web address anyone can open, never a script or a local file.
	if ("cawg_identity_url" in fields) {
		const url = (fields.cawg_identity_url as string).trim();
		if (url && !isHttpsAddress(url))
			throw new EditError(
				"The identity link must be a full web address starting https://",
			);
	}
	const current = (key: string) =>
		(
			db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
				{ value: string } | undefined
		)?.value ?? "";
	return inTransaction(db, () =>
		Object.entries(fields)
			// A setting never made reads as empty, so setting it empty is no change.
			.filter(([k, v]) => (v as string).trim() !== current(k))
			.filter(([k, v]) => setMeta(db, k, (v as string).trim(), change(opts)))
			.map(([k]) => k),
	);
}

/** The fields of a publication a person sets here; `withheld` is the export review's (Phase 8 step 5). */
export const PUBLICATION_FIELDS: readonly string[] = ["file_url", "page_url"];

/**
 * Say where a signed copy of a finished edit is published: the web address of
 * the signed file and of the page that shows it. Both are https addresses, or
 * empty to say it is no longer there; history keeps where it was. The first
 * address given makes the publication; it is never deleted.
 * @returns the publication as it now is, or null if there is none and nothing was set
 */
export function setPublication(
	db: DatabaseSync,
	signatureId: number,
	input: Record<string, unknown>,
	opts: PersonEdit,
): Publication | null {
	const fields = only(input, PUBLICATION_FIELDS, "Where a copy is published");
	if (Object.keys(fields).length === 0)
		throw new EditError("Say where the signed file or its page is published");
	const signing = db
		.prepare("SELECT kind FROM signatures WHERE id = ?")
		.get(signatureId) as { kind: string } | undefined;
	if (!signing) throw new NotFoundError("There is no such signing");
	if (signing.kind !== "output")
		throw new EditError(
			"Only a signed copy of a finished edit is published with a public record",
		);
	const values: Record<string, string> = {};
	for (const [k, v] of Object.entries(fields)) {
		if (typeof v !== "string")
			throw new EditError(`${k} takes a web address, or "" for none`);
		const url = v.trim();
		const what = k === "file_url" ? "The signed file's" : "The page's";
		if (url && !isHttpsAddress(url))
			throw new EditError(
				`${what} address must be a full web address starting https://`,
			);
		// As a browser writes it, so the catalog's check and the viewer's agree.
		values[k] = url ? new URL(url).href : "";
	}
	return inTransaction(db, () => {
		const current = publicationOf(db, signatureId);
		if (current) {
			editRow(db, "publications", current.id, values, change(opts));
		} else {
			if (Object.values(values).every((v) => v === "")) return null;
			createRow(
				db,
				"publications",
				{ signature_id: signatureId, ...values },
				change(opts),
			);
		}
		return publicationOf(db, signatureId);
	});
}

/** A whole https:// address with a host, as a browser would open it. */
export function isHttpsAddress(value: string): boolean {
	if (!URL.canParse(value)) return false;
	const url = new URL(value);
	return (
		url.protocol === "https:" &&
		!!url.hostname &&
		!url.username &&
		!url.password
	);
}

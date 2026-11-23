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
import { refreshTimelines, timelinesUsing } from "./timelines.ts";

import { EditError, NotFoundError } from "./errors.ts";

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

/** A whole https:// address with a host, as a browser would open it. */
function isHttpsAddress(value: string): boolean {
	if (!URL.canParse(value)) return false;
	const url = new URL(value);
	return (
		url.protocol === "https:" &&
		!!url.hostname &&
		!url.username &&
		!url.password
	);
}

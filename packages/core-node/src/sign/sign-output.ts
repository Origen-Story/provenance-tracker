// Signing a finished edit from its catalog (D41): its newest timeline and
// saved statement build the manifest (core's build.js), the signing engine
// (the C2PA library by default, D53) signs a new versioned copy beside the
// cut, and the copy and the signing are recorded.

import {
	closeSync,
	existsSync,
	openSync,
	readFileSync,
	readSync,
	rmSync,
	statSync,
} from "node:fs";
import path from "node:path";
import {
	nextSignatureVersion,
	recordSigning,
} from "@provenancetracker/core/catalog/signatures.ts";
import {
	fromCatalogPath,
	toCatalogPath,
} from "@provenancetracker/core/catalog/paths.ts";
import {
	breakdownOf,
	refreshTimeline,
	timelineSegments,
} from "@provenancetracker/core/catalog/timelines.ts";
import { c2paSummaryOf } from "@provenancetracker/core/extraction/c2pa-summary.ts";
import { thumbnailOf } from "@provenancetracker/core/catalog/edits.ts";
import {
	buildCreatorStatement,
	buildOutputManifest,
	ingredientLabel,
	placedAssetRefs,
	sidecarPathFor,
	thumbnailFormatOf,
} from "@provenancetracker/core/manifest/build.js";
import {
	carryWithheld,
	checkWithhold,
	isRevealKind,
	rememberRedactions,
	revealOf,
	sameReveal,
	stillCarried,
	type CarriedItem,
	type Remembered,
	type RememberedRedaction,
	type Reveal,
	type Withhold,
} from "@provenancetracker/core/manifest/reveal.ts";
import {
	fileCarries,
	type FileDetail,
} from "@provenancetracker/core/manifest/file-carries.ts";
import { interpretReport } from "@provenancetracker/core/manifest/verify.js";
import { LIBRARY_ENGINE } from "./engines/library.ts";
import { sha256OfFile } from "../hash.ts";
import type { Machine } from "../machine.ts";
import type { OpenProject } from "../project.ts";
import { listRoots } from "../roots.ts";
import { TOOL } from "../tool.ts";
import { certificateInfoOf } from "./certificates.ts";
import {
	IDENTITY_COVERS,
	IDENTITY_ROLE,
	identityReferences,
} from "@provenancetracker/core/manifest/identity.ts";
import { readSettings, signingEngineOf } from "../settings.ts";
import { keyFilesHolder } from "./holders/key-files.ts";
import { identityPaths, signerPaths } from "./signing-settings.ts";
import { openHolder, type CredentialHolder } from "./holders/index.ts";
import {
	storableDefinition,
	type SignIngredient,
	type SignArgs,
	type SigningEngine,
	type SignResource,
} from "./engine.ts";
import { signingEngineFor } from "./engines/index.ts";

export type { SigningEngine } from "./engine.ts";

/** What signs the file says it was made by: this tracker, under its public name. */
const GENERATOR = { name: "provenance-tracker", version: TOOL.version };

/**
 * The time-stamp authority the app asks when a person wants a trusted time
 * (RFC 3161; docs/network.md). The app's sign route takes only yes or no;
 * the command line names a server itself.
 */
export const TIMESTAMP_URL = "http://timestamp.digicert.com";

/** A refusal before anything is signed: the caller's to fix (HTTP 400). */
export class NotReadyError extends Error {}

/** Refuse, in words, when this project has no signing set up on this machine. */
export function refuseUnlessSetUp(machine: Machine, projectId: string): void {
	try {
		signerPaths(machine, projectId);
	} catch (err) {
		throw new NotReadyError((err as Error).message);
	}
}

/**
 * The creator's identity to add (D55): the holder given, or this machine's
 * identity for the project, or none. Refused with c2patool (decision 5c).
 */
export async function identityFor(
	machine: Machine,
	projectId: string,
	engine: SigningEngine,
	definition: Record<string, unknown>,
	given?: CredentialHolder,
): Promise<SignArgs["identity"]> {
	const files = given ? null : identityPaths(machine, projectId);
	if (!given && !files) return undefined;
	if (engine.name === "c2patool")
		throw new NotReadyError(IDENTITY_NEEDS_LIBRARY);
	let holder = given;
	if (!holder)
		try {
			holder = await keyFilesHolder(files!);
		} catch (err) {
			throw new NotReadyError(`Your identity: ${(err as Error).message}`);
		}
	return {
		holder,
		covers: identityReferences(
			definition as { assertions?: Array<{ label?: string }> },
		),
		roles: [IDENTITY_ROLE],
	};
}

/** Open what holds this project's key for one signing; a holder that can't open is a refusal. */
export async function holderOrRefuse(
	machine: Machine,
	projectId: string,
): Promise<CredentialHolder> {
	try {
		return await openHolder(machine, projectId);
	} catch (err) {
		throw new NotReadyError((err as Error).message);
	}
}

type Row = Record<string, unknown>;

/** Every live place of each content on this machine: sha256 → [{ rootId, path, file }]. */
function placesHere(project: OpenProject, machine: Machine) {
	const folders = new Map(
		listRoots(project, machine)
			.filter((r) => r.status === "ok" && r.folder)
			.map((r) => [r.id, r.folder!]),
	);
	const out = new Map<
		string,
		Array<{ rootId: number; rootFolder: string; path: string; file: string }>
	>();
	for (const l of project.db
		.prepare(
			"SELECT content_sha256 AS sha, root_id, path FROM locations WHERE gone_run_id IS NULL ORDER BY id",
		)
		.all() as Array<{ sha: string; root_id: number; path: string }>) {
		const folder = folders.get(l.root_id);
		if (!folder) continue;
		const file = fromCatalogPath(folder, l.path, machine.platform);
		if (!existsSync(file)) continue;
		const list = out.get(l.sha) ?? [];
		list.push({ rootId: l.root_id, rootFolder: folder, path: l.path, file });
		out.set(l.sha, list);
	}
	return out;
}

/** An asset's own newest file (never a signed copy). */
function ownContent(project: OpenProject, assetId: number): string | null {
	const row = project.db
		.prepare(
			`SELECT c.sha256 FROM contents c WHERE c.asset_id = ?
			   AND NOT EXISTS (SELECT 1 FROM signatures s WHERE s.signed_sha256 = c.sha256)
			 ORDER BY c.created_at DESC, c.rowid DESC LIMIT 1`,
		)
		.get(assetId) as { sha256: string } | undefined;
	return row?.sha256 ?? null;
}

/** The newest c2pa reading of a content, as the statement's "credentials in the file" reads it. */
function c2paOf(project: OpenProject, sha256: string) {
	const row = project.db
		.prepare(
			`SELECT status, data, error, validation FROM observations
			 WHERE content_sha256 = ? AND kind IN ('c2pa', 'c2pa-sidecar')
			   AND status <> 'unavailable' ORDER BY id DESC LIMIT 1`,
		)
		.get(sha256) as Row | undefined;
	if (!row) return null;
	const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : null);
	return c2paSummaryOf({
		status: row.status as "ok",
		data: parse(row.data),
		error: (row.error as string | null) ?? null,
		validation: parse(row.validation),
	});
}

/** A source of a signed film whose own credentials would travel into it (D62). */
export interface SourceReveal {
	assetId: number;
	/** Its file name, as the preview shows it. */
	title: string;
	/** The output's own cut (the parent ingredient), or a placed source. */
	parent: boolean;
	reveal: Reveal;
}

/**
 * A source of a signed film: the cut itself (the parent ingredient), then
 * each asset the timeline places, in the statement's order.
 */
interface Source {
	assetId: number;
	parent: boolean;
	/** Its own newest content, as the catalog knows it. */
	sha: string;
	/** A live file of that content on this machine; null when there is none. */
	file: string | null;
	title: string;
	/**
	 * The .c2pa sidecar beside it that the catalog knows, with the hash the
	 * catalog has for it. A .c2pa the catalog has not scanned is not one. Never
	 * for the cut, whose credentials are its own.
	 */
	sidecar: { file: string; sha: string } | null;
}

function sourcesOf(
	project: OpenProject,
	machine: Machine,
	places: ReturnType<typeof placesHere>,
	outputId: number,
	cut: string | null,
	placedIds: number[],
): Source[] {
	const out: Source[] = [];
	const add = (assetId: number, sha: string | null, parent: boolean) => {
		if (!sha) return;
		const place = places.get(sha)?.[0];
		const known = place?.path ?? lastKnownPath(project, sha);
		let sidecar: Source["sidecar"] = null;
		const beside = place ? (sidecarPathFor(place.file) as string) : null;
		if (place && beside && beside !== place.file && !parent) {
			const rel = toCatalogPath(place.rootFolder, beside, machine.platform);
			const row =
				rel && existsSync(beside)
					? (project.db
							.prepare(
								"SELECT content_sha256 AS sha FROM locations WHERE root_id = ? AND path = ? AND gone_run_id IS NULL ORDER BY id DESC LIMIT 1",
							)
							.get(place.rootId, rel) as { sha: string } | undefined)
					: undefined;
			if (row) sidecar = { file: beside, sha: row.sha };
		}
		out.push({
			assetId,
			parent,
			sha,
			file: place?.file ?? null,
			title: known ? known.split("/").pop()! : `asset ${assetId}`,
			sidecar,
		});
	};
	add(outputId, cut, true);
	for (const id of placedIds) add(id, ownContent(project, id), false);
	return out;
}

/** One reading of a source's credentials, stored by `extract` or made now. */
type Reading = { status: string; data: unknown; error: string | null };

/** The newest stored reading of one kind, by a reader that could run. */
function storedReading(
	project: OpenProject,
	sha256: string,
	kind: "c2pa" | "c2pa-sidecar",
	sidecarSha?: string,
): Reading | null {
	const row = project.db
		.prepare(
			`SELECT status, data, error FROM observations
			 WHERE content_sha256 = ? AND kind = ? AND status <> 'unavailable'
			   AND (? IS NULL OR source_sha256 = ?)
			 ORDER BY id DESC LIMIT 1`,
		)
		.get(sha256, kind, sidecarSha ?? null, sidecarSha ?? null) as
		{ status: string; data: string | null; error: string | null } | undefined;
	return row
		? {
				status: row.status,
				data: row.data ? JSON.parse(row.data) : null,
				error: row.error,
			}
		: null;
}

/**
 * Which reading says what a source carries, as the engines embed it: the
 * credentials in the file itself, else those in its sidecar. A reading that
 * failed counts when neither was read: something is there, and unseen.
 */
function chosenReading(own: Reading, side: Reading | null): Reading {
	if (own.status === "ok") return own;
	if (side?.status === "ok") return side;
	return [own, side].find((r) => r?.status === "unreadable") ?? own;
}

/** What a reading would bring into a signed film. */
function revealOfReading(r: Reading): Reveal {
	if (r.status === "ok") return revealOf(r.data as never);
	const none = revealOf(null);
	return r.status === "unreadable"
		? { ...none, unreadable: r.error ?? "the reader failed" }
		: none;
}

/**
 * What the review shows for a source: from the readings `extract` stored.
 * Null when it has not been read (or not its sidecar), so the review cannot
 * say what it carries.
 */
function shownReveal(project: OpenProject, s: Source): Reveal | null {
	const own = storedReading(project, s.sha, "c2pa");
	const side = s.sidecar
		? storedReading(project, s.sha, "c2pa-sidecar", s.sidecar.sha)
		: null;
	if (!own || (s.sidecar && !side)) return null;
	return revealOfReading(chosenReading(own, side));
}

/** Whether a source has credentials of its own that would travel, read or not. */
const carries = (s: SourceReveal) =>
	s.reveal.manifests > 0 || !!s.reveal.unreadable;

/**
 * Every source with what the review shows for it (nothing, for one not read
 * yet), and the ones not read yet. The review lists those that carry
 * credentials.
 */
function revealsOf(
	project: OpenProject,
	sources: Source[],
): { all: SourceReveal[]; unread: string[] } {
	const all: SourceReveal[] = [];
	const unread: string[] = [];
	for (const s of sources) {
		const reveal = shownReveal(project, s);
		if (!reveal) unread.push(s.title);
		all.push({
			assetId: s.assetId,
			title: s.title,
			parent: s.parent,
			reveal: reveal ?? revealOf(null),
		});
	}
	return { all, unread };
}

const notRead = (titles: string[]) =>
	`Not read for Content Credentials yet, so the review cannot show what ${titles.length === 1 ? "it carries" : "they carry"}: ${titles.join(", ")}. Read the project's files (the Media page, or npm run cli -- extract), then sign.`;

/**
 * What the newest signing of an output kept out of its file (D62, D63), to
 * start the next one from: each redaction with the source, assertion and kind
 * it was, and the sources left out. A record from before D63 has addresses
 * only.
 */
export function lastWithheld(
	project: OpenProject,
	outputId: number,
): Remembered | null {
	const row = project.db
		.prepare(
			"SELECT definition FROM signatures WHERE asset_id = ? AND kind = 'output' ORDER BY version DESC LIMIT 1",
		)
		.get(outputId) as { definition: string } | undefined;
	if (!row) return null;
	const d = JSON.parse(row.definition) as {
		redactions?: unknown;
		redactions_by_source?: unknown;
		credentials_left_out?: unknown;
	};
	// A catalog may come from someone else: take only what has the right shape.
	const list = (v: unknown) => (Array.isArray(v) ? v : []);
	const uris = list(d.redactions).filter((u) => typeof u === "string");
	const known = new Map<string, RememberedRedaction>();
	for (const r of list(d.redactions_by_source) as Array<Record<
		string,
		unknown
	> | null>)
		if (r && typeof r.uri === "string")
			known.set(r.uri, {
				assetId: Number.isSafeInteger(r.asset_id)
					? (r.asset_id as number)
					: null,
				title: typeof r.title === "string" ? r.title : "",
				label: typeof r.label === "string" ? r.label : "",
				kind: isRevealKind(r.kind) ? r.kind : null,
				uri: r.uri,
			});
	// Every choice is remembered by source (D63), also one made inside a source
	// whose credentials were then left out, which `redactions` (what was
	// removed from the file) does not hold. An older record has addresses only.
	return {
		redact: known.size
			? [...known.values()]
			: uris.map((uri) => rememberRedactions([uri], [])[0]),
		leaveOut: (
			list(d.credentials_left_out) as Array<{ asset_id?: unknown } | null>
		)
			.map((c) => c?.asset_id)
			.filter((id): id is number => Number.isSafeInteger(id)),
	};
}

/** The last signing's choices as they apply to the sources now: for the page, and for a signing that states none. */
export interface WithheldBefore {
	/** Where the next signing starts. */
	redact: string[];
	leaveOut: number[];
	/** Each redaction the last signing made, in words, with its address or addresses now (none when the sources no longer carry it). */
	redactions: CarriedItem[];
	/** The sources the last signing left out. */
	leftOut: number[];
	/** What was found again at a new address, and what was dropped, in sentences. */
	notes: string[];
}

function withheldBefore(
	last: Remembered | null,
	sources: SourceReveal[],
): WithheldBefore | null {
	if (!last) return null;
	const carried = carryWithheld(last, sources);
	return {
		...carried.withhold,
		redactions: carried.redactions,
		leftOut: last.leaveOut,
		notes: carried.notes,
	};
}

/** The CAWG identity address the project's statements carry, or "". */
function identityUrlOf(project: OpenProject): string {
	return (
		(
			project.db
				.prepare("SELECT value FROM meta WHERE key = 'cawg_identity_url'")
				.get() as { value: string } | undefined
		)?.value ?? ""
	);
}

/** The newest place the catalog knows for a content, here or not: its catalog path. */
function lastKnownPath(project: OpenProject, sha256: string): string | null {
	const row = project.db
		.prepare(
			"SELECT path FROM locations WHERE content_sha256 = ? ORDER BY gone_run_id IS NULL DESC, id DESC LIMIT 1",
		)
		.get(sha256) as { path: string } | undefined;
	return row?.path ?? null;
}

/**
 * Every asset the timeline places (enabled clips, the output itself left
 * out), as the manifest builder takes them, and the ones whose file is not on
 * this machine. A missing one still has an entry, named from where the
 * catalog last saw it, so a preview can show it; signing refuses.
 */
function placedAssets(
	project: OpenProject,
	places: ReturnType<typeof placesHere>,
	segments: Array<{ enabled: boolean; matchedAssetRef: string | null }>,
	outputRef: string,
): { assets: Map<string, Row>; missing: string[] } {
	const assets = new Map<string, Row>();
	const missing: string[] = [];
	for (const ref of new Set(
		segments
			.filter(
				(s) =>
					s.enabled && s.matchedAssetRef && s.matchedAssetRef !== outputRef,
			)
			.map((s) => s.matchedAssetRef!),
	)) {
		const a = project.db
			.prepare("SELECT * FROM assets WHERE id = ?")
			.get(Number(ref)) as Row;
		const sha = ownContent(project, Number(ref));
		const place = sha ? places.get(sha)?.[0] : undefined;
		if (!place) missing.push(a.title ? String(a.title) : `asset ${ref}`);
		assets.set(ref, {
			filePath: place?.file ?? (sha ? lastKnownPath(project, sha) : null),
			publicTitle: a.public_title,
			originClass: a.origin_class,
			originClassConfirmed: a.origin_class_confirmed === 1,
			originClassSource: a.origin_class_source,
			originClassNote: a.origin_class_note,
			aiAssisted: a.ai_assisted === 1,
			signedBy: a.signed_by,
			signerName: a.signer_name,
			c2paSummary: sha ? c2paOf(project, sha) : null,
		});
	}
	return { assets, missing };
}

/** A file's first bytes, for telling its format. */
function headOf(file: string, n = 16): Buffer {
	const fd = openSync(file, "r");
	try {
		const b = Buffer.alloc(n);
		return b.subarray(0, readSync(fd, b, 0, n, 0));
	} finally {
		closeSync(fd);
	}
}

/**
 * The image the edit is shown by (its claim thumbnail; D52) as signing takes
 * it: its file on this machine, its catalog hash and its format from its
 * bytes. Null with none picked; a problem when it cannot be used here.
 */
function thumbnailHere(
	project: OpenProject,
	places: ReturnType<typeof placesHere>,
	outputId: number,
): {
	thumbnail: {
		assetId: number;
		sha256: string;
		format: string;
		filePath: string;
	} | null;
	problem: string | null;
} {
	const imageId = thumbnailOf(project.db, outputId);
	if (imageId === null) return { thumbnail: null, problem: null };
	const sha = ownContent(project, imageId);
	const place = sha ? places.get(sha)?.[0] : undefined;
	if (!sha || !place)
		return {
			thumbnail: null,
			problem:
				"The thumbnail image is not on this machine. Scan its root, or pick another.",
		};
	const format = thumbnailFormatOf(headOf(place.file)) as string | null;
	if (!format)
		return {
			thumbnail: null,
			problem: "The thumbnail is not a JPEG or PNG image. Pick another.",
		};
	return {
		thumbnail: { assetId: imageId, sha256: sha, format, filePath: place.file },
		problem: null,
	};
}

/** What a preview of an output's statement found: the statement as it would be signed, and what stops signing now. */
export interface StatementPreview {
	/** The creator statement as signing would build it now; null with no timeline. */
	statement: Record<string, unknown> | null;
	/** Why it cannot be signed on this machine yet, in words; empty when nothing stops it but the signing set-up. */
	blockers: string[];
	/** The asset each ingredient is, in the statement's order. */
	ingredientAssetIds: number[];
	/** The image that will be the claim thumbnail, when one is picked and usable here. */
	thumbnailAssetId: number | null;
	/** The creator's identity signing would add (D55), when one is set up here. Never a path. */
	identity: IdentityPreview | null;
	/** What each source's own credentials would reveal inside the signed film (D62). */
	reveals: SourceReveal[];
	/**
	 * What the newest signing of this edit kept out, as it applies to the
	 * sources now, so the next starts from it; null before the first.
	 */
	lastWithheld: WithheldBefore | null;
	/**
	 * Who signed each source that names a signer, as the statement would say
	 * it. The statement above leaves out those of the sources the last signing
	 * left out; this lists them all, so the page can show what a choice changes.
	 */
	sourceSigners: Array<{ assetId: number; title: string; signer: string }>;
	/** What the cut and the thumbnail carry in their own metadata, outside any credentials (D64). */
	filesCarry: FileCarries[];
}

/** What one file that goes into the signed film says in its own metadata. */
export interface FileCarries {
	assetId: number;
	title: string;
	/** The cut, whose bytes the signed copy is; or the image embedded as its thumbnail. */
	role: "cut" | "thumbnail";
	/** False when ExifTool has not read it yet: nothing can be shown. */
	read: boolean;
	details: FileDetail[];
	/** How many more there are than the review lists. */
	more: number;
}

/** What a content says in its own metadata, from its stored ExifTool reading. */
function carriedBy(
	project: OpenProject,
	assetId: number,
	sha256: string,
	role: FileCarries["role"],
): FileCarries {
	const row = project.db
		.prepare(
			`SELECT status, data FROM observations
			 WHERE content_sha256 = ? AND kind = 'exif' AND status <> 'unavailable'
			 ORDER BY id DESC LIMIT 1`,
		)
		.get(sha256) as { status: string; data: string | null } | undefined;
	const known = lastKnownPath(project, sha256);
	return {
		assetId,
		title: known ? known.split("/").pop()! : `asset ${assetId}`,
		role,
		read: !!row,
		...fileCarries(
			row?.status === "ok" && row.data ? JSON.parse(row.data) : {},
		),
	};
}

export interface IdentityPreview {
	/** The identity certificate's name and issuer, as a verifier will show them. */
	name: string;
	issuer: string;
	validTo: string;
	/** What it vouches for, and as what. */
	covers: string[];
	role: string;
	/** The statement's author is not the name on the certificate (a warning, not a blocker; decision 5c). */
	authorDiffers: boolean;
}

/** Signing with an identity needs the C2PA library (decision 5c). */
const IDENTITY_NEEDS_LIBRARY =
	"Your identity is set up for this project, and c2patool cannot add it. Sign with the C2PA library: npm run cli -- settings signing-engine library";

/** The same name, ignoring case and spacing. */
export const sameName = (a: string, b: string) =>
	a.trim().replace(/\s+/g, " ").toLowerCase() ===
	b.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The identity this project signs with here, for the preview, or why it
 * cannot be used; null when none is set up. Reads only the certificate.
 */
function identityHere(
	machine: Machine,
	projectId: string,
	author: string,
): { preview: IdentityPreview | null; problem: string | null } {
	const files = identityPaths(machine, projectId);
	if (!files) return { preview: null, problem: null };
	let info;
	try {
		info = certificateInfoOf(readFileSync(files.certificatePath, "utf8"));
	} catch {
		return {
			preview: null,
			problem:
				"Your identity certificate cannot be read. Check this project's identity settings.",
		};
	}
	const preview: IdentityPreview = {
		name: info.commonName,
		issuer: info.issuer,
		validTo: info.validTo,
		covers: [...IDENTITY_COVERS],
		role: IDENTITY_ROLE,
		authorDiffers: !!author.trim() && !sameName(author, info.commonName),
	};
	if (!existsSync(files.privateKeyPath))
		return { preview, problem: "Your identity's private key is not there." };
	if (Date.parse(info.validTo) < Date.now())
		return {
			preview,
			problem: `Your identity certificate expired on ${info.validTo.slice(0, 10)}.`,
		};
	if (signingEngineOf(readSettings(machine.settingsPath)) === "c2patool")
		return { preview, problem: IDENTITY_NEEDS_LIBRARY };
	return { preview, problem: null };
}

/**
 * The creator statement an output would be signed with now, built by the
 * same builder signing uses, without signing or writing anything: so the
 * page shows exactly what goes into the file. The statement's words are the
 * newest saved ones; the signing set-up is the caller's to report.
 */
export function previewOutputStatement(
	project: OpenProject,
	machine: Machine,
	opts: { assetId: number; now?: () => string },
): StatementPreview {
	const { db } = project;
	const now = opts.now ?? (() => new Date().toISOString());
	const asset = db
		.prepare("SELECT * FROM assets WHERE id = ?")
		.get(opts.assetId) as Row | undefined;
	if (!asset) throw new NotReadyError("There is no such asset");
	if (asset.is_output !== 1)
		throw new NotReadyError(
			"A creator statement is for a finished edit (an output)",
		);
	const blockers: string[] = [];
	const cut = ownContent(project, opts.assetId);
	const places = placesHere(project, machine);
	const cutPlace = cut ? places.get(cut)?.[0] : undefined;
	if (!cut || !cutPlace)
		blockers.push(
			"The output's file is not on this machine. Scan its root, or locate it.",
		);
	const timeline = cut
		? (db
				.prepare(
					"SELECT id, sequence_name, fps, duration_frames FROM timelines WHERE content_sha256 = ? ORDER BY id DESC LIMIT 1",
				)
				.get(cut) as Row | undefined)
		: undefined;
	if (!timeline) {
		blockers.push("Import the timeline first: the statement is built from it.");
		return {
			statement: null,
			blockers,
			ingredientAssetIds: [],
			thumbnailAssetId: null,
			identity: null,
			reveals: [],
			lastWithheld: withheldBefore(lastWithheld(project, opts.assetId), []),
			sourceSigners: [],
			filesCarry: [],
		};
	}
	const saved = db
		.prepare(
			"SELECT text, author, organization, edited_with FROM statements WHERE asset_id = ? ORDER BY id DESC LIMIT 1",
		)
		.get(opts.assetId) as Row | undefined;
	if (!saved || !String(saved.text ?? "").trim())
		blockers.push("Write and save the creator statement before signing.");
	const naming = {
		refOf: (id: number) => String(id),
		segmentIdOf: (id: number) => id,
	};
	const breakdown = breakdownOf(db, timeline.id as number, naming) as {
		composition?: unknown;
	};
	const segments = timelineSegments(db, timeline.id as number, naming);
	const outputRef = String(opts.assetId);
	const { assets, missing } = placedAssets(
		project,
		places,
		segments,
		outputRef,
	);
	if (missing.length)
		blockers.push(
			`These files the timeline places are not on this machine, and signing reads each one: ${missing.join(", ")}`,
		);
	const thumb = thumbnailHere(project, places, opts.assetId);
	if (thumb.problem) blockers.push(thumb.problem);
	const identity = identityHere(
		machine,
		project.projectId,
		String(saved?.author ?? ""),
	);
	if (identity.problem) blockers.push(identity.problem);
	const ingredientAssetIds = (
		placedAssetRefs(segments, outputRef) as string[]
	).map(Number);
	const { all, unread } = revealsOf(
		project,
		sourcesOf(project, machine, places, opts.assetId, cut, ingredientAssetIds),
	);
	if (unread.length) blockers.push(notRead(unread));
	const before = withheldBefore(lastWithheld(project, opts.assetId), all);
	const statement = buildCreatorStatement({
		output: {
			ref: outputRef,
			filePath: cutPlace?.file ?? (cut ? lastKnownPath(project, cut) : null),
			originClass: asset.origin_class,
			originClassConfirmed: asset.origin_class_confirmed === 1,
			publicTitle: asset.public_title,
		},
		timeline: {
			sequenceName: timeline.sequence_name,
			fps: timeline.fps,
			durationFrames: timeline.duration_frames,
		},
		composition: breakdown.composition as object,
		segments,
		assets,
		statement: {
			text: saved?.text ?? "",
			authorName: saved?.author ?? "",
			organization: saved?.organization ?? "",
			softwareAgent: saved?.edited_with ?? "",
			identityUrl: identityUrlOf(project),
		},
		statedAt: now(),
		// As a signing that states no choice would write it.
		credentialsLeftOut: (before?.leaveOut ?? []).map(String),
	}) as Record<string, unknown>;
	const sourceSigners = ingredientAssetIds.flatMap((id) => {
		const a = assets.get(String(id));
		const signer = String(a?.signerName || a?.signedBy || "");
		const file = String(a?.filePath ?? "");
		return signer
			? [{ assetId: id, title: file.split(/[\\/]/).pop() ?? "", signer }]
			: [];
	});
	const filesCarry: FileCarries[] = [];
	if (cut) filesCarry.push(carriedBy(project, opts.assetId, cut, "cut"));
	if (thumb.thumbnail)
		filesCarry.push(
			carriedBy(
				project,
				thumb.thumbnail.assetId,
				thumb.thumbnail.sha256,
				"thumbnail",
			),
		);
	return {
		statement,
		blockers,
		ingredientAssetIds,
		thumbnailAssetId: thumb.thumbnail?.assetId ?? null,
		identity: identity.preview,
		reveals: all.filter(carries),
		lastWithheld: before,
		sourceSigners,
		filesCarry,
	};
}

/** The signed copy's name: the cut's, with ".signed.v<N>" before the extension; the first free N from `version`. */
function signedName(
	cutFile: string,
	version: number,
): { file: string; version: number } {
	const ext = path.extname(cutFile);
	const stem = cutFile.slice(0, cutFile.length - ext.length);
	for (let v = version; v < version + 1000; v++) {
		const file = `${stem}.signed.v${v}${ext}`;
		if (!existsSync(file)) return { file, version: v };
	}
	throw new Error("No free name for the signed copy");
}

export interface SignedOutput {
	/** What was kept out of the signed file (D62): how many assertions redacted, how many sources' credentials left out. */
	withheld: { redacted: number; leftOut: number };
	/**
	 * What the person should be told about it, in sentences: a choice of the
	 * last signing found again at a new address, or dropped because the
	 * sources no longer carry it. Empty when there is nothing to say.
	 */
	notes: string[];
	signatureId: number;
	runId: number;
	version: number;
	/** Where the signed copy is: its root and path. */
	root: string;
	path: string;
	status: string;
}

/**
 * Sign an output. Refuses (NotReadyError) when there is no signing set up
 * here, no saved statement, no timeline, or a file it needs is not on this
 * machine; nothing is written then.
 */
export async function signOutput(
	project: OpenProject,
	machine: Machine,
	opts: {
		assetId: number;
		engine?: SigningEngine;
		/** What holds the key; this machine's setup for the project when not given. */
		holder?: CredentialHolder;
		/** What holds the creator's identity key; this machine's setup for the project, if any, when not given. */
		identityHolder?: CredentialHolder;
		timestampUrl?: string;
		/** What to keep out of the signed file (D62): checked against what the sources carry. */
		withhold?: Withhold;
		now?: () => string;
	},
): Promise<SignedOutput> {
	const { db } = project;
	const now = opts.now ?? (() => new Date().toISOString());
	const asset = db
		.prepare("SELECT * FROM assets WHERE id = ?")
		.get(opts.assetId) as Row | undefined;
	if (!asset) throw new NotReadyError("There is no such asset");
	// Whether signing is set up here at all is said before anything else.
	if (!opts.holder) refuseUnlessSetUp(machine, project.projectId);

	const cut = ownContent(project, opts.assetId);
	const places = placesHere(project, machine);
	const cutPlace = cut ? places.get(cut)?.[0] : undefined;
	if (!cut || !cutPlace)
		throw new NotReadyError(
			"The output's file is not on this machine. Scan its root, or locate it.",
		);
	const timeline = db
		.prepare(
			"SELECT id, sequence_name, fps, duration_frames FROM timelines WHERE content_sha256 = ? ORDER BY id DESC LIMIT 1",
		)
		.get(cut) as Row | undefined;
	if (!timeline)
		throw new NotReadyError(
			"Import the timeline first: the statement is built from it.",
		);
	const statement = db
		.prepare(
			"SELECT id, text, author, organization, edited_with FROM statements WHERE asset_id = ? ORDER BY id DESC LIMIT 1",
		)
		.get(opts.assetId) as Row | undefined;
	if (!statement || !String(statement.text ?? "").trim())
		throw new NotReadyError(
			"Write and save the creator statement before signing.",
		);

	const breakdown = refreshTimeline(db, timeline.id as number) as {
		composition?: unknown;
	};
	const segments = timelineSegments(db, timeline.id as number, {
		refOf: (id) => String(id),
		segmentIdOf: (id) => id,
	});
	const outputRef = String(opts.assetId);
	const { assets, missing } = placedAssets(
		project,
		places,
		segments,
		outputRef,
	);
	if (missing.length)
		throw new NotReadyError(
			`These files the timeline places are not on this machine, and signing reads each one: ${missing.join(", ")}`,
		);

	const thumb = thumbnailHere(project, places, opts.assetId);
	if (thumb.problem) throw new NotReadyError(thumb.problem);

	// Every file signing reads must be the bytes the catalog knows: the cut,
	// each source the timeline places, and a sidecar used for one. A file
	// changed or swapped since its scan would otherwise be signed in under
	// the class and the review of the one the catalog has.
	const placedIds = (placedAssetRefs(segments, outputRef) as string[]).map(
		Number,
	);
	const sources = sourcesOf(
		project,
		machine,
		places,
		opts.assetId,
		cut,
		placedIds,
	);
	for (const s of sources) {
		if ((await sha256OfFile(s.file!)) !== s.sha)
			throw new NotReadyError(
				s.parent
					? "The output's file has changed since it was scanned. Scan its root, then sign."
					: `${s.title} has changed since it was scanned. Scan its root, then sign.`,
			);
		if (s.sidecar && (await sha256OfFile(s.sidecar.file)) !== s.sidecar.sha)
			throw new NotReadyError(
				`${path.basename(s.sidecar.file)} has changed since it was scanned. Scan its root, then sign.`,
			);
	}
	// So is the thumbnail: the definition names it by the catalog's hash.
	if (
		thumb.thumbnail &&
		(await sha256OfFile(thumb.thumbnail.filePath)) !== thumb.thumbnail.sha256
	)
		throw new NotReadyError(
			"The thumbnail image has changed since it was scanned. Scan its root, then sign.",
		);
	const { file: outputPath, version } = signedName(
		cutPlace.file,
		nextSignatureVersion(db, opts.assetId, "output"),
	);
	const engine = opts.engine ?? (await signingEngineFor(machine));
	// What each source carries is read now, with the reader the engine embeds
	// by, and must be what the review showed: a source never read, or read
	// before it or the reader changed, would bring in what nobody was shown.
	const read: SourceReveal[] = [];
	const unseen: string[] = [];
	for (const s of sources) {
		const own = await engine.read(s.file!);
		const side = s.sidecar ? await engine.read(s.file!, s.sidecar.file) : null;
		const cannot = [own, side].find((r) => r?.status === "unavailable");
		if (cannot)
			throw new NotReadyError(
				`Signing a finished edit first reads what each source carries, and nothing here can read it: ${cannot.error}`,
			);
		const reveal = revealOfReading(chosenReading(own, side));
		if (!sameReveal(reveal, shownReveal(project, s) ?? revealOf(null)))
			unseen.push(s.title);
		read.push({
			assetId: s.assetId,
			title: s.title,
			parent: s.parent,
			reveal,
		});
	}
	if (unseen.length)
		throw new NotReadyError(
			`What ${unseen.join(", ")} ${unseen.length === 1 ? "carries" : "carry"} in Content Credentials is not what the review showed: ${unseen.length === 1 ? "it was" : "they were"} last read before something changed, or never. Read the project's files again (the Media page, or npm run cli -- extract), look at the review, then sign.`,
		);
	// What to keep out (D62), checked against what these sources really carry.
	// Not said: as the last signing of this edit, carried to the sources as
	// they are now (D63), so a new signing never quietly reveals what the last
	// one kept out; what was found again or dropped is told. Said: exactly
	// that, and anything unknown is refused.
	const notes: string[] = [];
	let withhold: Withhold;
	if (opts.withhold === undefined) {
		const carried = carryWithheld(
			lastWithheld(project, opts.assetId) ?? { redact: [], leaveOut: [] },
			read,
		);
		withhold = carried.withhold;
		notes.push(...carried.notes);
	} else
		withhold = {
			redact: [...new Set(opts.withhold.redact)],
			leaveOut: [...new Set(opts.withhold.leaveOut)],
		};
	const problems = checkWithhold(withhold, read);
	if (problems.length) throw new NotReadyError(`${problems.join(". ")}.`);
	// A redaction inside a source whose credentials are left out has nothing
	// to remove: the manifest it names is not in the file at all.
	const kept = read.filter((s) => !withhold.leaveOut.includes(s.assetId));
	const redact = withhold.redact.filter((uri) =>
		kept.some((s) => s.reveal.items.some((i) => i.uri === uri)),
	);
	const withholding = withhold.redact.length + withhold.leaveOut.length > 0;
	if (withholding && engine.name !== LIBRARY_ENGINE)
		throw new NotReadyError(
			"Keeping details out of the signed file needs the C2PA library; this machine signs with c2patool. Switch with: npm run cli -- settings signing-engine library",
		);
	// The manifest is built once the choice is known: a source whose
	// credentials are left out is not named by its signer in the statement
	// either (D64).
	const identityUrl = identityUrlOf(project);
	const {
		definition,
		ingredients,
		resources,
		statement: signedStatement,
	} = buildOutputManifest({
		output: {
			ref: outputRef,
			filePath: cutPlace.file,
			originClass: asset.origin_class,
			originClassConfirmed: asset.origin_class_confirmed === 1,
			publicTitle: asset.public_title,
		},
		timeline: {
			sequenceName: timeline.sequence_name,
			fps: timeline.fps,
			durationFrames: timeline.duration_frames,
		},
		composition: breakdown.composition,
		segments,
		assets,
		statement: {
			text: statement.text,
			authorName: statement.author,
			organization: statement.organization,
			softwareAgent: statement.edited_with,
			identityUrl,
		},
		statedAt: now(),
		generator: GENERATOR,
		thumbnail: thumb.thumbnail,
		credentialsLeftOut: withhold.leaveOut.map(String),
	});
	// The label each source has in the definition: the cut is the parent.
	const labelOf = (assetId: number) =>
		assetId === opts.assetId
			? (ingredients as SignIngredient[])[0].label
			: ingredientLabel(placedIds.indexOf(assetId));
	// The keys are opened for this signing only, and let go with the holders.
	const identity = await identityFor(
		machine,
		project.projectId,
		engine,
		definition as Record<string, unknown>,
		opts.identityHolder,
	);
	const holder =
		opts.holder ?? (await holderOrRefuse(machine, project.projectId));
	const { report } = await engine.sign({
		inputPath: cutPlace.file,
		outputPath,
		definition: definition as Record<string, unknown>,
		// Each with the sidecar the catalog knows for it, and no other. The
		// cut is first; the rest are the placed assets, in their order.
		ingredients: (ingredients as SignIngredient[]).map((ing, i) => {
			const sidecar = ing.useInput
				? null
				: sources.find((s) => !s.parent && s.assetId === placedIds[i - 1])
						?.sidecar;
			return sidecar ? { ...ing, sidecarPath: sidecar.file } : ing;
		}),
		resources: resources as SignResource[],
		holder,
		identity,
		timestampUrl: opts.timestampUrl,
		...(withholding
			? {
					withhold: {
						redact,
						leaveOut: withhold.leaveOut.map(labelOf),
					},
				}
			: {}),
	});
	// The signed copy is kept only if its read-back is sound and nothing that
	// was to be kept out is still in it (D64): each redacted assertion gone
	// from its manifest, and no manifest left of a source that was left out.
	const staying = new Set(kept.flatMap((s) => s.reveal.manifestLabels));
	const failed = [
		...(withholding
			? stillCarried(report as never, {
					redact,
					manifests: read
						.filter((s) => withhold.leaveOut.includes(s.assetId))
						.flatMap((s) => s.reveal.manifestLabels)
						.filter((label) => !staying.has(label)),
				})
			: []),
	];
	const readBack = interpretReport(report) as {
		status: string;
		label: string;
		failures: Array<{ code: string }>;
	};
	if (!["valid", "unrecognised_issuer"].includes(readBack.status)) {
		const codes = readBack.failures.map((f) => f.code).join(", ");
		failed.push(
			`its credentials read back as "${readBack.label}"${codes ? ` (${codes})` : ""}, not as a sound signature`,
		);
	}
	if (failed.length) {
		// A file this signing wrote, at a name that did not exist before it.
		rmSync(outputPath, { force: true });
		throw new Error(
			`Signing failed: ${[...new Set(failed)].join("; ")}. The signed copy was not kept.`,
		);
	}
	const rel = toCatalogPath(cutPlace.rootFolder, outputPath, machine.platform);
	if (!rel) throw new Error(`${outputPath} is not inside its root`);
	const stats = statSync(outputPath);
	const { signatureId, runId } = recordSigning(
		db,
		{
			assetId: opts.assetId,
			kind: "output",
			version,
			sourceSha256: cut,
			signed: {
				sha256: await sha256OfFile(outputPath),
				size: stats.size,
				rootId: cutPlace.rootId,
				path: rel,
				modifiedMs: Math.floor(stats.mtimeMs),
			},
			engine: engine.name,
			engineVersion: engine.version,
			certificateSha256: certificateInfoOf(holder.chain).fingerprint,
			// What was kept out is part of the record of this signing (D62).
			definition: {
				...storableDefinition(definition as Record<string, unknown>),
				...(withholding
					? {
							// What was removed from the file; and every choice, by
							// source, assertion and kind as well: an address does not
							// survive a re-render (D63).
							redactions: redact,
							redactions_by_source: rememberRedactions(
								withhold.redact,
								read,
							).map((r) => ({
								asset_id: r.assetId,
								title: r.title,
								label: r.label,
								kind: r.kind,
								uri: r.uri,
							})),
							credentials_left_out: withhold.leaveOut.map((id) => ({
								asset_id: id,
								label: labelOf(id),
							})),
						}
					: {}),
			},
			statementId: statement.id as number,
			statement: signedStatement,
			report,
			signedAt: now(),
		},
		{ tool: TOOL, now },
	);
	const root = listRoots(project, machine).find(
		(r) => r.id === cutPlace.rootId,
	)!.name;
	const { status } = db
		.prepare("SELECT status FROM signatures WHERE id = ?")
		.get(signatureId) as { status: string };
	return {
		signatureId,
		runId,
		version,
		root,
		path: rel,
		status,
		withheld: {
			redacted: redact.length,
			leftOut: withhold.leaveOut.length,
		},
		notes,
	};
}

// Pure: the public export (phase 4d). One JSON file, made from one signed
// output, that a public page renders: the film's composition strip, the
// creator statement, the ingredients and how the signature read back.
//
// It is built only from the signature record (the statement as signed, the
// c2patool read-back, the signed file's hash), never from the live timeline,
// so the page shows exactly what is in the signed file even if work on the
// project carries on. No paths, no database ids: file names only, and the
// ingredient refs (ing-1, ing-2...) that the manifest itself uses.
//
// Schema: spec/public-export.v3.schema.json (format 3, D72: format 2 with
// the signing certificate's fingerprint); format 2's (D57) and format 1's
// are beside it. Bump EXPORT_FORMAT_VERSION on any change a viewer would
// have to handle differently. Format 1 is still built by
// buildPublicExportV1, for the Postgres migration's check that its exports
// come out byte for byte as they were (D34).

import { interpretReport, readTimeStamp } from "./verify.js";
import { readIdentity } from "./identity.ts";
import { fileNameOf } from "./build.js";
import {
	POSITIONS,
	knownSourceTypeUri,
	originClassDef,
	sourceTypeUri,
	spectrumPosition,
} from "../origin-vocabulary.js";

export const EXPORT_FORMAT = "provenance-tracker.public-export";
export const EXPORT_FORMAT_VERSION = 3;
const MIN_STATEMENT_VERSION = 2;

function parse(json, what) {
	if (json && typeof json === "object") return json;
	try {
		return json ? JSON.parse(json) : null;
	} catch {
		throw new Error(`The signature's ${what} is not readable JSON`);
	}
}

const lanes = (composition, fn) => ({
	picture: fn(composition?.picture),
	audio: fn(composition?.audio),
});

// Pair each ingredient of the statement with its entry in the read-back.
// c2patool does not keep the labels we sign with (ing-1, ing-2...): it names
// each ingredient by its assertion (c2pa.ingredient.v3, ...__1, ...__2) in
// the order they were given, parent first. So: our label if the reader kept
// it, else the same position among the placed ingredients when the file name
// agrees, else the one placed ingredient with that file name. No match is
// reported as unknown rather than guessed.
export function matchReadBack(statementIngredients, readBackIngredients) {
	const byLabel = new Map(readBackIngredients.map((i) => [i.label, i]));
	const placed = readBackIngredients.filter(
		(i) => i.relationship !== "parentOf",
	);
	return statementIngredients.map((s, k) => {
		if (byLabel.has(s.ref)) return byLabel.get(s.ref);
		if (placed[k] && placed[k].title === s.title) return placed[k];
		const sameName = placed.filter((i) => i.title === s.title);
		return sameName.length === 1 ? sameName[0] : null;
	});
}

/**
 * Format 1, as every export was until D57: one `signature` block for the
 * file, the signer and the time stamp together, and no identity.
 * @param {object} a
 * @param {object} a.signature   a `signatures` row of kind 'output' (statementJson and reportJson
 *                               as stored strings, or already parsed as `statement` / `report`)
 * @param {string} a.generatedAt ISO time
 * @param {object} a.generator   { name, version }
 */
export function buildPublicExportV1({ signature, generatedAt, generator }) {
	if (!signature) throw new Error("No signature to export");
	if (signature.kind !== "output")
		throw new Error("Only a signed output has a public export");
	const statement = parse(
		signature.statement ?? signature.statementJson,
		"statement",
	);
	if (!statement) throw new Error("This signature has no creator statement");
	if (
		!(statement.version >= MIN_STATEMENT_VERSION) ||
		!statement.composition?.picture?.intervals
	) {
		throw new Error(
			`This signed copy was made with statement version ${statement.version ?? 1}, which does not carry the timeline the public page draws. Sign the output again to export it.`,
		);
	}
	const report = parse(
		signature.report ?? signature.reportJson,
		"read-back report",
	);
	const v = interpretReport(report);
	const readBack = matchReadBack(statement.ingredients || [], v.ingredients);

	const ingredients = (statement.ingredients || []).map((i, k) => {
		const carried = readBack[k];
		return {
			ref: i.ref,
			title: i.publicTitle || i.title,
			fileName: i.title,
			originClass: i.originClass,
			// A page links this, so only a vocabulary address is written.
			digitalSourceType:
				knownSourceTypeUri(i.digitalSourceType) ||
				sourceTypeUri(i.originClass) ||
				null,
			position:
				i.position ||
				spectrumPosition(i.originClass, { aiAssisted: !!i.aiAssisted }),
			aiAssisted: !!i.aiAssisted,
			classSetBy: i.classSetBy,
			fileCredentials: i.fileCredentials,
			classClaimedByFile: i.classClaimedByFile ?? null,
			signedBy: i.signedBy || "",
			signerName: i.signerName || "",
			credentialsInSignedFile: carried ? carried.credentials : "unknown",
			note: i.note || "",
			pictureSeconds: i.pictureSeconds ?? 0,
			audioSeconds: i.audioSeconds ?? 0,
		};
	});

	const film = statement.output || {};
	const filmPosition = originClassDef(film.originClass).position;
	const usedClasses = new Set([
		film.originClass,
		...ingredients.map((i) => i.originClass),
		...ingredients.map((i) => i.classClaimedByFile).filter(Boolean),
	]);

	return {
		format: EXPORT_FORMAT,
		formatVersion: 1,
		generatedAt,
		generator: {
			name: generator?.name || "",
			version: generator?.version || "",
		},
		film: {
			title: film.publicTitle || film.title || "",
			fileName: film.title || "",
			durationSeconds: film.durationSeconds ?? null,
			fps: film.fps ?? null,
			originClass: film.originClass || "unknown",
			digitalSourceType: knownSourceTypeUri(film.digitalSourceType),
			position: filmPosition,
		},
		statement: {
			text: statement.text || "",
			author: statement.author || "",
			organization: statement.organization || "",
			editedWith: statement.editedWith || "",
			statedAt: statement.statedAt || null,
			statementVersion: statement.version,
		},
		composition: lanes(
			statement.composition,
			(lane) =>
				lane && {
					byPosition: lane.byPosition || {},
					mixed: lane.mixed || { seconds: 0, percent: 0, combos: {} },
					gap: lane.gap || { seconds: 0, percent: 0 },
					intervals: lane.intervals || [],
				},
		),
		ingredients,
		// Clips the tracker could not tie to an asset, and titles made in the
		// editor. Clip names are left out; times, the reason and the class the
		// creator gave the clip (statement v3; unknown before) are enough.
		untracked: (statement.unresolved || []).map((u) => ({
			track: u.track,
			startSeconds: u.startSeconds,
			endSeconds: u.endSeconds,
			reason: u.reason,
			originClass: u.originClass || "unknown",
			position: u.position || "unknown",
		})),
		editorMadeClips: statement.editorGeneratedClips || 0,
		signedFile: {
			fileName: fileNameOf(signature.signedPath),
			sha256: signature.signedHash || "",
			bytes: signature.signedSize || 0,
			version: signature.version ?? null,
			signedAt: signature.createdAt
				? new Date(signature.createdAt).toISOString()
				: null,
		},
		signature: {
			status: v.status,
			statusLabel: v.label,
			hashVerified: v.hashVerified,
			issuerRecognised: !v.untrusted && v.status === "valid",
			signer: v.signer
				? { commonName: v.signer.commonName, issuer: v.signer.issuer }
				: null,
			algorithm: v.signer?.alg || "",
			timestamped: v.timestamped,
			timestampTime: v.timestamped ? v.signer.time : null,
			manifestCount: v.manifests,
			failures: v.failures.map((f) => f.code),
		},
		vocabulary: {
			positions: POSITIONS.map((p) => ({
				id: p.id,
				label: p.label,
				long: p.long,
				desc: p.desc,
			})),
			classes: Object.fromEntries(
				[...usedClasses].filter(Boolean).map((code) => {
					const d = originClassDef(code);
					return [
						code,
						{
							label: d.label,
							position: d.position,
							desc: d.desc,
							iptc: sourceTypeUri(code) || null,
						},
					];
				}),
			),
		},
	};
}

/** A whole https:// address, as a browser writes it, or null. */
function httpsOrNull(value) {
	if (typeof value !== "string" || !URL.canParse(value)) return null;
	const url = new URL(value);
	return url.protocol === "https:" &&
		url.hostname &&
		!url.username &&
		!url.password
		? url.href
		: null;
}

const SIGNER_LABELS = {
	trusted: "Valid, on the C2PA trust list",
	unrecognised_issuer: "Valid, unrecognised issuer",
	invalid: "Invalid",
	absent: "No Content Credentials",
};

/**
 * Format 2 (D57): format 1's record of how the film was made, with the
 * single signature block split into three results that a page shows apart,
 * never as one badge: the file (does its content match what was signed),
 * the signer (the claim signature, its issuer and its time stamp), and the
 * creator's identity (a CAWG identity assertion, read on its own). It also
 * says where the signed copy is published, and how many details the
 * creator left out, without saying what.
 * @param {object} a
 * @param {object} a.signature    as for buildPublicExportV1, plus `definition` (the stored manifest definition)
 *   and `certificateSha256` (the signing certificate's fingerprint, kept at signing; "" when it was not)
 * @param {object|null} [a.publication] where the signed copy is published: { fileUrl, pageUrl, withheld }
 * @param {string} a.generatedAt  ISO time
 * @param {object} a.generator    { name, version }
 */
export function buildPublicExport({
	signature,
	publication = null,
	generatedAt,
	generator,
}) {
	const { signature: _single, ...v1 } = buildPublicExportV1({
		signature,
		generatedAt,
		generator,
	});
	void _single;
	const report = parse(
		signature.report ?? signature.reportJson,
		"read-back report",
	);
	const v = interpretReport(report);
	const identity = readIdentity(report);
	const definition = parse(
		signature.definition ?? signature.definitionJson,
		"stored definition",
	);
	const { vocabulary, signedFile, ...rest } = v1;
	return {
		...rest,
		formatVersion: EXPORT_FORMAT_VERSION,
		signedFile: { ...signedFile, url: httpsOrNull(publication?.fileUrl) },
		page: { url: httpsOrNull(publication?.pageUrl) },
		file: {
			status:
				v.status === "hash_mismatch"
					? "changed"
					: v.hashVerified
						? "matches"
						: "unchecked",
			hashVerified: v.hashVerified,
		},
		signer: {
			status: v.claim,
			statusLabel: SIGNER_LABELS[v.claim],
			commonName: v.signer?.commonName || "",
			issuer: v.signer?.issuer || "",
			// What a name cannot do: tell this signer's certificate from
			// another with the same name (D72). Empty for no signature, and for
			// a signing recorded before the fingerprint was kept.
			certificateSha256:
				v.claim !== "absent" &&
				/^[0-9a-f]{64}$/.test(signature.certificateSha256 || "")
					? signature.certificateSha256
					: "",
			algorithm: v.signer?.alg || "",
			timeStamp: readTimeStamp(report),
			manifestCount: v.manifests,
			failures: v.failures.map((f) => f.code),
		},
		identity: identity && {
			status: identity.status,
			name: identity.name,
			issuer: identity.issuer,
			roles: identity.roles,
		},
		withheld: {
			// Details left out of this record itself. Nothing here leaves any
			// out: the review before export became the review before signing
			// (D62), so a publication's `withheld` list is never applied to what
			// is built above, and counting it would tell a reader that details
			// were kept back when none were (D76). Zero until something applies
			// the list.
			fromRecord: 0,
			// Assertions redacted, and sources whose credentials were left out (D62).
			fromSignedFile:
				(Array.isArray(definition?.redactions)
					? definition.redactions.length
					: 0) +
				(Array.isArray(definition?.credentials_left_out)
					? definition.credentials_left_out.length
					: 0),
		},
		vocabulary,
	};
}

// A download name for the export: the signed file's base name.
export function publicExportFileName(signedPath) {
	const base = fileNameOf(signedPath).replace(/\.[^.]+$/, "");
	return `${base || "output"}.provenance.json`;
}

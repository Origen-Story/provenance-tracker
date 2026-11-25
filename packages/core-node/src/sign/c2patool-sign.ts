// Sign and read through the pinned c2patool (D35's engine, moved from the
// app so the catalog and the app share one implementation).
//
// Why c2patool and not the c2pa-node binding: Windows Smart App Control can
// refuse to load the binding's unsigned native module, and files the old
// binding signed do not read cleanly in current tools. c2patool is the
// reference implementation and ships as a signed binary.
//
// How an ingredient gets in with its own credentials: `c2patool <file> -i -o
// <dir>` writes the file's ingredient record (and its manifest store, if it
// has one) to a folder. Our label and relationship are set on that record and
// it is listed under `ingredient_paths`, so actions can point at it by label
// and a signed ingredient keeps its credentials inside the new file.
//
// Key handling: only the certificate and key *paths* are written, into a temp
// definition file that is deleted afterwards. Nothing here logs or returns
// them; callers store the definition without the signer fields
// (storableDefinition). Only the public certificate is ever read.

import { execFile } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { existsSync } from "node:fs";
import {
	copyFile,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { sidecarPathFor } from "@provenancetracker/core/manifest/build.js";

const execFileP = promisify(execFile);
const SIGN_TIMEOUT_MS = 10 * 60 * 1000;
const SIGNER_FIELDS = ["private_key", "sign_cert", "ta_url", "alg"];

async function run(
	tool: string,
	args: string[],
	timeout = SIGN_TIMEOUT_MS,
): Promise<{ stdout: string; stderr: string }> {
	try {
		return await execFileP(tool, args, {
			maxBuffer: 64 * 1024 * 1024,
			timeout,
			windowsHide: true,
		});
	} catch (err) {
		const e = err as NodeJS.ErrnoException & { stderr?: string };
		if (e.code === "ENOENT")
			throw new Error(
				"c2patool was not found. Run npm run tools:fetch or set C2PATOOL_PATH.",
				{ cause: err },
			);
		const out = new Error(
			(e.stderr || e.message || "")
				.trim()
				.split("\n")
				.filter((l) => !/^\s*$/.test(l))
				.slice(-3)
				.join(" "),
			{ cause: err },
		) as Error & { stderr?: string };
		out.stderr = e.stderr;
		throw out;
	}
}

/**
 * The full c2patool report for a file, or null when it carries no manifest.
 * With `externalManifest`, validate that .c2pa sidecar against the file
 * instead of whatever the file carries itself. Throws on a real read failure.
 */
export async function readReport(
	filePath: string,
	opts: { tool: string; externalManifest?: string },
): Promise<Record<string, unknown> | null> {
	let stdout: string;
	try {
		({ stdout } = await run(
			opts.tool,
			opts.externalManifest
				? [filePath, "--external-manifest", opts.externalManifest]
				: [filePath],
			120000,
		));
	} catch (err) {
		const e = err as Error & { stderr?: string };
		if (/no.*manifest|no.*claim|jumbf.*not.*found/i.test(e.stderr || e.message))
			return null;
		throw err;
	}
	return JSON.parse(stdout);
}

/**
 * The signing algorithm follows the certificate's key: P-256 is es256 and so
 * on. Read from the public certificate, never from the private key.
 */
export async function algorithmFor(certificatePath: string): Promise<string> {
	const key = new X509Certificate(await readFile(certificatePath, "utf8"))
		.publicKey;
	const type = key.asymmetricKeyType;
	if (type === "ec") {
		const curve = key.asymmetricKeyDetails?.namedCurve;
		if (curve === "prime256v1" || curve === "P-256") return "es256";
		if (curve === "secp384r1" || curve === "P-384") return "es384";
		if (curve === "secp521r1" || curve === "P-521") return "es512";
	}
	if (type === "rsa-pss" || type === "rsa") return "ps256";
	if (type === "ed25519") return "ed25519";
	throw new Error(`Unsupported signing key type in the certificate: ${type}`);
}

/**
 * What a public certificate says about whoever signs with it: its subject's
 * common name and its SHA-256 fingerprint (lower-case hex of the DER bytes),
 * the record of which certificate signed. The first certificate of a chain
 * is the signer's.
 */
export async function certificateInfo(certificatePath: string): Promise<{
	commonName: string;
	issuer: string;
	fingerprint: string;
	validTo: string;
}> {
	const pem = await readFile(certificatePath, "utf8");
	const cert = new X509Certificate(pem);
	const cn = (dn: string) =>
		/(?:^|\n)CN=([^\n]*)/.exec(dn)?.[1]?.trim() ?? dn.trim();
	return {
		commonName: cn(cert.subject),
		issuer: cn(cert.issuer),
		fingerprint: cert.fingerprint256.replaceAll(":", "").toLowerCase(),
		validTo: new Date(cert.validTo).toISOString(),
	};
}

async function prepareIngredient(
	tool: string,
	filePath: string,
	dir: string,
	{
		label,
		relationship,
		title,
	}: { label: string; relationship: string; title?: string },
): Promise<string> {
	if (!existsSync(filePath))
		throw new Error(
			`Ingredient file is missing: ${title || path.basename(filePath)}`,
		);
	const folder = path.join(dir, label);
	await run(tool, [filePath, "-i", "-o", folder], 120000);
	const recordPath = path.join(folder, "ingredient.json");
	const record = JSON.parse(await readFile(recordPath, "utf8")) as Record<
		string,
		unknown
	>;
	// c2patool resolves an ingredient's resources (its thumbnail, its manifest
	// store) against the definition's folder, not the ingredient's, so point
	// them into the ingredient's subfolder.
	// `-i` reads only credentials embedded in the file. A source asset signed
	// at ingest has them in a sidecar (D13), so attach that as the ingredient's
	// manifest store, with the validation results a reader gives for it.
	const sidecar = sidecarPathFor(filePath);
	if (!record.manifest_data && existsSync(sidecar)) {
		const report = await readReport(filePath, {
			tool,
			externalManifest: sidecar,
		}).catch(() => null);
		if (report?.active_manifest) {
			await copyFile(sidecar, path.join(folder, "manifest_data.c2pa"));
			Object.assign(record, {
				active_manifest: report.active_manifest,
				manifest_data: {
					format: "application/c2pa",
					identifier: "manifest_data.c2pa",
				},
				validation_results: report.validation_results,
				validation_status: report.validation_status || [],
			});
		}
	}
	for (const key of ["thumbnail", "manifest_data"]) {
		const res = record[key] as { identifier?: string } | undefined;
		if (res?.identifier) res.identifier = `${label}/${res.identifier}`;
	}
	Object.assign(record, {
		label,
		relationship,
		title: title || record.title || path.basename(filePath),
	});
	await writeFile(recordPath, JSON.stringify(record));
	return recordPath;
}

export interface SignIngredient {
	label: string;
	relationship: string;
	title?: string;
	filePath?: string;
	/** The file being signed is this ingredient (the parent). */
	useInput?: boolean;
}

/**
 * A file the definition names by identifier, such as the claim thumbnail
 * (build.js names it by its hash). c2patool resolves identifiers against the
 * definition's folder, so each is copied there under that name.
 */
export interface SignResource {
	identifier: string;
	filePath: string;
}

// An identifier is a plain file name: it must not reach outside the folder.
const RESOURCE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Sign `inputPath` into `outputPath` with a definition from build.js.
 * With `sidecar`, the manifest goes to `outputPath` as a .c2pa sidecar and
 * the input is left untouched (D13); c2patool still writes a copy of the
 * asset next to the sidecar, so that goes in the temp folder and is deleted
 * with it.
 */
export async function signWithC2patool(opts: {
	tool: string;
	inputPath: string;
	/** Must not exist: a signed copy never replaces a file. */
	outputPath: string;
	definition: Record<string, unknown>;
	ingredients?: SignIngredient[];
	resources?: SignResource[];
	certificatePath: string;
	privateKeyPath: string;
	/** RFC 3161 time-stamp authority; left out in tests (no network). */
	timestampUrl?: string;
	sidecar?: boolean;
	log?: (line: string) => void;
}): Promise<{ outputPath: string; report: Record<string, unknown> | null }> {
	const { tool, inputPath, outputPath } = opts;
	if (!existsSync(inputPath))
		throw new Error(`File to sign is missing: ${path.basename(inputPath)}`);
	if (existsSync(outputPath))
		throw new Error(`Refusing to overwrite ${path.basename(outputPath)}`);
	if (!opts.certificatePath || !existsSync(opts.certificatePath))
		throw new Error(
			"The signing certificate is not there. Check this project's signing settings.",
		);
	if (!opts.privateKeyPath || !existsSync(opts.privateKeyPath))
		throw new Error(
			"The signing key is not there. Check this project's signing settings.",
		);
	const ingredients = opts.ingredients ?? [];
	const dir = await mkdtemp(path.join(os.tmpdir(), "pt-c2pa-"));
	try {
		const ingredientPaths: string[] = [];
		for (const ing of ingredients)
			ingredientPaths.push(
				await prepareIngredient(
					tool,
					ing.useInput ? inputPath : ing.filePath!,
					dir,
					ing,
				),
			);
		for (const res of opts.resources ?? []) {
			if (!RESOURCE_NAME.test(res.identifier) || res.identifier.includes(".."))
				throw new Error(`Not a plain file name: ${res.identifier}`);
			if (!existsSync(res.filePath))
				throw new Error(
					`A file the credentials take is missing: ${path.basename(res.filePath)}`,
				);
			await copyFile(res.filePath, path.join(dir, res.identifier));
		}
		const full = {
			...opts.definition,
			alg: await algorithmFor(opts.certificatePath),
			sign_cert: path.resolve(opts.certificatePath),
			private_key: path.resolve(opts.privateKeyPath),
			...(opts.timestampUrl ? { ta_url: opts.timestampUrl } : {}),
			...(ingredientPaths.length ? { ingredient_paths: ingredientPaths } : {}),
		};
		const defPath = path.join(dir, "manifest.json");
		await writeFile(defPath, JSON.stringify(full));
		opts.log?.(
			`signing ${path.basename(inputPath)} -> ${path.basename(outputPath)} (${ingredients.length} ingredients)`,
		);
		if (opts.sidecar) {
			const scratch = path.join(dir, "out", path.basename(inputPath));
			await run(tool, [inputPath, "-m", defPath, "-s", "-o", scratch]);
			const written = path.join(
				dir,
				"out",
				`${path.basename(inputPath, path.extname(inputPath))}.c2pa`,
			);
			await moveFile(written, outputPath);
		} else {
			await run(tool, [inputPath, "-m", defPath, "-o", outputPath]);
		}
	} catch (err) {
		// c2patool can leave a partial file behind when it fails mid-write.
		if (existsSync(outputPath))
			await rm(outputPath, { force: true }).catch(() => {});
		throw new Error(`Signing failed: ${(err as Error).message}`, {
			cause: err,
		});
	} finally {
		await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
	const report = opts.sidecar
		? await readReport(inputPath, { tool, externalManifest: outputPath })
		: await readReport(outputPath, { tool });
	return { outputPath, report };
}

/** Rename, or copy and delete when the temp folder is on another drive. */
async function moveFile(from: string, to: string): Promise<void> {
	try {
		await rename(from, to);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
		await copyFile(from, to);
		await rm(from, { force: true });
	}
}

/**
 * The definition as recorded: what was signed, without the signer's key
 * material paths or the temp ingredient folders.
 */
export function storableDefinition(
	definition: Record<string, unknown>,
): Record<string, unknown> {
	const out = { ...definition };
	for (const f of [...SIGNER_FIELDS, "ingredient_paths"]) delete out[f];
	return out;
}

// Signing through the pinned c2patool: the fallback engine a machine can
// choose (D53; `npm run cli -- settings signing-engine c2patool`). The C2PA
// library signs by default. c2patool reads back only what it has just signed;
// it never reads files for the catalog (D15, D51).
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
// (storableDefinition). c2patool opens the key file itself, so it signs only
// with key files on this machine.
//
// What c2patool may send out (docs/network.md): the time-stamp request, and a
// request for Content Credentials an ingredient says are stored on the web,
// which c2patool makes to any address, unguarded, whatever this machine's
// setting says. So c2patool signs only on a machine set to fetch from any
// host (D74, engines/index.ts). The library engine keeps to the setting.

import { execFile } from "node:child_process";
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
import { libraryObservation } from "@provenancetracker/core/extraction/c2pa-library-read.ts";
import {
	c2patoolPath,
	c2patoolProblem,
	c2patoolVersion,
} from "../../extract/c2patool.ts";
import type { Machine } from "../../machine.ts";
import {
	checkSignArgs,
	type SignArgs,
	type SignIngredient,
	type SigningEngine,
} from "../engine.ts";

const execFileP = promisify(execFile);
const SIGN_TIMEOUT_MS = 10 * 60 * 1000;

/** The name recorded on signatures c2patool made. */
export const C2PATOOL_ENGINE = "c2patool";

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
			throw new Error("c2patool was not found. Run npm run tools:fetch.", {
				cause: err,
			});
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

async function prepareIngredient(
	tool: string,
	filePath: string,
	dir: string,
	{
		label,
		relationship,
		title,
		sidecarPath,
	}: {
		label: string;
		relationship: string;
		title?: string;
		sidecarPath?: string;
	},
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
	// manifest store, with the validation results a reader gives for it. Only
	// the sidecar the catalog knows (engine.ts), never one found here.
	const sidecar = sidecarPath;
	if (!record.manifest_data && sidecar && existsSync(sidecar)) {
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

/**
 * Sign `inputPath` into `outputPath` with a definition from build.js.
 * With `sidecar`, the manifest goes to `outputPath` as a .c2pa sidecar and
 * the input is left untouched (D13); c2patool still writes a copy of the
 * asset next to the sidecar, so that goes in the temp folder and is deleted
 * with it.
 */
export async function signWithC2patool(
	opts: Omit<SignArgs, "ingredients"> & {
		ingredients?: SignIngredient[];
		tool: string;
	},
): Promise<{ outputPath: string; report: Record<string, unknown> | null }> {
	const { tool, inputPath, outputPath } = opts;
	checkSignArgs({ ...opts, ingredients: opts.ingredients ?? [] });
	// c2patool opens the key files itself, so it signs only with a holder
	// that has them (D54). Opening that holder checked the key against the
	// certificate: c2patool would otherwise leave a broken signature.
	if (opts.identity)
		throw new Error(
			"c2patool cannot add your identity (CAWG). Sign with the C2PA library: npm run cli -- settings signing-engine library",
		);
	const files = opts.holder.keyFiles;
	if (!files)
		throw new Error(
			`c2patool signs only with key files on this machine, and this project's key is held by "${opts.holder.kind}". Sign with the C2PA library: npm run cli -- settings signing-engine library`,
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
		// c2patool resolves identifiers against the definition's folder, so each
		// resource is copied there under its name.
		for (const res of opts.resources ?? [])
			await copyFile(res.filePath, path.join(dir, res.identifier));
		const full = {
			...opts.definition,
			alg: opts.holder.alg,
			sign_cert: path.resolve(files.certificatePath),
			private_key: path.resolve(files.privateKeyPath),
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
export async function moveFile(from: string, to: string): Promise<void> {
	try {
		await rename(from, to);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
		await copyFile(from, to);
		await rm(from, { force: true });
	}
}

/**
 * c2patool on this machine, as the engine. Its readEmbedded takes a .c2pa
 * sidecar beside the file as the file's own (c2patool has no switch to stop
 * it), so signingEngineFor answers that question with the library when it can.
 */
export async function c2patoolEngine(machine: Machine): Promise<SigningEngine> {
	// The program is checked against its pinned hash before it is ever run,
	// its version asked included (D69).
	const problem = c2patoolProblem(machine.env, machine.platform);
	if (problem) throw new Error(problem);
	const tool = c2patoolPath(machine.env, machine.platform);
	return {
		name: C2PATOOL_ENGINE,
		version: (await c2patoolVersion(tool)) ?? "",
		sign: (args) => signWithC2patool({ ...args, tool }),
		// c2patool is not a reader for the catalog (D15): signingEngineFor
		// answers with the library when it can.
		read: async (_file, sidecar) =>
			libraryObservation({
				kind: sidecar ? "c2pa-sidecar" : "c2pa",
				version: null,
				unavailable:
					"c2patool does not read files for the tracker; the C2PA library does.",
			}),
		readEmbedded: async (file) => {
			const report = await readReport(file, { tool }).catch(() => null);
			if (!report?.active_manifest) return null;
			const manifests = report.manifests as
				| Record<
						string,
						{ signature_info?: { common_name?: string; issuer?: string } }
				  >
				| undefined;
			const info = manifests?.[String(report.active_manifest)]?.signature_info;
			return { signer: info?.common_name || info?.issuer || "" };
		},
	};
}

// IO: sign and read through the bundled c2patool (phase 4c).
//
// Why c2patool and not the c2pa-node binding: Windows Smart App Control can
// refuse to load the binding's unsigned native module, and files the old
// binding signed do not read cleanly in current tools. c2patool is the
// reference implementation and ships as a signed binary.
//
// How an ingredient gets in with its own credentials: `c2patool <file> -i -o
// <dir>` writes the file's ingredient record (and its manifest store, if it
// has one) to a folder. We set our label and relationship on that record and
// list it under `ingredient_paths`, so actions can point at it by label and a
// signed ingredient keeps its credentials inside the new file.
//
// Key handling: only the certificate and key *paths* are written, into a temp
// definition file that is deleted afterwards. Nothing here logs or returns
// them; callers store the definition without the signer fields.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm, rename, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { resolveC2patoolPath } from '../extraction/c2pa.js';
import { sidecarPathFor } from './build.js';
import { createLogger } from '../logger.js';

const log = createLogger('c2patool');
const execFileP = promisify(execFile);
const SIGN_TIMEOUT_MS = 10 * 60 * 1000;
const SIGNER_FIELDS = ['private_key', 'sign_cert', 'ta_url', 'alg'];

async function run(args, timeout = SIGN_TIMEOUT_MS) {
	try {
		return await execFileP(resolveC2patoolPath(), args, { maxBuffer: 64 * 1024 * 1024, timeout, windowsHide: true });
	} catch (err) {
		if (err.code === 'ENOENT') throw new Error('c2patool was not found. Put it in tools/c2patool/ or set C2PATOOL_PATH.');
		const e = new Error((err.stderr || err.message || '').trim().split('\n').filter(l => !/^\s*$/.test(l)).slice(-3).join(' '));
		e.stderr = err.stderr;
		throw e;
	}
}

/**
 * The full c2patool report for a file, or null when it carries no manifest.
 * With `externalManifest`, validate that .c2pa sidecar against the file
 * instead of whatever the file carries itself. Throws on a real read failure.
 */
export async function readReport(filePath, { externalManifest = '' } = {}) {
	let stdout;
	try {
		({ stdout } = await run(externalManifest ? [filePath, '--external-manifest', externalManifest] : [filePath], 120000));
	} catch (err) {
		if (/no.*manifest|no.*claim|jumbf.*not.*found/i.test(err.stderr || err.message)) return null;
		throw err;
	}
	return JSON.parse(stdout);
}

// The signing algorithm follows the certificate's key: P-256 is es256 and so
// on. Read from the public certificate, never from the private key.
export async function algorithmFor(certificatePath) {
	const pem = await readFile(certificatePath, 'utf8');
	const key = new X509Certificate(pem).publicKey;
	const type = key.asymmetricKeyType;
	if (type === 'ec') {
		const curve = key.asymmetricKeyDetails?.namedCurve;
		if (curve === 'prime256v1' || curve === 'P-256') return 'es256';
		if (curve === 'secp384r1' || curve === 'P-384') return 'es384';
		if (curve === 'secp521r1' || curve === 'P-521') return 'es512';
	}
	if (type === 'rsa-pss' || type === 'rsa') return 'ps256';
	if (type === 'ed25519') return 'ed25519';
	throw new Error(`Unsupported signing key type in the certificate: ${type}`);
}

async function prepareIngredient(filePath, dir, { label, relationship, title }) {
	if (!existsSync(filePath)) throw new Error(`Ingredient file is missing: ${title || path.basename(filePath)}`);
	const folder = path.join(dir, label);
	await run([filePath, '-i', '-o', folder], 120000);
	const recordPath = path.join(folder, 'ingredient.json');
	const record = JSON.parse(await readFile(recordPath, 'utf8'));
	// c2patool resolves an ingredient's resources (its thumbnail, its manifest
	// store) against the definition's folder, not the ingredient's, so point
	// them into the ingredient's subfolder.
	// `-i` reads only credentials embedded in the file. A source asset signed
	// at ingest has them in a sidecar (D13), so attach that as the ingredient's
	// manifest store, with the validation results a reader gives for it.
	const sidecar = sidecarPathFor(filePath);
	if (!record.manifest_data && existsSync(sidecar)) {
		const report = await readReport(filePath, { externalManifest: sidecar }).catch(() => null);
		if (report?.active_manifest) {
			await copyFile(sidecar, path.join(folder, 'manifest_data.c2pa'));
			Object.assign(record, {
				active_manifest: report.active_manifest,
				manifest_data: { format: 'application/c2pa', identifier: 'manifest_data.c2pa' },
				validation_results: report.validation_results,
				validation_status: report.validation_status || []
			});
		}
	}
	for (const key of ['thumbnail', 'manifest_data']) {
		if (record[key]?.identifier) record[key].identifier = `${label}/${record[key].identifier}`;
	}
	Object.assign(record, { label, relationship, title: title || record.title || path.basename(filePath) });
	await writeFile(recordPath, JSON.stringify(record));
	return recordPath;
}

/**
 * Sign `inputPath` into `outputPath` with a definition from build.js.
 *
 * @param {object} a
 * @param {string} a.inputPath
 * @param {string} a.outputPath        must not exist
 * @param {object} a.definition        from buildOutputManifest / buildAssetManifest
 * @param {Array}  a.ingredients       [{ label, relationship, title, filePath? , useInput? }]
 * @param {string} a.certificatePath
 * @param {string} a.privateKeyPath
 * @param {string} [a.timestampUrl]    RFC 3161 time-stamp authority; omitted in tests (no network)
 * @param {boolean} [a.sidecar]        write the manifest to `outputPath` as a .c2pa sidecar and
 *                                     leave the input untouched (D13). c2patool still writes a
 *                                     copy of the asset next to the sidecar, so that goes in the
 *                                     temp folder and is deleted with it.
 * @returns {Promise<{ outputPath: string, report: object }>}
 */
export async function signWithC2patool({ inputPath, outputPath, definition, ingredients = [], certificatePath, privateKeyPath, timestampUrl = '', sidecar = false }) {
	if (!existsSync(inputPath)) throw new Error(`File to sign is missing: ${path.basename(inputPath)}`);
	if (existsSync(outputPath)) throw new Error(`Refusing to overwrite ${path.basename(outputPath)}`);
	if (!certificatePath || !existsSync(certificatePath)) throw new Error('Signing certificate not found. Check the paths in Project Settings.');
	if (!privateKeyPath || !existsSync(privateKeyPath)) throw new Error('Signing key not found. Check the paths in Project Settings.');

	const dir = await mkdtemp(path.join(os.tmpdir(), 'pt-c2pa-'));
	try {
		const ingredientPaths = [];
		for (const ing of ingredients) {
			ingredientPaths.push(await prepareIngredient(ing.useInput ? inputPath : ing.filePath, dir, ing));
		}
		const full = {
			...definition,
			alg: await algorithmFor(certificatePath),
			sign_cert: path.resolve(certificatePath),
			private_key: path.resolve(privateKeyPath),
			...(timestampUrl ? { ta_url: timestampUrl } : {}),
			...(ingredientPaths.length ? { ingredient_paths: ingredientPaths } : {})
		};
		const defPath = path.join(dir, 'manifest.json');
		await writeFile(defPath, JSON.stringify(full));
		log.info(`signing ${path.basename(inputPath)} -> ${path.basename(outputPath)} (${ingredients.length} ingredients)`);
		if (sidecar) {
			const scratchAsset = path.join(dir, 'out', path.basename(inputPath));
			await run([inputPath, '-m', defPath, '-s', '-o', scratchAsset]);
			const written = path.join(dir, 'out', `${path.basename(inputPath, path.extname(inputPath))}.c2pa`);
			await moveFile(written, outputPath);
		} else {
			await run([inputPath, '-m', defPath, '-o', outputPath]);
		}
	} catch (err) {
		// c2patool can leave a partial file behind when it fails mid-write.
		if (existsSync(outputPath)) await rm(outputPath, { force: true }).catch(() => {});
		throw new Error(`Signing failed: ${err.message}`);
	} finally {
		await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
	const report = sidecar ? await readReport(inputPath, { externalManifest: outputPath }) : await readReport(outputPath);
	return { outputPath, report };
}

// Rename, or copy and delete when the temp folder is on another drive.
async function moveFile(from, to) {
	try {
		await rename(from, to);
	} catch (err) {
		if (err.code !== 'EXDEV') throw err;
		await copyFile(from, to);
		await rm(from, { force: true });
	}
}

// The definition as stored in the database: what was signed, without the
// signer's key material paths or the temp ingredient folders.
export function storableDefinition(definition) {
	const out = { ...definition };
	for (const f of [...SIGNER_FIELDS, 'ingredient_paths']) delete out[f];
	return out;
}

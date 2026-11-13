// Sign one source asset with Content Credentials, through c2patool (phase 4c,
// D13).
//
// For a file that arrived without credentials (a hand-recorded WAV, most
// ElevenLabs audio, an MP3 from a tool that does not sign): a `c2pa.created`
// action with the asset's class as its IPTC digitalSourceType, the creator as
// a schema.org CreativeWork author, and the AI training opt-out. For a file
// that already has credentials, those stay as the parent and this manifest
// adds the creator's signature on top.
//
// The file itself is never written. The manifest goes into a `.c2pa` sidecar
// beside it (`<name>.c2pa`, where C2PA readers look), so a 2 GB take is not
// duplicated and the edit project's links are untouched. Only deliverables
// (signed outputs) get the manifest embedded in a new file.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { computeFileHash, getFileSize } from '../core/file-utils.js';
import { buildAssetManifest, sidecarPathFor } from '../manifest/build.js';
import { interpretReport } from '../manifest/verify.js';
import { signWithC2patool, readReport, storableDefinition } from '../manifest/c2patool.js';
import { GENERATOR } from '../manifest/generator.js';

/**
 * @param {object} args
 * @param {string} args.inputPath
 * @param {string} [args.sidecarPath]      where to write the .c2pa; default <name>.c2pa beside the input
 * @param {string} args.originClass        the asset's class in the tracker
 * @param {string} [args.creatorName]
 * @param {string} [args.organization]
 * @param {string} [args.toolUsed]         what made the file
 * @param {boolean} [args.isAiGenerated]   the signer says a model made it
 * @param {string} [args.identityUrl]      where the creator's identity is published
 * @param {boolean} [args.trainingMiningOptOut=true]
 * @param {string} args.certificatePath
 * @param {string} args.privateKeyPath
 * @param {string} [args.timestampUrl]
 */
export async function signAsset(args) {
	const { inputPath, originClass = 'unknown', creatorName = '', organization = '', toolUsed = '', isAiGenerated = false, identityUrl = '', trainingMiningOptOut = true, certificatePath, privateKeyPath, timestampUrl = '' } = args;
	if (!inputPath || !existsSync(inputPath)) throw new Error(`Input file does not exist: ${inputPath ? path.basename(inputPath) : '(none)'}`);
	const sidecarPath = args.sidecarPath || sidecarPathFor(inputPath);

	// Any sidecar already beside the file must have been archived by the caller,
	// both so nothing is overwritten and so the read below sees only what the
	// file carries itself (readers pick up <name>.c2pa automatically).
	for (const p of new Set([sidecarPath, sidecarPathFor(inputPath)])) {
		if (existsSync(p)) throw new Error(`Refusing to overwrite ${path.basename(p)}`);
	}
	// A file with its own embedded credentials is not signed at ingest. c2patool
	// can only sidecar-sign it by binding to a copy with those credentials
	// stripped, which then does not match the untouched file. Its own
	// credentials already are its provenance, and an output keeps them.
	const embedded = await readReport(inputPath).catch(() => null);
	if (embedded) {
		const signer = embedded.manifests?.[embedded.active_manifest]?.signature_info;
		const by = signer?.common_name || signer?.issuer;
		throw Object.assign(new Error(`This file already carries its own Content Credentials${by ? ` (signed by ${by})` : ''}. It does not need signing at ingest, and a sidecar could not match it without stripping them. They are carried into any output you sign.`), { status: 409 });
	}
	const { definition, ingredients } = buildAssetManifest({
		title: path.basename(inputPath),
		originClass,
		isAiGenerated,
		toolUsed,
		authorName: creatorName,
		organization,
		identityUrl,
		trainingMiningOptOut,
		generator: GENERATOR
	});
	const { report } = await signWithC2patool({ inputPath, outputPath: sidecarPath, definition, ingredients, certificatePath, privateKeyPath, timestampUrl, sidecar: true });

	const [sidecarHash, sidecarSize] = await Promise.all([computeFileHash(sidecarPath), getFileSize(sidecarPath)]);
	return {
		sidecarPath,
		sidecarHash,
		sidecarSize,
		report,
		verification: interpretReport(report),
		definition: storableDefinition(definition)
	};
}

// C2PA signing — writes a Content Credentials manifest into an asset file.
//
// Call this when an asset arrives without a manifest (most ElevenLabs audio,
// hand-recorded WAVs, MP3s from any non-CAI tool). Produces a parallel
// `<basename>.signed.<ext>` file alongside the original; the original is
// preserved (project policy is to keep all originals during v0.2).
//
// What goes into the manifest:
//   - c2pa.actions   — declares this asset was created (or AI-generated) by
//                       the named softwareAgent
//   - stds.schema-org.CreativeWork — author + publisher; this is what
//                       contentcredentials.org renders as "Creator"
//   - c2pa.training-mining — opt-out signal; honored by AI training crawlers
//                       that respect C2PA
//   - cawg.identity (CAWG-lite) — identity assertion pointing at the project's
//                       hosted CAWG identity doc. v0.2 ships this as a
//                       declarative assertion (no COSE signature yet); future
//                       work will wrap it in proper x509.cose.
//   - DigitalSourceType (when AI-generated) — IPTC code on the CreativeWork
//
// Audio gotchas:
//   - c2pa-node's default thumbnail generator runs Sharp, which throws on
//     audio MIME types. We pass thumbnail: false for any audio/* asset.
//   - Buffer-mode signing is JPEG/PNG only. We always use file-mode signing
//     (mimeType + path), which works across image/audio/video.

import { loadC2paNode } from './c2pa-node-loader.js';
import { existsSync } from 'fs';
import { stat } from 'fs/promises';
import path from 'path';
import { computeFileHash, getMimeType, getFileSize } from '../core/file-utils.js';
import { extractC2pa } from './c2pa.js';
import { createLogger } from '../logger.js';

const log = createLogger('c2pa-sign');

// IPTC digital source type vocabulary URIs — the canonical list of "how this
// was made" identifiers C2PA readers recognize.
const DIGITAL_SOURCE_TYPES = {
	trainedAlgorithmicMedia: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
	digitalCapture: 'http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture',
	humanEdits: 'http://cv.iptc.org/newscodes/digitalsourcetype/humanEdits'
};

function isAudioMime(mimeType) {
	return typeof mimeType === 'string' && mimeType.startsWith('audio/');
}

function signedOutputPath(inputPath) {
	const ext = path.extname(inputPath);
	const base = inputPath.slice(0, -ext.length);
	return `${base}.signed${ext}`;
}

// Build the assertion list. Order isn't semantically meaningful but we put
// actions first because that's the conventional reading order in C2PA tools.
function buildAssertions({ creatorName, organization, toolUsed, isAiGenerated, trainingMiningOptOut, cawgIdentityUrl, cawgIdentityName }) {
	const assertions = [];

	// 1. c2pa.actions — what happened to produce this file
	const action = isAiGenerated
		? { action: 'c2pa.created', softwareAgent: toolUsed || 'unknown', digitalSourceType: DIGITAL_SOURCE_TYPES.trainedAlgorithmicMedia }
		: { action: 'c2pa.created', softwareAgent: toolUsed || 'unknown', digitalSourceType: DIGITAL_SOURCE_TYPES.digitalCapture };
	assertions.push({ label: 'c2pa.actions', data: { actions: [action] } });

	// 2. schema.org CreativeWork — universal "creator" surface for C2PA readers
	const author = [];
	if (creatorName) author.push({ '@type': 'Person', name: creatorName });
	if (organization) author.push({ '@type': 'Organization', name: organization });
	assertions.push({
		label: 'stds.schema-org.CreativeWork',
		data: {
			'@context': 'https://schema.org',
			'@type': 'CreativeWork',
			...(author.length ? { author } : {}),
			...(organization ? { publisher: { '@type': 'Organization', name: organization } } : {})
		}
	});

	// 3. training/mining opt-out — signal to AI crawlers that this asset is
	// not licensed for training data. Default true.
	if (trainingMiningOptOut !== false) {
		assertions.push({
			label: 'c2pa.training-mining',
			data: {
				entries: {
					'c2pa.ai_generative_training': { use: 'notAllowed' },
					'c2pa.ai_inference': { use: 'notAllowed' },
					'c2pa.ai_training': { use: 'notAllowed' },
					'c2pa.data_mining': { use: 'notAllowed' }
				}
			}
		});
	}

	// 4. CAWG identity (CAWG-lite) — declarative pointer at the project's
	// hosted identity doc. Full CAWG x509.cose signing requires COSE encoding
	// not exposed by c2pa-node's high-level API; v0.2 ships the assertion
	// shape (label cawg.identity, signer_payload, role) without the COSE wrap.
	// A reader can still see the identity URL and name; verifying the COSE
	// signature comes in v0.3.
	//
	// TODO(v0.3 — CAWG upgrade path): when c2pa-node exposes first-class CAWG
	// signing (track github.com/contentauth/c2pa-node), or when a public CAWG
	// identity aggregator launches:
	//   - Option 3 (x509.cose): wrap signer_payload in COSE_Sign1 using the
	//     same project cert, set sig_type='cawg.x509.cose', drop the `note`.
	//   - Option 4 (identity_claims_aggregation): swap signer_payload for a
	//     verifiable credential issued by a third-party aggregator; trust
	//     anchor moves from self-signed cert to aggregator reputation.
	// Either path is a localized change here — manifest schema and storage
	// already accept the assertion bytes.
	if (cawgIdentityUrl) {
		assertions.push({
			label: 'cawg.identity',
			data: {
				signer_payload: {
					sig_type: 'cawg.x509.cose.unsigned',
					referenced_assertions: [],
					role: ['cawg.creator'],
					identity_url: cawgIdentityUrl,
					identity_name: cawgIdentityName || creatorName || ''
				},
				signature: null,
				note: 'CAWG-lite v0.2 — declarative identity assertion. Full x509.cose signing pending.'
			}
		});
	}

	return assertions;
}

/**
 * Sign an asset file with a C2PA manifest.
 *
 * @param {object} args
 * @param {string} args.inputPath          path to the source file
 * @param {string} [args.outputPath]       destination for the signed copy; default = <input>.signed.<ext>
 * @param {string} [args.mimeType]         MIME type; auto-detected from extension if omitted
 * @param {string} args.creatorName        person who created the asset
 * @param {string} [args.organization]     org/publisher name
 * @param {string} args.toolUsed           softwareAgent (e.g. "Adobe Audition 25.x")
 * @param {boolean} [args.isAiGenerated]   if true, marks DigitalSourceType=trainedAlgorithmicMedia
 * @param {string} [args.cawgIdentityUrl]  URL of hosted CAWG identity doc
 * @param {string} [args.cawgIdentityName] human-readable signer name for CAWG
 * @param {boolean} [args.trainingMiningOptOut=true]
 * @param {string} args.certificatePath    PEM cert chain
 * @param {string} args.privateKeyPath     PEM private key
 * @returns {Promise<{ signedPath: string, fileHash: string, fileSize: number, mimeType: string, c2paSummary: object }>}
 */
export async function signAsset(args) {
	const {
		inputPath,
		outputPath: outArg,
		mimeType: mimeArg,
		creatorName,
		organization,
		toolUsed,
		isAiGenerated,
		cawgIdentityUrl,
		cawgIdentityName,
		trainingMiningOptOut,
		certificatePath,
		privateKeyPath
	} = args;

	if (!inputPath || !existsSync(inputPath)) {
		throw new Error(`Input file does not exist: ${inputPath}`);
	}
	if (!certificatePath || !existsSync(certificatePath)) {
		throw new Error(`Certificate path missing or not found: ${certificatePath}`);
	}
	if (!privateKeyPath || !existsSync(privateKeyPath)) {
		throw new Error(`Private key path missing or not found: ${privateKeyPath}`);
	}

	const mimeType = mimeArg || getMimeType(inputPath);
	const outputPath = outArg || signedOutputPath(inputPath);

	if (existsSync(outputPath)) {
		throw new Error(`Refusing to overwrite existing signed file at ${outputPath}. Delete it first or pass an explicit outputPath.`);
	}

	// The native binding is optional (see c2pa-node-loader.js). Reading has a
	// c2patool fallback; signing through c2patool arrives with output signing.
	const { module: c2paNode, reason } = await loadC2paNode();
	if (!c2paNode) {
		throw new Error(`Signing is unavailable on this machine: the c2pa-node native module could not be loaded (${reason}). On Windows this is usually Smart App Control blocking an unsigned binary.`);
	}
	const { createC2pa, ManifestBuilder, createTestSigner } = c2paNode;
	const signer = await createTestSigner({ certificatePath, privateKeyPath });
	// thumbnail: false — Sharp can't generate thumbnails for audio (or many
	// non-image formats); attempting it throws. Image assets keep the default
	// thumbnail behaviour.
	const c2paOpts = isAudioMime(mimeType) ? { signer, thumbnail: false } : { signer };
	const c2pa = createC2pa(c2paOpts);

	const manifest = new ManifestBuilder({
		claim_generator: 'provenance-tracker/0.2',
		format: mimeType,
		title: path.basename(inputPath),
		assertions: buildAssertions({ creatorName, organization, toolUsed, isAiGenerated, trainingMiningOptOut, cawgIdentityUrl, cawgIdentityName })
	});

	log.info(`signing ${path.basename(inputPath)} (${mimeType}) → ${path.basename(outputPath)}`);
	await c2pa.sign({
		asset: { mimeType, path: inputPath },
		options: { outputPath },
		manifest
	});

	const [fileHash, fileSize, c2paSummary] = await Promise.all([
		computeFileHash(outputPath),
		getFileSize(outputPath),
		extractC2pa(outputPath)
	]);

	return { signedPath: outputPath, fileHash, fileSize, mimeType, c2paSummary };
}

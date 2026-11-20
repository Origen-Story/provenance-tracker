// IO for phase 4c: creator statements, signing outputs and assets, and the
// record of every signed copy. The manifest itself is built by build.js
// (pure); c2patool.js runs the binary.
//
// The asset row is never repointed at a signed copy. It keeps the original's
// path and hash, so a timeline that uses the original still matches it, and
// the signed copy is a row in `signatures`.
import { existsSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import path from 'node:path';
import { db } from '../../db/index.js';
import { creatorStatements, signatures, producedAssets } from '../../db/schema.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import { computeFileHash, getFileSize } from '../core/file-utils.js';
import { tableFor } from '../relationships/relationships.js';
import { collectSignals } from '../origin/origin.js';
import { getTimeline, listTimelines } from '../timeline/timelines.js';
import { buildOutputManifest, buildCreatorStatement, versionedSignedPath, assetKey, placedAssetKeys, sidecarPathFor, planSidecar } from './build.js';
import { interpretReport } from './verify.js';
import { signWithC2patool, storableDefinition } from './c2patool.js';
import { GENERATOR } from './generator.js';
import { buildPublicExport, publicExportFileName } from './public-export.js';
import { signAsset } from '../extraction/c2pa-sign.js';

const TEXT_LIMIT = 4000;

export async function getStatement(producedAssetId) {
	const [row] = await db.select().from(creatorStatements).where(eq(creatorStatements.producedAssetId, producedAssetId)).limit(1);
	return row || null;
}

export async function saveStatement(projectId, producedAssetId, { text, authorName, organization, softwareAgent } = {}) {
	const values = {
		text: String(text || '').trim().slice(0, TEXT_LIMIT),
		authorName: String(authorName || '').trim().slice(0, 200),
		organization: String(organization || '').trim().slice(0, 200),
		softwareAgent: String(softwareAgent || '').trim().slice(0, 200)
	};
	const [row] = await db.insert(creatorStatements)
		.values({ projectId, producedAssetId, ...values })
		.onConflictDoUpdate({ target: creatorStatements.producedAssetId, set: { ...values, updatedAt: sql`now()` } })
		.returning();
	return row;
}

// Everything the builder needs for one output, read fresh.
export async function loadOutputContext(producedAssetId) {
	const [output] = await db.select().from(producedAssets).where(eq(producedAssets.id, producedAssetId)).limit(1);
	if (!output) throw new Error('Output not found');
	const tls = await listTimelines({ projectId: output.projectId, producedAssetId });
	const latest = tls[tls.length - 1];
	const timeline = latest ? await getTimeline(latest.id) : null;
	const segments = timeline?.segments || [];
	const assets = new Map();
	for (const k of placedAssetKeys(segments, assetKey('produced', output.id))) {
		const [type, id] = k.split(':');
		const table = tableFor(type);
		const [row] = await db.select().from(table).where(eq(table.id, Number(id))).limit(1);
		if (!row) continue;
		const { c2paSummary } = await collectSignals(type, row);
		assets.set(k, { ...row, type, c2paSummary });
	}
	return { output: { ...output, type: 'produced' }, timeline, composition: timeline?.breakdown?.composition || null, segments, assets };
}

function statementInput(saved, project) {
	return {
		text: saved?.text || '',
		authorName: saved?.authorName || '',
		organization: saved?.organization || '',
		softwareAgent: saved?.softwareAgent || '',
		identityUrl: project?.cawgIdentityUrl || ''
	};
}

/**
 * The statement exactly as it would be signed now, for the Statement tab.
 */
export async function previewStatement(project, producedAssetId) {
	const ctx = await loadOutputContext(producedAssetId);
	const saved = await getStatement(producedAssetId);
	if (!ctx.composition) return { saved, statement: null, reason: 'Import the timeline first: the statement is built from it.' };
	const statement = buildCreatorStatement({ ...ctx, statement: statementInput(saved, project), statedAt: null });
	return { saved, statement };
}

function requireSigner(project) {
	if (!project?.certificatePath || !project?.privateKeyPath) {
		throw Object.assign(new Error('This project has no signing certificate. Set the certificate and key paths in Project Settings (npm run cert:generate makes a dev pair).'), { status: 400 });
	}
	if (!existsSync(project.certificatePath) || !existsSync(project.privateKeyPath)) {
		throw Object.assign(new Error('The certificate or key path in Project Settings does not point at a file.'), { status: 400 });
	}
}

async function recordSignature({ projectId, assetType, assetId, kind, version, sourcePath, signedPath, definition, report, statement }) {
	const verification = interpretReport(report);
	const [sourceHash, signedHash, signedSize] = await Promise.all([computeFileHash(sourcePath), computeFileHash(signedPath), getFileSize(signedPath)]);
	const [row] = await db.insert(signatures).values({
		projectId, assetType, assetId, kind, version,
		sourcePath, sourceHash, signedPath, signedHash, signedSize,
		definitionJson: JSON.stringify(definition),
		reportJson: report ? JSON.stringify(report) : null,
		statementJson: statement ? JSON.stringify(statement) : null,
		status: verification.status,
		signerName: verification.signer?.commonName || '',
		signerIssuer: verification.signer?.issuer || '',
		timestamped: verification.timestamped
	}).returning();
	return withVerification(row);
}

function withVerification(row) {
	let report = null;
	try { report = row.reportJson ? JSON.parse(row.reportJson) : null; } catch { report = null; }
	let statement = null;
	try { statement = row.statementJson ? JSON.parse(row.statementJson) : null; } catch { statement = null; }
	const { reportJson, definitionJson, statementJson, ...rest } = row;
	return { ...rest, verification: interpretReport(report), statement, signedFileExists: existsSync(row.signedPath) };
}

/**
 * Sign a finished edit: build the manifest from its timeline and statement,
 * sign a new versioned copy beside the export, read it back, record it.
 */
export async function signOutput(project, producedAssetId, { timestampUrl = '' } = {}) {
	requireSigner(project);
	const ctx = await loadOutputContext(producedAssetId);
	if (ctx.output.projectId !== project.id) throw Object.assign(new Error('Output not found in the active project'), { status: 404 });
	if (!existsSync(ctx.output.filePath)) throw Object.assign(new Error('The export file is not at its recorded path.'), { status: 400 });
	const saved = await getStatement(producedAssetId);
	if (!saved?.text) throw Object.assign(new Error('Write and save the creator statement before signing.'), { status: 400 });

	const { definition, ingredients, statement } = buildOutputManifest({ ...ctx, statement: statementInput(saved, project), statedAt: new Date().toISOString(), generator: GENERATOR });
	const { path: outputPath, version } = versionedSignedPath(ctx.output.filePath, existsSync);
	const { report } = await signWithC2patool({
		inputPath: ctx.output.filePath, outputPath, definition, ingredients,
		certificatePath: project.certificatePath, privateKeyPath: project.privateKeyPath, timestampUrl
	});
	return recordSignature({
		projectId: project.id, assetType: 'produced', assetId: producedAssetId, kind: 'output', version,
		sourcePath: ctx.output.filePath, signedPath: outputPath, definition: storableDefinition(definition), report, statement
	});
}

/**
 * Sign one source asset at ingest (D13): the manifest goes into a .c2pa
 * sidecar beside the file; the file and the asset row are left as they are.
 * Signing again archives the previous sidecar as <name>.v<N>.c2pa first.
 */
export async function signOneAsset(project, type, id, opts = {}) {
	requireSigner(project);
	const table = tableFor(type);
	const [row] = await db.select().from(table).where(eq(table.id, id)).limit(1);
	if (!row || row.projectId !== project.id) throw Object.assign(new Error('Asset not found in the active project'), { status: 404 });
	if (!existsSync(row.filePath)) throw Object.assign(new Error('The file is not at its recorded path. Run the integrity check in Settings.'), { status: 400 });

	const previous = await db.select().from(signatures).where(and(eq(signatures.assetType, type), eq(signatures.assetId, id)));
	const target = sidecarPathFor(row.filePath);
	const plan = planSidecar({
		inputPath: row.filePath,
		sidecarExists: existsSync(target),
		currentSignature: previous.find(p => samePath(p.signedPath, target)) || null,
		latestVersion: previous.reduce((m, p) => Math.max(m, p.version || 0), 0)
	});
	if (plan.action === 'refuse') throw Object.assign(new Error(plan.reason), { status: 409 });
	if (plan.action === 'rotate') {
		if (existsSync(plan.archive.to)) throw Object.assign(new Error(`Cannot archive the previous signature: ${path.basename(plan.archive.to)} already exists.`), { status: 409 });
		await rename(plan.archive.from, plan.archive.to);
	}

	let result;
	try {
		result = await signAsset({
			inputPath: row.filePath,
			sidecarPath: plan.sidecarPath,
			originClass: row.originClass,
			creatorName: opts.creatorName,
			organization: opts.organization,
			toolUsed: opts.toolUsed,
			isAiGenerated: !!opts.isAiGenerated,
			identityUrl: opts.identityUrl || project.cawgIdentityUrl || '',
			trainingMiningOptOut: opts.trainingMiningOptOut !== false,
			certificatePath: project.certificatePath,
			privateKeyPath: project.privateKeyPath,
			timestampUrl: opts.timestampUrl || ''
		});
	} catch (err) {
		// Put the previous signature back where readers look for it.
		if (plan.action === 'rotate' && !existsSync(plan.archive.from)) await rename(plan.archive.to, plan.archive.from).catch(() => {});
		throw err;
	}
	if (plan.action === 'rotate') {
		await db.update(signatures).set({ signedPath: plan.archive.to }).where(eq(signatures.id, plan.archive.signatureId));
	}
	return recordSignature({
		projectId: project.id, assetType: type, assetId: id, kind: 'asset', version: plan.version,
		sourcePath: row.filePath, signedPath: result.sidecarPath, definition: result.definition, report: result.report, statement: null
	});
}

const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

export async function listSignatures(type, id) {
	const rows = await db.select().from(signatures)
		.where(and(eq(signatures.assetType, type), eq(signatures.assetId, id)))
		.orderBy(desc(signatures.createdAt));
	return rows.map(withVerification);
}

/**
 * The public export (phase 4d) of one signed copy of an output: the latest,
 * or the one named by `signatureId`. Built from the signature record alone.
 */
export async function publicExportFor(project, producedAssetId, { signatureId } = {}) {
	const where = [
		eq(signatures.projectId, project.id),
		eq(signatures.assetType, 'produced'),
		eq(signatures.assetId, producedAssetId),
		eq(signatures.kind, 'output')
	];
	if (signatureId != null) where.push(eq(signatures.id, signatureId));
	const [row] = await db.select().from(signatures).where(and(...where)).orderBy(desc(signatures.createdAt)).limit(1);
	if (!row) throw Object.assign(new Error(signatureId != null ? 'That signed copy was not found for this output.' : 'Sign the output first: the public export is made from a signed copy.'), { status: 404 });
	try {
		return { data: buildPublicExport({ signature: row, generatedAt: new Date().toISOString(), generator: GENERATOR }), fileName: publicExportFileName(row.signedPath) };
	} catch (err) {
		throw Object.assign(err, { status: 409 });
	}
}

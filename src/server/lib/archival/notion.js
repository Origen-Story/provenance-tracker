import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import mime from 'mime-types';
import { createLogger } from '../logger.js';

const log = createLogger('notion');

function truncName(str, max = 100) {
	return str && str.length > max ? str.slice(0, max) : str;
}

// Notion caps rich_text.content at 2000 chars per rich_text item. Truncate with
// an ellipsis so oversize captions sync instead of failing validation.
function truncRichText(str, max = 2000) {
	if (!str || str.length <= max) return str;
	return str.slice(0, max - 1) + '…';
}

export function isNotionConfigured(project) {
	return !!(project?.notionEnabled && project?.notionArchivalDbId && process.env.NOTION_API_KEY);
}

let _Client;
async function getNotionClient() {
	if (!_Client) {
		const mod = await import('@notionhq/client');
		_Client = mod.Client;
	}
	return new _Client({ auth: process.env.NOTION_API_KEY, notionVersion: '2026-03-11' });
}

// Cache of notion property types per database. Avoids repeated schema lookups
// on every single-asset sync while letting multi-asset loops share one hit.
// Keyed by database_id. Reset on process restart — so adding a new property in
// Notion requires a server restart to be detected, which is fine for rare config.
const _dbPropTypes = new Map();

// At Notion API version 2026-03-11 and later, database property schemas live on
// data sources, not on the database itself (databases can have multiple data
// sources). databases.retrieve returns { data_sources: [{ id, name }] }; we then
// fetch the first data source's properties to look up the type.
async function getGroupPropertyType(notion, databaseId, propertyName) {
	if (!propertyName) return null;
	const cacheKey = `${databaseId}:${propertyName}`;
	if (_dbPropTypes.has(cacheKey)) return _dbPropTypes.get(cacheKey);
	try {
		const db = await notion.databases.retrieve({ database_id: databaseId });
		const dataSourceId = db?.data_sources?.[0]?.id;
		let type = null;
		if (dataSourceId) {
			const ds = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
			type = ds?.properties?.[propertyName]?.type || null;
		} else if (db?.properties) {
			// Fallback for older API versions where schema still lives on the database.
			type = db.properties[propertyName]?.type || null;
		}
		_dbPropTypes.set(cacheKey, type);
		if (!type) log.warn(`Notion property "${propertyName}" not found on database ${databaseId} — group sync will be skipped.`);
		return type;
	} catch (err) {
		log.warn(`Could not retrieve Notion database schema to detect "${propertyName}" type: ${err.message}`);
		return null;
	}
}

export async function syncAssetToNotion(asset, project) {
	if (!isNotionConfigured(project)) {
		throw new Error('Notion integration is not configured for this project.');
	}

	const notion = await getNotionClient();
	const groupPropType = await getGroupPropertyType(notion, project.notionArchivalDbId, project.notionGroupProperty);
	const properties = buildProperties(asset, project, groupPropType);

	// Upload local file to Notion for reliable gallery thumbnails.
	// If Notion rejects the upload (e.g. exceeds the workspace plan's file-size cap),
	// degrade gracefully — the page still syncs with metadata and Source URL, which is
	// strictly better than failing the whole asset.
	let fileUploadId = null;
	try {
		fileUploadId = await uploadImage(notion, asset);
	} catch (err) {
		if (isFileTooLargeError(err)) {
			log.warn(`Skipping Notion image upload for "${asset.name || asset.id}" — file too large for workspace (${asset.fileSize} bytes). Syncing metadata only.`);
		} else {
			throw err;
		}
	}
	if (fileUploadId) {
		properties['Image'] = {
			files: [{
				type: 'file_upload',
				file_upload: { id: fileUploadId },
				name: truncName(asset.filename || asset.name || 'image')
			}]
		};
	}

	if (asset.notionPageId) {
		try {
			await notion.pages.update({ page_id: asset.notionPageId, properties });
			return { notionPageId: asset.notionPageId };
		} catch (err) {
			// Page may have been moved/deleted — create a fresh one instead
			if (err.code === 'validation_error' || err.code === 'object_not_found') {
				log.info(`Page ${asset.notionPageId} is stale (${err.code}), creating new page`);
			} else {
				throw err;
			}
		}
	}

	const page = await notion.pages.create({
		parent: { database_id: project.notionArchivalDbId },
		properties
	});
	return { notionPageId: page.id };
}

// Notion upload mode thresholds. single_part caps at 20 MiB; above that the API
// requires multi_part with 5–20 MiB chunks. Workspace plans may enforce a stricter
// cap (free is 5 MiB); caller catches file-too-large errors and degrades gracefully.
const SINGLE_PART_MAX_BYTES = 20 * 1024 * 1024;
const MULTI_PART_CHUNK_BYTES = 10 * 1024 * 1024;

function isFileTooLargeError(err) {
	const msg = (err?.message || '').toLowerCase();
	const body = (err?.body || '').toLowerCase();
	return msg.includes('too large') || body.includes('too large') || msg.includes('file size') || err?.status === 413;
}

/**
 * Upload the asset's local file to Notion.
 * Returns a fileUploadId, or null if no file exists on disk.
 */
async function uploadImage(notion, asset) {
	if (!asset.filePath || !existsSync(asset.filePath)) {
		return null;
	}

	const filename = asset.filename || path.basename(asset.filePath);
	const contentType = mime.lookup(asset.filePath) || 'application/octet-stream';
	const fileData = await readFile(asset.filePath);

	if (fileData.length <= SINGLE_PART_MAX_BYTES) {
		const upload = await notion.fileUploads.create({ mode: 'single_part' });
		await notion.fileUploads.send({
			file_upload_id: upload.id,
			file: {
				filename,
				data: new Blob([fileData], { type: contentType })
			}
		});
		return upload.id;
	}

	const numberOfParts = Math.ceil(fileData.length / MULTI_PART_CHUNK_BYTES);
	const upload = await notion.fileUploads.create({
		mode: 'multi_part',
		number_of_parts: numberOfParts,
		filename,
		content_type: contentType
	});

	for (let i = 0; i < numberOfParts; i++) {
		const start = i * MULTI_PART_CHUNK_BYTES;
		const end = Math.min(start + MULTI_PART_CHUNK_BYTES, fileData.length);
		const chunk = fileData.subarray(start, end);
		// part_number MUST be a string — the SDK's buildFormData only appends
		// string and object values; numbers are silently dropped, so Notion
		// rejects the part with "part_number parameter is missing".
		await notion.fileUploads.send({
			file_upload_id: upload.id,
			part_number: String(i + 1),
			file: {
				filename,
				data: new Blob([chunk], { type: contentType })
			}
		});
	}

	await notion.fileUploads.complete({ file_upload_id: upload.id });
	return upload.id;
}

function buildProperties(asset, project, groupPropType) {
	const props = {
		Name: { title: [{ text: { content: asset.name || 'Untitled' } }] }
	};

	if (asset.caption) props['Caption'] = { rich_text: [{ text: { content: truncRichText(asset.caption) } }] };
	if (asset.sourceUrl) props['Source URL'] = { url: asset.sourceUrl };

	const creatorArchive = [asset.creator, asset.institution].filter(Boolean).join(' / ');
	if (creatorArchive) props['Creator / Archive'] = { rich_text: [{ text: { content: truncRichText(creatorArchive) } }] };

	if (asset.license) props['License'] = { select: { name: asset.license } };
	if (asset.accessDate) props['Access Date'] = { date: { start: asset.accessDate } };
	if (asset.medium) {
		const label = asset.medium.charAt(0).toUpperCase() + asset.medium.slice(1);
		props['Medium'] = { select: { name: label } };
	}

	// The notionGroupProperty records where the search originally found this asset —
	// an audit/provenance record, NOT a classification. The user's own triage field
	// (typically multi_select "Stop") is fully user-owned and must never be touched
	// by sync, or manual edits would get wiped on every re-sync.
	//
	// Supported column types for notionGroupProperty:
	//   - select      → write { select: { name } }
	//   - rich_text   → write { rich_text: [{ text: { content } }] }
	//   - multi_select, title, anything else → skipped (log once)
	if (project?.notionGroupProperty && asset.searchGroupName) {
		if (groupPropType === 'select') {
			props[project.notionGroupProperty] = { select: { name: asset.searchGroupName } };
		} else if (groupPropType === 'rich_text') {
			props[project.notionGroupProperty] = { rich_text: [{ text: { content: truncRichText(asset.searchGroupName) } }] };
		}
		// Other types: deliberately skip to avoid clobbering user-managed fields.
	}

	// Image is handled by syncAssetToNotion via file upload
	return props;
}

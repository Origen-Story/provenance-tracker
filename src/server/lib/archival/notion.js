import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import mime from 'mime-types';
import { createLogger } from '../logger.js';

const log = createLogger('notion');

function truncName(str, max = 100) {
	return str && str.length > max ? str.slice(0, max) : str;
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

export async function syncAssetToNotion(asset, project) {
	if (!isNotionConfigured(project)) {
		throw new Error('Notion integration is not configured for this project.');
	}

	const notion = await getNotionClient();
	const properties = buildProperties(asset, project);

	// Upload local file to Notion for reliable gallery thumbnails
	const fileUploadId = await uploadImage(notion, asset);
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

function buildProperties(asset, project) {
	const props = {
		Name: { title: [{ text: { content: asset.name || 'Untitled' } }] }
	};

	if (asset.caption) props['Caption'] = { rich_text: [{ text: { content: asset.caption } }] };
	if (asset.sourceUrl) props['Source URL'] = { url: asset.sourceUrl };

	const creatorArchive = [asset.creator, asset.institution].filter(Boolean).join(' / ');
	if (creatorArchive) props['Creator / Archive'] = { rich_text: [{ text: { content: creatorArchive } }] };

	if (asset.license) props['License'] = { select: { name: asset.license } };
	if (asset.accessDate) props['Access Date'] = { date: { start: asset.accessDate } };
	if (asset.medium) {
		const label = asset.medium.charAt(0).toUpperCase() + asset.medium.slice(1);
		props['Medium'] = { select: { name: label } };
	}

	if (project?.notionGroupProperty && asset.searchGroupName) {
		props[project.notionGroupProperty] = { select: { name: asset.searchGroupName } };
	}

	// Image is handled by syncAssetToNotion via file upload
	return props;
}

import { db } from '../db/index.js';
import { assets } from '../db/schema.js';
import { like, desc } from 'drizzle-orm';
import { ASSET_TYPES } from '../constants.js';

export function getTypeAbbreviation(assetType) {
	const found = ASSET_TYPES.find((t) => t.value === assetType);
	return found ? found.abbr : 'OTH';
}

export function generateAssetId(prefix, assetType) {
	const abbr = getTypeAbbreviation(assetType);
	const pattern = `${prefix}-${abbr}-%`;

	const latest = db
		.select({ assetId: assets.assetId })
		.from(assets)
		.where(like(assets.assetId, pattern))
		.orderBy(desc(assets.assetId))
		.limit(1)
		.get();

	let nextNum = 1;
	if (latest) {
		const parts = latest.assetId.split('-');
		const num = parseInt(parts[parts.length - 1], 10);
		if (!isNaN(num)) nextNum = num + 1;
	}

	return `${prefix}-${abbr}-${String(nextNum).padStart(3, '0')}`;
}

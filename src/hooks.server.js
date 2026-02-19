import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from '$lib/core/db/index.js';
import { projectConfig } from '$lib/core/db/schema.js';
import { eq } from 'drizzle-orm';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, 'lib/core/db/migrations');

migrate(db, { migrationsFolder });

const existing = db.select().from(projectConfig).limit(1).get();
if (!existing) {
	db.insert(projectConfig)
		.values({
			projectName: "Gaia's Atmosphere",
			author: 'Matt Ford',
			organization: 'Origen Story',
			assetIdPrefix: 'GAIA'
		})
		.run();
}

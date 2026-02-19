import { db } from '$lib/core/db/index.js';
import { projectConfig } from '$lib/core/db/schema.js';
import { eq } from 'drizzle-orm';

export function getProjectConfig() {
	return db.select().from(projectConfig).limit(1).get() || null;
}

export function updateProjectConfig(data) {
	const existing = getProjectConfig();
	if (!existing) {
		return db.insert(projectConfig).values(data).returning().get();
	}
	return db
		.update(projectConfig)
		.set({ ...data, updatedAt: new Date().toISOString() })
		.where(eq(projectConfig.id, existing.id))
		.returning()
		.get();
}

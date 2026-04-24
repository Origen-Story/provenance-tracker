import { db } from '../db/index.js';
import { projects, assets } from '../db/schema.js';
import { eq, count, sql } from 'drizzle-orm';
import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import path from 'path';

const MANAGED_FOLDERS = ['archival-images', 'ai-assets', 'produced-assets'];

/**
 * Create managed storage directories for a project.
 * Only runs if the project has a storagePath set.
 */
export async function ensureStorageFolders(project) {
	if (!project?.storagePath) return;
	for (const folder of MANAGED_FOLDERS) {
		const dir = path.join(project.storagePath, folder);
		if (!existsSync(dir)) {
			await mkdir(dir, { recursive: true });
		}
	}
}

export async function listProjects() {
	return db.select().from(projects).orderBy(projects.createdAt);
}

export async function getActiveProject() {
	const [row] = await db.select().from(projects).where(eq(projects.isActive, true)).limit(1);
	return row || null;
}

export async function getProject(id) {
	const [row] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
	return row || null;
}

export async function createProject(data) {
	await db.update(projects).set({ isActive: false });
	const [row] = await db.insert(projects).values({
		name: data.name || 'Untitled Project',
		description: data.description || '',
		assetIdPrefix: data.assetIdPrefix || 'PROJ',
		modules: data.modules || '["archival"]',
		storagePath: data.storagePath || '',
		notionEnabled: !!data.notionEnabled,
		notionArchivalDbId: data.notionArchivalDbId || '',
		notionGroupProperty: data.notionGroupProperty || '',
		isActive: true
	}).returning();
	await ensureStorageFolders(row);
	return row;
}

export async function setActiveProject(id) {
	await db.update(projects).set({ isActive: false });
	await db.update(projects)
		.set({ isActive: true, updatedAt: sql`now()` })
		.where(eq(projects.id, id));
	const project = await getProject(id);
	await ensureStorageFolders(project);
	return project;
}

export async function updateProject(id, data) {
	const updates = {
		name: data.name,
		description: data.description,
		assetIdPrefix: data.assetIdPrefix,
		modules: data.modules,
		notionEnabled: !!data.notionEnabled,
		notionArchivalDbId: data.notionArchivalDbId,
		updatedAt: sql`now()`
	};
	if (data.storagePath !== undefined) updates.storagePath = data.storagePath;
	if (data.notionGroupProperty !== undefined) updates.notionGroupProperty = data.notionGroupProperty;
	await db.update(projects).set(updates).where(eq(projects.id, id));
	const project = await getProject(id);
	await ensureStorageFolders(project);
	return project;
}

export async function deleteProject(id) {
	const [{ total }] = await db.select({ total: count() })
		.from(assets)
		.where(eq(assets.projectId, id));
	if (total > 0) {
		throw new Error(`Cannot delete project with ${total} asset(s). Delete assets first.`);
	}
	await db.delete(projects).where(eq(projects.id, id));
}

export function projectHasModule(project, moduleName) {
	try {
		return JSON.parse(project?.modules || '[]').includes(moduleName);
	} catch {
		return false;
	}
}

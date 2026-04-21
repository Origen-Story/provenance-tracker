import { Router } from 'express';
import { getActiveProject } from '../lib/projects.js';
import {
	listGroups, getGroup, createGroup, updateGroup,
	deleteGroup, reassignAndDeleteGroup, getGroupUsage,
	importGroups, exportGroups
} from '../lib/search/groups.js';

const router = Router();

// List groups for active project (with derived counts + usage)
router.get('/', async (req, res) => {
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });
	try {
		const groups = await listGroups(project.id);
		res.json(groups);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Export as JSON — plain array, safe to round-trip through import
router.get('/export', async (req, res) => {
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });
	try {
		const groups = await exportGroups(project.id);
		res.setHeader('Content-Type', 'application/json; charset=utf-8');
		res.setHeader('Content-Disposition', `attachment; filename="search-groups-${project.name.replace(/\W+/g, '_')}.json"`);
		res.send(JSON.stringify(groups, null, 2));
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Get single group
router.get('/:id', async (req, res) => {
	try {
		const group = await getGroup(parseInt(req.params.id));
		if (!group) return res.status(404).json({ error: 'Group not found' });
		res.json(group);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Create
router.post('/', async (req, res) => {
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });
	try {
		const { group, ignoredFields } = await createGroup(project.id, req.body || {});
		res.status(201).json({ group, ignoredFields });
	} catch (err) {
		res.status(400).json({ error: err.message });
	}
});

// Update
router.patch('/:id', async (req, res) => {
	try {
		const { group, ignoredFields } = await updateGroup(parseInt(req.params.id), req.body || {});
		if (!group) return res.status(404).json({ error: 'Group not found' });
		res.json({ group, ignoredFields });
	} catch (err) {
		res.status(400).json({ error: err.message });
	}
});

// Check usage (called by UI before showing delete dialog)
router.get('/:id/usage', async (req, res) => {
	try {
		const group = await getGroup(parseInt(req.params.id));
		if (!group) return res.status(404).json({ error: 'Group not found' });
		const usage = await getGroupUsage(group.projectId, group.groupId);
		res.json(usage);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Delete — blocking if candidates/assets reference this group
router.delete('/:id', async (req, res) => {
	try {
		await deleteGroup(parseInt(req.params.id));
		res.json({ deleted: true });
	} catch (err) {
		if (err.code === 'GROUP_IN_USE') {
			return res.status(409).json({ error: err.message, usage: err.usage });
		}
		res.status(500).json({ error: err.message });
	}
});

// Reassign candidates/assets to another group, then delete the source
router.post('/:id/reassign-delete', async (req, res) => {
	const { targetGroupId } = req.body || {};
	if (!targetGroupId) return res.status(400).json({ error: 'targetGroupId required' });
	try {
		await reassignAndDeleteGroup(parseInt(req.params.id), targetGroupId);
		res.json({ deleted: true });
	} catch (err) {
		res.status(400).json({ error: err.message });
	}
});

// Bulk import
router.post('/import', async (req, res) => {
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });
	const { groups, mode = 'merge' } = req.body || {};
	if (!Array.isArray(groups)) return res.status(400).json({ error: 'groups array required' });
	if (!['merge', 'replace'].includes(mode)) return res.status(400).json({ error: 'mode must be "merge" or "replace"' });
	try {
		const result = await importGroups(project.id, groups, { mode });
		res.json(result);
	} catch (err) {
		res.status(400).json({ error: err.message });
	}
});

export default router;

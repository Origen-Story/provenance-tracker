import { Router } from 'express';
import { listProjects, getActiveProject, getProject, createProject, setActiveProject, updateProject, deleteProject } from '../lib/projects.js';
import { toProjectResponse } from '../lib/core/project-response.js';
import { checkProjectIntegrity } from '../lib/integrity.js';
import { getDashboardStats } from '../lib/dashboard.js';

const router = Router();

// Every project leaves through toProjectResponse: the row holds the signing
// certificate and key paths, and a response carries only `signingConfigured`.

router.get('/', async (req, res) => {
	const projects = await listProjects();
	res.json(projects.map(toProjectResponse));
});

router.get('/active', async (req, res) => {
	const project = await getActiveProject();
	res.json(toProjectResponse(project));
});

router.get('/dashboard', async (req, res) => {
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });
	try {
		const stats = await getDashboardStats(project.id);
		res.json(stats);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

router.get('/integrity', async (req, res) => {
	const project = await getActiveProject();
	if (!project) return res.status(400).json({ error: 'No active project' });
	try {
		const result = await checkProjectIntegrity(project);
		res.json(result);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

router.get('/:id', async (req, res) => {
	const project = await getProject(parseInt(req.params.id));
	if (!project) return res.status(404).json({ error: 'Project not found' });
	res.json(toProjectResponse(project));
});

router.post('/', async (req, res) => {
	try {
		const project = await createProject(req.body);
		res.status(201).json(toProjectResponse(project));
	} catch (err) {
		res.status(400).json({ error: err.message });
	}
});

router.post('/:id/activate', async (req, res) => {
	const project = await setActiveProject(parseInt(req.params.id));
	if (!project) return res.status(404).json({ error: 'Project not found' });
	res.json(toProjectResponse(project));
});

router.patch('/:id', async (req, res) => {
	const project = await getProject(parseInt(req.params.id));
	if (!project) return res.status(404).json({ error: 'Project not found' });
	const updated = await updateProject(parseInt(req.params.id), req.body);
	res.json(toProjectResponse(updated));
});

router.delete('/:id', async (req, res) => {
	try {
		await deleteProject(parseInt(req.params.id));
		res.json({ success: true });
	} catch (err) {
		res.status(400).json({ error: err.message });
	}
});

export default router;

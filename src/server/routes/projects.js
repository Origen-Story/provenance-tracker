import { Router } from 'express';
import { listProjects, getActiveProject, getProject, createProject, setActiveProject, updateProject, deleteProject } from '../lib/projects.js';
import { checkProjectIntegrity } from '../lib/integrity.js';
import { getDashboardStats } from '../lib/dashboard.js';

const router = Router();

router.get('/', async (req, res) => {
	const projects = await listProjects();
	res.json(projects);
});

router.get('/active', async (req, res) => {
	const project = await getActiveProject();
	res.json(project);
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
	res.json(project);
});

router.post('/', async (req, res) => {
	try {
		const project = await createProject(req.body);
		res.status(201).json(project);
	} catch (err) {
		res.status(400).json({ error: err.message });
	}
});

router.post('/:id/activate', async (req, res) => {
	const project = await setActiveProject(parseInt(req.params.id));
	if (!project) return res.status(404).json({ error: 'Project not found' });
	res.json(project);
});

router.patch('/:id', async (req, res) => {
	const project = await getProject(parseInt(req.params.id));
	if (!project) return res.status(404).json({ error: 'Project not found' });
	const updated = await updateProject(parseInt(req.params.id), req.body);
	res.json(updated);
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

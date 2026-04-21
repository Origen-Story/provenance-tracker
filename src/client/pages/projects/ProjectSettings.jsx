import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import PageHeader from '../../components/layout/PageHeader.jsx';

export default function ProjectSettings() {
	const { id } = useParams();
	const navigate = useNavigate();
	const qc = useQueryClient();

	const { data: project, isLoading } = useQuery({
		queryKey: ['project', id],
		queryFn: () => fetch(`/api/projects/${id}`).then(r => r.json())
	});

	const [name, setName] = useState('');
	const [description, setDescription] = useState('');
	const [prefix, setPrefix] = useState('');
	const [modules, setModules] = useState([]);
	const [storagePath, setStoragePath] = useState('');
	const [notionEnabled, setNotionEnabled] = useState(false);
	const [notionDbId, setNotionDbId] = useState('');
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		if (project) {
			setName(project.name || '');
			setDescription(project.description || '');
			setPrefix(project.assetIdPrefix || '');
			setModules(() => { try { return JSON.parse(project.modules || '[]'); } catch { return []; } });
			setStoragePath(project.storagePath || '');
			setNotionEnabled(project.notionEnabled || false);
			setNotionDbId(project.notionArchivalDbId || '');
		}
	}, [project]);

	const update = useMutation({
		mutationFn: (data) => fetch(`/api/projects/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(data)
		}).then(r => r.json()),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['projects'] });
			qc.invalidateQueries({ queryKey: ['activeProject'] });
			qc.invalidateQueries({ queryKey: ['project', id] });
			setSaved(true);
			setTimeout(() => setSaved(false), 3000);
		}
	});

	const del = useMutation({
		mutationFn: () => fetch(`/api/projects/${id}`, { method: 'DELETE' }).then(r => r.json()),
		onSuccess: (data) => {
			if (data.error) { alert(data.error); return; }
			qc.invalidateQueries({ queryKey: ['projects'] });
			navigate('/projects');
		}
	});

	function toggleModule(mod) {
		setModules(prev => prev.includes(mod) ? prev.filter(m => m !== mod) : [...prev, mod]);
	}

	function handleSave(e) {
		e.preventDefault();
		update.mutate({
			name, description,
			assetIdPrefix: prefix.toUpperCase(),
			storagePath,
			modules: JSON.stringify(modules),
			notionEnabled,
			notionArchivalDbId: notionDbId
		});
	}

	if (isLoading) return <p className="text-text-secondary text-sm">Loading…</p>;

	return (
		<div>
			<div className="mb-6">
				<div className="flex items-center gap-2 text-sm text-text-secondary mb-1">
					<Link to="/projects" className="hover:text-text-primary transition-colors">Projects</Link>
					<span>/</span>
					<span className="text-text-primary">{project?.name}</span>
				</div>
				<h2 className="text-2xl font-bold text-text-primary">Project Settings</h2>
			</div>

			<div className="max-w-xl space-y-8">
				{saved && <div className="bg-success/10 border border-success/30 text-success text-sm rounded-lg px-4 py-2">Settings saved.</div>}

				<form onSubmit={handleSave} className="space-y-5">
					<div>
						<label className="block text-sm font-medium text-text-primary mb-1.5">Project name</label>
						<input type="text" value={name} onChange={e => setName(e.target.value)}
							className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent" />
					</div>
					<div>
						<label className="block text-sm font-medium text-text-primary mb-1.5">Description</label>
						<textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
							className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent resize-none" />
					</div>
					<div>
						<label className="block text-sm font-medium text-text-primary mb-1.5">Asset ID prefix</label>
						<input type="text" value={prefix} onChange={e => setPrefix(e.target.value.toUpperCase())} maxLength={8}
							className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent uppercase" />
					</div>
					<div>
						<label className="block text-sm font-medium text-text-primary mb-1.5">Storage path <span className="text-text-secondary font-normal">(optional)</span></label>
						<input type="text" value={storagePath} onChange={e => setStoragePath(e.target.value)}
							placeholder="C:\Projects\my-project or leave blank for default"
							className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent font-mono text-sm" />
						<p className="text-xs text-text-secondary mt-1">Where downloaded images are saved. Defaults to <code className="bg-border/40 px-1 rounded">data/archival/images/</code> inside the app folder.</p>
					</div>

					<div>
						<p className="text-sm font-medium text-text-primary mb-2">Modules</p>
						<div className="space-y-2">
							{[{ value: 'archival', label: 'Archival Images' }, { value: 'ai_assets', label: 'AI Assets' }].map(mod => (
								<label key={mod.value} className="flex items-center gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-card-hover transition-colors">
									<input type="checkbox" checked={modules.includes(mod.value)} onChange={() => toggleModule(mod.value)} className="w-4 h-4 accent-accent" />
									<span className="text-sm text-text-primary">{mod.label}</span>
								</label>
							))}
						</div>
					</div>

					{modules.includes('archival') && (
						<div className="space-y-3 border border-border rounded-lg p-4">
							<p className="text-sm font-medium text-text-primary">Notion integration</p>
							<label className="flex items-center gap-3 cursor-pointer">
								<input type="checkbox" checked={notionEnabled} onChange={e => setNotionEnabled(e.target.checked)} className="w-4 h-4 accent-accent" />
								<span className="text-sm text-text-primary">Enable Notion sync</span>
							</label>
							{notionEnabled && (
								<div>
									<label className="block text-sm font-medium text-text-primary mb-1.5">Notion Database ID</label>
									<input type="text" value={notionDbId} onChange={e => setNotionDbId(e.target.value)}
										placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
										className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent font-mono text-sm" />
								</div>
							)}
						</div>
					)}

					<button type="submit" disabled={update.isPending}
						className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40">
						{update.isPending ? 'Saving…' : 'Save changes'}
					</button>
				</form>

				<div className="border-t border-border pt-6">
					<p className="text-sm font-medium text-danger mb-2">Danger zone</p>
					<button onClick={() => { if (confirm('Delete this project? This cannot be undone.')) del.mutate(); }}
						className="px-4 py-2 border border-danger/40 text-danger hover:bg-danger/10 rounded-lg text-sm transition-colors">
						Delete project
					</button>
				</div>
			</div>
		</div>
	);
}

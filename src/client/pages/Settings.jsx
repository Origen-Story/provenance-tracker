import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import PageHeader from '../components/layout/PageHeader.jsx';

export default function Settings() {
	const qc = useQueryClient();
	const { data: project } = useQuery({
		queryKey: ['activeProject'],
		queryFn: () => fetch('/api/projects/active').then(r => r.json())
	});

	const { data: notionStatus } = useQuery({
		queryKey: ['notionStatus'],
		queryFn: () => fetch('/api/notion/status').then(r => r.json())
	});

	const activate = useMutation({
		mutationFn: (id) => fetch(`/api/projects/${id}/activate`, { method: 'POST' }).then(r => r.json()),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['activeProject'] });
			qc.invalidateQueries({ queryKey: ['projects'] });
		}
	});

	const { data: projects } = useQuery({
		queryKey: ['projects'],
		queryFn: () => fetch('/api/projects').then(r => r.json())
	});

	return (
		<div>
			<PageHeader title="Settings" description="Project configuration and integrations" />

			<div className="space-y-6 max-w-2xl">
				{/* Active project */}
				<section className="bg-card-bg border border-border rounded-xl p-6">
					<h3 className="font-semibold text-text-primary mb-1">Active Project</h3>
					<p className="text-sm text-text-secondary mb-4">Switch between projects or edit project settings.</p>
					<div className="space-y-2">
						{projects?.map(p => (
							<div key={p.id} className={`flex items-center justify-between p-3 rounded-lg border ${p.isActive ? 'border-accent bg-accent/10' : 'border-border'}`}>
								<div>
									<p className="text-sm font-medium text-text-primary">{p.name}</p>
									{p.description && <p className="text-xs text-text-secondary">{p.description}</p>}
								</div>
								<div className="flex items-center gap-2">
									{p.isActive && <span className="text-xs text-accent font-medium">Active</span>}
									<Link to={`/projects/${p.id}/settings`}
										className="text-xs text-text-secondary hover:text-text-primary px-2 py-1 rounded border border-border hover:bg-card-hover transition-colors">
										Edit
									</Link>
									{!p.isActive && (
										<button onClick={() => activate.mutate(p.id)}
											className="text-xs text-accent hover:text-accent-hover px-2 py-1 rounded border border-accent hover:bg-accent/10 transition-colors">
											Activate
										</button>
									)}
								</div>
							</div>
						))}
					</div>
					<Link to="/projects/new"
						className="mt-4 inline-block text-sm text-accent hover:text-accent-hover">
						+ New project
					</Link>
				</section>

				{/* Notion status */}
				<section className="bg-card-bg border border-border rounded-xl p-6">
					<h3 className="font-semibold text-text-primary mb-1">Notion Integration</h3>
					<p className="text-sm text-text-secondary mb-3">
						{notionStatus?.configured
							? 'API key is configured. Notion sync is available for archival assets.'
							: 'No API key found. Set NOTION_API_KEY in your .env file to enable sync.'}
					</p>
					<div className={`inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border ${notionStatus?.configured ? 'border-success/40 bg-success/10 text-success' : 'border-border text-text-secondary'}`}>
						<span className={`w-1.5 h-1.5 rounded-full ${notionStatus?.configured ? 'bg-success' : 'bg-text-secondary'}`} />
						{notionStatus?.configured ? 'Connected' : 'Not configured'}
					</div>
				</section>

				{/* Active project modules */}
				{project && (
					<section className="bg-card-bg border border-border rounded-xl p-6">
						<h3 className="font-semibold text-text-primary mb-1">Active Modules</h3>
						<p className="text-sm text-text-secondary mb-3">Modules enabled for <span className="text-text-primary">{project.name}</span>.</p>
						<div className="flex flex-wrap gap-2">
							{JSON.parse(project.modules || '[]').map(mod => (
								<span key={mod} className="text-xs px-2.5 py-1 rounded-full bg-accent/10 text-accent border border-accent/20 capitalize">
									{mod.replace('_', ' ')}
								</span>
							))}
						</div>
						<Link to={`/projects/${project.id}/settings`} className="mt-3 inline-block text-xs text-text-secondary hover:text-text-primary underline">
							Edit project settings →
						</Link>
					</section>
				)}

				{/* Storage integrity */}
				{project && <IntegrityCheck project={project} />}
			</div>
		</div>
	);
}

function IntegrityCheck({ project }) {
	const [result, setResult] = useState(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');

	async function runCheck() {
		setLoading(true);
		setError('');
		try {
			const res = await fetch('/api/projects/integrity');
			const data = await res.json();
			if (!res.ok) { setError(data.error || 'Check failed'); return; }
			setResult(data);
		} catch (err) {
			setError(err.message);
		} finally {
			setLoading(false);
		}
	}

	const healthy = result && result.orphanFiles.length === 0 && result.missingFiles.length === 0;

	return (
		<section className="bg-card-bg border border-border rounded-xl p-6">
			<div className="flex items-start justify-between mb-1">
				<h3 className="font-semibold text-text-primary">Storage Integrity</h3>
				{result && (
					<span className={`text-xs px-2.5 py-1 rounded-full border ${
						healthy ? 'border-success/40 bg-success/10 text-success' : 'border-amber-500/40 bg-amber-500/10 text-amber-400'
					}`}>
						{healthy ? 'Healthy' : 'Issues found'}
					</span>
				)}
			</div>
			<p className="text-sm text-text-secondary mb-4">
				Check for orphan files in managed storage and missing files referenced by the database.
			</p>

			{!project.storagePath && (
				<p className="text-sm text-text-secondary italic">No storage path configured. Set one in project settings to enable integrity checks.</p>
			)}

			{project.storagePath && (
				<>
					<button onClick={runCheck} disabled={loading}
						className="px-4 py-2 bg-card-bg border border-border hover:bg-card-hover text-text-primary rounded-lg text-sm font-medium transition-colors disabled:opacity-40 flex items-center gap-2">
						{loading ? (
							<><svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeOpacity=".25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg> Checking...</>
						) : 'Run integrity check'}
					</button>

					{error && <p className="text-sm text-danger mt-3">{error}</p>}

					{result && (
						<div className="mt-4 space-y-4">
							{/* Summary */}
							<div className="grid grid-cols-3 gap-3">
								<div className="text-center p-3 rounded-lg bg-app-bg">
									<p className="text-lg font-bold text-text-primary">{result.tracked}</p>
									<p className="text-xs text-text-secondary">Tracked in DB</p>
								</div>
								<div className="text-center p-3 rounded-lg bg-app-bg">
									<p className={`text-lg font-bold ${result.orphanFiles.length > 0 ? 'text-amber-400' : 'text-text-primary'}`}>{result.orphanFiles.length}</p>
									<p className="text-xs text-text-secondary">Orphan files</p>
								</div>
								<div className="text-center p-3 rounded-lg bg-app-bg">
									<p className={`text-lg font-bold ${result.missingFiles.length > 0 ? 'text-danger' : 'text-text-primary'}`}>{result.missingFiles.length}</p>
									<p className="text-xs text-text-secondary">Missing files</p>
								</div>
							</div>

							{/* Orphan files */}
							{result.orphanFiles.length > 0 && (
								<div>
									<h4 className="text-sm font-medium text-amber-400 mb-2">Orphan files (in storage but not tracked)</h4>
									<div className="space-y-1 max-h-48 overflow-y-auto">
										{result.orphanFiles.map((f, i) => (
											<div key={i} className="flex items-center justify-between text-xs bg-app-bg rounded px-3 py-1.5">
												<div className="flex items-center gap-2 min-w-0">
													<span className="text-text-secondary shrink-0">{f.folder}/</span>
													<span className="text-text-primary font-mono truncate">{f.filename}</span>
												</div>
												<span className="text-text-secondary shrink-0 ml-2">{(f.size / 1024).toFixed(0)} KB</span>
											</div>
										))}
									</div>
									<p className="text-xs text-text-secondary mt-2">
										These files exist in managed storage but are not in the database. They may need to be imported or removed.
									</p>
								</div>
							)}

							{/* Missing files */}
							{result.missingFiles.length > 0 && (
								<div>
									<h4 className="text-sm font-medium text-danger mb-2">Missing files (in DB but not on disk)</h4>
									<div className="space-y-1 max-h-48 overflow-y-auto">
										{result.missingFiles.map((f, i) => (
											<div key={i} className="flex items-center justify-between text-xs bg-app-bg rounded px-3 py-1.5">
												<div className="flex items-center gap-2 min-w-0">
													<span className={`shrink-0 px-1.5 py-0.5 rounded text-xs ${
														f.type === 'ai-assets' ? 'bg-purple-500/20 text-purple-400'
														: f.type === 'archival' ? 'bg-amber-500/20 text-amber-400'
														: 'bg-blue-500/20 text-blue-400'
													}`}>{f.type}</span>
													<span className="text-text-primary truncate">{f.label}</span>
												</div>
												<span className="text-text-secondary font-mono text-xs shrink-0 ml-2 truncate max-w-48">{f.filePath}</span>
											</div>
										))}
									</div>
									<p className="text-xs text-text-secondary mt-2">
										These database records point to files that no longer exist on disk. The files may have been moved or deleted.
									</p>
								</div>
							)}

							{healthy && (
								<p className="text-sm text-success">All files accounted for. No orphans or missing files detected.</p>
							)}
						</div>
					)}
				</>
			)}
		</section>
	);
}

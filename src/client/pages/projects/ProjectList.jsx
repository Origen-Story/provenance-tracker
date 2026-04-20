import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import PageHeader from '../../components/layout/PageHeader.jsx';

export default function ProjectList() {
	const qc = useQueryClient();
	const { data: projects = [], isLoading } = useQuery({
		queryKey: ['projects'],
		queryFn: () => fetch('/api/projects').then(r => r.json())
	});

	const activate = useMutation({
		mutationFn: (id) => fetch(`/api/projects/${id}/activate`, { method: 'POST' }).then(r => r.json()),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['projects'] });
			qc.invalidateQueries({ queryKey: ['activeProject'] });
		}
	});

	if (isLoading) return <p className="text-text-secondary text-sm">Loading…</p>;

	return (
		<div>
			<PageHeader title="Projects" />
			<div className="max-w-2xl">
				{projects.length === 0 ? (
					<div className="text-center py-16 text-text-secondary">
						<p className="mb-4">No projects yet.</p>
						<Link to="/projects/new" className="text-accent hover:text-accent-hover">Create your first project →</Link>
					</div>
				) : (
					<>
						<div className="space-y-3 mb-6">
							{projects.map(project => {
								const modules = (() => { try { return JSON.parse(project.modules || '[]'); } catch { return []; } })();
								return (
									<div key={project.id} className="bg-card-bg border border-border rounded-lg p-4 flex items-center justify-between">
										<div>
											<div className="flex items-center gap-2">
												<span className="font-medium text-text-primary">{project.name}</span>
												{project.isActive && (
													<span className="text-xs bg-accent/20 text-accent px-2 py-0.5 rounded-full">Active</span>
												)}
											</div>
											{project.description && <p className="text-sm text-text-secondary mt-0.5">{project.description}</p>}
											<div className="flex gap-2 mt-1.5">
												{modules.map(mod => (
													<span key={mod} className="text-xs bg-card-hover text-text-secondary px-2 py-0.5 rounded">
														{mod === 'ai_assets' ? 'AI Assets' : mod === 'archival' ? 'Archival' : mod}
													</span>
												))}
											</div>
										</div>
										<div className="flex gap-2 shrink-0">
											{!project.isActive && (
												<button
													onClick={() => activate.mutate(project.id)}
													className="text-sm text-accent hover:text-accent-hover px-3 py-1.5 border border-accent/30 hover:border-accent rounded transition-colors"
												>
													Switch to
												</button>
											)}
											<Link
												to={`/projects/${project.id}/settings`}
												className="text-sm text-text-secondary hover:text-text-primary px-3 py-1.5 border border-border rounded transition-colors"
											>
												Settings
											</Link>
										</div>
									</div>
								);
							})}
						</div>
						<Link to="/projects/new" className="inline-flex items-center gap-2 text-sm text-accent hover:text-accent-hover">
							<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
								<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
							</svg>
							New project
						</Link>
					</>
				)}
			</div>
		</div>
	);
}

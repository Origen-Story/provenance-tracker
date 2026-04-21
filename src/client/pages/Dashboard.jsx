import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import PageHeader from '../components/layout/PageHeader.jsx';

const TYPE_COLORS = {
	ai: { bg: 'bg-purple-500/10', border: 'border-purple-500/20', text: 'text-purple-400', dot: 'bg-purple-400' },
	archival: { bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-amber-400', dot: 'bg-amber-400' },
	produced: { bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-blue-400', dot: 'bg-blue-400' }
};

function formatRelative(iso) {
	if (!iso) return '';
	const diff = Date.now() - new Date(iso).getTime();
	const mins = Math.floor(diff / 60000);
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	const days = Math.floor(hrs / 24);
	return `${days}d ago`;
}

export default function Dashboard() {
	const { data: project } = useQuery({
		queryKey: ['activeProject'],
		queryFn: () => fetch('/api/projects/active').then(r => r.json())
	});

	const { data: stats, isLoading } = useQuery({
		queryKey: ['dashboard'],
		queryFn: () => fetch('/api/projects/dashboard').then(r => r.json()),
		enabled: !!project,
		staleTime: 10000
	});

	const modules = (() => {
		try { return JSON.parse(project?.modules || '[]'); } catch { return []; }
	})();

	const hasAI = modules.includes('ai_assets');
	const hasArchival = modules.includes('archival');

	const { data: novelty } = useQuery({
		queryKey: ['noveltyStats'],
		queryFn: () => fetch('/api/assets/novelty').then(r => r.json()),
		enabled: !!project && hasAI,
		staleTime: 10000
	});

	return (
		<div>
			<PageHeader
				title={project?.name || 'Dashboard'}
				description={project?.description || ''}
			/>

			{/* === Asset counts === */}
			<div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
				<div className="bg-card-bg border border-border rounded-lg p-5">
					<p className="text-3xl font-bold text-text-primary">{stats?.counts?.total ?? '—'}</p>
					<p className="text-sm text-text-secondary mt-1">Total assets</p>
				</div>
				<Link to="/produced" className="bg-card-bg border border-border rounded-lg p-5 hover:border-blue-400/40 transition-colors">
					<p className="text-3xl font-bold text-blue-400">{stats?.counts?.produced ?? '—'}</p>
					<p className="text-sm text-text-secondary mt-1">Produced</p>
				</Link>
				{hasAI && (
					<Link to="/assets" className="bg-card-bg border border-border rounded-lg p-5 hover:border-purple-400/40 transition-colors">
						<p className="text-3xl font-bold text-purple-400">{stats?.counts?.ai ?? '—'}</p>
						<p className="text-sm text-text-secondary mt-1">AI assets</p>
					</Link>
				)}
				{hasArchival && (
					<Link to="/archival" className="bg-card-bg border border-border rounded-lg p-5 hover:border-amber-400/40 transition-colors">
						<p className="text-3xl font-bold text-amber-400">{stats?.counts?.archival ?? '—'}</p>
						<p className="text-sm text-text-secondary mt-1">Archival</p>
					</Link>
				)}
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
				{/* === Enrichment status === */}
				<div className="bg-card-bg border border-border rounded-lg p-5">
					<h3 className="text-sm font-semibold text-text-primary mb-3">Needs attention</h3>
					{isLoading ? <p className="text-xs text-text-secondary">Loading...</p> : (stats?.needsEnrichment?.total === 0 && !novelty?.novel) ? (
						<p className="text-sm text-success">All assets are enriched</p>
					) : (
						<div className="space-y-2">
							{stats?.needsEnrichment?.produced > 0 && (
								<Link to="/produced?enrichment=incomplete" className="flex items-center justify-between text-sm hover:bg-card-hover rounded px-2 py-1.5 -mx-2 transition-colors">
									<span className="text-text-secondary">Produced — missing metadata</span>
									<span className="text-blue-400 font-medium">{stats.needsEnrichment.produced}</span>
								</Link>
							)}
							{hasAI && stats?.needsEnrichment?.ai > 0 && (
								<Link to="/assets?enrichment=incomplete" className="flex items-center justify-between text-sm hover:bg-card-hover rounded px-2 py-1.5 -mx-2 transition-colors">
									<span className="text-text-secondary">AI — missing metadata</span>
									<span className="text-purple-400 font-medium">{stats.needsEnrichment.ai}</span>
								</Link>
							)}
							{hasArchival && stats?.needsEnrichment?.archival > 0 && (
								<Link to="/archival?enrichment=incomplete" className="flex items-center justify-between text-sm hover:bg-card-hover rounded px-2 py-1.5 -mx-2 transition-colors">
									<span className="text-text-secondary">Archival — missing metadata</span>
									<span className="text-amber-400 font-medium">{stats.needsEnrichment.archival}</span>
								</Link>
							)}
							{hasAI && novelty?.unknown > 0 && (
								<Link to="/assets?novelty=unknown" className="flex items-center justify-between text-sm hover:bg-card-hover rounded px-2 py-1.5 -mx-2 transition-colors"
									title="AI assets where no parser matched — may be a new platform or format change">
									<span className="text-text-secondary">AI — unknown platform</span>
									<span className="text-amber-400 font-medium">{novelty.unknown}</span>
								</Link>
							)}
							{hasAI && novelty?.lowCoverage > 0 && (
								<Link to="/assets?novelty=low-coverage" className="flex items-center justify-between text-sm hover:bg-card-hover rounded px-2 py-1.5 -mx-2 transition-colors"
									title={`Recognized platform but parser filled <${novelty.threshold}% of core fields — format may have drifted`}>
									<span className="text-text-secondary">AI — low extraction coverage</span>
									<span className="text-amber-400 font-medium">{novelty.lowCoverage}</span>
								</Link>
							)}
						</div>
					)}
				</div>

				{/* === Breakdowns === */}
				<div className="bg-card-bg border border-border rounded-lg p-5">
					<h3 className="text-sm font-semibold text-text-primary mb-3">Breakdowns</h3>
					{isLoading ? <p className="text-xs text-text-secondary">Loading...</p> : (
						<div className="space-y-3">
							{hasAI && stats?.breakdowns?.aiByPlatform?.length > 0 && (
								<div>
									<p className="text-xs text-text-secondary mb-1.5">AI by platform</p>
									<div className="flex flex-wrap gap-1.5">
										{stats.breakdowns.aiByPlatform.map(r => (
											<span key={r.platform} className="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
												{r.platform} ({r.count})
											</span>
										))}
									</div>
								</div>
							)}
							{hasArchival && stats?.breakdowns?.archByMedium?.length > 0 && (
								<div>
									<p className="text-xs text-text-secondary mb-1.5">Archival by medium</p>
									<div className="flex flex-wrap gap-1.5">
										{stats.breakdowns.archByMedium.map(r => (
											<span key={r.medium} className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 capitalize">
												{r.medium} ({r.count})
											</span>
										))}
									</div>
								</div>
							)}
							{stats?.breakdowns?.prodByType?.length > 0 && (
								<div>
									<p className="text-xs text-text-secondary mb-1.5">Produced by type</p>
									<div className="flex flex-wrap gap-1.5">
										{stats.breakdowns.prodByType.map(r => (
											<span key={r.type} className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 capitalize">
												{r.type} ({r.count})
											</span>
										))}
									</div>
								</div>
							)}
							{!stats?.breakdowns?.aiByPlatform?.length && !stats?.breakdowns?.archByMedium?.length && !stats?.breakdowns?.prodByType?.length && (
								<p className="text-xs text-text-secondary">No assets to break down yet.</p>
							)}
						</div>
					)}
				</div>

				{/* === Quick actions === */}
				<div className="bg-card-bg border border-border rounded-lg p-5">
					<h3 className="text-sm font-semibold text-text-primary mb-3">Quick actions</h3>
					<div className="space-y-2">
						<Link to="/import" className="flex items-center gap-3 text-sm text-text-secondary hover:text-text-primary hover:bg-card-hover rounded px-2 py-2 -mx-2 transition-colors">
							<svg className="w-4 h-4 text-accent shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
								<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
							</svg>
							Import assets
						</Link>
						<Link to="/import?type=produced" className="flex items-center gap-3 text-sm text-text-secondary hover:text-text-primary hover:bg-card-hover rounded px-2 py-2 -mx-2 transition-colors">
							<svg className="w-4 h-4 text-blue-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
								<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
							</svg>
							Add produced asset
						</Link>
						{hasAI && (
							<Link to="/import?type=ai-assets" className="flex items-center gap-3 text-sm text-text-secondary hover:text-text-primary hover:bg-card-hover rounded px-2 py-2 -mx-2 transition-colors">
								<svg className="w-4 h-4 text-purple-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
									<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
								</svg>
								Add AI asset
							</Link>
						)}
						{hasArchival && (
							<Link to="/import?type=archival" className="flex items-center gap-3 text-sm text-text-secondary hover:text-text-primary hover:bg-card-hover rounded px-2 py-2 -mx-2 transition-colors">
								<svg className="w-4 h-4 text-amber-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
									<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
								</svg>
								Add archival image
							</Link>
						)}
						<Link to="/settings" className="flex items-center gap-3 text-sm text-text-secondary hover:text-text-primary hover:bg-card-hover rounded px-2 py-2 -mx-2 transition-colors">
							<svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
								<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
							</svg>
							Project settings
						</Link>
					</div>
				</div>
			</div>

			{/* === Recent activity === */}
			{stats?.recent?.length > 0 && (
				<div className="bg-card-bg border border-border rounded-lg p-5">
					<h3 className="text-sm font-semibold text-text-primary mb-3">Recent activity</h3>
					<div className="space-y-1">
						{stats.recent.map((item, i) => {
							const c = TYPE_COLORS[item.type] || TYPE_COLORS.produced;
							return (
								<Link key={`${item.type}-${item.id}`} to={item.link}
									className="flex items-center gap-3 text-sm hover:bg-card-hover rounded px-2 py-2 -mx-2 transition-colors">
									<span className={`w-2 h-2 rounded-full shrink-0 ${c.dot}`} />
									<span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${c.bg} ${c.text} ${c.border} border`}>
										{item.type === 'ai' ? 'AI' : item.type === 'archival' ? 'Arch' : 'Prod'}
									</span>
									<span className="text-text-primary truncate">{item.label}</span>
									<span className="text-xs text-text-secondary shrink-0 ml-auto">{formatRelative(item.createdAt)}</span>
								</Link>
							);
						})}
					</div>
				</div>
			)}

			{/* Empty state */}
			{!isLoading && stats?.counts?.total === 0 && (
				<div className="text-center py-16 text-text-secondary">
					<p className="text-lg mb-2">No assets yet</p>
					<p className="text-sm mb-6">Start by importing assets into this project.</p>
					<Link to="/import" className="px-5 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors">
						Import assets
					</Link>
				</div>
			)}
		</div>
	);
}

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/layout/PageHeader.jsx';

function SyncAllButton({ qc }) {
	const [result, setResult] = useState(null);

	const { data: notionStatus } = useQuery({
		queryKey: ['notionStatus'],
		queryFn: () => fetch('/api/notion/status').then(r => r.json())
	});

	const syncAll = useMutation({
		mutationFn: () => fetch('/api/notion/sync-all', { method: 'POST' }).then(r => r.json()),
		onSuccess: (data) => {
			setResult(data);
			qc.invalidateQueries({ queryKey: ['archival'] });
		}
	});

	if (!notionStatus?.configured) return null;

	return (
		<div className="flex items-center gap-3">
			{result && (
				<p className="text-xs text-text-secondary">
					{result.synced} synced{result.failed > 0 ? `, ${result.failed} failed` : ''}
				</p>
			)}
			<button onClick={() => { setResult(null); syncAll.mutate(); }}
				disabled={syncAll.isPending}
				className="px-4 py-2 bg-card-bg border border-border hover:bg-card-hover text-text-primary rounded-lg text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-40">
				<svg className={`w-4 h-4 ${syncAll.isPending ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
					<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
					<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
				</svg>
				{syncAll.isPending ? 'Syncing…' : 'Sync all to Notion'}
			</button>
		</div>
	);
}

const MEDIA_TYPES = [
	{ value: 'photograph', label: 'Photograph' },
	{ value: 'illustration', label: 'Illustration' },
	{ value: 'map', label: 'Map' },
	{ value: 'document', label: 'Document' },
	{ value: 'other', label: 'Other' }
];

function formatDate(iso) {
	if (!iso) return null;
	return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function ArchivalList() {
	const qc = useQueryClient();
	const [searchParams, setSearchParams] = useSearchParams();
	const [search, setSearch] = useState(searchParams.get('search') || '');
	const medium = searchParams.get('medium') || '';
	const searchGroupId = searchParams.get('searchGroupId') || '';

	const enrichment = searchParams.get('enrichment') || '';

	const { data, isLoading } = useQuery({
		queryKey: ['archival', { search: searchParams.get('search') || '', medium, enrichment, searchGroupId }],
		queryFn: () => {
			const params = new URLSearchParams();
			if (searchParams.get('search')) params.set('search', searchParams.get('search'));
			if (medium) params.set('medium', medium);
			if (enrichment) params.set('enrichment', enrichment);
			if (searchGroupId) params.set('searchGroupId', searchGroupId);
			return fetch(`/api/archival?${params}`).then(r => r.json());
		}
	});

	const { data: groups = [] } = useQuery({
		queryKey: ['archivalGroups'],
		queryFn: () => fetch('/api/archival/groups').then(r => r.json())
	});

	function applySearch() {
		const params = new URLSearchParams(searchParams);
		if (search) params.set('search', search); else params.delete('search');
		setSearchParams(params, { replace: true });
	}

	function setMedium(val) {
		const params = new URLSearchParams(searchParams);
		if (val) params.set('medium', val); else params.delete('medium');
		setSearchParams(params, { replace: true });
	}

	function setGroup(val) {
		const params = new URLSearchParams(searchParams);
		if (val) params.set('searchGroupId', val); else params.delete('searchGroupId');
		setSearchParams(params, { replace: true });
	}

	const assets = data?.assets || [];
	const total = data?.total || 0;

	return (
		<div>
			<div className="flex items-start justify-between gap-4 mb-6">
				<PageHeader title="Archival Images" description={isLoading ? '' : `${total} asset${total !== 1 ? 's' : ''}`} />
				<SyncAllButton qc={qc} />
			</div>

			<div className="flex gap-3 mb-6 flex-wrap">
				<input type="text" value={search} onChange={e => setSearch(e.target.value)}
					onKeyDown={e => e.key === 'Enter' && applySearch()}
					placeholder="Search name, creator, caption…"
					className="flex-1 min-w-48 bg-card-bg border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
				/>
				<select value={medium} onChange={e => setMedium(e.target.value)}
					className="bg-card-bg border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent">
					<option value="">All media</option>
					{MEDIA_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
				</select>
				{groups.length > 0 && (
					<select value={searchGroupId} onChange={e => setGroup(e.target.value)}
						className="bg-card-bg border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent">
						<option value="">All groups</option>
						{groups.map(g => <option key={g.id} value={g.id}>{g.name || g.id}</option>)}
					</select>
				)}
				<button onClick={applySearch}
					className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors">
					Search
				</button>
				<button onClick={() => {
						const params = new URLSearchParams(searchParams);
						if (enrichment) params.delete('enrichment'); else params.set('enrichment', 'incomplete');
						setSearchParams(params, { replace: true });
					}}
					className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 border ${
						enrichment ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 'bg-card-bg border-border text-text-secondary hover:text-text-primary hover:bg-card-hover'
					}`}>
					<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
					</svg>
					{enrichment ? 'Showing incomplete' : 'Needs enrichment'}
				</button>
				<Link to="/import?type=archival"
					className="px-4 py-2 bg-card-bg border border-border hover:bg-card-hover text-text-primary rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
					<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
					</svg>
					Add image
				</Link>
			</div>

			{isLoading ? (
				<p className="text-text-secondary text-sm">Loading…</p>
			) : assets.length === 0 ? (
				<div className="text-center py-20 text-text-secondary">
					{(searchParams.get('search') || medium || searchGroupId) ? (
						<>
							<p>No assets match your filters.</p>
							<button onClick={() => setSearchParams({}, { replace: true })} className="text-accent hover:text-accent-hover text-sm mt-2 block mx-auto">
								Clear filters
							</button>
						</>
					) : (
						<>
							<p className="mb-4">No archival images yet.</p>
							<Link to="/import?type=archival" className="text-accent hover:text-accent-hover">Add your first image →</Link>
						</>
					)}
				</div>
			) : (
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
					{assets.map(asset => {
						const incomplete = asset.missingFields?.length > 0;
						return (
						<Link key={asset.id} to={`/archival/${asset.id}`}
							className={`bg-card-bg border rounded-lg overflow-hidden hover:border-accent/40 transition-colors block ${incomplete ? 'border-amber-500/40' : 'border-border'}`}>
							<div className="aspect-video bg-card-hover flex items-center justify-center overflow-hidden relative">
								{incomplete && (
									<div className="absolute top-2 right-2 z-10 bg-amber-500/90 text-white text-[10px] font-medium px-1.5 py-0.5 rounded" title={`Missing: ${asset.missingFields.join(', ')}`}>
										{asset.missingFields.length} missing
									</div>
								)}
								{asset.filePath ? (
									<img src={`/api/preview?path=${encodeURIComponent(asset.filePath)}`}
										alt={asset.name} className="w-full h-full object-cover" loading="lazy" />
								) : (
									<svg className="w-8 h-8 text-text-secondary opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
										<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
									</svg>
								)}
							</div>
							<div className="p-3">
								<div className="flex items-start justify-between gap-2">
									<p className="font-medium text-text-primary text-sm leading-tight truncate">{asset.name || 'Untitled'}</p>
									<div className={`w-2 h-2 rounded-full shrink-0 mt-1 ${asset.notionSyncedAt ? 'bg-success' : 'bg-border'}`}
										title={asset.notionSyncedAt ? 'Synced to Notion' : 'Not synced'} />
								</div>
								{(asset.creator || asset.institution) && (
									<p className="text-xs text-text-secondary mt-0.5 truncate">
										{[asset.creator, asset.institution].filter(Boolean).join(' · ')}
									</p>
								)}
								<div className="flex items-center justify-between mt-2">
									<span className="text-xs bg-card-hover text-text-secondary px-2 py-0.5 rounded capitalize">{asset.medium}</span>
									{asset.accessDate && <span className="text-xs text-text-secondary">{formatDate(asset.accessDate)}</span>}
								</div>
							</div>
						</Link>
					);
					})}
				</div>
			)}
		</div>
	);
}

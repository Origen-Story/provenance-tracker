import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import PageHeader from '../../components/layout/PageHeader.jsx';

const ASSET_TYPES = ['audio', 'video', 'image', 'document', 'other'];

export default function ProducedList() {
	const [searchParams, setSearchParams] = useSearchParams();
	const [search, setSearch] = useState(searchParams.get('search') || '');
	const assetType = searchParams.get('assetType') || '';

	const enrichment = searchParams.get('enrichment') || '';

	const { data, isLoading } = useQuery({
		queryKey: ['produced', { search: searchParams.get('search') || '', assetType, enrichment }],
		queryFn: () => {
			const params = new URLSearchParams();
			if (searchParams.get('search')) params.set('search', searchParams.get('search'));
			if (assetType) params.set('assetType', assetType);
			if (enrichment) params.set('enrichment', enrichment);
			return fetch(`/api/produced?${params}`).then(r => r.json());
		}
	});

	function applySearch() {
		const params = new URLSearchParams(searchParams);
		if (search) params.set('search', search); else params.delete('search');
		setSearchParams(params, { replace: true });
	}

	function setFilter(val) {
		const params = new URLSearchParams(searchParams);
		if (val) params.set('assetType', val); else params.delete('assetType');
		setSearchParams(params, { replace: true });
	}

	const assets = data?.assets || [];
	const total = data?.total || 0;

	return (
		<div>
			<PageHeader title="Produced Assets" description={isLoading ? '' : `${total} asset${total !== 1 ? 's' : ''}`} />

			<div className="flex gap-3 mb-6 flex-wrap">
				<input type="text" value={search} onChange={e => setSearch(e.target.value)}
					onKeyDown={e => e.key === 'Enter' && applySearch()}
					placeholder="Search name, description, creator..."
					className="flex-1 min-w-48 bg-card-bg border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
				/>
				<select value={assetType} onChange={e => setFilter(e.target.value)}
					className="bg-card-bg border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent">
					<option value="">All types</option>
					{ASSET_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
				</select>
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
				<Link to="/import?type=produced"
					className="px-4 py-2 bg-card-bg border border-border hover:bg-card-hover text-text-primary rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
					<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
					</svg>
					Add asset
				</Link>
			</div>

			{isLoading ? (
				<p className="text-text-secondary text-sm">Loading...</p>
			) : assets.length === 0 ? (
				<div className="text-center py-20 text-text-secondary">
					{(searchParams.get('search') || assetType) ? (
						<>
							<p>No assets match your filters.</p>
							<button onClick={() => setSearchParams({}, { replace: true })} className="text-accent hover:text-accent-hover text-sm mt-2 block mx-auto">
								Clear filters
							</button>
						</>
					) : (
						<>
							<p className="mb-4">No produced assets yet.</p>
							<Link to="/import?type=produced" className="text-accent hover:text-accent-hover">Import your first asset →</Link>
						</>
					)}
				</div>
			) : (
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
					{assets.map(asset => {
						const incomplete = asset.missingFields?.length > 0;
						return (
						<Link key={asset.id} to={`/produced/${asset.id}`}
							className={`bg-card-bg border rounded-lg overflow-hidden hover:border-accent/40 transition-colors block ${incomplete ? 'border-amber-500/40' : 'border-border'}`}>
							<div className="aspect-video bg-card-hover flex items-center justify-center overflow-hidden relative">
								{incomplete && (
									<div className="absolute top-2 right-2 z-10 bg-amber-500/90 text-white text-[10px] font-medium px-1.5 py-0.5 rounded" title={`Missing: ${asset.missingFields.join(', ')}`}>
										{asset.missingFields.length} missing
									</div>
								)}
								{asset.mimeType?.startsWith('image/') ? (
									<img src={`/api/preview?path=${encodeURIComponent(asset.filePath)}`}
										alt={asset.name} className="w-full h-full object-cover" loading="lazy" />
								) : asset.mimeType?.startsWith('audio/') ? (
									<svg className="w-8 h-8 text-text-secondary opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
										<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
									</svg>
								) : (
									<svg className="w-8 h-8 text-text-secondary opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
										<rect x="2" y="2" width="20" height="20" rx="2"/><polygon points="10 8 16 12 10 16 10 8"/>
									</svg>
								)}
							</div>
							<div className="p-3">
								<p className="font-medium text-text-primary text-sm leading-tight truncate">{asset.name || 'Untitled'}</p>
								{asset.description && <p className="text-xs text-text-secondary mt-0.5 truncate">{asset.description}</p>}
								<div className="flex items-center justify-between mt-2">
									<span className="text-xs bg-card-hover text-text-secondary px-2 py-0.5 rounded capitalize">{asset.assetType}</span>
									{asset.recordingDate && <span className="text-xs text-text-secondary">{asset.recordingDate}</span>}
								</div>
								{asset.creator && <p className="text-xs text-text-secondary mt-1 truncate">{asset.creator}</p>}
							</div>
						</Link>
					);
					})}
				</div>
			)}
		</div>
	);
}

import { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/layout/PageHeader.jsx';

// Client-side per-asset sync loop. One HTTP request per asset means a single
// Notion hiccup or server blip can't torch the whole batch, and markNotionSynced
// commits per-asset so progress survives a page refresh.
const SYNC_DELAY_MS = 200;

function SyncAllButton({ qc }) {
	const [phase, setPhase] = useState('idle'); // 'idle' | 'running' | 'done'
	const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });
	const [errors, setErrors] = useState([]);
	const [showErrors, setShowErrors] = useState(false);
	const [forceAll, setForceAll] = useState(false);
	const cancelRef = useRef(false);

	const { data: notionStatus } = useQuery({
		queryKey: ['notionStatus'],
		queryFn: () => fetch('/api/notion/status').then(r => r.json())
	});

	if (!notionStatus?.configured) return null;

	async function runSync() {
		cancelRef.current = false;
		setPhase('running');
		setErrors([]);
		setShowErrors(false);
		setProgress({ done: 0, total: 0, failed: 0 });

		let assets;
		try {
			const res = await fetch('/api/archival?limit=5000');
			const data = await res.json();
			assets = data.assets || [];
		} catch (err) {
			setErrors([{ name: '(fetch asset list)', error: err.message }]);
			setPhase('done');
			return;
		}

		// Default: only sync assets that haven't been synced yet (picks up new
		// additions + prior failures). Force mode re-pushes everything, e.g. when
		// metadata changed and you want those edits to land in Notion.
		if (!forceAll) assets = assets.filter(a => !a.notionSyncedAt);

		setProgress({ done: 0, total: assets.length, failed: 0 });
		const collected = [];

		for (let i = 0; i < assets.length; i++) {
			if (cancelRef.current) break;
			const asset = assets[i];
			try {
				const res = await fetch(`/api/notion/sync/${asset.id}`, { method: 'POST' });
				const body = await res.json().catch(() => ({}));
				if (!res.ok || body.error) {
					collected.push({ name: asset.name || `Asset ${asset.id}`, error: body.error || `HTTP ${res.status}` });
					setProgress(p => ({ ...p, done: p.done + 1, failed: p.failed + 1 }));
				} else {
					setProgress(p => ({ ...p, done: p.done + 1 }));
				}
			} catch (err) {
				collected.push({ name: asset.name || `Asset ${asset.id}`, error: err.message });
				setProgress(p => ({ ...p, done: p.done + 1, failed: p.failed + 1 }));
			}
			if (i < assets.length - 1) await new Promise(r => setTimeout(r, SYNC_DELAY_MS));
		}

		setErrors(collected);
		setPhase('done');
		qc.invalidateQueries({ queryKey: ['archival'] });
	}

	function cancel() {
		cancelRef.current = true;
	}

	function reset() {
		setPhase('idle');
		setErrors([]);
		setShowErrors(false);
		setProgress({ done: 0, total: 0, failed: 0 });
	}

	const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

	return (
		<div className="flex flex-col items-end gap-2">
			<div className="flex items-center gap-3">
				{phase === 'running' && (
					<p className="text-xs text-text-secondary tabular-nums">
						{progress.done} / {progress.total}{progress.failed > 0 ? ` · ${progress.failed} failed` : ''}
					</p>
				)}
				{phase === 'done' && (
					<p className="text-xs text-text-secondary">
						{progress.done - progress.failed} synced{progress.failed > 0 ? `, ${progress.failed} failed` : ''}
						{progress.failed > 0 && (
							<button onClick={() => setShowErrors(s => !s)} className="ml-2 text-accent hover:text-accent-hover">
								{showErrors ? 'hide' : 'details'}
							</button>
						)}
					</p>
				)}
				{phase === 'running' ? (
					<button onClick={cancel}
						className="px-4 py-2 bg-card-bg border border-border hover:bg-card-hover text-text-primary rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
						Cancel
					</button>
				) : (
					<>
						<label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer" title="By default, only unsynced assets are processed. Enable to re-push everything (useful after editing metadata).">
							<input type="checkbox" checked={forceAll} onChange={e => setForceAll(e.target.checked)} className="w-3.5 h-3.5 accent-accent" />
							Resync all
						</label>
						<button onClick={() => { reset(); runSync(); }}
							className="px-4 py-2 bg-card-bg border border-border hover:bg-card-hover text-text-primary rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
							<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
								<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
								<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
							</svg>
							{forceAll ? 'Resync all to Notion' : (phase === 'done' ? 'Sync new + retry failed' : 'Sync to Notion')}
						</button>
					</>
				)}
			</div>
			{phase === 'running' && progress.total > 0 && (
				<div className="w-64 h-1 bg-card-bg border border-border rounded-full overflow-hidden">
					<div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
				</div>
			)}
			{phase === 'done' && showErrors && errors.length > 0 && (
				<div className="w-96 max-h-64 overflow-y-auto bg-card-bg border border-border rounded-lg p-3 text-xs space-y-1">
					{errors.map((e, i) => (
						<div key={i} className="flex gap-2">
							<span className="text-text-primary truncate shrink-0 max-w-[40%]" title={e.name}>{e.name}</span>
							<span className="text-danger truncate" title={e.error}>{e.error}</span>
						</div>
					))}
				</div>
			)}
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

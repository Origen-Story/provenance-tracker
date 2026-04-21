import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, Link } from 'react-router-dom';
import PageHeader from '../../components/layout/PageHeader.jsx';

const TIER_STYLES = {
	green: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30', label: 'Public Domain' },
	yellow: { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30', label: 'Attribution' },
	red: { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/30', label: 'Restricted' }
};

const STATUS_STYLES = {
	pending: { bg: 'bg-card-hover', text: 'text-text-secondary', label: 'Pending' },
	approved: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: 'Approved' },
	rejected: { bg: 'bg-red-500/15', text: 'text-red-400', label: 'Rejected' },
	flagged: { bg: 'bg-amber-500/15', text: 'text-amber-400', label: 'Flagged' },
	processing: { bg: 'bg-blue-500/15', text: 'text-blue-400', label: 'Processing' },
	duplicate: { bg: 'bg-purple-500/15', text: 'text-purple-300', label: 'Duplicate' },
	failed: { bg: 'bg-orange-500/15', text: 'text-orange-400', label: 'Failed' }
};

function effectiveStatus(c) {
	if (c?.status === 'rejected' && c?.rejectionReason?.startsWith('Duplicate')) return 'duplicate';
	return c?.status;
}

function matchedAssetIdFromReason(reason) {
	const m = reason?.match(/asset #(\d+)/);
	return m ? parseInt(m[1]) : null;
}

// ---------------------------------------------------------------------------
// Detail Modal
// ---------------------------------------------------------------------------

function DetailModal({ candidate, onClose, onApprove, onReject, onFlag, onRetry, approving }) {
	if (!candidate) return null;
	const tier = TIER_STYLES[candidate.licenseTier] || TIER_STYLES.red;
	const dims = (() => { try { return JSON.parse(candidate.dimensions || '{}'); } catch { return {}; } })();
	const cats = (() => { try { return JSON.parse(candidate.categories || '[]'); } catch { return []; } })();

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
			<div className="bg-sidebar-bg border border-border rounded-xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
				{/* Header */}
				<div className="flex items-center justify-between p-4 border-b border-border">
					<h3 className="text-sm font-semibold text-text-primary truncate pr-4">{candidate.title || 'Untitled'}</h3>
					<button onClick={onClose} className="text-text-secondary hover:text-text-primary shrink-0">
						<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
					</button>
				</div>

				{/* Image */}
				<div className="p-4 bg-card-bg flex items-center justify-center min-h-48">
					<img src={candidate.thumbnailUrl || candidate.imageUrl} alt={candidate.title}
						className="max-h-80 max-w-full object-contain rounded" loading="lazy" />
				</div>

				{/* Metadata */}
				<div className="p-4 space-y-3">
					<div className="flex gap-2 flex-wrap">
						<span className={`text-xs px-2 py-0.5 rounded-full border ${tier.bg} ${tier.text} ${tier.border}`}>{candidate.license || 'Unknown'}</span>
						{candidate.status !== 'pending' && (() => {
							const eff = effectiveStatus(candidate);
							return (
								<span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLES[eff]?.bg} ${STATUS_STYLES[eff]?.text}`}>
									{STATUS_STYLES[eff]?.label}
								</span>
							);
						})()}
						{dims.width > 0 && <span className="text-xs text-text-secondary">{dims.width} x {dims.height}</span>}
					</div>

					{candidate.status === 'rejected' && candidate.rejectionReason && (() => {
						const matchedId = matchedAssetIdFromReason(candidate.rejectionReason);
						const isDup = candidate.rejectionReason.startsWith('Duplicate');
						return (
							<div className={`text-xs p-2 rounded ${isDup ? 'bg-purple-500/10 border border-purple-500/20' : 'bg-card-hover'}`}>
								<p className={isDup ? 'text-purple-300' : 'text-text-secondary'}>{candidate.rejectionReason}</p>
								{matchedId && (
									<a href={`/archival/${matchedId}`} className="text-accent hover:text-accent-hover mt-1 inline-block">
										View matched asset →
									</a>
								)}
							</div>
						);
					})()}

					{candidate.status === 'processing' && (candidate.retryCount > 0 || candidate.lastError) && (
						<div className="text-xs p-2 rounded bg-blue-500/10 border border-blue-500/20">
							<p className="text-blue-300">
								In queue — attempt {candidate.retryCount || 0}/5{candidate.nextAttemptAt ? `, next at ${new Date(candidate.nextAttemptAt).toLocaleTimeString()}` : ''}
							</p>
							{candidate.lastError && <p className="text-text-secondary mt-0.5">Last error: {candidate.lastError}</p>}
						</div>
					)}

					{candidate.status === 'failed' && (
						<div className="text-xs p-2 rounded bg-orange-500/10 border border-orange-500/20">
							<p className="text-orange-300 font-medium">Download failed after {candidate.retryCount || 5} attempts</p>
							{candidate.lastError && <p className="text-text-secondary mt-0.5">{candidate.lastError}</p>}
						</div>
					)}

					{candidate.description && (
						<div>
							<p className="text-xs text-text-secondary mb-0.5">Description</p>
							<p className="text-sm text-text-primary">{candidate.description}</p>
						</div>
					)}

					{candidate.author && (
						<div>
							<p className="text-xs text-text-secondary mb-0.5">Author</p>
							<p className="text-sm text-text-primary">{candidate.author}</p>
						</div>
					)}

					{candidate.originalDate && (
						<div>
							<p className="text-xs text-text-secondary mb-0.5">Date</p>
							<p className="text-sm text-text-primary">{candidate.originalDate}</p>
						</div>
					)}

					{cats.length > 0 && (
						<div>
							<p className="text-xs text-text-secondary mb-1">Categories</p>
							<div className="flex flex-wrap gap-1">
								{cats.slice(0, 10).map((c, i) => (
									<span key={i} className="text-xs px-1.5 py-0.5 rounded bg-card-hover text-text-secondary">{c}</span>
								))}
								{cats.length > 10 && <span className="text-xs text-text-secondary">+{cats.length - 10} more</span>}
							</div>
						</div>
					)}

					<div className="flex items-center gap-2 text-xs">
						<span className="text-text-secondary">Source:</span>
						<a href={candidate.sourcePageUrl} target="_blank" rel="noopener noreferrer"
							className="text-accent hover:text-accent-hover truncate">View on Wikimedia Commons</a>
					</div>

					{candidate.searchQuery && (
						<p className="text-xs text-text-secondary">Found via: "{candidate.searchQuery}"</p>
					)}
				</div>

				{/* Actions */}
				{candidate.status === 'pending' && (
					<div className="flex gap-2 p-4 border-t border-border">
						<button onClick={() => onApprove(candidate.id)} disabled={approving}
							className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
							{approving ? 'Downloading...' : 'Approve'}
						</button>
						<button onClick={() => onFlag(candidate.id)}
							className="px-4 py-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 rounded-lg text-sm font-medium transition-colors border border-amber-600/30">
							Flag
						</button>
						<button onClick={() => onReject(candidate.id)}
							className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg text-sm font-medium transition-colors border border-red-600/30">
							Reject
						</button>
					</div>
				)}

				{candidate.status === 'approved' && candidate.archivalAssetId && (
					<div className="p-4 border-t border-border">
						<a href={`/archival/${candidate.archivalAssetId}`}
							className="text-sm text-accent hover:text-accent-hover">View in archival assets →</a>
					</div>
				)}

				{candidate.status === 'failed' && (
					<div className="flex gap-2 p-4 border-t border-border">
						<button onClick={() => onRetry(candidate.id)}
							className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors">
							Retry download
						</button>
						<button onClick={() => onReject(candidate.id)}
							className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg text-sm font-medium transition-colors border border-red-600/30">
							Reject
						</button>
					</div>
				)}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Search job progress — shared by SearchPage + GroupsManager via export
// ---------------------------------------------------------------------------

export function JobProgress({ job, onCancel, onDismiss, onRetry, cancelling, retrying }) {
	const active = ['queued', 'running'].includes(job.status);
	const retryable = ['failed', 'cancelled'].includes(job.status);
	const totalSteps = (job.keywordsTotal || 0) + (job.categoriesTotal || 0);
	const doneSteps = (job.keywordsDone || 0) + (job.categoriesDone || 0);
	const pct = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0;
	const barColor = job.status === 'failed' ? 'bg-red-500' : job.status === 'cancelled' ? 'bg-amber-500' : job.status === 'completed' ? 'bg-emerald-500' : 'bg-accent';

	return (
		<div className="mt-3 bg-sidebar-bg rounded-lg px-3 py-2 text-sm">
			<div className="flex items-center justify-between gap-3 mb-1.5">
				<div className="flex items-center gap-2 min-w-0">
					<span className="text-text-primary font-medium truncate">{job.groupName}</span>
					<span className="text-xs text-text-secondary">
						{job.status === 'queued' && 'queued'}
						{job.status === 'running' && `${doneSteps}/${totalSteps} steps`}
						{job.status === 'completed' && `done — ${job.candidatesInserted} new candidates`}
						{job.status === 'failed' && `failed: ${job.lastError || 'unknown error'}`}
						{job.status === 'cancelled' && 'cancelled'}
					</span>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					{active && (
						<button onClick={onCancel} disabled={cancelling}
							className="text-xs text-text-secondary hover:text-red-400 disabled:opacity-40">
							{cancelling ? 'Cancelling...' : 'Cancel'}
						</button>
					)}
					{retryable && onRetry && (
						<button onClick={onRetry} disabled={retrying}
							className="text-xs text-accent hover:text-accent-hover disabled:opacity-40">
							{retrying ? 'Retrying...' : 'Retry'}
						</button>
					)}
					{!active && (
						<button onClick={onDismiss} className="text-xs text-text-secondary hover:text-text-primary">Dismiss</button>
					)}
				</div>
			</div>
			<div className="h-1.5 bg-card-hover rounded overflow-hidden">
				<div className={`h-full ${barColor} transition-all`} style={{ width: `${active ? pct : 100}%` }} />
			</div>
			{job.status === 'running' && (
				<p className="text-[11px] text-text-secondary mt-1">
					{job.keywordsDone || 0}/{job.keywordsTotal || 0} keywords · {job.categoriesDone || 0}/{job.categoriesTotal || 0} categories · {job.uniqueTitles || 0} unique titles · {job.candidatesInserted || 0} inserted
				</p>
			)}
			{job.status === 'completed' && (job.skippedLicense > 0 || job.skippedDuplicate > 0 || job.skippedExisting > 0) && (
				<p className="text-[11px] text-text-secondary mt-1">
					skipped {job.skippedLicense || 0} (license), {job.skippedDuplicate || 0} (dup), {job.skippedExisting || 0} (already in archive)
				</p>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function SearchPage() {
	const qc = useQueryClient();
	const [searchParams, setSearchParams] = useSearchParams();
	const [search, setSearch] = useState(searchParams.get('search') || '');
	const [selected, setSelected] = useState(new Set());
	const [detailId, setDetailId] = useState(null);
	const [activeJobId, setActiveJobId] = useState(null);
	const pageSize = parseInt(searchParams.get('limit') || '60');
	const page = parseInt(searchParams.get('page') || '1');

	const groupFilter = searchParams.get('searchGroupId') || searchParams.get('stopId') || '';
	const statusFilter = searchParams.get('status') || 'pending';
	const tierFilter = searchParams.get('licenseTier') || '';
	const searchTypeFilter = searchParams.get('searchType') || '';

	// Fetch groups list
	const { data: groups } = useQuery({
		queryKey: ['searchGroups'],
		queryFn: () => fetch('/api/search-groups').then(r => r.json())
	});

	// Fetch stats first (polls while background approvals are in-flight)
	const { data: stats } = useQuery({
		queryKey: ['searchStats'],
		queryFn: () => fetch('/api/search/stats').then(r => r.json()),
		refetchInterval: (q) => {
			const rows = q.state.data || [];
			return rows.some(s => (s.processing || 0) > 0) ? 3000 : false;
		}
	});

	const processingCount = (stats || []).reduce((n, s) => n + (s.processing || 0), 0);
	const failedCount = (stats || []).reduce((n, s) => n + (s.failed || 0), 0);

	// Fetch candidates
	const { data, isLoading } = useQuery({
		queryKey: ['searchCandidates', { searchGroupId: groupFilter, status: statusFilter, licenseTier: tierFilter, searchType: searchTypeFilter, search: searchParams.get('search') || '', page, pageSize }],
		queryFn: () => {
			const p = new URLSearchParams();
			if (groupFilter) p.set('searchGroupId', groupFilter);
			if (statusFilter) p.set('status', statusFilter);
			if (tierFilter) p.set('licenseTier', tierFilter);
			if (searchTypeFilter) p.set('searchType', searchTypeFilter);
			if (searchParams.get('search')) p.set('search', searchParams.get('search'));
			p.set('limit', String(pageSize));
			p.set('offset', String((page - 1) * pageSize));
			return fetch(`/api/search/candidates?${p}`).then(r => r.json());
		},
		refetchInterval: processingCount > 0 ? 5000 : false
	});

	// Enqueue a search job — returns a jobId, then we poll /jobs/:id for progress.
	const executeSearch = useMutation({
		mutationFn: (groupId) => fetch('/api/search/execute', {
			method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ groupId })
		}).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Search enqueue failed'); return d; }),
		onSuccess: (d) => setActiveJobId(d.jobId)
	});

	// Poll active job while queued/running; stop once it terminates.
	const { data: activeJob } = useQuery({
		queryKey: ['searchJob', activeJobId],
		queryFn: () => fetch(`/api/search/jobs/${activeJobId}`).then(r => r.json()),
		enabled: !!activeJobId,
		refetchInterval: (q) => {
			const j = q.state.data;
			if (!j) return 2000;
			return ['queued', 'running'].includes(j.status) ? 2000 : false;
		}
	});

	// When a job finishes, refresh candidate views.
	useEffect(() => {
		if (!activeJob) return;
		if (['completed', 'failed', 'cancelled'].includes(activeJob.status)) {
			qc.invalidateQueries({ queryKey: ['searchCandidates'] });
			qc.invalidateQueries({ queryKey: ['searchStats'] });
		}
	}, [activeJob?.id, activeJob?.status, qc]);

	const cancelJobMut = useMutation({
		mutationFn: (jobId) => fetch(`/api/search/jobs/${jobId}/cancel`, { method: 'POST' })
			.then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; })
	});

	const retryJobMut = useMutation({
		mutationFn: (jobId) => fetch(`/api/search/jobs/${jobId}/retry`, { method: 'POST' })
			.then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; }),
		onSuccess: (job) => { setActiveJobId(job.id); }
	});

	// Single approve
	const approveMut = useMutation({
		mutationFn: (id) => fetch(`/api/search/candidates/${id}/approve`, { method: 'POST' }).then(r => r.json()),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['searchCandidates'] });
			qc.invalidateQueries({ queryKey: ['searchStats'] });
		}
	});

	// Status update (reject / flag)
	const statusMut = useMutation({
		mutationFn: ({ id, status, rejectionReason }) => fetch(`/api/search/candidates/${id}`, {
			method: 'PATCH', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status, rejectionReason })
		}).then(r => r.json()),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['searchCandidates'] });
			qc.invalidateQueries({ queryKey: ['searchStats'] });
		}
	});

	// Bulk approve
	const bulkApproveMut = useMutation({
		mutationFn: (ids) => fetch('/api/search/candidates/bulk-approve', {
			method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ids })
		}).then(r => r.json()),
		onSuccess: () => {
			setSelected(new Set());
			qc.invalidateQueries({ queryKey: ['searchCandidates'] });
			qc.invalidateQueries({ queryKey: ['searchStats'] });
		}
	});

	// Retry a failed candidate
	const retryMut = useMutation({
		mutationFn: (id) => fetch(`/api/search/candidates/${id}/retry`, { method: 'POST' }).then(r => r.json()),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['searchCandidates'] });
			qc.invalidateQueries({ queryKey: ['searchStats'] });
		}
	});

	// Bulk reject
	const bulkRejectMut = useMutation({
		mutationFn: (ids) => fetch('/api/search/candidates/bulk-status', {
			method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ids, status: 'rejected' })
		}).then(r => r.json()),
		onSuccess: () => {
			setSelected(new Set());
			qc.invalidateQueries({ queryKey: ['searchCandidates'] });
			qc.invalidateQueries({ queryKey: ['searchStats'] });
		}
	});

	const candidates = data?.candidates || [];
	const total = data?.total || 0;
	const totalPages = Math.ceil(total / pageSize);
	const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
	const rangeEnd = Math.min(page * pageSize, total);

	function setFilter(key, val) {
		const p = new URLSearchParams(searchParams);
		if (val) p.set(key, val); else p.delete(key);
		p.delete('page'); // reset to page 1 on filter change
		setSearchParams(p, { replace: true });
		setSelected(new Set());
	}

	function goToPage(n) {
		const p = new URLSearchParams(searchParams);
		if (n > 1) p.set('page', String(n)); else p.delete('page');
		setSearchParams(p, { replace: true });
		setSelected(new Set());
	}

	function applySearch() {
		const p = new URLSearchParams(searchParams);
		if (search) p.set('search', search); else p.delete('search');
		setSearchParams(p, { replace: true });
	}

	function toggleSelect(id) {
		setSelected(prev => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id); else next.add(id);
			return next;
		});
	}

	function toggleSelectAll() {
		if (selected.size === candidates.length) {
			setSelected(new Set());
		} else {
			setSelected(new Set(candidates.map(c => c.id)));
		}
	}

	const detailCandidate = detailId ? candidates.find(c => c.id === detailId) : null;

	// Group picker state
	const [selectedGroup, setSelectedGroup] = useState('');

	return (
		<div>
			<PageHeader title="Archive Search" description={isLoading ? '' : `${total.toLocaleString()} candidate${total !== 1 ? 's' : ''} matching filters`} />

			{processingCount > 0 && (
				<div className="flex items-center gap-3 mb-4 px-3 py-2 bg-blue-500/10 border border-blue-500/30 rounded-lg">
					<svg className="w-4 h-4 text-blue-400 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<path d="M21 12a9 9 0 1 1-6.219-8.56"/>
					</svg>
					<p className="text-xs text-blue-400">
						{processingCount} candidate{processingCount !== 1 ? 's' : ''} in the download queue. The worker chips away one at a time with automatic retries (429s, network blips). This page auto-updates as each finishes.
					</p>
				</div>
			)}

			{failedCount > 0 && (
				<div className="flex items-center gap-3 mb-4 px-3 py-2 bg-orange-500/10 border border-orange-500/30 rounded-lg">
					<svg className="w-4 h-4 text-orange-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
					</svg>
					<p className="text-xs text-orange-400">
						{failedCount} candidate{failedCount !== 1 ? 's' : ''} failed after max retries.{' '}
						<button onClick={() => setFilter('status', 'failed')} className="underline hover:text-orange-300">View failed</button>
						{' '}to retry or reject individually.
					</p>
				</div>
			)}

			{/* Stats summary */}
			{stats?.length > 0 && (
				<div className="flex gap-2 mb-4 flex-wrap">
					{stats.map(s => (
						<div key={s.searchGroupId} className="text-xs bg-card-bg border border-border rounded px-2.5 py-1.5">
							<span className="text-text-secondary">{s.searchGroupName}: </span>
							<span className="text-text-primary font-medium">{s.pending}</span>
							<span className="text-text-secondary"> pending</span>
							{(s.processing || 0) > 0 && <><span className="text-blue-400 ml-1">{s.processing}</span><span className="text-text-secondary"> in queue</span></>}
							{(s.failed || 0) > 0 && <><span className="text-orange-400 ml-1">{s.failed}</span><span className="text-text-secondary"> failed</span></>}
							{s.approved > 0 && <><span className="text-emerald-400 ml-1">{s.approved}</span><span className="text-text-secondary"> approved</span></>}
						</div>
					))}
				</div>
			)}

			{/* Search execution bar */}
			<div className="bg-card-bg border border-border rounded-lg p-4 mb-6">
				<div className="flex gap-3 items-end flex-wrap">
					<div className="flex-1 min-w-48">
						<div className="flex items-center justify-between mb-1">
							<label className="text-xs text-text-secondary">Search a group</label>
							<Link to="/search/groups" className="text-xs text-accent hover:text-accent-hover">Manage groups →</Link>
						</div>
						<select value={selectedGroup} onChange={e => setSelectedGroup(e.target.value)}
							className="w-full bg-sidebar-bg border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent">
							<option value="">Select a group...</option>
							{(groups || []).map(g => (
								<option key={g.groupId} value={g.groupId}>{g.groupName} ({g.keywordCount} keywords, {g.categoryCount} categories)</option>
							))}
						</select>
					</div>
					<button
						onClick={() => selectedGroup && executeSearch.mutate(selectedGroup)}
						disabled={!selectedGroup || executeSearch.isPending || (activeJob && ['queued', 'running'].includes(activeJob.status))}
						className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40 flex items-center gap-2">
						<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
						Search Wikimedia
					</button>
				</div>
				{activeJob && <JobProgress
					job={activeJob}
					onCancel={() => cancelJobMut.mutate(activeJob.id)}
					onDismiss={() => setActiveJobId(null)}
					onRetry={() => retryJobMut.mutate(activeJob.id)}
					cancelling={cancelJobMut.isPending}
					retrying={retryJobMut.isPending}
				/>}
			</div>

			{/* Filter bar */}
			<div className="flex gap-3 mb-4 flex-wrap">
				<input type="text" value={search} onChange={e => setSearch(e.target.value)}
					onKeyDown={e => e.key === 'Enter' && applySearch()}
					placeholder="Search title, description, author..."
					className="flex-1 min-w-48 bg-card-bg border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
				/>
				<select value={groupFilter} onChange={e => setFilter('searchGroupId', e.target.value)}
					className="bg-card-bg border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent">
					<option value="">All groups</option>
					{(groups || []).map(g => <option key={g.groupId} value={g.groupId}>{g.groupName}</option>)}
				</select>
				<select value={statusFilter} onChange={e => setFilter('status', e.target.value)}
					className="bg-card-bg border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent">
					<option value="">All statuses</option>
					<option value="pending">Pending</option>
					<option value="processing">In queue</option>
					<option value="approved">Approved</option>
					<option value="rejected">Rejected</option>
					<option value="failed">Failed</option>
					<option value="flagged">Flagged</option>
				</select>
				<select value={tierFilter} onChange={e => setFilter('licenseTier', e.target.value)}
					className="bg-card-bg border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent">
					<option value="">All licenses</option>
					<option value="green">Public Domain</option>
					<option value="yellow">Attribution (CC BY/SA)</option>
				</select>
				<select value={searchTypeFilter} onChange={e => setFilter('searchType', e.target.value)}
					className="bg-card-bg border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent">
					<option value="">All sources</option>
					<option value="keyword">Keyword results</option>
					<option value="category">Category results</option>
				</select>
				<button onClick={applySearch}
					className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors">
					Search
				</button>
			</div>

			{/* Toolbar: pagination info + select all + bulk actions */}
			{candidates.length > 0 && (
				<div className="flex items-center gap-3 mb-4 bg-card-bg border border-border rounded-lg px-4 py-2.5 flex-wrap">
					{/* Select all checkbox */}
					<input type="checkbox"
						checked={candidates.length > 0 && selected.size === candidates.length}
						onChange={toggleSelectAll}
						className="w-4 h-4 rounded border-border accent-accent cursor-pointer"
						title={selected.size === candidates.length ? 'Deselect all' : 'Select all on page'} />

					{/* Page info */}
					<span className="text-sm text-text-secondary">
						Showing <span className="text-text-primary font-medium">{rangeStart}–{rangeEnd}</span> of <span className="text-text-primary font-medium">{total.toLocaleString()}</span>
					</span>

					{/* Per-page size */}
					<select value={pageSize} onChange={e => { setFilter('limit', e.target.value); }}
						className="bg-sidebar-bg border border-border rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent">
						<option value="40">40 / page</option>
						<option value="60">60 / page</option>
						<option value="100">100 / page</option>
						<option value="200">200 / page</option>
					</select>

					{/* Bulk actions — shown when items selected */}
					{selected.size > 0 && (
						<div className="flex items-center gap-2 ml-auto">
							<span className="text-sm text-accent font-medium">{selected.size} selected</span>
							<button onClick={() => bulkApproveMut.mutate([...selected])}
								disabled={bulkApproveMut.isPending}
								className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-medium transition-colors disabled:opacity-50">
								{bulkApproveMut.isPending ? 'Approving...' : `Approve ${selected.size}`}
							</button>
							<button onClick={() => bulkRejectMut.mutate([...selected])}
								disabled={bulkRejectMut.isPending}
								className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded text-xs font-medium transition-colors border border-red-600/30 disabled:opacity-50">
								Reject {selected.size}
							</button>
							<button onClick={() => {
								const unselectedIds = candidates.filter(c => !selected.has(c.id)).map(c => c.id);
								if (unselectedIds.length > 0) bulkRejectMut.mutate(unselectedIds);
							}}
								disabled={bulkRejectMut.isPending}
								className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded text-xs font-medium transition-colors border border-red-600/30 disabled:opacity-50"
								title="Reject everything on this page that is NOT selected">
								Reject other {candidates.length - selected.size}
							</button>
							<button onClick={() => setSelected(new Set())}
								className="px-3 py-1.5 text-text-secondary hover:text-text-primary text-xs transition-colors">
								Clear
							</button>
						</div>
					)}

					{/* Pagination controls */}
					{totalPages > 1 && (
						<div className="flex items-center gap-1 ml-2">
							<button onClick={() => goToPage(page - 1)} disabled={page <= 1}
								className="px-2 py-1 text-xs text-text-secondary hover:text-text-primary disabled:opacity-30 transition-colors">Prev</button>
							{Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
								let p;
								if (totalPages <= 7) p = i + 1;
								else if (page <= 4) p = i + 1;
								else if (page >= totalPages - 3) p = totalPages - 6 + i;
								else p = page - 3 + i;
								return (
									<button key={p} onClick={() => goToPage(p)}
										className={`px-2 py-1 text-xs rounded transition-colors ${p === page ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'}`}>
										{p}
									</button>
								);
							})}
							<button onClick={() => goToPage(page + 1)} disabled={page >= totalPages}
								className="px-2 py-1 text-xs text-text-secondary hover:text-text-primary disabled:opacity-30 transition-colors">Next</button>
						</div>
					)}
				</div>
			)}

			{/* Grid */}
			{isLoading ? (
				<p className="text-text-secondary text-sm">Loading...</p>
			) : candidates.length === 0 ? (
				<div className="text-center py-20 text-text-secondary">
					{(groupFilter || searchParams.get('search') || tierFilter) ? (
						<>
							<p>No candidates match your filters.</p>
							<button onClick={() => setSearchParams({ status: 'pending' }, { replace: true })}
								className="text-accent hover:text-accent-hover text-sm mt-2 block mx-auto">
								Clear filters
							</button>
						</>
					) : statusFilter === 'pending' ? (
						<>
							<p className="mb-2">No pending candidates.</p>
							<p className="text-sm">Select a group above and click "Search Wikimedia" to find images.</p>
						</>
					) : (
						<p>No candidates with status "{statusFilter}".</p>
					)}
				</div>
			) : (
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
					{candidates.map(c => {
						const tier = TIER_STYLES[c.licenseTier] || TIER_STYLES.red;
						const isSelected = selected.has(c.id);
						return (
							<div key={c.id}
								className={`bg-card-bg border rounded-lg overflow-hidden transition-colors relative ${
									isSelected ? 'border-accent ring-1 ring-accent/30' : 'border-border hover:border-accent/40'
								}`}>
								{/* Checkbox */}
								<div className="absolute top-2 left-2 z-10">
									<input type="checkbox" checked={isSelected} onChange={() => toggleSelect(c.id)}
										className="w-4 h-4 rounded border-border accent-accent cursor-pointer" />
								</div>

								{/* License badge */}
								<div className="absolute top-2 right-2 z-10">
									<span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${tier.bg} ${tier.text} ${tier.border}`}>
										{tier.label}
									</span>
								</div>

								{/* Thumbnail (clickable) */}
								<button onClick={() => setDetailId(c.id)} className="w-full text-left">
									<div className="aspect-video bg-card-hover flex items-center justify-center overflow-hidden">
										{c.thumbnailUrl ? (
											<img src={c.thumbnailUrl} alt={c.title}
												className="w-full h-full object-cover" loading="lazy" />
										) : (
											<svg className="w-8 h-8 text-text-secondary opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
												<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
											</svg>
										)}
									</div>
									<div className="p-3">
										<p className="font-medium text-text-primary text-sm leading-tight truncate">{c.title || 'Untitled'}</p>
										{c.author && <p className="text-xs text-text-secondary mt-0.5 truncate">{c.author}</p>}
										<div className="flex items-center justify-between mt-2">
											<span className="text-xs text-text-secondary truncate" title={c.searchQuery || c.searchGroupName}>
												{c.searchQuery ? c.searchQuery.replace(/^\[(keyword|category)\]\s*/, (_, type) => type === 'keyword' ? '🔑 ' : '📁 ') : c.searchGroupName}
											</span>
											{c.status !== 'pending' && (() => {
												const eff = effectiveStatus(c);
												return (
													<span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_STYLES[eff]?.bg} ${STATUS_STYLES[eff]?.text}`}
														title={c.rejectionReason || ''}>
														{STATUS_STYLES[eff]?.label}
													</span>
												);
											})()}
										</div>
									</div>
								</button>
							</div>
						);
					})}
				</div>
			)}

			{/* Bottom pagination */}
			{totalPages > 1 && candidates.length > 0 && (
				<div className="flex items-center justify-center gap-1 mt-6 mb-2">
					<button onClick={() => goToPage(page - 1)} disabled={page <= 1}
						className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary disabled:opacity-30 transition-colors">Prev</button>
					<span className="text-sm text-text-secondary mx-2">Page {page} of {totalPages}</span>
					<button onClick={() => goToPage(page + 1)} disabled={page >= totalPages}
						className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary disabled:opacity-30 transition-colors">Next</button>
				</div>
			)}

			{/* Detail Modal */}
			<DetailModal
				candidate={detailCandidate}
				onClose={() => setDetailId(null)}
				onApprove={(id) => approveMut.mutate(id, { onSuccess: () => setDetailId(null) })}
				onReject={(id) => statusMut.mutate({ id, status: 'rejected' }, { onSuccess: () => setDetailId(null) })}
				onFlag={(id) => statusMut.mutate({ id, status: 'flagged' }, { onSuccess: () => setDetailId(null) })}
				onRetry={(id) => retryMut.mutate(id, { onSuccess: () => setDetailId(null) })}
				approving={approveMut.isPending}
			/>
		</div>
	);
}

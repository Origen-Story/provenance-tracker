import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Composition from '../../components/timeline/Composition.jsx';
import { fmtClock } from '../../components/timeline/LaneStrip.jsx';
import OriginBadge from '../../components/origin/OriginBadge.jsx';
import InlineClassSetter from '../../components/origin/InlineClassSetter.jsx';
import { TYPE_LABELS, DETAIL_PATHS } from '../../components/origin/originClasses.js';

async function jsonOrThrow(r) {
	const j = await r.json();
	if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
	return j;
}

const TABS = [
	{ id: 'composition', label: 'Composition' },
	{ id: 'statement', label: 'Statement', soon: 'Creator statement (phase 4c)' },
	{ id: 'credentials', label: 'Credentials', soon: 'Sign and verify (phase 4c)' },
	{ id: 'export', label: 'Export', soon: 'Public export (phase 4d)' }
];

function ImportForm({ producedId, replace, onDone }) {
	const qc = useQueryClient();
	const [file, setFile] = useState(null);
	const importTl = useMutation({
		mutationFn: () => {
			const fd = new FormData();
			fd.append('file', file);
			fd.append('producedAssetId', producedId);
			return fetch('/api/timelines', { method: 'POST', body: fd }).then(jsonOrThrow);
		},
		onSuccess: () => { setFile(null); qc.invalidateQueries({ queryKey: ['timelines'] }); qc.invalidateQueries({ queryKey: ['timeline'] }); qc.invalidateQueries({ queryKey: ['relationships'] }); qc.invalidateQueries({ queryKey: ['outputs'] }); onDone?.(); }
	});
	return (
		<div className={`bg-card-bg border border-border rounded-lg p-4 flex flex-wrap items-center gap-3 ${replace ? '' : 'mb-6'}`}>
			<div className="text-sm text-text-primary font-medium">{replace ? 'Replace the timeline' : 'Import the sequence'}</div>
			<p className="text-xs text-text-secondary flex-1 min-w-[16rem]">Premiere: File › Export › Final Cut Pro XML. Resolve: File › Export › Timeline › Final Cut Pro 7 XML. Clips are matched to this project's assets by path, hash and name.</p>
			<input type="file" accept=".xml,text/xml,application/xml" onChange={e => setFile(e.target.files?.[0] || null)} className="text-xs text-text-secondary" />
			<button type="button" disabled={!file || importTl.isPending} onClick={() => importTl.mutate()}
				className="px-4 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-md text-xs font-medium disabled:opacity-40">
				{importTl.isPending ? 'Importing…' : 'Import'}
			</button>
			{importTl.isError && <p className="w-full text-xs text-danger">{importTl.error.message}</p>}
		</div>
	);
}

function MatchPicker({ onPick, onCancel }) {
	const [q, setQ] = useState('');
	const search = useQuery({
		queryKey: ['relationships-search', q],
		queryFn: () => fetch(`/api/relationships/search?q=${encodeURIComponent(q)}`).then(jsonOrThrow),
		enabled: q.trim().length >= 2
	});
	return (
		<div className="space-y-1">
			<input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search assets…"
				className="w-full bg-card-bg border border-border rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent" />
			{search.data?.results?.length > 0 && (
				<ul className="max-h-36 overflow-y-auto border border-border rounded divide-y divide-border bg-card-bg">
					{search.data.results.map(r => (
						<li key={`${r.type}-${r.id}`}>
							<button type="button" onClick={() => onPick(r)} className="w-full text-left px-2 py-1 text-xs hover:bg-card-hover flex items-center gap-2">
								<span className="text-[10px] text-text-secondary w-14 shrink-0">{TYPE_LABELS[r.type]}</span>
								<span className="truncate">{r.label}</span>
								<OriginBadge originClass={r.originClass} confirmed={r.originClassConfirmed} className="ml-auto" />
							</button>
						</li>
					))}
				</ul>
			)}
			<button type="button" onClick={onCancel} className="text-[11px] text-text-secondary hover:text-text-primary">cancel</button>
		</div>
	);
}

// How a clip on the timeline was tied to a tracked asset, strongest first.
const METHOD_LABELS = { path: 'same file', hash: 'identical copy', filename_size: 'same name and size', filename: 'same name only, check', manual: 'you picked this', unmatched: 'no match', sequence: 'nested sequence', generator: 'title or generator' };
const METHOD_HELP = {
	path: 'The timeline points at this exact file.',
	hash: 'The file the timeline points at is byte-for-byte identical to this asset, even though the path or name differs.',
	filename_size: 'Same file name and size as this asset. Very likely the same file.',
	filename: 'Only the file name matches. Check that this is the right asset.',
	manual: 'Nothing in the file ties it to this asset; you chose it.',
	unmatched: 'No tracked asset matches this clip. Pick one, or import the file first.'
};

function SegmentRow({ seg, onFix, queryKeys }) {
	const [picking, setPicking] = useState(false);
	const method = seg.matchMethod;
	const weak = method === 'filename' || method === 'unmatched';
	return (
		<tr className={`border-t border-border/60 ${seg.enabled ? '' : 'opacity-50'}`}>
			<td className="py-1.5 pr-2 text-text-secondary whitespace-nowrap">{seg.trackKind === 'video' ? 'V' : 'A'}{seg.trackIndex}</td>
			<td className="py-1.5 pr-2 text-text-secondary whitespace-nowrap">{fmtClock(seg.startSeconds)}–{fmtClock(seg.endSeconds)}</td>
			<td className="py-1.5 pr-2 text-text-primary max-w-[16rem]">
				<div className="truncate" title={seg.sourcePath || seg.sourceName}>{seg.clipName || seg.sourceName}</div>
				{!seg.enabled && <div className="text-[10px] text-text-secondary">disabled</div>}
			</td>
			<td className="py-1.5 pr-2">
				{picking ? (
					<MatchPicker onPick={(r) => { setPicking(false); onFix(seg, r); }} onCancel={() => setPicking(false)} />
				) : seg.asset ? (
					<div className="flex items-center gap-2">
						<Link to={`${DETAIL_PATHS[seg.asset.type]}/${seg.asset.id}`} className="truncate max-w-[12rem] hover:text-accent" title={seg.asset.filename}>{seg.asset.label}</Link>
						<span className={`text-[10px] ${weak ? 'text-amber-400' : 'text-text-secondary'}`} title={`${METHOD_HELP[method] || 'How the clip was matched to the asset.'}${seg.matchConfidence < 1 ? ` (${Math.round(seg.matchConfidence * 100)}% confidence)` : ''}`}>
							{METHOD_LABELS[method] || method}{seg.matchConfidence > 0 && seg.matchConfidence < 1 ? ` ${Math.round(seg.matchConfidence * 100)}%` : ''}
						</span>
						<button type="button" onClick={() => setPicking(true)} className="text-[11px] text-text-secondary hover:text-text-primary" title="Wrong asset? Pick the right one.">wrong asset?</button>
					</div>
				) : seg.sourceKind !== 'file' ? (
					<span className="text-[11px] text-text-secondary">{METHOD_LABELS[method] || method}</span>
				) : (
					<div className="flex items-center gap-2">
						<span className="text-[11px] text-amber-400">no match</span>
						<button type="button" onClick={() => setPicking(true)} className="text-[11px] text-accent hover:text-accent-hover">pick asset</button>
					</div>
				)}
			</td>
			<td className="py-1.5">
				{seg.asset ? <InlineClassSetter asset={seg.asset} queryKeys={queryKeys} /> : <OriginBadge originClass="unknown" confirmed={false} />}
			</td>
		</tr>
	);
}

export default function OutputPage() {
	const { id } = useParams();
	const navigate = useNavigate();
	const qc = useQueryClient();
	const [tab, setTab] = useState('composition');
	const [showAudio, setShowAudio] = useState(true);
	const [replacing, setReplacing] = useState(false);

	const asset = useQuery({ queryKey: ['produced', id], queryFn: () => fetch(`/api/produced/${id}`).then(jsonOrThrow) });
	const list = useQuery({ queryKey: ['timelines', id], queryFn: () => fetch(`/api/timelines?producedAssetId=${id}`).then(jsonOrThrow) });
	const current = list.data?.timelines?.[list.data.timelines.length - 1];
	const timeline = useQuery({
		queryKey: ['timeline', current?.id],
		queryFn: () => fetch(`/api/timelines/${current.id}`).then(jsonOrThrow),
		enabled: !!current
	});
	const queryKeys = [['timeline', current?.id], ['timelines', id], ['outputs'], ['produced'], ['assets'], ['archival']];
	const invalidate = () => { for (const k of queryKeys) qc.invalidateQueries({ queryKey: k }); qc.invalidateQueries({ queryKey: ['relationships'] }); };

	const segment = useMutation({
		mutationFn: ({ segId, patch }) => fetch(`/api/timelines/${current.id}/segments/${segId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).then(jsonOrThrow),
		onSuccess: invalidate
	});
	const del = useMutation({
		mutationFn: () => fetch(`/api/timelines/${current.id}`, { method: 'DELETE' }).then(jsonOrThrow),
		onSuccess: invalidate
	});
	const unmark = useMutation({
		mutationFn: () => fetch(`/api/outputs/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isOutput: false }) }).then(jsonOrThrow),
		onSuccess: () => { invalidate(); navigate('/outputs'); }
	});

	const a = asset.data;
	const t = timeline.data;
	const comp = t?.breakdown?.composition;

	return (
		<div>
			<div className="mb-4 flex items-center gap-2 text-sm text-text-secondary">
				<Link to="/outputs" className="hover:text-text-primary transition-colors">Outputs</Link>
				<span>/</span>
				<span className="text-text-primary">{a?.name || a?.filename || `#${id}`}</span>
				<Link to={`/produced/${id}`} className="ml-auto px-2.5 py-1 border border-border rounded-md text-xs text-text-primary hover:border-accent/60 hover:text-accent" title="The file's own page: metadata, origin class, and the list of ingredients">File details and ingredients</Link>
			</div>

			<div className="mb-6 flex items-center gap-1 border-b border-border">
				{TABS.map(tb => (
					<button key={tb.id} type="button" disabled={!!tb.soon} onClick={() => setTab(tb.id)} title={tb.soon || ''}
						className={`px-3 py-2 text-sm border-b-2 -mb-px ${tab === tb.id ? 'border-accent text-text-primary' : 'border-transparent text-text-secondary'} ${tb.soon ? 'opacity-40 cursor-not-allowed' : 'hover:text-text-primary'}`}>
						{tb.label}{tb.soon && <span className="ml-1.5 text-[9px] uppercase tracking-wide border border-border rounded px-1 py-px">soon</span>}
					</button>
				))}
			</div>

			{list.isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
			{!list.isLoading && !current && (
				<>
					<ImportForm producedId={id} />
					<p className="text-xs text-text-secondary">Not a finished edit? <button type="button" onClick={() => unmark.mutate()} className="text-accent hover:text-accent-hover">Remove it from Outputs</button>. The file stays in Produced Assets.</p>
				</>
			)}

			{t && tab === 'composition' && (
				<div className="space-y-6">
					<div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-text-secondary">
						<span><span className="text-text-primary">{t.sequenceName}</span> · {t.sourceFormat} v{t.sourceFormatVersion}</span>
						<span>{comp?.durationSeconds ? `${fmtClock(comp.durationSeconds)}` : `${t.durationFrames} frames`} at {t.fps?.toFixed(3)} fps{t.ntsc ? ' (NTSC)' : ''}</span>
						<span>{t.width}×{t.height}</span>
						<span>{t.segments.length} clips{t.breakdown?.counts?.unmatched ? <span className="text-amber-400">, {t.breakdown.counts.unmatched} unmatched</span> : ''}</span>
						<span className="ml-auto flex items-center gap-3">
							<button type="button" onClick={() => setReplacing(r => !r)} className="hover:text-text-primary">{replacing ? 'cancel' : 'Replace timeline'}</button>
							<button type="button" onClick={() => { if (confirm('Delete this imported timeline? The output and its links stay.')) del.mutate(); }} className="text-danger hover:underline">Delete timeline</button>
						</span>
					</div>
					{replacing && <ImportForm producedId={id} replace onDone={() => setReplacing(false)} />}

					{t.notes?.length > 0 && (
						<div className="bg-amber-500/5 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-200">
							{t.notes.map((n, i) => <div key={i}>{n}</div>)}
						</div>
					)}

					<Composition asset={a} composition={comp} />

					<div className="bg-card-bg border border-border rounded-lg p-4">
						<div className="flex items-center justify-between mb-2">
							<h3 className="text-sm font-medium text-text-primary">Clips</h3>
							<label className="text-[11px] text-text-secondary flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={showAudio} onChange={e => setShowAudio(e.target.checked)} /> show audio tracks</label>
						</div>
						<p className="text-[11px] text-text-secondary mb-2">Setting a class here sets it on the asset, so every clip that uses it and every output that includes it follow.</p>
						<table className="w-full text-xs">
							<thead>
								<tr className="text-left text-text-secondary">
									<th className="pb-1 pr-2 font-medium">Track</th>
									<th className="pb-1 pr-2 font-medium">Time</th>
									<th className="pb-1 pr-2 font-medium">Clip</th>
									<th className="pb-1 pr-2 font-medium" title="The tracked asset this clip was tied to, and how">Tracked asset, and how it was matched</th>
									<th className="pb-1 font-medium">Origin class</th>
								</tr>
							</thead>
							<tbody>
								{t.segments.filter(s => showAudio || s.trackKind === 'video').map(seg => (
									<SegmentRow key={seg.id} seg={seg} queryKeys={queryKeys}
										onFix={(s, r) => segment.mutate({ segId: s.id, patch: { matchedAssetType: r.type, matchedAssetId: r.id } })} />
								))}
							</tbody>
						</table>
						{segment.isError && <p className="text-xs text-danger mt-2">{segment.error.message}</p>}
					</div>
				</div>
			)}
		</div>
	);
}

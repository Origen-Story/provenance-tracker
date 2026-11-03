import { useState } from 'react';
import { useParams, Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import OriginBadge from '../../components/origin/OriginBadge.jsx';
import { ORIGIN_CLASSES, originClassInfo, TYPE_LABELS, DETAIL_PATHS } from '../../components/origin/originClasses.js';

async function jsonOrThrow(r) {
	const j = await r.json();
	if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
	return j;
}

function fmtTime(seconds) {
	if (seconds == null) return '';
	const m = Math.floor(seconds / 60);
	const s = seconds - m * 60;
	return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

// Stacked bar + table for one breakdown block ({ byClass, gap }).
function ClassBar({ block, title, note }) {
	if (!block) return null;
	const entries = Object.entries(block.byClass || {}).sort((a, b) => b[1].frames - a[1].frames);
	const gap = block.gap;
	return (
		<div className="bg-card-bg border border-border rounded-lg p-4 space-y-3">
			<div className="flex items-baseline justify-between">
				<h3 className="text-sm font-medium text-text-primary">{title}</h3>
				{note && <span className="text-[11px] text-text-secondary">{note}</span>}
			</div>
			<div className="flex h-5 rounded overflow-hidden border border-border bg-card-hover" title="Share of the sequence duration">
				{entries.map(([cls, v]) => (
					<div key={cls} style={{ width: `${v.percent}%` }} className={`${originClassInfo(cls).bar} h-full`} title={`${originClassInfo(cls).label}: ${v.percent.toFixed(1)}%`} />
				))}
				{gap?.frames > 0 && <div style={{ width: `${gap.percent}%` }} className="h-full bg-transparent" title={`No clip: ${gap.percent.toFixed(1)}%`} />}
			</div>
			<table className="w-full text-xs">
				<tbody>
					{entries.map(([cls, v]) => (
						<tr key={cls} className="border-t border-border/60">
							<td className="py-1"><OriginBadge originClass={cls} confirmed /></td>
							<td className="py-1 text-text-secondary">{originClassInfo(cls).label}</td>
							<td className="py-1 text-right text-text-primary">{v.seconds != null ? `${v.seconds.toFixed(1)} s` : `${v.frames} f`}</td>
							<td className="py-1 text-right text-text-primary font-medium w-16">{v.percent.toFixed(1)}%</td>
						</tr>
					))}
					{gap?.frames > 0 && (
						<tr className="border-t border-border/60">
							<td className="py-1 text-text-secondary" colSpan={2}>No clip on this track</td>
							<td className="py-1 text-right text-text-secondary">{gap.seconds != null ? `${gap.seconds.toFixed(1)} s` : `${gap.frames} f`}</td>
							<td className="py-1 text-right text-text-secondary w-16">{gap.percent.toFixed(1)}%</td>
						</tr>
					)}
				</tbody>
			</table>
		</div>
	);
}

function AudioSummary({ audio, durationSeconds }) {
	if (!audio) return null;
	const entries = Object.entries(audio.byClass || {}).sort((a, b) => b[1].frames - a[1].frames);
	if (!entries.length) return null;
	return (
		<div className="bg-card-bg border border-border rounded-lg p-4 space-y-2">
			<h3 className="text-sm font-medium text-text-primary">Audio</h3>
			<p className="text-[11px] text-text-secondary">Audio layers stack, so shares can exceed 100% of the {durationSeconds ? `${durationSeconds.toFixed(0)} s` : ''} sequence. Stereo pairs are counted once.</p>
			<table className="w-full text-xs">
				<tbody>
					{entries.map(([cls, v]) => (
						<tr key={cls} className="border-t border-border/60">
							<td className="py-1"><OriginBadge originClass={cls} confirmed /></td>
							<td className="py-1 text-text-secondary">{originClassInfo(cls).label}</td>
							<td className="py-1 text-right text-text-primary">{v.seconds != null ? `${v.seconds.toFixed(1)} s` : `${v.frames} f`}</td>
							<td className="py-1 text-right text-text-primary font-medium w-16">{v.percentOfTimeline.toFixed(0)}%</td>
						</tr>
					))}
				</tbody>
			</table>
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

function SegmentRow({ seg, onFix, onClass }) {
	const [picking, setPicking] = useState(false);
	const method = seg.matchMethod;
	const methodLabel = { path: 'path', hash: 'hash', filename_size: 'name+size', filename: 'name only', manual: 'manual', unmatched: 'no match', sequence: 'nested sequence', generator: 'generator' }[method] || method;
	const weak = method === 'filename' || method === 'unmatched';
	return (
		<tr className={`border-t border-border/60 ${seg.enabled ? '' : 'opacity-50'}`}>
			<td className="py-1.5 pr-2 text-text-secondary whitespace-nowrap">{seg.trackKind === 'video' ? 'V' : 'A'}{seg.trackIndex}</td>
			<td className="py-1.5 pr-2 text-text-secondary whitespace-nowrap">{fmtTime(seg.startSeconds)}–{fmtTime(seg.endSeconds)}</td>
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
						<span className={`text-[10px] ${weak ? 'text-amber-400' : 'text-text-secondary'}`}>{methodLabel}{seg.matchConfidence ? ` ${Math.round(seg.matchConfidence * 100)}%` : ''}</span>
						<button type="button" onClick={() => setPicking(true)} className="text-[11px] text-text-secondary hover:text-text-primary">change</button>
					</div>
				) : seg.sourceKind !== 'file' ? (
					<span className="text-[11px] text-text-secondary">{methodLabel}</span>
				) : (
					<div className="flex items-center gap-2">
						<span className="text-[11px] text-amber-400">no match</span>
						<button type="button" onClick={() => setPicking(true)} className="text-[11px] text-accent hover:text-accent-hover">pick asset</button>
					</div>
				)}
			</td>
			<td className="py-1.5">
				<div className="flex items-center gap-1">
					<OriginBadge originClass={seg.originClass || 'unknown'} confirmed={!!seg.originClassOverride || !!seg.asset?.originClassConfirmed} />
					<select value={seg.originClassOverride || ''} onChange={e => onClass(seg, e.target.value || null)} title="Override the class for this clip only"
						className="bg-card-bg border border-border rounded px-1 py-0.5 text-[10px] text-text-secondary focus:outline-none focus:border-accent">
						<option value="">asset's class</option>
						{ORIGIN_CLASSES.map(c => <option key={c.value} value={c.value}>{c.short}</option>)}
					</select>
				</div>
			</td>
		</tr>
	);
}

export default function TimelinePage() {
	const { id } = useParams();
	const qc = useQueryClient();
	const [file, setFile] = useState(null);
	const [showAudio, setShowAudio] = useState(true);

	const asset = useQuery({ queryKey: ['produced', id], queryFn: () => fetch(`/api/produced/${id}`).then(jsonOrThrow) });
	const list = useQuery({ queryKey: ['timelines', id], queryFn: () => fetch(`/api/timelines?producedAssetId=${id}`).then(jsonOrThrow) });
	const current = list.data?.timelines?.[list.data.timelines.length - 1];
	const timeline = useQuery({
		queryKey: ['timeline', current?.id],
		queryFn: () => fetch(`/api/timelines/${current.id}`).then(jsonOrThrow),
		enabled: !!current
	});

	const invalidate = () => { qc.invalidateQueries({ queryKey: ['timelines', id] }); qc.invalidateQueries({ queryKey: ['timeline'] }); qc.invalidateQueries({ queryKey: ['relationships'] }); };

	const importTl = useMutation({
		mutationFn: () => {
			const fd = new FormData();
			fd.append('file', file);
			fd.append('producedAssetId', id);
			return fetch('/api/timelines', { method: 'POST', body: fd }).then(jsonOrThrow);
		},
		onSuccess: () => { setFile(null); invalidate(); }
	});
	const settings = useMutation({
		mutationFn: (patch) => fetch(`/api/timelines/${current.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).then(jsonOrThrow),
		onSuccess: invalidate
	});
	const segment = useMutation({
		mutationFn: ({ segId, patch }) => fetch(`/api/timelines/${current.id}/segments/${segId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).then(jsonOrThrow),
		onSuccess: invalidate
	});
	const del = useMutation({
		mutationFn: () => fetch(`/api/timelines/${current.id}`, { method: 'DELETE' }).then(jsonOrThrow),
		onSuccess: invalidate
	});

	const t = timeline.data;
	const bd = t?.breakdown;

	return (
		<div>
			<div className="mb-6 flex items-center gap-2 text-sm text-text-secondary">
				<Link to="/produced" className="hover:text-text-primary transition-colors">Produced Assets</Link>
				<span>/</span>
				<Link to={`/produced/${id}`} className="hover:text-text-primary transition-colors">{asset.data?.name || `#${id}`}</Link>
				<span>/</span>
				<span className="text-text-primary">Timeline</span>
			</div>

			<div className="bg-card-bg border border-border rounded-lg p-4 mb-6 flex flex-wrap items-center gap-3">
				<div className="text-sm text-text-primary font-medium">{current ? 'Replace timeline' : 'Import a timeline'}</div>
				<p className="text-xs text-text-secondary flex-1 min-w-[16rem]">Premiere: File › Export › Final Cut Pro XML. Resolve: File › Export › Timeline › Final Cut Pro 7 XML. Clips are matched to this project's assets by path, hash and name.</p>
				<input type="file" accept=".xml,text/xml,application/xml" onChange={e => setFile(e.target.files?.[0] || null)} className="text-xs text-text-secondary" />
				<button type="button" disabled={!file || importTl.isPending} onClick={() => importTl.mutate()}
					className="px-4 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-md text-xs font-medium disabled:opacity-40">
					{importTl.isPending ? 'Importing…' : 'Import'}
				</button>
				{importTl.isError && <p className="w-full text-xs text-danger">{importTl.error.message}</p>}
			</div>

			{list.isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
			{!list.isLoading && !current && <p className="text-sm text-text-secondary">No timeline imported for this output yet.</p>}

			{t && (
				<div className="space-y-6">
					<div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-text-secondary">
						<span><span className="text-text-primary">{t.sequenceName}</span> · {t.sourceFormat} v{t.sourceFormatVersion}</span>
						<span>{bd?.durationSeconds ? `${bd.durationSeconds.toFixed(1)} s` : `${t.durationFrames} frames`} at {t.fps?.toFixed(3)} fps{t.ntsc ? ' (NTSC)' : ''}</span>
						<span>{t.width}×{t.height}</span>
						<span>{t.segments.length} clips, {bd?.counts?.unmatched ?? 0} unmatched</span>
						<span className="ml-auto flex items-center gap-3">
							<label className="flex items-center gap-1 cursor-pointer">
								<span>Primary track</span>
								<select value={t.primaryTrackIndex} onChange={e => settings.mutate({ primaryTrackIndex: e.target.value })} className="bg-card-bg border border-border rounded px-1 py-0.5 text-[11px] text-text-primary">
									{[...new Set(t.segments.filter(s => s.trackKind === 'video').map(s => s.trackIndex))].sort((a, b) => a - b).map(i => <option key={i} value={i}>V{i}</option>)}
									{!t.segments.some(s => s.trackKind === 'video') && <option value={1}>V1</option>}
								</select>
							</label>
							<label className="flex items-center gap-1 cursor-pointer">
								<input type="checkbox" checked={!!t.includeOverlays} onChange={e => settings.mutate({ includeOverlays: e.target.checked })} />
								<span>Overlays</span>
							</label>
							<button type="button" onClick={() => { if (confirm('Delete this imported timeline? The output asset stays.')) del.mutate(); }} className="text-danger hover:underline">Delete</button>
						</span>
					</div>

					{t.notes?.length > 0 && (
						<div className="bg-amber-500/5 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-200">
							{t.notes.map((n, i) => <div key={i}>{n}</div>)}
						</div>
					)}

					<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
						<ClassBar block={bd?.primary} title={`Picture: track V${bd?.primary?.trackIndex || t.primaryTrackIndex}`} note="Headline numbers (decision D7)" />
						{bd?.overlays ? <ClassBar block={bd.overlays} title="Picture with overlays" note="Top-most clip wins" /> : <AudioSummary audio={bd?.audio} durationSeconds={bd?.durationSeconds} />}
					</div>
					{bd?.overlays && <AudioSummary audio={bd?.audio} durationSeconds={bd?.durationSeconds} />}

					<div className="bg-card-bg border border-border rounded-lg p-4">
						<div className="flex items-center justify-between mb-2">
							<h3 className="text-sm font-medium text-text-primary">Clips</h3>
							<label className="text-[11px] text-text-secondary flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={showAudio} onChange={e => setShowAudio(e.target.checked)} /> show audio tracks</label>
						</div>
						<table className="w-full text-xs">
							<thead>
								<tr className="text-left text-text-secondary">
									<th className="pb-1 pr-2 font-medium">Track</th>
									<th className="pb-1 pr-2 font-medium">Time</th>
									<th className="pb-1 pr-2 font-medium">Clip</th>
									<th className="pb-1 pr-2 font-medium">Matched asset</th>
									<th className="pb-1 font-medium">Origin class</th>
								</tr>
							</thead>
							<tbody>
								{t.segments.filter(s => showAudio || s.trackKind === 'video').map(seg => (
									<SegmentRow key={seg.id} seg={seg}
										onFix={(s, r) => segment.mutate({ segId: s.id, patch: { matchedAssetType: r.type, matchedAssetId: r.id } })}
										onClass={(s, cls) => segment.mutate({ segId: s.id, patch: { originClass: cls } })} />
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

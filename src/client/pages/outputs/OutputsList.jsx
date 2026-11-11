import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import PageHeader from '../../components/layout/PageHeader.jsx';
import LaneStrip, { fmtClock } from '../../components/timeline/LaneStrip.jsx';

async function jsonOrThrow(r) {
	const j = await r.json();
	if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
	return j;
}

function AddOutput({ onDone }) {
	const qc = useQueryClient();
	const [q, setQ] = useState('');
	const search = useQuery({
		queryKey: ['produced', { search: q, outputs: 'exclude' }],
		queryFn: () => fetch(`/api/produced?outputs=exclude&search=${encodeURIComponent(q)}&limit=20`).then(jsonOrThrow)
	});
	const mark = useMutation({
		mutationFn: (id) => fetch(`/api/outputs/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isOutput: true }) }).then(jsonOrThrow),
		onSuccess: () => { qc.invalidateQueries({ queryKey: ['outputs'] }); qc.invalidateQueries({ queryKey: ['produced'] }); onDone(); }
	});
	const candidates = (search.data?.assets || []).filter(a => a.mimeType?.startsWith('video/') || a.mimeType?.startsWith('audio/'));
	return (
		<div className="bg-card-bg border border-border rounded-lg p-4 space-y-2">
			<p className="text-xs text-text-secondary">Pick the finished edit from Produced Assets. Import the render there first if it is not in the project yet.</p>
			<input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search produced video and audio…"
				className="w-full bg-card-bg border border-border rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
			<ul className="max-h-56 overflow-y-auto divide-y divide-border border border-border rounded-md">
				{candidates.map(a => (
					<li key={a.id}>
						<button type="button" onClick={() => mark.mutate(a.id)} disabled={mark.isPending} className="w-full text-left px-2 py-1.5 text-xs hover:bg-card-hover flex items-center gap-2">
							<span className="truncate text-text-primary">{a.name || a.filename}</span>
							<span className="ml-auto text-[10px] text-text-secondary shrink-0">{a.durationSeconds ? fmtClock(a.durationSeconds) : a.assetType}</span>
						</button>
					</li>
				))}
				{search.data && candidates.length === 0 && <li className="px-2 py-1.5 text-xs text-text-secondary">No video or audio found.</li>}
			</ul>
			<div className="flex items-center gap-3">
				<button type="button" onClick={onDone} className="text-[11px] text-text-secondary hover:text-text-primary">cancel</button>
				{mark.isError && <span className="text-[11px] text-danger">{mark.error.message}</span>}
			</div>
		</div>
	);
}

function OutputCard({ o }) {
	const comp = o.timeline?.composition;
	const unknown = comp?.picture?.byClass?.unknown?.percent || 0;
	const unmatched = o.timeline?.counts?.unmatched || 0;
	return (
		<Link to={`/outputs/${o.id}`} className="block bg-card-bg border border-border hover:border-accent/60 rounded-lg p-4 transition-colors">
			<div className="flex items-baseline justify-between gap-3 mb-2">
				<span className="text-sm font-medium text-text-primary truncate">{o.name || o.filename}</span>
				<span className="text-[11px] text-text-secondary shrink-0">{o.durationSeconds ? fmtClock(o.durationSeconds) : ''}{o.frameRate ? ` · ${o.frameRate} fps` : ''}</span>
			</div>
			{comp ? (
				<>
					<LaneStrip title="" lane={comp.picture} durationSeconds={comp.durationSeconds} height="h-4" gutter={false} />
					<div className="mt-1.5 flex items-center gap-3 text-[11px] text-text-secondary">
						<span>{o.timeline.sequenceName}</span>
						{unknown > 0 && <span className="text-amber-400">{unknown.toFixed(0)}% unknown</span>}
						{unmatched > 0 && <span className="text-amber-400">{unmatched} clip{unmatched === 1 ? '' : 's'} unmatched</span>}
						{unknown === 0 && unmatched === 0 && <span className="text-success">every clip classified</span>}
					</div>
				</>
			) : (
				<p className="text-[11px] text-text-secondary">No timeline yet. Open it and import the sequence XML.</p>
			)}
		</Link>
	);
}

export default function OutputsList() {
	const [adding, setAdding] = useState(false);
	const { data, isLoading } = useQuery({ queryKey: ['outputs'], queryFn: () => fetch('/api/outputs').then(jsonOrThrow) });
	const outputs = data?.outputs || [];
	return (
		<div>
			<div className="flex items-start justify-between gap-4">
				<PageHeader title="Outputs" description="Finished edits: what is in each one, moment by moment, and the credentials it will ship with." />
				<button type="button" onClick={() => setAdding(a => !a)} className="shrink-0 px-3 py-1.5 border border-accent/60 text-accent hover:bg-accent/10 rounded-md text-xs font-medium">
					{adding ? 'Cancel' : '+ Add output'}
				</button>
			</div>
			{adding && <div className="mb-4"><AddOutput onDone={() => setAdding(false)} /></div>}
			{isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
			{!isLoading && outputs.length === 0 && (
				<div className="bg-card-bg border border-border rounded-lg p-6 text-sm text-text-secondary">
					<p>No outputs yet. An output is a finished edit: the render you will publish.</p>
					<p className="mt-2">One appears here when you import a sequence XML for a produced asset, when an imported file carries Content Credentials listing ingredients, or when you add one above.</p>
				</div>
			)}
			<div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
				{outputs.map(o => <OutputCard key={o.id} o={o} />)}
			</div>
		</div>
	);
}

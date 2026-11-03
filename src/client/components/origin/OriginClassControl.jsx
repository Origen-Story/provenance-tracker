import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ORIGIN_CLASSES, originClassInfo, explainSource } from './originClasses.js';

async function jsonOrThrow(r) {
	const j = await r.json();
	if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
	return j;
}

/**
 * Shows the asset's origin class with the rule that proposed it, and lets the
 * user confirm it or pick another. `type` is ai | archival | produced.
 */
export default function OriginClassControl({ type, id, asset, queryKeys = [] }) {
	const qc = useQueryClient();
	const [selected, setSelected] = useState(asset?.originClass || 'unknown');
	const [note, setNote] = useState(asset?.originClassNote || '');
	useEffect(() => { setSelected(asset?.originClass || 'unknown'); }, [asset?.originClass]);
	useEffect(() => { setNote(asset?.originClassNote || ''); }, [asset?.originClassNote]);

	const invalidate = () => {
		for (const key of queryKeys) qc.invalidateQueries({ queryKey: key });
		qc.invalidateQueries({ queryKey: ['relationships'] });
	};

	const confirm = useMutation({
		mutationFn: (originClass) => fetch(`/api/origin/${type}/${id}`, {
			method: 'PATCH', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ originClass, confirmed: true, note })
		}).then(jsonOrThrow),
		onSuccess: invalidate
	});

	const propose = useMutation({
		mutationFn: () => fetch(`/api/origin/${type}/${id}/propose`, { method: 'POST' }).then(jsonOrThrow),
		onSuccess: invalidate
	});

	if (!asset) return null;
	const current = originClassInfo(asset.originClass);
	const confirmed = !!asset.originClassConfirmed;
	const dirty = selected !== asset.originClass || note !== (asset.originClassNote || '');
	// Only an unknown class asks for attention. A proposal from metadata is
	// used as-is everywhere; confirming it is optional.
	const needsAttention = asset.originClass === 'unknown';

	return (
		<div className={`border rounded-lg p-3 space-y-2 ${needsAttention ? 'bg-amber-500/5 border-amber-500/30' : 'bg-card-bg border-border'}`}>
			<div className="flex items-center justify-between gap-2">
				<span className="text-xs font-medium text-text-secondary">Origin class</span>
				<span className={`border rounded px-2 py-0.5 text-xs font-medium ${current.color}`}>{current.label}</span>
			</div>
			<p className="text-xs text-text-secondary">
				{confirmed ? 'Confirmed.' : needsAttention ? 'Needs a decision.' : 'Proposed from metadata; confirm only if you want to vouch for it.'}{' '}
				{explainSource(asset.originClassSource)}
			</p>
			<div className="flex gap-2">
				<select value={selected} onChange={e => setSelected(e.target.value)}
					className="flex-1 bg-card-bg border border-border rounded-md px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent">
					{ORIGIN_CLASSES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
				</select>
				<button type="button" onClick={() => confirm.mutate(selected)} disabled={confirm.isPending || (confirmed && !dirty)}
					className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-md text-xs font-medium disabled:opacity-40 transition-colors">
					{confirm.isPending ? 'Saving…' : dirty ? 'Set' : confirmed ? 'Confirmed' : 'Confirm'}
				</button>
			</div>
			<p className="text-[11px] text-text-secondary">{originClassInfo(selected).desc}</p>
			<input value={note} onChange={e => setNote(e.target.value)} placeholder="Reason (optional): why this class, especially when it overrides what the file says. Goes into the output manifest."
				className="w-full bg-card-bg border border-border rounded-md px-2 py-1 text-[11px] text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
			<div className="flex items-center justify-between">
				<button type="button" onClick={() => propose.mutate()} disabled={propose.isPending}
					className="text-[11px] text-text-secondary hover:text-text-primary underline-offset-2 hover:underline disabled:opacity-50">
					{propose.isPending ? 'Re-proposing…' : 'Re-run proposal'}
				</button>
				{(confirm.isError || propose.isError) && <span className="text-[11px] text-danger">{(confirm.error || propose.error)?.message}</span>}
			</div>
		</div>
	);
}

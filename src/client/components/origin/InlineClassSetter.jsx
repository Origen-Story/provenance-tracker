import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import OriginBadge from './OriginBadge.jsx';
import { ORIGIN_CLASSES, originClassInfo } from './originClasses.js';

async function jsonOrThrow(r) {
	const j = await r.json();
	if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
	return j;
}

/**
 * Compact class control for table rows. Sets the asset's own class (the
 * same call as the detail page), with an optional reason that travels into
 * the output manifest. `asset` needs type, id, originClass,
 * originClassConfirmed and originClassNote.
 */
export default function InlineClassSetter({ asset, queryKeys = [] }) {
	const qc = useQueryClient();
	const [pending, setPending] = useState(null); // class chosen but not saved
	const [note, setNote] = useState('');

	const save = useMutation({
		mutationFn: ({ originClass, note }) => fetch(`/api/origin/${asset.type}/${asset.id}`, {
			method: 'PATCH', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ originClass, confirmed: true, note })
		}).then(jsonOrThrow),
		onSuccess: () => {
			setPending(null); setNote('');
			for (const key of queryKeys) qc.invalidateQueries({ queryKey: key });
			qc.invalidateQueries({ queryKey: ['relationships'] });
		}
	});

	if (!asset) return null;
	if (pending) {
		return (
			<div className="space-y-1 min-w-[14rem]">
				<div className="flex items-center gap-1">
					<select value={pending} onChange={e => setPending(e.target.value)} className="bg-card-bg border border-border rounded px-1 py-0.5 text-[11px] text-text-primary focus:outline-none focus:border-accent">
						{ORIGIN_CLASSES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
					</select>
				</div>
				<input value={note} onChange={e => setNote(e.target.value)} placeholder="Reason (optional, goes into the manifest)"
					className="w-full bg-card-bg border border-border rounded px-2 py-0.5 text-[11px] text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
				<div className="flex items-center gap-2">
					<button type="button" onClick={() => save.mutate({ originClass: pending, note })} disabled={save.isPending}
						className="px-2 py-0.5 bg-accent hover:bg-accent-hover text-white rounded text-[11px] font-medium disabled:opacity-40">{save.isPending ? 'Saving…' : 'Set'}</button>
					<button type="button" onClick={() => { setPending(null); setNote(''); }} className="text-[11px] text-text-secondary hover:text-text-primary">cancel</button>
					{save.isError && <span className="text-[11px] text-danger">{save.error.message}</span>}
				</div>
				<p className="text-[10px] text-text-secondary">{originClassInfo(pending).desc} Applies to the asset everywhere it is used.</p>
			</div>
		);
	}
	return (
		<div className="flex items-center gap-1.5">
			<OriginBadge originClass={asset.originClass} confirmed={asset.originClassConfirmed} note={asset.originClassNote} />
			<select value="" onChange={e => { if (e.target.value) { setPending(e.target.value); setNote(asset.originClassNote || ''); } }} title="Set this asset's origin class"
				className="bg-card-bg border border-border rounded px-1 py-0.5 text-[10px] text-text-secondary focus:outline-none focus:border-accent">
				<option value="">{asset.originClassConfirmed ? 'change…' : 'set…'}</option>
				{ORIGIN_CLASSES.map(c => <option key={c.value} value={c.value}>{c.short}</option>)}
			</select>
		</div>
	);
}

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import OriginBadge from './OriginBadge.jsx';
import { originClassDef } from './originClasses.js';
import { ClassSelect, AiAssistedCheck } from './ClassFields.jsx';

async function jsonOrThrow(r) {
	const j = await r.json();
	if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
	return j;
}

/**
 * Compact class control for table rows. Sets the asset's own class (the
 * same call as the detail page), with the AI-assisted flag where it applies
 * and an optional reason that travels into the output manifest. `asset` is
 * an asset reference: type, id, originClass, originClassConfirmed,
 * originClassNote, aiAssisted, signedBy, signerName.
 */
export default function InlineClassSetter({ asset, queryKeys = [] }) {
	const qc = useQueryClient();
	const [pending, setPending] = useState(null); // class chosen but not saved
	const [note, setNote] = useState('');
	const [aiAssisted, setAiAssisted] = useState(false);

	const close = () => { setPending(null); setNote(''); setAiAssisted(false); };
	const save = useMutation({
		mutationFn: () => fetch(`/api/origin/${asset.type}/${asset.id}`, {
			method: 'PATCH', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ originClass: pending, confirmed: true, note, aiAssisted })
		}).then(jsonOrThrow),
		onSuccess: () => {
			close();
			for (const key of queryKeys) qc.invalidateQueries({ queryKey: key });
			qc.invalidateQueries({ queryKey: ['relationships'] });
		}
	});

	if (!asset) return null;
	if (pending) {
		return (
			<div className="space-y-1 min-w-[15rem]">
				<ClassSelect size="sm" value={pending} onChange={(v) => { setPending(v); if (originClassDef(v).position !== 'digital') setAiAssisted(false); }} />
				<AiAssistedCheck compact originClass={pending} checked={aiAssisted} onChange={setAiAssisted} />
				<input value={note} onChange={e => setNote(e.target.value)} placeholder="Reason (optional, goes into the manifest)"
					className="w-full bg-card-bg border border-border rounded px-2 py-0.5 text-[11px] text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
				<div className="flex items-center gap-2">
					<button type="button" onClick={() => save.mutate()} disabled={save.isPending}
						className="px-2 py-0.5 bg-accent hover:bg-accent-hover text-white rounded text-[11px] font-medium disabled:opacity-40">{save.isPending ? 'Saving…' : 'Set'}</button>
					<button type="button" onClick={close} className="text-[11px] text-text-secondary hover:text-text-primary">cancel</button>
					{save.isError && <span className="text-[11px] text-danger">{save.error.message}</span>}
				</div>
				<p className="text-[10px] text-text-secondary">{originClassDef(pending).desc} Applies to the asset everywhere it is used.</p>
			</div>
		);
	}
	const open = () => { setPending(asset.originClass || 'unknown'); setNote(asset.originClassNote || ''); setAiAssisted(!!asset.aiAssisted); };
	return (
		<div className="flex items-center gap-1.5">
			<OriginBadge asset={asset} />
			<button type="button" onClick={open} title="Set this asset's origin class"
				className="text-[10px] text-text-secondary hover:text-text-primary border border-border rounded px-1 py-0.5">
				{asset.originClassConfirmed ? 'change' : 'set'}
			</button>
		</div>
	);
}

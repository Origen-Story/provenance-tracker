import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { originInfo, originClassDef, pillStyle, explainSource, SIGNED_BY_LABELS } from './originClasses.js';
import { ClassSelect, AiAssistedCheck } from './ClassFields.jsx';

async function jsonOrThrow(r) {
	const j = await r.json();
	if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
	return j;
}

/**
 * Shows the asset's origin class with the rule that proposed it, who signed
 * the file, and lets the user confirm the class or pick another, with a
 * reason. `type` is ai | archival | produced.
 */
export default function OriginClassControl({ type, id, asset, queryKeys = [] }) {
	const qc = useQueryClient();
	const [selected, setSelected] = useState(asset?.originClass || 'unknown');
	const [note, setNote] = useState(asset?.originClassNote || '');
	const [aiAssisted, setAiAssisted] = useState(!!asset?.aiAssisted);
	useEffect(() => { setSelected(asset?.originClass || 'unknown'); }, [asset?.originClass]);
	useEffect(() => { setNote(asset?.originClassNote || ''); }, [asset?.originClassNote]);
	useEffect(() => { setAiAssisted(!!asset?.aiAssisted); }, [asset?.aiAssisted]);

	const invalidate = () => {
		for (const key of queryKeys) qc.invalidateQueries({ queryKey: key });
		qc.invalidateQueries({ queryKey: ['relationships'] });
		qc.invalidateQueries({ queryKey: ['timeline'] });
		qc.invalidateQueries({ queryKey: ['outputs'] });
	};

	const confirm = useMutation({
		mutationFn: () => fetch(`/api/origin/${type}/${id}`, {
			method: 'PATCH', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ originClass: selected, confirmed: true, note, aiAssisted })
		}).then(jsonOrThrow),
		onSuccess: invalidate
	});

	const propose = useMutation({
		mutationFn: () => fetch(`/api/origin/${type}/${id}/propose`, { method: 'POST' }).then(jsonOrThrow),
		onSuccess: invalidate
	});

	if (!asset) return null;
	const current = originInfo(asset);
	const confirmed = !!asset.originClassConfirmed;
	const dirty = selected !== asset.originClass || note !== (asset.originClassNote || '') || aiAssisted !== !!asset.aiAssisted;
	// Only an unknown class asks for attention. A proposal from metadata is
	// used as-is everywhere; confirming it is optional.
	const needsAttention = current.code === 'unknown';

	return (
		<div className={`border rounded-lg p-3 space-y-2 ${needsAttention ? 'bg-amber-500/5 border-amber-500/30' : 'bg-card-bg border-border'}`}>
			<div className="flex items-center justify-between gap-2">
				<span className="text-xs font-medium text-text-secondary">Origin class</span>
				<span className="border rounded px-2 py-0.5 text-xs font-medium" style={pillStyle(current.position)}>{current.label}</span>
			</div>
			<p className="text-[11px] text-text-secondary">
				{current.positionLabel}{current.code !== 'unknown' && <> · IPTC <code className="text-text-primary">{current.code}</code></>}
				{type === 'archival' && ' · from an archive'}
			</p>
			<p className="text-xs text-text-secondary">
				{confirmed ? 'Confirmed.' : needsAttention ? 'Needs a decision.' : 'Proposed from metadata; confirm only if you want to vouch for it.'}{' '}
				{explainSource(asset.originClassSource)}
			</p>
			{asset.signedBy && (
				<p className="text-[11px] text-text-secondary">
					<span className="text-success">✓ Signed</span> by {SIGNED_BY_LABELS[asset.signedBy] || asset.signedBy}{asset.signerName ? `: ${asset.signerName}` : ''}.
				</p>
			)}
			<div className="flex gap-2">
				<ClassSelect value={selected} onChange={(v) => { setSelected(v); if (originClassDef(v).position !== 'digital') setAiAssisted(false); }} />
				<button type="button" onClick={() => confirm.mutate()} disabled={confirm.isPending || (confirmed && !dirty)}
					className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-md text-xs font-medium disabled:opacity-40 transition-colors">
					{confirm.isPending ? 'Saving…' : dirty ? 'Set' : confirmed ? 'Confirmed' : 'Confirm'}
				</button>
			</div>
			<p className="text-[11px] text-text-secondary">{originClassDef(selected).desc}</p>
			<AiAssistedCheck originClass={selected} checked={aiAssisted} onChange={setAiAssisted} />
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

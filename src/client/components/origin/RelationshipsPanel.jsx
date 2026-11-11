import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import OriginBadge from './OriginBadge.jsx';
import AssetPicker from './AssetPicker.jsx';
import { DETAIL_PATHS, TYPE_LABELS } from './originClasses.js';

// Group headings by direction and relationship type, so a row never needs a
// verb: on an output's page the parents are its "Ingredients".
const PARENT_GROUPS = [
	{ types: ['derived_from'], title: 'Derived from', hint: 'the source this enhanced copy was made from' },
	{ types: ['ingredient', 'output_of'], title: 'Ingredients', hint: 'what went into this edit' }
];
const CHILD_GROUPS = [
	{ types: ['derived_from'], title: 'Enhanced copies', hint: 'upscales and restorations made from this asset' },
	{ types: ['ingredient', 'output_of'], title: 'Used in', hint: 'edits this asset is part of' }
];
const METHOD_LABELS = { timeline: 'timeline', filename_pattern: 'filename pattern', manual: 'by hand', c2pa_ingredient: 'credentials' };

async function jsonOrThrow(r) {
	const j = await r.json();
	if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
	return j;
}

function linkedBy(rel) {
	const label = METHOD_LABELS[rel.matchMethod] || rel.matchMethod || '';
	const conf = rel.confidence != null && rel.confidence < 1 ? `, ${Math.round(rel.confidence * 100)}%` : '';
	return `${label}${conf}`;
}

function Group({ title, hint, rows, onUnlink }) {
	if (!rows.length) return null;
	return (
		<div>
			<div className="flex items-baseline gap-2 mb-1">
				<span className="text-xs font-medium text-text-primary">{title} ({rows.length})</span>
				<span className="text-[10px] text-text-secondary">{hint}</span>
			</div>
			<table className="w-full text-xs">
				<thead>
					<tr className="text-left text-[10px] text-text-secondary">
						<th className="pb-0.5 font-medium">Asset</th>
						<th className="pb-0.5 font-medium">Class</th>
						<th className="pb-0.5 font-medium">Linked by</th>
						<th className="pb-0.5" />
					</tr>
				</thead>
				<tbody>
					{rows.map(rel => (
						<tr key={rel.id} className="border-t border-border/60">
							<td className="py-1 pr-2 max-w-[14rem]">
								{rel.asset ? (
									<div className="flex items-center gap-1.5 min-w-0">
										<span className="text-[10px] text-text-secondary shrink-0 w-12">{TYPE_LABELS[rel.asset.type]}</span>
										<Link to={`${DETAIL_PATHS[rel.asset.type]}/${rel.asset.id}`} className="text-text-primary hover:text-accent truncate" title={rel.asset.filename}>{rel.asset.label}</Link>
									</div>
								) : <span className="text-text-secondary">missing asset</span>}
							</td>
							<td className="py-1 pr-2">{rel.asset && <OriginBadge originClass={rel.asset.originClass} confirmed={rel.asset.originClassConfirmed} note={rel.asset.originClassNote} />}</td>
							<td className="py-1 pr-2 text-[10px] text-text-secondary whitespace-nowrap" title={rel.notes || ''}>{linkedBy(rel)}</td>
							<td className="py-1 text-right"><button type="button" onClick={() => onUnlink(rel.id)} className="text-[11px] text-text-secondary hover:text-danger" title="Remove link">unlink</button></td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/**
 * Links to and from this asset, grouped by what they mean, plus a form to
 * add one by searching the project's assets. `type` is ai | archival | produced.
 */
export default function RelationshipsPanel({ type, id, queryKeys = [] }) {
	const qc = useQueryClient();
	const [adding, setAdding] = useState(false);
	const [direction, setDirection] = useState('parent'); // 'parent': picked asset is the source of this one
	const [relType, setRelType] = useState('derived_from');
	const [picked, setPicked] = useState(null);

	const rels = useQuery({
		queryKey: ['relationships', type, id],
		queryFn: () => fetch(`/api/relationships/${type}/${id}`).then(jsonOrThrow)
	});

	const invalidate = () => {
		qc.invalidateQueries({ queryKey: ['relationships'] });
		for (const key of queryKeys) qc.invalidateQueries({ queryKey: key });
	};

	const link = useMutation({
		mutationFn: () => {
			const self = { type, id: Number(id) };
			const other = { type: picked.type, id: picked.id };
			const parent = direction === 'parent' ? other : self;
			const child = direction === 'parent' ? self : other;
			return fetch('/api/relationships', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ parentType: parent.type, parentId: parent.id, childType: child.type, childId: child.id, relationshipType: relType })
			}).then(jsonOrThrow);
		},
		onSuccess: () => { setPicked(null); setAdding(false); invalidate(); }
	});

	const unlink = useMutation({
		mutationFn: (relId) => fetch(`/api/relationships/${relId}`, { method: 'DELETE' }).then(jsonOrThrow),
		onSuccess: invalidate
	});

	const parents = rels.data?.parents || [];
	const children = rels.data?.children || [];
	const selfIsChild = direction === 'parent';

	return (
		<div className="bg-card-bg border border-border rounded-lg p-3 space-y-3">
			<div className="flex items-center justify-between">
				<span className="text-xs font-medium text-text-secondary">Relationships</span>
				<button type="button" onClick={() => setAdding(a => !a)} className="text-[11px] text-accent hover:text-accent-hover">
					{adding ? 'Cancel' : '+ Add link'}
				</button>
			</div>

			{rels.isLoading && <p className="text-xs text-text-secondary">Loading…</p>}
			{!rels.isLoading && parents.length === 0 && children.length === 0 && !adding && (
				<p className="text-xs text-text-secondary">No links yet. An upscale or edit should point at the asset it was made from.</p>
			)}
			{PARENT_GROUPS.map(g => <Group key={g.title} title={g.title} hint={g.hint} rows={parents.filter(r => g.types.includes(r.relationshipType))} onUnlink={unlink.mutate} />)}
			{CHILD_GROUPS.map(g => <Group key={g.title} title={g.title} hint={g.hint} rows={children.filter(r => g.types.includes(r.relationshipType))} onUnlink={unlink.mutate} />)}

			{adding && (
				<div className="border-t border-border pt-2 space-y-2">
					<div className="flex gap-2">
						<select value={direction} onChange={e => setDirection(e.target.value)}
							className="flex-1 bg-card-bg border border-border rounded-md px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent">
							<option value="parent">This asset was made from…</option>
							<option value="child">This asset was used to make…</option>
						</select>
						<select value={relType} onChange={e => setRelType(e.target.value)}
							className="bg-card-bg border border-border rounded-md px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent">
							<option value="derived_from">{selfIsChild ? 'derived from (enhanced copy)' : 'source of (enhanced copy)'}</option>
							<option value="ingredient">{selfIsChild ? 'made from (ingredient)' : 'ingredient of'}</option>
							<option value="output_of">{selfIsChild ? 'output of' : 'used in'}</option>
						</select>
					</div>
					{!picked && <AssetPicker onPick={setPicked} exclude={{ type, id: Number(id) }} />}
					{picked && (
						<div className="flex items-center gap-2 text-xs">
							<span className="text-text-secondary">Selected:</span>
							<span className="text-text-primary truncate" title={picked.filename}>{picked.label}</span>
							<button type="button" onClick={() => setPicked(null)} className="text-[11px] text-text-secondary hover:text-text-primary">change</button>
							<button type="button" onClick={() => link.mutate()} disabled={link.isPending}
								className="ml-auto px-3 py-1 bg-accent hover:bg-accent-hover text-white rounded-md text-xs font-medium disabled:opacity-40">
								{link.isPending ? 'Linking…' : 'Link'}
							</button>
						</div>
					)}
					{link.isError && <p className="text-xs text-danger">{link.error.message}</p>}
				</div>
			)}
			{unlink.isError && <p className="text-xs text-danger">{unlink.error.message}</p>}
		</div>
	);
}

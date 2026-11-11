import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import OriginBadge from './OriginBadge.jsx';
import { TYPE_LABELS } from './originClasses.js';

async function jsonOrThrow(r) {
	const j = await r.json();
	if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
	return j;
}

/**
 * Search box plus result list for choosing one of the project's assets.
 * Opens with the most recent assets listed, so there is always something to
 * pick; typing narrows it. Each row shows the asset's label and its file
 * name, since an AI asset's label is an ID.
 */
export default function AssetPicker({ onPick, onCancel, exclude = null, placeholder = 'Type an ID or part of a file name…' }) {
	const [q, setQ] = useState('');
	const search = useQuery({
		queryKey: ['relationships-search', q.trim()],
		queryFn: () => fetch(`/api/relationships/search?q=${encodeURIComponent(q.trim())}`).then(jsonOrThrow)
	});
	const results = (search.data?.results || []).filter(r => !(exclude && r.type === exclude.type && r.id === exclude.id));
	return (
		<div className="space-y-1 min-w-[16rem]">
			<input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder}
				className="w-full bg-card-bg border border-border rounded px-2 py-1 text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
			{search.isError && <p className="text-[11px] text-danger">{search.error.message}</p>}
			{search.isLoading && <p className="text-[11px] text-text-secondary">Searching…</p>}
			{!search.isLoading && !search.isError && results.length === 0 && (
				<p className="text-[11px] text-amber-400">{q.trim() ? `No asset matches "${q.trim()}". Try fewer words, or import the file first.` : 'This project has no assets yet.'}</p>
			)}
			{results.length > 0 && (
				<>
					{!q.trim() && <p className="text-[10px] text-text-secondary">Most recent assets. Type to search.</p>}
					<ul className="max-h-44 overflow-y-auto border border-border rounded divide-y divide-border bg-card-bg">
						{results.map(r => (
							<li key={`${r.type}-${r.id}`}>
								<button type="button" onClick={() => onPick(r)} className="w-full text-left px-2 py-1 text-xs hover:bg-card-hover flex items-center gap-2">
									<span className="text-[10px] text-text-secondary w-14 shrink-0">{TYPE_LABELS[r.type]}</span>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-text-primary">{r.label}</span>
										{r.filename && r.filename !== r.label && <span className="block truncate text-[10px] text-text-secondary" title={r.filename}>{r.filename}</span>}
									</span>
									<OriginBadge asset={r} className="shrink-0" />
								</button>
							</li>
						))}
					</ul>
				</>
			)}
			{onCancel && <button type="button" onClick={onCancel} className="text-[11px] text-text-secondary hover:text-text-primary">cancel</button>}
		</div>
	);
}

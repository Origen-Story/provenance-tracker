// The name the public viewer shows for an asset or an output (statement v2).
// It is signed into the creator statement, so it should be set before the
// output is signed; changing it afterwards does not change a signed file.
import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

const MAX = 120; // PUBLIC_TITLE_MAX in src/server/lib/manifest/build.js

export default function PublicTitleField({ type, id, asset, fileName = '', queryKeys = [], label = 'Public title' }) {
	const qc = useQueryClient();
	const saved = asset?.publicTitle || '';
	const [value, setValue] = useState(saved);
	useEffect(() => { setValue(saved); }, [saved]);

	const save = useMutation({
		mutationFn: async () => {
			const r = await fetch(`/api/origin/${type}/${id}/public-title`, {
				method: 'PATCH', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ publicTitle: value })
			});
			const j = await r.json();
			if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
			return j;
		},
		onSuccess: () => {
			for (const key of queryKeys) qc.invalidateQueries({ queryKey: key });
			qc.invalidateQueries({ queryKey: ['outputs'] });
			qc.invalidateQueries({ queryKey: ['statement'] });
		}
	});

	if (!asset) return null;
	const dirty = value.trim() !== saved;
	return (
		<div className="border border-border rounded-lg p-3 space-y-1.5 bg-card-bg">
			<label htmlFor={`public-title-${type}-${id}`} className="text-xs font-medium text-text-secondary">{label}</label>
			<div className="flex gap-2">
				<input id={`public-title-${type}-${id}`} value={value} maxLength={MAX}
					onChange={e => setValue(e.target.value)}
					onKeyDown={e => { if (e.key === 'Enter' && dirty) save.mutate(); }}
					placeholder={fileName || 'Name shown on the public page'}
					className="flex-1 min-w-0 bg-card-bg border border-border rounded-md px-2 py-1 text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
				<button type="button" onClick={() => save.mutate()} disabled={!dirty || save.isPending}
					className="px-3 py-1 bg-accent hover:bg-accent-hover text-white rounded-md text-xs font-medium disabled:opacity-40 transition-colors">
					{save.isPending ? 'Saving…' : 'Save'}
				</button>
			</div>
			<p className="text-[11px] text-text-secondary">
				The name the public page shows. It is signed into the creator statement, so set it before signing. Leave it empty to use the file name.
			</p>
			{save.isError && <p className="text-[11px] text-danger">{save.error.message}</p>}
		</div>
	);
}

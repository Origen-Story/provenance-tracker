// Export tab (phase 4d): the public export of a signed copy, the JSON file a
// public page renders. It is made from the signed copy's record, so it shows
// what is in that file, not the timeline as it is now.
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { StatusPill, fileName } from '../../components/SignedCopies.jsx';
import { fmtClock } from '../../components/timeline/LaneStrip.jsx';

async function jsonOrThrow(r) {
	const j = await r.json();
	if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
	return j;
}

const fmtBytes = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round((n || 0) / 1e3)} KB`);

export default function ExportPanel({ producedId }) {
	const sigs = useQuery({ queryKey: ['signatures', 'produced', String(producedId)], queryFn: () => fetch(`/api/outputs/${producedId}/signatures`).then(jsonOrThrow) });
	const outputs = (sigs.data?.signatures || []).filter(s => s.kind === 'output');
	const [selected, setSelected] = useState(null);
	useEffect(() => { if (selected == null && outputs.length) setSelected(outputs[0].id); }, [outputs.length]);

	const preview = useQuery({
		queryKey: ['public-export', String(producedId), selected],
		enabled: selected != null,
		retry: false,
		queryFn: () => fetch(`/api/outputs/${producedId}/public-export?signature=${selected}`).then(jsonOrThrow)
	});
	const e = preview.data;

	if (sigs.isLoading) return <p className="text-sm text-text-secondary">Loading…</p>;
	if (!outputs.length) {
		return <p className="text-sm text-text-secondary">Sign the output on the Credentials tab first. The public export is made from a signed copy.</p>;
	}

	return (
		<div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6">
			<div className="space-y-3">
				<div className="bg-card-bg border border-border rounded-lg p-4 space-y-2">
					<h3 className="text-sm font-medium text-text-primary">Public export</h3>
					<p className="text-xs text-text-secondary">
						A JSON file for the public viewer: the composition strip, your statement, the ingredients with their public titles, and how the signed copy read back. It holds file names but no paths. It is made from the signed copy you pick, so it matches that file exactly.
					</p>
					<p className="text-xs text-text-secondary">Publish the signed copy itself alongside it: the export carries its SHA-256 so anyone can check the download.</p>
				</div>
				<div className="space-y-2">
					{outputs.map(s => (
						<label key={s.id} className={`flex items-center gap-2 border rounded-lg p-2.5 cursor-pointer ${selected === s.id ? 'border-accent bg-accent/5' : 'border-border bg-card-bg'}`}>
							<input type="radio" name="export-signature" checked={selected === s.id} onChange={() => setSelected(s.id)} />
							<span className="text-xs text-text-secondary">v{s.version}</span>
							<span className="text-sm font-mono truncate" title={s.signedPath}>{fileName(s.signedPath)}</span>
							<StatusPill verification={s.verification} />
							<span className="text-[11px] text-text-secondary ml-auto">{new Date(s.createdAt).toLocaleString()}</span>
						</label>
					))}
				</div>
			</div>

			<div className="space-y-3">
				{preview.isLoading && <p className="text-sm text-text-secondary">Building the export…</p>}
				{preview.isError && <p className="text-sm text-amber-300">{preview.error.message}</p>}
				{e && (
					<div className="bg-card-bg border border-border rounded-lg p-4 space-y-3">
						<div className="flex items-center gap-2 flex-wrap">
							<h3 className="text-sm font-medium text-text-primary">{e.film.title}</h3>
							<span className="text-xs text-text-secondary">{fmtClock(e.film.durationSeconds)}</span>
							<a href={`/api/outputs/${producedId}/public-export?signature=${selected}&download=1`}
								className="ml-auto px-3 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-md text-xs font-medium">
								Download export JSON
							</a>
						</div>
						<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
							<dt className="text-text-secondary">Ingredients</dt><dd>{e.ingredients.length}{e.ingredients.some(i => i.title === i.fileName) && <span className="text-amber-300"> · {e.ingredients.filter(i => i.title === i.fileName).length} without a public title (the page shows the file name)</span>}</dd>
							<dt className="text-text-secondary">Timeline</dt><dd>{e.composition.picture?.intervals.length || 0} picture and {e.composition.audio?.intervals.length || 0} sound sections</dd>
							<dt className="text-text-secondary">Statement</dt><dd className="truncate">{e.statement.text ? `${e.statement.text.slice(0, 90)}${e.statement.text.length > 90 ? '…' : ''}` : <span className="text-amber-300">empty</span>}</dd>
							<dt className="text-text-secondary">Signed file</dt><dd className="font-mono truncate" title={e.signedFile.sha256}>{e.signedFile.fileName} · {fmtBytes(e.signedFile.bytes)} · SHA-256 {e.signedFile.sha256.slice(0, 12)}…</dd>
							<dt className="text-text-secondary">Signature</dt><dd>{e.signature.statusLabel}{e.signature.signer?.commonName ? `, ${e.signature.signer.commonName}` : ''}{e.signature.timestamped ? ', time-stamped' : ', no trusted time stamp'}</dd>
						</dl>
						{e.untracked.length > 0 && <p className="text-[11px] text-amber-300">{e.untracked.length} clip{e.untracked.length === 1 ? '' : 's'} not tied to a tracked asset. The page lists them by time only.</p>}
						<details>
							<summary className="text-[11px] text-text-secondary cursor-pointer">Show the JSON</summary>
							<pre className="mt-2 text-[10px] leading-snug max-h-96 overflow-auto bg-black/20 rounded p-2">{JSON.stringify(e, null, 2)}</pre>
						</details>
					</div>
				)}
			</div>
		</div>
	);
}

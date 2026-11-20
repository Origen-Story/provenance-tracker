// Credentials tab (phase 4c): sign a new versioned copy of the finished edit
// and see how each signed copy reads back.
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SignatureCard } from '../../components/SignedCopies.jsx';

async function jsonOrThrow(r) {
	const j = await r.json();
	if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
	return j;
}

const RELATIONSHIP = { parentOf: 'parent (the export)', componentOf: 'placed' };

export default function CredentialsPanel({ producedId }) {
	const qc = useQueryClient();
	const [timestamp, setTimestamp] = useState(true);
	const sigs = useQuery({ queryKey: ['signatures', 'produced', String(producedId)], queryFn: () => fetch(`/api/outputs/${producedId}/signatures`).then(jsonOrThrow) });
	const statement = useQuery({ queryKey: ['statement', producedId], queryFn: () => fetch(`/api/outputs/${producedId}/statement`).then(jsonOrThrow) });
	const sign = useMutation({
		mutationFn: () => fetch(`/api/outputs/${producedId}/sign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ timestamp }) }).then(jsonOrThrow),
		onSuccess: () => qc.invalidateQueries({ queryKey: ['signatures', 'produced', String(producedId)] })
	});

	const list = sigs.data?.signatures || [];
	const certOk = sigs.data?.certificateConfigured;
	const hasStatement = !!statement.data?.saved?.text;
	const blocker = !certOk ? 'No signing certificate is set for this project. Add the certificate and key paths in Project Settings.'
		: !hasStatement ? 'Write and save the creator statement first.'
		: null;

	return (
		<div className="space-y-6 max-w-3xl">
			<div className="bg-card-bg border border-border rounded-lg p-4 space-y-3">
				<h3 className="text-sm font-medium text-text-primary">Sign this edit</h3>
				<p className="text-xs text-text-secondary">Writes a new file beside the export, <code>…signed.v{(list[0]?.version || 0) + 1}</code>, with Content Credentials: the export as parent, each tracked asset as a placed ingredient with its class, and your statement. The export itself is not changed. Ingredients that carry their own credentials keep them inside the new file.</p>
				<label className="flex items-center gap-2 text-xs text-text-primary cursor-pointer">
					<input type="checkbox" checked={timestamp} onChange={e => setTimestamp(e.target.checked)} />
					Add a trusted time stamp <span className="text-text-secondary">(sends a hash of the manifest, not the video, to DigiCert's time-stamp server)</span>
				</label>
				<div className="flex items-center gap-3">
					<button type="button" disabled={!!blocker || sign.isPending} onClick={() => sign.mutate()}
						className="px-4 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-md text-xs font-medium disabled:opacity-40">
						{sign.isPending ? 'Signing…' : 'Sign a new copy'}
					</button>
					{blocker && <span className="text-xs text-amber-400">{blocker}</span>}
					{sign.isError && <span className="text-xs text-danger">{sign.error.message}</span>}
				</div>
			</div>

			{list.length === 0 && !sigs.isLoading && <p className="text-sm text-text-secondary">Not signed yet.</p>}
			{list.map(sig => (
				<SignatureCard key={sig.id} sig={sig}>
					{sig.verification?.ingredients?.length > 0 && (
						<details className="text-xs">
							<summary className="cursor-pointer text-text-secondary hover:text-text-primary">{sig.verification.ingredients.length} ingredients, {sig.verification.manifests} manifests in the file</summary>
							<table className="w-full mt-1">
								<tbody>
									{sig.verification.ingredients.map((i, n) => (
										<tr key={n} className="border-t border-border/60">
											<td className="py-1 pr-2 truncate max-w-[16rem]" title={i.title}>{i.title}</td>
											<td className="py-1 pr-2 text-text-secondary">{RELATIONSHIP[i.relationship] || i.relationship}</td>
											<td className={`py-1 pr-2 ${i.credentials === 'none' ? 'text-amber-300' : 'text-text-secondary'}`}>{i.credentials === 'none' ? 'no credentials of its own' : 'own credentials kept'}</td>
											<td className="py-1 text-danger">{i.problems.map(p => p.code).join(', ')}</td>
										</tr>
									))}
								</tbody>
							</table>
						</details>
					)}
					<p className="text-[11px] text-text-secondary break-all">Check it yourself, from the tracker's folder: <code className="bg-border/40 px-1 rounded select-all">tools\c2patool\c2patool.exe "{sig.signedPath}"</code></p>
				</SignatureCard>
			))}
		</div>
	);
}

// "Sign with Content Credentials" modal — used on both produced-asset and
// AI-asset detail pages. Posts to /api/sign/:type/:id and refreshes the asset
// query on success.
//
// Pre-fills creator/org/CAWG fields from the active project so the user can
// just click through. Tool name and "AI generated?" are the only fields that
// usually need touching per-asset.
import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export default function SignAssetModal({ assetType, assetId, onClose, defaultIsAi = false, defaultTool = '' }) {
	const qc = useQueryClient();

	const { data: project } = useQuery({
		queryKey: ['activeProject'],
		queryFn: () => fetch('/api/projects/active').then(r => r.json())
	});

	const [creatorName, setCreatorName] = useState('');
	const [organization, setOrganization] = useState('');
	const [toolUsed, setToolUsed] = useState(defaultTool);
	const [isAiGenerated, setIsAiGenerated] = useState(defaultIsAi);
	const [cawgIdentityUrl, setCawgIdentityUrl] = useState('');
	const [cawgIdentityName, setCawgIdentityName] = useState('');
	const [trainingMiningOptOut, setTrainingMiningOptOut] = useState(true);

	useEffect(() => {
		if (project) {
			setCreatorName(project.cawgIdentityName || '');
			setOrganization('');
			setCawgIdentityUrl(project.cawgIdentityUrl || '');
			setCawgIdentityName(project.cawgIdentityName || '');
		}
	}, [project]);

	const sign = useMutation({
		mutationFn: async () => {
			const res = await fetch(`/api/sign/${assetType}/${assetId}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ creatorName, organization, toolUsed, isAiGenerated, cawgIdentityUrl, cawgIdentityName, trainingMiningOptOut })
			});
			const body = await res.json();
			if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
			return body;
		},
		onSuccess: () => {
			const queryKey = assetType === 'produced' ? 'produced' : 'asset';
			qc.invalidateQueries({ queryKey: [queryKey, String(assetId)] });
			qc.invalidateQueries({ queryKey: [queryKey, assetId] });
			qc.invalidateQueries({ queryKey: [`${assetType}-list`] });
			onClose();
		}
	});

	const certConfigured = !!(project?.certificatePath && project?.privateKeyPath);

	return (
		<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
			<div className="bg-card-bg border border-border rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
				<h3 className="text-lg font-bold text-text-primary mb-1">Sign with Content Credentials</h3>
				<p className="text-xs text-text-secondary mb-4">Embeds a C2PA manifest into a copy of this file. Original is preserved.</p>

				{!certConfigured && (
					<div className="bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs rounded-lg px-3 py-2 mb-4">
						No certificate configured. Run <code className="bg-border/40 px-1 rounded">npm run cert:generate</code> and add the paths in Project Settings.
					</div>
				)}

				<div className="space-y-3">
					<div>
						<label className="block text-xs font-medium text-text-primary mb-1">Creator name</label>
						<input type="text" value={creatorName} onChange={e => setCreatorName(e.target.value)}
							className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent" />
					</div>
					<div>
						<label className="block text-xs font-medium text-text-primary mb-1">Organization <span className="text-text-secondary">(optional)</span></label>
						<input type="text" value={organization} onChange={e => setOrganization(e.target.value)}
							className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent" />
					</div>
					<div>
						<label className="block text-xs font-medium text-text-primary mb-1">Tool used</label>
						<input type="text" value={toolUsed} onChange={e => setToolUsed(e.target.value)}
							placeholder="e.g. Adobe Audition 25.x, ElevenLabs"
							className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
					</div>
					<label className="flex items-center gap-2 cursor-pointer">
						<input type="checkbox" checked={isAiGenerated} onChange={e => setIsAiGenerated(e.target.checked)} className="w-4 h-4 accent-accent" />
						<span className="text-sm text-text-primary">AI generated</span>
					</label>
					<label className="flex items-center gap-2 cursor-pointer">
						<input type="checkbox" checked={trainingMiningOptOut} onChange={e => setTrainingMiningOptOut(e.target.checked)} className="w-4 h-4 accent-accent" />
						<span className="text-sm text-text-primary">Opt out of AI training/mining</span>
					</label>
					<div className="border-t border-border pt-3 space-y-3">
						<p className="text-xs font-medium text-text-secondary uppercase tracking-wide">CAWG identity (optional)</p>
						<div>
							<label className="block text-xs font-medium text-text-primary mb-1">Identity URL</label>
							<input type="text" value={cawgIdentityUrl} onChange={e => setCawgIdentityUrl(e.target.value)}
								className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent" />
						</div>
						<div>
							<label className="block text-xs font-medium text-text-primary mb-1">Identity name</label>
							<input type="text" value={cawgIdentityName} onChange={e => setCawgIdentityName(e.target.value)}
								className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent" />
						</div>
					</div>
				</div>

				{sign.isError && (
					<div className="bg-danger/10 border border-danger/30 text-danger text-xs rounded-lg px-3 py-2 mt-4">
						{sign.error?.message || 'Signing failed'}
					</div>
				)}

				<div className="flex justify-end gap-2 mt-5">
					<button onClick={onClose}
						className="px-4 py-2 bg-card-bg border border-border hover:bg-card-hover text-text-primary rounded-lg text-sm transition-colors">
						Cancel
					</button>
					<button onClick={() => sign.mutate()} disabled={!certConfigured || !creatorName || !toolUsed || sign.isPending}
						className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40">
						{sign.isPending ? 'Signing…' : 'Sign asset'}
					</button>
				</div>
			</div>
		</div>
	);
}

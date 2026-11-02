import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import SignAssetModal from '../../components/SignAssetModal.jsx';

const ASSET_TYPES = ['audio', 'video', 'image', 'document', 'other'];

export default function ProducedDetail() {
	const { id } = useParams();
	const navigate = useNavigate();
	const qc = useQueryClient();
	const [saved, setSaved] = useState(false);
	const [signOpen, setSignOpen] = useState(false);

	const { data: asset, isLoading } = useQuery({
		queryKey: ['produced', id],
		queryFn: () => fetch(`/api/produced/${id}`).then(r => r.json())
	});

	const update = useMutation({
		mutationFn: (data) => fetch(`/api/produced/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(data)
		}).then(r => r.json()),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['produced', id] });
			qc.invalidateQueries({ queryKey: ['produced'] });
			setSaved(true);
			setTimeout(() => setSaved(false), 3000);
		}
	});

	const del = useMutation({
		mutationFn: () => fetch(`/api/produced/${id}`, { method: 'DELETE' }).then(r => r.json()),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['produced'] });
			navigate('/produced');
		}
	});

	function handleSubmit(e) {
		e.preventDefault();
		const form = new FormData(e.target);
		update.mutate(Object.fromEntries(form));
	}

	if (isLoading) return <p className="text-text-secondary text-sm p-8">Loading...</p>;
	if (!asset || asset.error) return <p className="text-danger text-sm p-8">Asset not found.</p>;

	let exif = {};
	try { exif = JSON.parse(asset.exifJson || '{}'); } catch {}

	return (
		<div>
			<div className="mb-6 flex items-center gap-2 text-sm text-text-secondary">
				<Link to="/produced" className="hover:text-text-primary transition-colors">Produced Assets</Link>
				<span>/</span>
				<span className="text-text-primary">{asset.name || 'Untitled'}</span>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
				{/* Left: preview + file info */}
				<div className="space-y-4">
					{asset.mimeType?.startsWith('image/') && (
						<div className="bg-card-bg border border-border rounded-lg overflow-hidden">
							<img src={`/api/preview?path=${encodeURIComponent(asset.filePath)}`}
								alt={asset.name} className="w-full object-cover" />
						</div>
					)}
					{asset.mimeType?.startsWith('audio/') && (
						<div className="bg-card-bg border border-border rounded-lg p-4 flex items-center justify-center">
							<svg className="w-12 h-12 text-text-secondary opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
								<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
							</svg>
						</div>
					)}

					<div className="bg-card-bg border border-border rounded-lg p-3 space-y-1.5 text-xs">
						<div className="flex justify-between"><span className="text-text-secondary">File</span><span className="text-text-primary font-mono">{asset.filename}</span></div>
						<div className="flex justify-between"><span className="text-text-secondary">Size</span><span className="text-text-primary">{(asset.fileSize / 1024).toFixed(0)} KB</span></div>
						<div className="flex justify-between"><span className="text-text-secondary">MIME</span><span className="text-text-primary">{asset.mimeType}</span></div>
						{asset.fileHash && <div className="flex justify-between"><span className="text-text-secondary">Hash</span><span className="text-text-primary font-mono text-xs">{asset.fileHash.slice(0, 16)}...</span></div>}
						{asset.c2paJson && <div className="flex justify-between"><span className="text-text-secondary">C2PA</span><span className="text-success">Manifest found</span></div>}
						{asset.originalFilePath && <div className="flex justify-between"><span className="text-text-secondary">Original</span><span className="text-text-primary font-mono text-xs truncate max-w-[60%]" title={asset.originalFilePath}>{asset.originalFilePath.split(/[\\/]/).pop()}</span></div>}
					</div>

					{!asset.c2paJson && (
						<button onClick={() => setSignOpen(true)}
							className="w-full px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2">
							<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
							Sign with Content Credentials
						</button>
					)}

					{Object.keys(exif).length > 0 && (
						<details className="bg-card-bg border border-border rounded-lg">
							<summary className="px-3 py-2 text-xs font-medium text-text-secondary cursor-pointer hover:text-text-primary">
								EXIF data ({Object.keys(exif).length} fields)
							</summary>
							<div className="px-3 pb-3 space-y-1 max-h-64 overflow-y-auto">
								{Object.entries(exif).slice(0, 40).map(([k, v]) => (
									<div key={k} className="flex justify-between gap-2 text-xs">
										<span className="text-text-secondary shrink-0">{k}</span>
										<span className="text-text-primary text-right truncate">{String(v)}</span>
									</div>
								))}
							</div>
						</details>
					)}
				</div>

				{/* Right: edit form */}
				<form onSubmit={handleSubmit} className="lg:col-span-2 space-y-4">
					{saved && <div className="bg-success/10 border border-success/30 text-success text-sm rounded-lg px-4 py-2">Saved.</div>}

					<div className="grid grid-cols-2 gap-4">
						<div className="col-span-2">
							<label className="block text-sm font-medium text-text-primary mb-1">Name</label>
							<input name="name" type="text" defaultValue={asset.name}
								className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
						</div>
						<div className="col-span-2">
							<label className="block text-sm font-medium text-text-primary mb-1">Description</label>
							<textarea name="description" rows={2} defaultValue={asset.description}
								className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm resize-none" />
						</div>
						<div>
							<label className="block text-sm font-medium text-text-primary mb-1">Asset type</label>
							<select name="assetType" defaultValue={asset.assetType}
								className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm">
								{ASSET_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
							</select>
						</div>
						<div>
							<label className="block text-sm font-medium text-text-primary mb-1">Recording date</label>
							<input name="recordingDate" type="date" defaultValue={asset.recordingDate}
								className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
						</div>
						<div>
							<label className="block text-sm font-medium text-text-primary mb-1">Creator</label>
							<input name="creator" type="text" defaultValue={asset.creator}
								className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
						</div>
						<div>
							<label className="block text-sm font-medium text-text-primary mb-1">Location</label>
							<input name="location" type="text" defaultValue={asset.location}
								className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
						</div>
						<div className="col-span-2">
							<label className="block text-sm font-medium text-text-primary mb-1">Equipment</label>
							<input name="equipment" type="text" defaultValue={asset.equipment} placeholder="Microphone, camera model, etc."
								className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent text-sm" />
						</div>
						<div className="col-span-2">
							<label className="block text-sm font-medium text-text-primary mb-1">Usage notes</label>
							<textarea name="usageNotes" rows={2} defaultValue={asset.usageNotes}
								className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm resize-none" />
						</div>
					</div>

					<div className="flex items-center justify-between pt-2 border-t border-border">
						<button type="button"
							onClick={() => { if (confirm('Delete this asset? This cannot be undone.')) del.mutate(); }}
							className="px-4 py-2 border border-danger/40 text-danger hover:bg-danger/10 rounded-lg text-sm transition-colors">
							Delete
						</button>
						<button type="submit" disabled={update.isPending}
							className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40">
							{update.isPending ? 'Saving...' : 'Save changes'}
						</button>
					</div>
				</form>
			</div>

			{signOpen && (
				<SignAssetModal assetType="produced" assetId={id}
					defaultIsAi={false} defaultTool={asset.equipment || ''}
					onClose={() => setSignOpen(false)} />
			)}
		</div>
	);
}

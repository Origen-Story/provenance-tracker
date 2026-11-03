import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import OriginClassControl from '../../components/origin/OriginClassControl.jsx';
import RelationshipsPanel from '../../components/origin/RelationshipsPanel.jsx';

const MEDIA_TYPES = ['photograph', 'illustration', 'map', 'document', 'other'];
const COMMON_LICENSES = ['Public Domain', 'CC BY 4.0', 'CC BY-SA 4.0', 'CC BY-NC 4.0', 'CC BY-NC-SA 4.0', 'CC0 1.0', 'All Rights Reserved'];

export default function ArchivalDetail() {
	const { id } = useParams();
	const navigate = useNavigate();
	const qc = useQueryClient();
	const [saved, setSaved] = useState(false);
	const [syncing, setSyncing] = useState(false);
	const [syncError, setSyncError] = useState('');

	const { data: asset, isLoading } = useQuery({
		queryKey: ['archival', id],
		queryFn: () => fetch(`/api/archival/${id}`).then(r => r.json())
	});

	const { data: notionStatus } = useQuery({
		queryKey: ['notionStatus'],
		queryFn: () => fetch('/api/notion/status').then(r => r.json())
	});

	const update = useMutation({
		mutationFn: (data) => fetch(`/api/archival/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(data)
		}).then(r => r.json()),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['archival', id] });
			qc.invalidateQueries({ queryKey: ['archival'] });
			setSaved(true);
			setTimeout(() => setSaved(false), 3000);
		}
	});

	const del = useMutation({
		mutationFn: () => fetch(`/api/archival/${id}`, { method: 'DELETE' }).then(r => r.json()),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['archival'] });
			navigate('/archival');
		}
	});

	async function handleSync() {
		setSyncing(true);
		setSyncError('');
		try {
			const res = await fetch(`/api/notion/sync/${id}`, { method: 'POST' });
			const data = await res.json();
			if (!res.ok) { setSyncError(data.error); return; }
			qc.invalidateQueries({ queryKey: ['archival', id] });
		} catch (err) {
			setSyncError(err.message);
		} finally {
			setSyncing(false);
		}
	}

	function handleSubmit(e) {
		e.preventDefault();
		const form = new FormData(e.target);
		update.mutate(Object.fromEntries(form));
	}

	if (isLoading) return <p className="text-text-secondary text-sm p-8">Loading…</p>;
	if (!asset || asset.error) return <p className="text-danger text-sm p-8">Asset not found.</p>;

	let exif = {};
	try { exif = JSON.parse(asset.exifJson || '{}'); } catch {}

	return (
		<div>
			<div className="mb-6 flex items-center gap-2 text-sm text-text-secondary">
				<Link to="/archival" className="hover:text-text-primary transition-colors">Archival</Link>
				<span>/</span>
				<span className="text-text-primary">{asset.name || 'Untitled'}</span>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
				{/* Left: image + file info */}
				<div className="space-y-4">
					<div className="bg-card-bg border border-border rounded-lg overflow-hidden">
						<img src={`/api/preview?path=${encodeURIComponent(asset.filePath)}`}
							alt={asset.name} className="w-full object-cover" />
					</div>

					<div className="bg-card-bg border border-border rounded-lg p-3 space-y-1.5 text-xs">
						<div className="flex justify-between"><span className="text-text-secondary">File</span><span className="text-text-primary font-mono">{asset.filename}</span></div>
						<div className="flex justify-between"><span className="text-text-secondary">Size</span><span className="text-text-primary">{(asset.fileSize / 1024).toFixed(0)} KB</span></div>
						<div className="flex justify-between"><span className="text-text-secondary">Hash</span><span className="text-text-primary font-mono text-xs">{asset.fileHash?.slice(0, 16)}…</span></div>
						<a href={`/api/archival/${asset.id}/download`} download
							className="block w-full mt-2 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white rounded text-xs font-medium text-center transition-colors">
							Download original
						</a>
					</div>

					<OriginClassControl type="archival" id={id} asset={asset} queryKeys={[['archival', id], ['archival']]} />
					<RelationshipsPanel type="archival" id={id} queryKeys={[['archival', id], ['archival']]} />

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

					{/* Notion sync */}
					{notionStatus?.configured && (
						<div className="bg-card-bg border border-border rounded-lg p-3 space-y-2">
							<div className="flex items-center justify-between">
								<p className="text-xs font-medium text-text-primary">Notion sync</p>
								<div className={`w-2 h-2 rounded-full ${asset.notionSyncedAt ? 'bg-success' : 'bg-border'}`} />
							</div>
							{asset.notionSyncedAt && (
								<p className="text-xs text-text-secondary">
									Last synced: {new Date(asset.notionSyncedAt).toLocaleString()}
								</p>
							)}
							{syncError && <p className="text-xs text-danger">{syncError}</p>}
							<button onClick={handleSync} disabled={syncing}
								className="w-full px-3 py-1.5 bg-accent hover:bg-accent-hover text-white rounded text-xs font-medium transition-colors disabled:opacity-40">
								{syncing ? 'Syncing…' : asset.notionSyncedAt ? 'Sync again' : 'Sync to Notion'}
							</button>
						</div>
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
							<label className="block text-sm font-medium text-text-primary mb-1">Caption</label>
							<textarea name="caption" rows={2} defaultValue={asset.caption}
								className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm resize-none" />
						</div>
						<div className="col-span-2">
							<label className="block text-sm font-medium text-text-primary mb-1">Source URL</label>
							<input name="sourceUrl" type="url" defaultValue={asset.sourceUrl}
								className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm font-mono" />
						</div>
						<div>
							<label className="block text-sm font-medium text-text-primary mb-1">Access date</label>
							<input name="accessDate" type="date" defaultValue={asset.accessDate}
								className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
						</div>
						<div>
							<label className="block text-sm font-medium text-text-primary mb-1">Original date</label>
							<input name="originalDate" type="text" defaultValue={asset.originalDate}
								placeholder="1910, circa 1900"
								className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent text-sm" />
						</div>
						<div>
							<label className="block text-sm font-medium text-text-primary mb-1">Creator</label>
							<input name="creator" type="text" defaultValue={asset.creator}
								className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
						</div>
						<div>
							<label className="block text-sm font-medium text-text-primary mb-1">Institution / Archive</label>
							<input name="institution" type="text" defaultValue={asset.institution}
								className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
						</div>
						<div>
							<label className="block text-sm font-medium text-text-primary mb-1">License</label>
							<input name="license" type="text" defaultValue={asset.license} list="licenses-detail"
								className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
							<datalist id="licenses-detail">{COMMON_LICENSES.map(l => <option key={l} value={l} />)}</datalist>
						</div>
						<div>
							<label className="block text-sm font-medium text-text-primary mb-1">Medium</label>
							<select name="medium" defaultValue={asset.medium}
								className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm">
								{MEDIA_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
							</select>
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
							{update.isPending ? 'Saving…' : 'Save changes'}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}

import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import SignAssetModal from '../../components/SignAssetModal.jsx';
import OriginClassControl from '../../components/origin/OriginClassControl.jsx';
import RelationshipsPanel from '../../components/origin/RelationshipsPanel.jsx';

const PLATFORM_LABELS = { freepik: 'Freepik', comfyui: 'ComfyUI', midjourney: 'Midjourney', firefly: 'Adobe Firefly', elevenlabs: 'ElevenLabs', 'topaz-video-ai': 'Topaz Video AI', 'topaz-gigapixel': 'Topaz Gigapixel', unknown: 'Unknown' };
const DIGITAL_SOURCE_TYPES = [
	{ value: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia', label: 'Trained Algorithmic Media' },
	{ value: 'http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicMedia', label: 'Algorithmic Media' },
	{ value: 'http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture', label: 'Digital Capture' },
	{ value: 'http://cv.iptc.org/newscodes/digitalsourcetype/humanCreatedWithAI', label: 'Human Created with AI' },
];

function Section({ title, children, defaultOpen = true }) {
	const [open, setOpen] = useState(defaultOpen);
	return (
		<div className="border border-border rounded-lg overflow-hidden">
			<button onClick={() => setOpen(o => !o)} type="button"
				className="w-full flex items-center justify-between px-4 py-3 bg-card-bg hover:bg-card-hover transition-colors text-left">
				<span className="text-sm font-medium text-text-primary">{title}</span>
				<svg className={`w-4 h-4 text-text-secondary transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
			</button>
			{open && <div className="p-4 border-t border-border bg-card-bg/50">{children}</div>}
		</div>
	);
}

function MetaRow({ label, value }) {
	if (!value && value !== 0) return null;
	return (
		<div className="flex gap-4">
			<span className="text-xs text-text-secondary w-28 shrink-0">{label}</span>
			<span className="text-xs text-text-primary break-all">{String(value)}</span>
		</div>
	);
}

export default function AIAssetDetail() {
	const { id } = useParams();
	const navigate = useNavigate();
	const qc = useQueryClient();
	const [saved, setSaved] = useState(false);
	const [signOpen, setSignOpen] = useState(false);

	const { data: asset, isLoading } = useQuery({
		queryKey: ['asset', id],
		queryFn: () => fetch(`/api/assets/${id}`).then(r => r.json())
	});

	const update = useMutation({
		mutationFn: (data) => fetch(`/api/assets/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(data)
		}).then(r => r.json()),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['asset', id] });
			qc.invalidateQueries({ queryKey: ['assets'] });
			setSaved(true);
			setTimeout(() => setSaved(false), 3000);
		}
	});

	const reExtract = useMutation({
		mutationFn: () => fetch(`/api/assets/${id}/re-extract`, { method: 'POST' }).then(async r => {
			const j = await r.json();
			if (!r.ok) throw new Error(j.error || 'Re-extraction failed');
			return j;
		}),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['asset', id] });
			qc.invalidateQueries({ queryKey: ['assets'] });
			qc.invalidateQueries({ queryKey: ['noveltyStats'] });
		}
	});

	const del = useMutation({
		mutationFn: () => fetch(`/api/assets/${id}`, { method: 'DELETE' }).then(r => r.json()),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['assets'] });
			navigate('/assets');
		}
	});

	function handleSave(e) {
		e.preventDefault();
		const form = new FormData(e.target);
		update.mutate({
			description: form.get('description'),
			notes: form.get('notes'),
			digitalSourceType: form.get('digitalSourceType'),
			platform: form.get('platform'),
			generationDate: form.get('generationDate'),
			generationParams: {
				prompt: form.get('prompt'),
				negativePrompt: form.get('negativePrompt'),
				modelName: form.get('modelName'),
				modelVersion: form.get('modelVersion'),
				seed: form.get('seed'),
				steps: parseInt(form.get('steps')) || 0,
				cfgScale: form.get('cfgScale'),
				sampler: form.get('sampler'),
				scheduler: form.get('scheduler'),
				width: parseInt(form.get('width')) || 0,
				height: parseInt(form.get('height')) || 0,
				aspectRatio: form.get('aspectRatio'),
				stylize: form.get('stylize')
			}
		});
	}

	if (isLoading) return <p className="text-text-secondary text-sm">Loading…</p>;
	if (!asset) return <p className="text-danger text-sm">Asset not found.</p>;

	const gp = asset.generationParams;
	const c2pa = asset.metadata?.find(m => m.metadataType === 'c2pa');
	const exif = asset.metadata?.find(m => m.metadataType === 'exif');
	const platformMeta = asset.metadata?.find(m => m.metadataType === 'platform');
	const pngChunks = asset.metadata?.find(m => m.metadataType === 'png_chunks');
	const c2paData = c2pa ? JSON.parse(c2pa.rawJson) : null;
	const exifData = exif ? JSON.parse(exif.rawJson) : null;
	const platformData = platformMeta ? JSON.parse(platformMeta.rawJson) : null;
	const pngChunksData = pngChunks ? JSON.parse(pngChunks.rawJson) : null;

	const coverage = asset.extractionCoverage;
	const isNovel = asset.platform === 'unknown' || (coverage != null && coverage < 60);
	const coverageColor = coverage == null ? 'text-text-secondary'
		: coverage >= 80 ? 'text-success'
		: coverage >= 60 ? 'text-text-primary'
		: 'text-amber-400';

	return (
		<div>
			<div className="mb-6 flex items-center gap-2 text-sm text-text-secondary">
				<Link to="/assets" className="hover:text-text-primary transition-colors">Assets</Link>
				<span>/</span>
				<span className="text-text-primary font-mono">{asset.assetId}</span>
			</div>

			{saved && <div className="mb-4 bg-success/10 border border-success/30 text-success text-sm rounded-lg px-4 py-2">Changes saved.</div>}

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
				{/* Left: preview + info panels */}
				<div className="space-y-4">
					{asset.mimeType?.startsWith('image/') && (
						<div className="bg-card-bg border border-border rounded-lg overflow-hidden">
							<img src={`/api/preview?path=${encodeURIComponent(asset.filePath)}`}
								alt={asset.description} className="w-full object-cover" />
						</div>
					)}

					<div className="bg-card-bg border border-border rounded-lg p-3 space-y-1.5 text-xs">
						<div className="flex justify-between"><span className="text-text-secondary">Asset ID</span><span className="text-text-primary font-mono">{asset.assetId}</span></div>
						<div className="flex justify-between"><span className="text-text-secondary">File</span><span className="text-text-primary font-mono truncate ml-4">{asset.filename || asset.filePath?.split(/[\\/]/).pop()}</span></div>
						<div className="flex justify-between"><span className="text-text-secondary">Size</span><span className="text-text-primary">{asset.fileSize ? (asset.fileSize / 1024).toFixed(0) + ' KB' : '—'}</span></div>
						<div className="flex justify-between"><span className="text-text-secondary">Type</span><span className="text-text-primary capitalize">{asset.assetType}</span></div>
						<div className="flex justify-between"><span className="text-text-secondary">Platform</span><span className="text-text-primary">{PLATFORM_LABELS[asset.platform] || asset.platform}</span></div>
						<div className="flex justify-between">
							<span className="text-text-secondary">Extraction coverage</span>
							<span className={coverageColor}>{coverage == null ? '—' : `${coverage}%`}</span>
						</div>
					</div>

					<OriginClassControl type="ai" id={id} asset={asset} queryKeys={[['asset', id], ['assets']]} />
					<RelationshipsPanel type="ai" id={id} queryKeys={[['asset', id], ['assets']]} />

					{/* Novelty + re-extract controls. Re-extract replays current parsers against stored
					    raw metadata, so parser improvements can upgrade previously-imported assets. */}
					<div className={`border rounded-lg p-3 ${isNovel ? 'bg-amber-500/5 border-amber-500/30' : 'bg-card-bg border-border'}`}>
						{isNovel && (
							<p className="text-xs text-amber-400 mb-2 flex items-center gap-1.5">
								<svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
									<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
								</svg>
								{asset.platform === 'unknown' ? 'Unknown platform — no parser matched' : `Low coverage (${coverage}%) — parser may need updating`}
							</p>
						)}
						<button type="button" onClick={() => reExtract.mutate()} disabled={reExtract.isPending}
							className="w-full px-3 py-1.5 text-xs rounded-md border border-border bg-card-hover hover:bg-card-bg text-text-primary disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
							<svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
								<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
							</svg>
							{reExtract.isPending ? 'Re-extracting…' : 'Re-extract metadata'}
						</button>
						{reExtract.isError && <p className="text-xs text-danger mt-2">{reExtract.error.message}</p>}
						{reExtract.isSuccess && <p className="text-xs text-success mt-2">Re-extracted.</p>}
					</div>

					{/* C2PA panel */}
					{c2paData ? (
						<Section title="C2PA Manifest" defaultOpen={true}>
							<div className="space-y-1.5">
								<MetaRow label="Title" value={c2paData.title} />
								<MetaRow label="Generator" value={c2paData.claimGenerator} />
								{c2paData.signatureInfo?.issuer && <MetaRow label="Issuer" value={c2paData.signatureInfo.issuer} />}
								{c2paData.signatureInfo?.time && <MetaRow label="Signed" value={new Date(c2paData.signatureInfo.time).toLocaleDateString()} />}
								{c2paData.assertions?.length > 0 && (
									<div className="mt-2 pt-2 border-t border-border">
										<p className="text-xs text-text-secondary mb-1">Assertions ({c2paData.assertions.length})</p>
										{c2paData.assertions.map((a, i) => (
											<p key={i} className="text-xs text-text-primary font-mono">{a.label}</p>
										))}
									</div>
								)}
							</div>
						</Section>
					) : (
						<div className="bg-card-bg border border-border rounded-lg p-3 space-y-2">
							<p className="text-xs text-text-secondary">No C2PA manifest found in this file.</p>
							<button onClick={() => setSignOpen(true)}
								className="w-full px-3 py-1.5 text-xs rounded-md bg-accent hover:bg-accent-hover text-white transition-colors flex items-center justify-center gap-2">
								<svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
								Sign with Content Credentials
							</button>
						</div>
					)}

					{/* EXIF accordion */}
					{exifData && Object.keys(exifData).length > 0 && (
						<Section title="EXIF / XMP Data" defaultOpen={false}>
							<div className="space-y-1.5 max-h-60 overflow-y-auto">
								{Object.entries(exifData).slice(0, 40).map(([k, v]) => (
									<MetaRow key={k} label={k} value={v} />
								))}
							</div>
						</Section>
					)}

					{/* Parsed platform data — what the active parser extracted */}
					{platformData && (
						<Section title="Parsed platform data" defaultOpen={false}>
							<div className="space-y-1.5 max-h-60 overflow-y-auto">
								{Object.entries(platformData).map(([k, v]) => {
									if (v === null || v === undefined || v === '' || v === 0) return null;
									const display = typeof v === 'object' ? JSON.stringify(v) : v;
									return <MetaRow key={k} label={k} value={display} />;
								})}
							</div>
						</Section>
					)}

					{/* Raw PNG chunks — useful when platform='unknown' to see what parsers could target */}
					{pngChunksData && Object.keys(pngChunksData).length > 0 && (
						<Section title="PNG chunks (raw)" defaultOpen={false}>
							<div className="space-y-2 max-h-60 overflow-y-auto">
								{Object.entries(pngChunksData).map(([k, v]) => (
									<div key={k}>
										<p className="text-xs text-text-secondary mb-0.5">{k}</p>
										<pre className="text-[10px] text-text-primary font-mono bg-card-hover rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
											{typeof v === 'string' ? v : JSON.stringify(v, null, 2)}
										</pre>
									</div>
								))}
							</div>
						</Section>
					)}
				</div>

				{/* Right: edit form */}
				<form onSubmit={handleSave} className="lg:col-span-2 space-y-6">
					<div className="space-y-4">
						<h3 className="text-sm font-semibold text-text-primary border-b border-border pb-2">Asset details</h3>
						<div className="grid grid-cols-2 gap-4">
							<div className="col-span-2">
								<label className="block text-sm font-medium text-text-primary mb-1">Description</label>
								<input name="description" type="text" defaultValue={asset.description}
									className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
							</div>
							<div>
								<label className="block text-sm font-medium text-text-primary mb-1">Platform</label>
								<select name="platform" defaultValue={asset.platform}
									className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm">
									{Object.entries(PLATFORM_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
								</select>
							</div>
							<div>
								<label className="block text-sm font-medium text-text-primary mb-1">Generation date</label>
								<input name="generationDate" type="date" defaultValue={asset.generationDate}
									className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
							</div>
							<div className="col-span-2">
								<label className="block text-sm font-medium text-text-primary mb-1">Digital source type</label>
								<select name="digitalSourceType" defaultValue={asset.digitalSourceType}
									className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm">
									{DIGITAL_SOURCE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
								</select>
							</div>
							<div className="col-span-2">
								<label className="block text-sm font-medium text-text-primary mb-1">Notes</label>
								<textarea name="notes" defaultValue={asset.notes} rows={2}
									className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm resize-none" />
							</div>
						</div>
					</div>

					<div className="space-y-4">
						<h3 className="text-sm font-semibold text-text-primary border-b border-border pb-2">Generation parameters</h3>
						<div className="grid grid-cols-2 gap-4">
							<div className="col-span-2">
								<label className="block text-sm font-medium text-text-primary mb-1">Prompt</label>
								<textarea name="prompt" defaultValue={gp?.prompt} rows={3}
									className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm resize-none font-mono" />
							</div>
							<div className="col-span-2">
								<label className="block text-sm font-medium text-text-primary mb-1">Negative prompt</label>
								<textarea name="negativePrompt" defaultValue={gp?.negativePrompt} rows={2}
									className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm resize-none font-mono" />
							</div>
							<div>
								<label className="block text-sm font-medium text-text-primary mb-1">Model</label>
								<input name="modelName" type="text" defaultValue={gp?.modelName}
									className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
							</div>
							<div>
								<label className="block text-sm font-medium text-text-primary mb-1">Version</label>
								<input name="modelVersion" type="text" defaultValue={gp?.modelVersion}
									className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
							</div>
							<div>
								<label className="block text-sm font-medium text-text-primary mb-1">Seed</label>
								<input name="seed" type="text" defaultValue={gp?.seed}
									className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm font-mono" />
							</div>
							<div>
								<label className="block text-sm font-medium text-text-primary mb-1">Steps</label>
								<input name="steps" type="number" defaultValue={gp?.steps || ''}
									className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
							</div>
							<div>
								<label className="block text-sm font-medium text-text-primary mb-1">CFG Scale</label>
								<input name="cfgScale" type="text" defaultValue={gp?.cfgScale}
									className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
							</div>
							<div>
								<label className="block text-sm font-medium text-text-primary mb-1">Aspect ratio</label>
								<input name="aspectRatio" type="text" defaultValue={gp?.aspectRatio}
									className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
							</div>
							<div>
								<label className="block text-sm font-medium text-text-primary mb-1">Width</label>
								<input name="width" type="number" defaultValue={gp?.width || ''}
									className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
							</div>
							<div>
								<label className="block text-sm font-medium text-text-primary mb-1">Height</label>
								<input name="height" type="number" defaultValue={gp?.height || ''}
									className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
							</div>
						</div>
					</div>

					<div className="flex items-center justify-between pt-2 border-t border-border">
						<button type="button"
							onClick={() => { if (confirm(`Delete ${asset.assetId}? This cannot be undone.`)) del.mutate(); }}
							className="text-sm text-danger hover:underline">
							Delete asset
						</button>
						<button type="submit" disabled={update.isPending}
							className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40">
							{update.isPending ? 'Saving…' : 'Save changes'}
						</button>
					</div>
				</form>
			</div>

			{signOpen && (
				<SignAssetModal assetType="ai" assetId={id}
					defaultIsAi={true} defaultTool={PLATFORM_LABELS[asset.platform] || ''}
					onClose={() => setSignOpen(false)} />
			)}
		</div>
	);
}

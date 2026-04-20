import { useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

const PLATFORM_LABELS = { freepik: 'Freepik', comfyui: 'ComfyUI', midjourney: 'Midjourney', unknown: 'Unknown' };
const DIGITAL_SOURCE_TYPES = [
	{ value: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia', label: 'Trained Algorithmic Media (AI-generated)' },
	{ value: 'http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicMedia', label: 'Algorithmic Media' },
	{ value: 'http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture', label: 'Digital Capture' },
	{ value: 'http://cv.iptc.org/newscodes/digitalsourcetype/humanCreatedWithAI', label: 'Human Created with AI' },
];

export default function AIAssetImport() {
	const navigate = useNavigate();
	const qc = useQueryClient();
	const fileInputRef = useRef(null);

	const [mode, setMode] = useState('upload'); // upload | scan | path
	const [step, setStep] = useState(1);
	const [extracting, setExtracting] = useState(false);
	const [extractError, setExtractError] = useState('');

	// Single-file state
	const [extracted, setExtracted] = useState(null);
	const [pathInput, setPathInput] = useState('');

	// Batch state
	const [batchResults, setBatchResults] = useState([]);
	const [folderPath, setFolderPath] = useState('');

	// Drag state
	const [dragging, setDragging] = useState(false);

	// === Single-file form fields ===
	const [description, setDescription] = useState('');
	const [notes, setNotes] = useState('');
	const [digitalSourceType, setDigitalSourceType] = useState(DIGITAL_SOURCE_TYPES[0].value);
	const [generationDate, setGenerationDate] = useState('');
	const [platform, setPlatform] = useState('unknown');
	const [prompt, setPrompt] = useState('');
	const [negativePrompt, setNegativePrompt] = useState('');
	const [modelName, setModelName] = useState('');
	const [modelVersion, setModelVersion] = useState('');
	const [seed, setSeed] = useState('');
	const [steps, setSteps] = useState('');
	const [cfgScale, setCfgScale] = useState('');
	const [width, setWidth] = useState('');
	const [height, setHeight] = useState('');
	const [aspectRatio, setAspectRatio] = useState('');

	function prefillFromExtraction(data) {
		setExtracted(data);
		setPlatform(data.platform || 'unknown');
		setGenerationDate(data.generationDate || '');
		setPrompt(data.suggestedPrompt || '');
		setNegativePrompt(data.suggestedNegativePrompt || '');
		setModelName(data.suggestedModel || '');
		setModelVersion(data.suggestedModelVersion || '');
		setSeed(data.suggestedSeed || '');
		setSteps(data.suggestedSteps ? String(data.suggestedSteps) : '');
		setCfgScale(data.suggestedCfgScale || '');
		setWidth(data.suggestedWidth ? String(data.suggestedWidth) : '');
		setHeight(data.suggestedHeight ? String(data.suggestedHeight) : '');
		setAspectRatio(data.suggestedAspectRatio || '');
		setDescription('');
		setNotes('');
	}

	// === Upload files ===
	async function handleUpload(fileList) {
		if (!fileList?.length) return;
		setExtracting(true);
		setExtractError('');
		try {
			const formData = new FormData();
			formData.append('module', 'ai-assets');
			for (const file of fileList) formData.append('files', file);

			const res = await fetch('/api/upload', { method: 'POST', body: formData });
			const data = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
			if (!res.ok) { setExtractError(data.error || 'Upload failed'); return; }

			const successes = data.results.filter(r => r.success);
			if (successes.length === 0) {
				setExtractError(data.results[0]?.error || 'No files could be processed');
				return;
			}
			if (successes.length === 1) {
				prefillFromExtraction(successes[0]);
				setStep(2);
			} else {
				setBatchResults(successes);
				setStep(3);
			}
		} catch (err) {
			setExtractError(err.message);
		} finally {
			setExtracting(false);
		}
	}

	// === Scan folder ===
	async function handleScan() {
		setExtracting(true);
		setExtractError('');
		try {
			const res = await fetch('/api/upload/scan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ folderPath: folderPath.trim(), module: 'ai-assets' })
			});
			const data = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
			if (!res.ok) { setExtractError(data.error || 'Scan failed'); return; }

			const successes = data.results.filter(r => r.success);
			if (successes.length === 0) {
				setExtractError(data.message || 'No supported files found in this folder.');
				return;
			}
			setBatchResults(successes);
			setStep(3);
		} catch (err) {
			setExtractError(err.message);
		} finally {
			setExtracting(false);
		}
	}

	// === Path extract (single) ===
	async function handlePathExtract() {
		setExtracting(true);
		setExtractError('');
		try {
			const res = await fetch('/api/assets/extract', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ filePath: pathInput.trim() })
			});
			const data = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
			if (!res.ok) { setExtractError(data.error || 'Extraction failed'); return; }
			prefillFromExtraction(data);
			setStep(2);
		} catch (err) {
			setExtractError(err.message);
		} finally {
			setExtracting(false);
		}
	}

	// === Save single asset ===
	const save = useMutation({
		mutationFn: (data) => fetch('/api/assets', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(data)
		}).then(r => r.json()),
		onSuccess: (asset) => {
			qc.invalidateQueries({ queryKey: ['assets'] });
			navigate(`/assets/${asset.id}`);
		}
	});

	function handleSave(e) {
		e.preventDefault();
		save.mutate({
			filePath: extracted.filePath,
			filename: extracted.filename,
			fileHash: extracted.fileHash,
			fileSize: extracted.fileSize,
			mimeType: extracted.mimeType,
			assetType: extracted.assetType,
			platform, description, notes, digitalSourceType, generationDate,
			exifJson: extracted.exifJson,
			c2paJson: extracted.c2paJson,
			pngChunksJson: extracted.pngChunksJson,
			platformJson: extracted.platformJson,
			generationParams: {
				prompt, negativePrompt, modelName, modelVersion,
				seed, steps: parseInt(steps) || 0, cfgScale,
				width: parseInt(width) || 0, height: parseInt(height) || 0,
				aspectRatio, otherParams: '{}'
			}
		});
	}

	// === Batch save all ===
	const [batchSaving, setBatchSaving] = useState(false);
	const [batchSaved, setBatchSaved] = useState(0);

	async function handleBatchSave() {
		setBatchSaving(true);
		let saved = 0;
		for (const item of batchResults) {
			try {
				await fetch('/api/assets', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						filePath: item.filePath,
						filename: item.filename,
						fileHash: item.fileHash,
						fileSize: item.fileSize,
						mimeType: item.mimeType,
						assetType: item.assetType,
						platform: item.platform || 'unknown',
						description: '',
						digitalSourceType: DIGITAL_SOURCE_TYPES[0].value,
						generationDate: item.generationDate || '',
						exifJson: item.exifJson,
						c2paJson: item.c2paJson,
						pngChunksJson: item.pngChunksJson,
						platformJson: item.platformJson,
						generationParams: {
							prompt: item.suggestedPrompt || '',
							negativePrompt: item.suggestedNegativePrompt || '',
							modelName: item.suggestedModel || '',
							modelVersion: item.suggestedModelVersion || '',
							seed: item.suggestedSeed || '',
							steps: item.suggestedSteps || 0,
							cfgScale: item.suggestedCfgScale || '',
							width: item.suggestedWidth || 0,
							height: item.suggestedHeight || 0,
							aspectRatio: item.suggestedAspectRatio || '',
							otherParams: '{}'
						}
					})
				});
				saved++;
				setBatchSaved(saved);
			} catch { /* skip failed */ }
		}
		qc.invalidateQueries({ queryKey: ['assets'] });
		navigate('/assets');
	}

	// === Drag handlers ===
	function onDragOver(e) { e.preventDefault(); setDragging(true); }
	function onDragLeave() { setDragging(false); }
	function onDrop(e) { e.preventDefault(); setDragging(false); handleUpload(e.dataTransfer.files); }

	return (
		<div>
			<div className="mb-6 flex items-center gap-2 text-sm text-text-secondary">
				<Link to="/assets" className="hover:text-text-primary transition-colors">Assets</Link>
				<span>/</span>
				<span className="text-text-primary">Import</span>
			</div>
			<h2 className="text-2xl font-bold text-text-primary mb-6">Import AI Assets</h2>

			{/* === STEP 1: Choose import method === */}
			{step === 1 && (
				<div className="max-w-xl space-y-5">
					{/* Mode tabs */}
					<div className="flex gap-2">
						{[{ v: 'upload', l: 'Upload files' }, { v: 'scan', l: 'Scan folder' }, { v: 'path', l: 'File path' }].map(opt => (
							<button key={opt.v} onClick={() => { setMode(opt.v); setExtractError(''); }}
								className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${mode === opt.v ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-secondary hover:text-text-primary hover:bg-card-hover'}`}>
								{opt.l}
							</button>
						))}
					</div>

					{/* Upload mode */}
					{mode === 'upload' && (
						<div>
							<input ref={fileInputRef} type="file" multiple accept="image/*,video/*,audio/*" className="hidden"
								onChange={e => handleUpload(e.target.files)} />
							<div
								onClick={() => !extracting && fileInputRef.current?.click()}
								onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
								className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
									dragging ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/40 hover:bg-card-hover'
								}`}>
								<svg className="w-10 h-10 text-text-secondary mx-auto mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
									<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
								</svg>
								{extracting ? (
									<p className="text-sm text-accent">Processing files…</p>
								) : (
									<>
										<p className="text-sm text-text-primary font-medium">Drop files here or click to browse</p>
										<p className="text-xs text-text-secondary mt-1">Images, video, or audio. Multiple files supported.</p>
									</>
								)}
							</div>
						</div>
					)}

					{/* Scan mode */}
					{mode === 'scan' && (
						<div className="space-y-3">
							<div>
								<label className="block text-sm font-medium text-text-primary mb-1.5">Folder path</label>
								<input type="text" value={folderPath} onChange={e => setFolderPath(e.target.value)}
									onKeyDown={e => e.key === 'Enter' && folderPath.trim() && handleScan()}
									placeholder="C:\Users\mattf\Pictures\gaia-atmosphere"
									className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent font-mono text-sm" />
								<p className="text-xs text-text-secondary mt-1">All supported files in this folder will be copied to managed storage and scanned.</p>
							</div>
							<button onClick={handleScan} disabled={!folderPath.trim() || extracting}
								className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40 flex items-center gap-2">
								{extracting ? (
									<><svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeOpacity=".25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>Scanning…</>
								) : 'Scan folder →'}
							</button>
						</div>
					)}

					{/* Path mode */}
					{mode === 'path' && (
						<div className="space-y-3">
							<div>
								<label className="block text-sm font-medium text-text-primary mb-1.5">File path</label>
								<input type="text" value={pathInput} onChange={e => setPathInput(e.target.value)}
									onKeyDown={e => e.key === 'Enter' && pathInput.trim() && handlePathExtract()}
									placeholder="C:\Users\mattf\Pictures\gaia-001.png"
									className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent font-mono text-sm" />
							</div>
							<button onClick={handlePathExtract} disabled={!pathInput.trim() || extracting}
								className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40 flex items-center gap-2">
								{extracting ? (
									<><svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeOpacity=".25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>Extracting…</>
								) : 'Extract metadata →'}
							</button>
						</div>
					)}

					{extractError && <p className="text-sm text-danger">{extractError}</p>}
				</div>
			)}

			{/* === STEP 2: Single file review === */}
			{step === 2 && extracted && (
				<div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
					<div className="space-y-4">
						{extracted.mimeType?.startsWith('image/') && (
							<div className="bg-card-bg border border-border rounded-lg overflow-hidden">
								<img src={`/api/preview?path=${encodeURIComponent(extracted.filePath)}`}
									alt="Preview" className="w-full object-cover" style={{ maxHeight: 220 }} />
							</div>
						)}
						<div className="bg-card-bg border border-border rounded-lg p-3 space-y-1.5 text-xs">
							<div className="flex justify-between"><span className="text-text-secondary">File</span><span className="text-text-primary font-mono truncate ml-4">{extracted.filename}</span></div>
							<div className="flex justify-between"><span className="text-text-secondary">Size</span><span className="text-text-primary">{(extracted.fileSize / 1024).toFixed(0)} KB</span></div>
							<div className="flex justify-between"><span className="text-text-secondary">Type</span><span className="text-text-primary capitalize">{extracted.assetType}</span></div>
							<div className="flex justify-between"><span className="text-text-secondary">Platform</span>
								<span className={`font-medium ${extracted.platform !== 'unknown' ? 'text-accent' : 'text-text-secondary'}`}>
									{PLATFORM_LABELS[extracted.platform] || extracted.platform}
								</span>
							</div>
							{extracted.c2paJson && <div className="flex justify-between"><span className="text-text-secondary">C2PA</span><span className="text-success">Manifest found</span></div>}
						</div>
						<button onClick={() => { setStep(1); setExtracted(null); }}
							className="text-sm text-text-secondary hover:text-text-primary transition-colors">← Change file</button>
					</div>

					<form onSubmit={handleSave} className="lg:col-span-2 space-y-6">
						<div className="space-y-4">
							<h3 className="text-sm font-semibold text-text-primary border-b border-border pb-2">Asset details</h3>
							<div className="grid grid-cols-2 gap-4">
								<div className="col-span-2">
									<label className="block text-sm font-medium text-text-primary mb-1">Description</label>
									<input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description"
										className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent text-sm" />
								</div>
								<div>
									<label className="block text-sm font-medium text-text-primary mb-1">Platform</label>
									<select value={platform} onChange={e => setPlatform(e.target.value)}
										className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm">
										{Object.entries(PLATFORM_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
									</select>
								</div>
								<div>
									<label className="block text-sm font-medium text-text-primary mb-1">Generation date</label>
									<input type="date" value={generationDate} onChange={e => setGenerationDate(e.target.value)}
										className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
								</div>
								<div className="col-span-2">
									<label className="block text-sm font-medium text-text-primary mb-1">Digital source type</label>
									<select value={digitalSourceType} onChange={e => setDigitalSourceType(e.target.value)}
										className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm">
										{DIGITAL_SOURCE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
									</select>
								</div>
								<div className="col-span-2">
									<label className="block text-sm font-medium text-text-primary mb-1">Notes</label>
									<textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="How this asset is used in the project"
										className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent text-sm resize-none" />
								</div>
							</div>
						</div>
						<div className="space-y-4">
							<h3 className="text-sm font-semibold text-text-primary border-b border-border pb-2">Generation parameters</h3>
							<div className="grid grid-cols-2 gap-4">
								<div className="col-span-2">
									<label className="block text-sm font-medium text-text-primary mb-1">Prompt</label>
									<textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={3}
										className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm resize-none font-mono" />
								</div>
								<div className="col-span-2">
									<label className="block text-sm font-medium text-text-primary mb-1">Negative prompt</label>
									<textarea value={negativePrompt} onChange={e => setNegativePrompt(e.target.value)} rows={2}
										className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm resize-none font-mono" />
								</div>
								<div>
									<label className="block text-sm font-medium text-text-primary mb-1">Model</label>
									<input type="text" value={modelName} onChange={e => setModelName(e.target.value)}
										className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
								</div>
								<div>
									<label className="block text-sm font-medium text-text-primary mb-1">Version</label>
									<input type="text" value={modelVersion} onChange={e => setModelVersion(e.target.value)}
										className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
								</div>
								<div>
									<label className="block text-sm font-medium text-text-primary mb-1">Seed</label>
									<input type="text" value={seed} onChange={e => setSeed(e.target.value)}
										className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm font-mono" />
								</div>
								<div>
									<label className="block text-sm font-medium text-text-primary mb-1">Steps</label>
									<input type="number" value={steps} onChange={e => setSteps(e.target.value)}
										className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
								</div>
								<div>
									<label className="block text-sm font-medium text-text-primary mb-1">CFG Scale</label>
									<input type="text" value={cfgScale} onChange={e => setCfgScale(e.target.value)}
										className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
								</div>
								<div>
									<label className="block text-sm font-medium text-text-primary mb-1">Aspect ratio</label>
									<input type="text" value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} placeholder="16:9"
										className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent text-sm" />
								</div>
								<div>
									<label className="block text-sm font-medium text-text-primary mb-1">Width</label>
									<input type="number" value={width} onChange={e => setWidth(e.target.value)}
										className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
								</div>
								<div>
									<label className="block text-sm font-medium text-text-primary mb-1">Height</label>
									<input type="number" value={height} onChange={e => setHeight(e.target.value)}
										className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
								</div>
							</div>
						</div>
						{save.isError && <p className="text-sm text-danger">{save.error?.message}</p>}
						<div className="flex justify-end">
							<button type="submit" disabled={save.isPending}
								className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40">
								{save.isPending ? 'Saving…' : 'Save asset'}
							</button>
						</div>
					</form>
				</div>
			)}

			{/* === STEP 3: Batch review === */}
			{step === 3 && batchResults.length > 0 && (
				<div className="space-y-4">
					<div className="flex items-center justify-between">
						<div>
							<h3 className="text-lg font-semibold text-text-primary">{batchResults.length} files ready to import</h3>
							<p className="text-sm text-text-secondary">Files have been copied to managed storage and scanned. You can enrich individual assets after import.</p>
						</div>
						<div className="flex items-center gap-3">
							<button onClick={() => { setStep(1); setBatchResults([]); }}
								className="px-4 py-2 text-text-secondary hover:text-text-primary text-sm transition-colors">Cancel</button>
							<button onClick={handleBatchSave} disabled={batchSaving}
								className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40 flex items-center gap-2">
								{batchSaving ? `Saving ${batchSaved}/${batchResults.length}…` : `Import all ${batchResults.length} assets`}
							</button>
						</div>
					</div>

					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
						{batchResults.map((item, i) => (
							<div key={i} className="bg-card-bg border border-border rounded-lg overflow-hidden">
								{item.mimeType?.startsWith('image/') && (
									<div className="aspect-video bg-card-hover overflow-hidden">
										<img src={`/api/preview?path=${encodeURIComponent(item.filePath)}`}
											alt={item.filename} className="w-full h-full object-cover" loading="lazy" />
									</div>
								)}
								<div className="p-3 space-y-1">
									<p className="text-xs font-mono text-text-primary truncate">{item.filename}</p>
									<div className="flex items-center justify-between">
										<span className={`text-xs font-medium ${item.platform !== 'unknown' ? 'text-accent' : 'text-text-secondary'}`}>
											{PLATFORM_LABELS[item.platform] || item.platform}
										</span>
										<span className="text-xs text-text-secondary">{(item.fileSize / 1024).toFixed(0)} KB</span>
									</div>
									{item.c2paJson && <p className="text-xs text-success">C2PA manifest</p>}
									{item.suggestedPrompt && <p className="text-xs text-text-secondary truncate">{item.suggestedPrompt}</p>}
								</div>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

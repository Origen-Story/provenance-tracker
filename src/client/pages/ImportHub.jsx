import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';

// === Constants per asset type ===
const ASSET_TYPES = [
	{ value: 'ai-assets', label: 'AI Assets', icon: 'sparkle', desc: 'AI-generated images, video, or audio', color: 'text-purple-400' },
	{ value: 'produced', label: 'Produced Assets', icon: 'mic', desc: 'Original recordings, field audio, video', color: 'text-blue-400' },
	{ value: 'archival', label: 'Archival Images', icon: 'archive', desc: 'Public domain images from archives', color: 'text-amber-400' }
];

const PLATFORM_LABELS = { freepik: 'Freepik', comfyui: 'ComfyUI', midjourney: 'Midjourney', firefly: 'Adobe Firefly', elevenlabs: 'ElevenLabs', 'topaz-video-ai': 'Topaz Video AI', unknown: 'Unknown' };
const DIGITAL_SOURCE_TYPES = [
	{ value: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia', label: 'Trained Algorithmic Media (AI-generated)' },
	{ value: 'http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicMedia', label: 'Algorithmic Media' },
	{ value: 'http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture', label: 'Digital Capture' },
	{ value: 'http://cv.iptc.org/newscodes/digitalsourcetype/humanCreatedWithAI', label: 'Human Created with AI' },
];
const MEDIA_TYPES = ['photograph', 'illustration', 'map', 'document', 'other'];
const COMMON_LICENSES = ['Public Domain', 'CC BY 4.0', 'CC BY-SA 4.0', 'CC BY-NC 4.0', 'CC BY-NC-SA 4.0', 'CC0 1.0', 'All Rights Reserved'];
const PRODUCED_ASSET_TYPES = ['audio', 'video', 'image', 'document', 'other'];

function TypeIcon({ type }) {
	const icons = {
		sparkle: <><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z"/></>,
		mic: <><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></>,
		archive: <><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></>
	};
	return (
		<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
			{icons[type]}
		</svg>
	);
}

function InPlaceOption({ inPlace, setInPlace }) {
	return (
		<label className="flex items-start gap-2 text-sm text-text-secondary cursor-pointer select-none">
			<input type="checkbox" checked={inPlace} onChange={e => setInPlace(e.target.checked)}
				className="rounded border-border accent-accent mt-0.5" />
			<span>
				<span className="text-text-primary">Keep files where they are</span> (track in place)
				<span className="block text-xs">The tracker records the path and never moves, renames or deletes the file. Moving or editing it later shows up in the integrity check. Untick to copy into managed storage instead.</span>
			</span>
		</label>
	);
}

export default function ImportHub() {
	const navigate = useNavigate();
	const qc = useQueryClient();
	const [searchParams] = useSearchParams();
	const fileInputRef = useRef(null);

	// Which asset type are we importing?
	const preselected = searchParams.get('type') || '';
	const [assetCategory, setAssetCategory] = useState(preselected || '');

	useEffect(() => {
		if (preselected) setAssetCategory(preselected);
	}, [preselected]);

	// Import method
	const [mode, setMode] = useState('upload'); // upload | scan | path | url
	const [step, setStep] = useState(assetCategory ? 2 : 1); // 1=choose type, 2=upload, 3=enrich, 4=batch

	useEffect(() => {
		if (preselected) setStep(2);
	}, [preselected]);

	// Shared state
	const [extracting, setExtracting] = useState(false);
	const [extractError, setExtractError] = useState('');
	const [extracted, setExtracted] = useState(null);
	const [dragging, setDragging] = useState(false);
	const [pathInput, setPathInput] = useState('');
	const [folderPath, setFolderPath] = useState('');
	const [batchResults, setBatchResults] = useState([]);
	const [batchSaving, setBatchSaving] = useState(false);
	const [batchSaved, setBatchSaved] = useState(0);
	const [deleteOriginals, setDeleteOriginals] = useState(false);
	// Track in place (D12): record files where they are instead of copying them
	// into managed storage. The default for produced media, whose files already
	// live in an edit project that links to them.
	const [inPlace, setInPlace] = useState(preselected === 'produced');
	const [recursive, setRecursive] = useState(false);
	useEffect(() => { setInPlace(assetCategory === 'produced'); }, [assetCategory]);
	const [scanInfo, setScanInfo] = useState(null); // { subdirectories, deleted, duplicates }

	// === AI Asset enrichment fields ===
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
	const [aiSteps, setAiSteps] = useState('');
	const [cfgScale, setCfgScale] = useState('');
	const [width, setWidth] = useState('');
	const [height, setHeight] = useState('');
	const [aspectRatio, setAspectRatio] = useState('');

	// === Archival enrichment fields ===
	const [archName, setArchName] = useState('');
	const [caption, setCaption] = useState('');
	const [sourceUrl, setSourceUrl] = useState('');
	const [accessDate, setAccessDate] = useState('');
	const [creator, setCreator] = useState('');
	const [institution, setInstitution] = useState('');
	const [license, setLicense] = useState('');
	const [licenseUrl, setLicenseUrl] = useState('');
	const [originalDate, setOriginalDate] = useState('');
	const [medium, setMedium] = useState('photograph');
	const [archUsageNotes, setArchUsageNotes] = useState('');

	// === Produced enrichment fields ===
	const [prodName, setProdName] = useState('');
	const [prodDescription, setProdDescription] = useState('');
	const [prodCreator, setProdCreator] = useState('');
	const [recordingDate, setRecordingDate] = useState('');
	const [location, setLocation] = useState('');
	const [equipment, setEquipment] = useState('');
	const [prodUsageNotes, setProdUsageNotes] = useState('');
	const [prodAssetType, setProdAssetType] = useState('audio');

	function selectType(type) {
		setAssetCategory(type);
		setStep(2);
		setExtractError('');
		// Default mode: archival gets url option, others start with upload
		if (type === 'archival') setMode('upload');
		else setMode('upload');
	}

	function prefillAI(data) {
		setExtracted(data);
		setPlatform(data.platform || 'unknown');
		setGenerationDate(data.generationDate || '');
		setPrompt(data.suggestedPrompt || '');
		setNegativePrompt(data.suggestedNegativePrompt || '');
		setModelName(data.suggestedModel || '');
		setModelVersion(data.suggestedModelVersion || '');
		setSeed(data.suggestedSeed || '');
		setAiSteps(data.suggestedSteps ? String(data.suggestedSteps) : '');
		setCfgScale(data.suggestedCfgScale || '');
		setWidth(data.suggestedWidth ? String(data.suggestedWidth) : '');
		setHeight(data.suggestedHeight ? String(data.suggestedHeight) : '');
		setAspectRatio(data.suggestedAspectRatio || '');
		setDescription('');
		setNotes('');
	}

	function prefillArchival(data) {
		setExtracted(data);
		setArchName(data.filename?.replace(/\.[^.]+$/, '').replace(/_/g, ' ') || '');
		setCaption(data.suggestedCaption || '');
		setSourceUrl(data.sourceUrl || '');
		setAccessDate(data.accessDate || new Date().toISOString().slice(0, 10));
		setCreator(data.suggestedCreator || '');
		setOriginalDate(data.suggestedOriginalDate?.toString()?.slice(0, 10) || '');
	}

	function prefillProduced(data) {
		setExtracted(data);
		setProdName(data.filename?.replace(/\.[^.]+$/, '').replace(/_/g, ' ') || '');
		setProdDescription('');
		// Guess asset type from mime
		if (data.mimeType?.startsWith('audio/')) setProdAssetType('audio');
		else if (data.mimeType?.startsWith('video/')) setProdAssetType('video');
		else if (data.mimeType?.startsWith('image/')) setProdAssetType('image');
		else setProdAssetType('other');
	}

	function prefillFromData(data) {
		if (assetCategory === 'ai-assets') prefillAI(data);
		else if (assetCategory === 'archival') prefillArchival(data);
		else prefillProduced(data);
	}

	// === Upload files ===
	async function handleUpload(fileList) {
		if (!fileList?.length) return;
		setExtracting(true);
		setExtractError('');
		setScanInfo(null);
		try {
			const formData = new FormData();
			formData.append('module', assetCategory);
			for (const file of fileList) formData.append('files', file);
			const res = await fetch('/api/upload', { method: 'POST', body: formData });
			const data = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
			if (!res.ok) { setExtractError(data.error || 'Upload failed'); return; }

			const successes = data.results.filter(r => r.success);
			const duplicates = data.results.filter(r => r.duplicate);
			if (duplicates.length > 0) {
				setScanInfo({ duplicates: duplicates.length, duplicateNames: duplicates.map(d => d.filename), subdirectories: [], deleted: 0 });
			}

			if (successes.length === 0) {
				setExtractError(duplicates.length > 0
					? `All ${duplicates.length} file(s) are already in the catalog.`
					: (data.results[0]?.error || 'No files could be processed'));
				return;
			}
			if (successes.length === 1 && duplicates.length === 0) {
				prefillFromData(successes[0]);
				setStep(3);
			} else {
				setBatchResults(successes);
				setStep(4);
			}
		} catch (err) { setExtractError(err.message); }
		finally { setExtracting(false); }
	}

	// === Scan folder ===
	async function handleScan() {
		setExtracting(true);
		setExtractError('');
		setScanInfo(null);
		try {
			const res = await fetch('/api/upload/scan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ folderPath: folderPath.trim(), module: assetCategory, inPlace, recursive, deleteOriginals: inPlace ? false : deleteOriginals })
			});
			const data = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
			if (!res.ok) { setExtractError(data.error || 'Scan failed'); return; }

			const successes = data.results.filter(r => r.success);
			const duplicates = data.results.filter(r => r.duplicate);
			const info = {
				subdirectories: data.subdirectories || [],
				deleted: data.deleted || 0,
				duplicates: duplicates.length,
				duplicateNames: duplicates.map(d => d.filename)
			};
			setScanInfo(info);

			if (successes.length === 0 && duplicates.length > 0) {
				setExtractError(`All ${duplicates.length} file(s) are already in the catalog.`);
				return;
			}
			if (successes.length === 0) { setExtractError(data.message || 'No supported files found.'); return; }
			if (successes.length === 1 && duplicates.length === 0) {
				prefillFromData(successes[0]);
				setStep(3);
			} else {
				setBatchResults(successes);
				setStep(4);
			}
		} catch (err) { setExtractError(err.message); }
		finally { setExtracting(false); }
	}

	// === Path extract (single file — copies to managed storage) ===
	async function handlePathExtract() {
		setExtracting(true);
		setExtractError('');
		setScanInfo(null);
		try {
			const res = await fetch('/api/upload/file', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ filePath: pathInput.trim(), module: assetCategory, inPlace, deleteOriginal: inPlace ? false : deleteOriginals })
			});
			const data = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
			if (!res.ok) { setExtractError(data.error || 'Extraction failed'); return; }
			if (data.deleted) setScanInfo({ deleted: 1, duplicates: 0, subdirectories: [], duplicateNames: [] });
			prefillFromData(data);
			setStep(3);
		} catch (err) { setExtractError(err.message); }
		finally { setExtracting(false); }
	}

	// === URL extract (archival) ===
	async function handleUrlExtract() {
		setExtracting(true);
		setExtractError('');
		try {
			const res = await fetch('/api/extract', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mode: 'url', sourceUrl: pathInput.trim() })
			});
			const data = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
			if (!res.ok) { setExtractError(data.error || 'Extraction failed'); return; }
			prefillFromData(data);
			setStep(3);
		} catch (err) { setExtractError(err.message); }
		finally { setExtracting(false); }
	}

	function handleExtractSubmit() {
		if (mode === 'url') handleUrlExtract();
		else handlePathExtract();
	}

	// === Save mutations per type ===
	const saveAI = useMutation({
		mutationFn: (data) => fetch('/api/assets', {
			method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
		}).then(r => r.json()),
		onSuccess: (asset) => { qc.invalidateQueries({ queryKey: ['assets'] }); navigate(`/assets/${asset.id}`); }
	});

	const saveArchival = useMutation({
		mutationFn: (data) => fetch('/api/archival', {
			method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
		}).then(r => r.json()),
		onSuccess: (asset) => { qc.invalidateQueries({ queryKey: ['archival'] }); navigate(`/archival/${asset.id}`); }
	});

	const saveProduced = useMutation({
		mutationFn: (data) => fetch('/api/produced', {
			method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
		}).then(r => r.json()),
		onSuccess: (asset) => { qc.invalidateQueries({ queryKey: ['produced'] }); navigate(`/produced/${asset.id}`); }
	});

	function handleSaveAI(e) {
		e.preventDefault();
		saveAI.mutate({
			filePath: extracted.filePath, filename: extracted.filename, fileHash: extracted.fileHash,
			fileSize: extracted.fileSize, mimeType: extracted.mimeType, assetType: extracted.assetType,
			platform, description, notes, digitalSourceType, generationDate,
			exifJson: extracted.exifJson, c2paJson: extracted.c2paJson, inPlace: !!extracted.inPlace,
			pngChunksJson: extracted.pngChunksJson, platformJson: extracted.platformJson,
			generationParams: {
				prompt, negativePrompt, modelName, modelVersion,
				seed, steps: parseInt(aiSteps) || 0, cfgScale,
				width: parseInt(width) || 0, height: parseInt(height) || 0,
				aspectRatio, otherParams: '{}'
			}
		});
	}

	function handleSaveArchival(e) {
		e.preventDefault();
		saveArchival.mutate({
			name: archName, caption, sourceUrl, accessDate,
			creator, institution, license, licenseUrl,
			originalDate, medium, usageNotes: archUsageNotes,
			filePath: extracted.filePath, filename: extracted.filename,
			fileHash: extracted.fileHash, fileSize: extracted.fileSize,
			mimeType: extracted.mimeType, exifJson: extracted.exifJson,
			c2paJson: extracted.c2paJson || null, inPlace: !!extracted.inPlace
		});
	}

	function handleSaveProduced(e) {
		e.preventDefault();
		saveProduced.mutate({
			name: prodName, description: prodDescription, creator: prodCreator,
			recordingDate, location, equipment, usageNotes: prodUsageNotes,
			assetType: prodAssetType,
			filePath: extracted.filePath, filename: extracted.filename,
			fileHash: extracted.fileHash, fileSize: extracted.fileSize,
			mimeType: extracted.mimeType, exifJson: extracted.exifJson,
			c2paJson: extracted.c2paJson || null, inPlace: !!extracted.inPlace
		});
	}

	// === Batch save ===
	async function handleBatchSave() {
		setBatchSaving(true);
		let saved = 0;
		const endpoint = assetCategory === 'archival' ? '/api/archival'
			: assetCategory === 'produced' ? '/api/produced'
			: '/api/assets';

		for (const item of batchResults) {
			try {
				let body;
				if (assetCategory === 'ai-assets') {
					body = {
						filePath: item.filePath, filename: item.filename, fileHash: item.fileHash, inPlace: !!item.inPlace,
						fileSize: item.fileSize, mimeType: item.mimeType, assetType: item.assetType,
						platform: item.platform || 'unknown', description: '',
						digitalSourceType: DIGITAL_SOURCE_TYPES[0].value,
						generationDate: item.generationDate || '',
						exifJson: item.exifJson, c2paJson: item.c2paJson,
						pngChunksJson: item.pngChunksJson, platformJson: item.platformJson,
						generationParams: {
							prompt: item.suggestedPrompt || '', negativePrompt: item.suggestedNegativePrompt || '',
							modelName: item.suggestedModel || '', modelVersion: item.suggestedModelVersion || '',
							seed: item.suggestedSeed || '', steps: item.suggestedSteps || 0,
							cfgScale: item.suggestedCfgScale || '',
							width: item.suggestedWidth || 0, height: item.suggestedHeight || 0,
							aspectRatio: item.suggestedAspectRatio || '', otherParams: '{}'
						}
					};
				} else if (assetCategory === 'archival') {
					body = {
						name: item.filename?.replace(/\.[^.]+$/, '').replace(/_/g, ' ') || '',
						filePath: item.filePath, filename: item.filename, fileHash: item.fileHash, inPlace: !!item.inPlace,
						fileSize: item.fileSize, mimeType: item.mimeType,
						exifJson: item.exifJson, c2paJson: item.c2paJson || null,
						accessDate: item.accessDate || new Date().toISOString().slice(0, 10),
						creator: item.suggestedCreator || '',
						caption: item.suggestedCaption || '',
						originalDate: item.suggestedOriginalDate?.toString()?.slice(0, 10) || ''
					};
				} else {
					const mt = item.mimeType || '';
					body = {
						name: item.filename?.replace(/\.[^.]+$/, '').replace(/_/g, ' ') || '',
						filePath: item.filePath, filename: item.filename, fileHash: item.fileHash, inPlace: !!item.inPlace,
						fileSize: item.fileSize, mimeType: item.mimeType,
						exifJson: item.exifJson, c2paJson: item.c2paJson || null,
						assetType: mt.startsWith('audio/') ? 'audio' : mt.startsWith('video/') ? 'video' : mt.startsWith('image/') ? 'image' : 'other'
					};
				}
				await fetch(endpoint, {
					method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
				});
				saved++;
				setBatchSaved(saved);
			} catch { /* skip failed */ }
		}
		qc.invalidateQueries({ queryKey: ['assets'] });
		qc.invalidateQueries({ queryKey: ['archival'] });
		qc.invalidateQueries({ queryKey: ['produced'] });
		const dest = assetCategory === 'archival' ? '/archival' : assetCategory === 'produced' ? '/produced' : '/assets';
		navigate(dest);
	}

	const activeSave = assetCategory === 'ai-assets' ? saveAI : assetCategory === 'archival' ? saveArchival : saveProduced;
	const typeLabel = ASSET_TYPES.find(t => t.value === assetCategory)?.label || 'Assets';
	const modes = assetCategory === 'archival'
		? [{ v: 'upload', l: 'Upload files' }, { v: 'scan', l: 'Scan folder' }, { v: 'url', l: 'From URL' }, { v: 'path', l: 'File path' }]
		: [{ v: 'upload', l: 'Upload files' }, { v: 'scan', l: 'Scan folder' }, { v: 'path', l: 'File path' }];

	return (
		<div>
			<div className="mb-6 flex items-center gap-2 text-sm text-text-secondary">
				<Link to="/" className="hover:text-text-primary transition-colors">Dashboard</Link>
				<span>/</span>
				<span className="text-text-primary">Import</span>
			</div>
			<h2 className="text-2xl font-bold text-text-primary mb-6">Import Assets</h2>

			{/* === STEP 1: Choose asset type === */}
			{step === 1 && (
				<div className="max-w-2xl">
					<p className="text-sm text-text-secondary mb-5">What type of asset are you importing?</p>
					<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
						{ASSET_TYPES.map(type => (
							<button key={type.value} onClick={() => selectType(type.value)}
								className="bg-card-bg border border-border rounded-xl p-5 text-left hover:border-accent/50 hover:bg-card-hover transition-colors group">
								<div className={`${type.color} mb-3`}><TypeIcon type={type.icon} /></div>
								<p className="text-sm font-semibold text-text-primary group-hover:text-accent transition-colors">{type.label}</p>
								<p className="text-xs text-text-secondary mt-1">{type.desc}</p>
							</button>
						))}
					</div>
				</div>
			)}

			{/* === STEP 2: Import method === */}
			{step === 2 && (
				<div className="max-w-xl space-y-5">
					<div className="flex items-center gap-3 mb-2">
						<button onClick={() => { setStep(1); setAssetCategory(''); setExtractError(''); }}
							className="text-sm text-text-secondary hover:text-text-primary transition-colors">
							← Back
						</button>
						<span className="text-sm font-medium text-text-primary">{typeLabel}</span>
					</div>

					{/* Mode tabs */}
					<div className="flex gap-2 flex-wrap">
						{modes.map(opt => (
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
								onDragOver={e => { e.preventDefault(); setDragging(true); }}
								onDragLeave={() => setDragging(false)}
								onDrop={e => { e.preventDefault(); setDragging(false); handleUpload(e.dataTransfer.files); }}
								className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
									dragging ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/40 hover:bg-card-hover'
								}`}>
								<svg className="w-10 h-10 text-text-secondary mx-auto mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
									<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
								</svg>
								{extracting ? <p className="text-sm text-accent">Processing files...</p> : (
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
									placeholder="C:\path\to\archival-images"
									className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent font-mono text-sm" />
								<p className="text-xs text-text-secondary mt-1">{inPlace ? 'Supported files are recorded where they are; nothing is copied.' : 'Supported files are copied to managed storage and scanned.'}</p>
							</div>
							<InPlaceOption inPlace={inPlace} setInPlace={setInPlace} />
							<label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer select-none">
								<input type="checkbox" checked={recursive} onChange={e => setRecursive(e.target.checked)}
									className="rounded border-border accent-accent" />
								Include subfolders
							</label>
							{!inPlace && (
								<label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer select-none">
									<input type="checkbox" checked={deleteOriginals} onChange={e => setDeleteOriginals(e.target.checked)}
										className="rounded border-border accent-accent" />
									Delete originals after copying to managed storage
								</label>
							)}
							<div className="flex items-center gap-3">
								<button onClick={handleScan} disabled={!folderPath.trim() || extracting}
									className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40 flex items-center gap-2">
									{extracting ? <><Spinner /> Scanning...</> : 'Scan folder →'}
								</button>
							</div>
						</div>
					)}

					{/* URL mode (archival) */}
					{mode === 'url' && (
						<div className="space-y-3">
							<div>
								<label className="block text-sm font-medium text-text-primary mb-1.5">Image URL</label>
								<input type="text" value={pathInput} onChange={e => setPathInput(e.target.value)}
									onKeyDown={e => e.key === 'Enter' && pathInput.trim() && handleUrlExtract()}
									placeholder="https://upload.wikimedia.org/..."
									className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent font-mono text-sm" />
							</div>
							<button onClick={handleUrlExtract} disabled={!pathInput.trim() || extracting}
								className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40 flex items-center gap-2">
								{extracting ? <><Spinner /> Extracting...</> : 'Extract metadata →'}
							</button>
						</div>
					)}

					{/* Path mode */}
					{mode === 'path' && (
						<div className="space-y-3">
							<div>
								<label className="block text-sm font-medium text-text-primary mb-1.5">File path</label>
								<input type="text" value={pathInput} onChange={e => setPathInput(e.target.value)}
									onKeyDown={e => e.key === 'Enter' && pathInput.trim() && handleExtractSubmit()}
									placeholder="C:\Users\...\image.jpg"
									className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent font-mono text-sm" />
								<p className="text-xs text-text-secondary mt-1">{inPlace ? 'The file is recorded where it is; nothing is copied.' : 'The file is copied to managed storage and scanned.'}</p>
							</div>
							<InPlaceOption inPlace={inPlace} setInPlace={setInPlace} />
							{!inPlace && (
								<label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer select-none">
									<input type="checkbox" checked={deleteOriginals} onChange={e => setDeleteOriginals(e.target.checked)}
										className="rounded border-border accent-accent" />
									Delete original after copying to managed storage
								</label>
							)}
							<button onClick={handleExtractSubmit} disabled={!pathInput.trim() || extracting}
								className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40 flex items-center gap-2">
								{extracting ? <><Spinner /> Extracting...</> : 'Extract metadata →'}
							</button>
						</div>
					)}

					{extractError && <p className="text-sm text-danger">{extractError}</p>}

					{/* Scan result info banners */}
					{scanInfo && scanInfo.duplicates > 0 && (
						<div className="bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm rounded-lg px-4 py-2">
							{scanInfo.duplicates} duplicate{scanInfo.duplicates !== 1 ? 's' : ''} skipped
							{scanInfo.duplicateNames.length <= 5 && (
								<span className="text-xs block mt-1 opacity-80">{scanInfo.duplicateNames.join(', ')}</span>
							)}
						</div>
					)}
					{scanInfo && scanInfo.subdirectories?.length > 0 && (
						<div className="bg-blue-500/10 border border-blue-500/30 text-blue-400 text-sm rounded-lg px-4 py-2">
							{scanInfo.subdirectories.length} subdirector{scanInfo.subdirectories.length === 1 ? 'y' : 'ies'} not scanned: {scanInfo.subdirectories.join(', ')}
						</div>
					)}
					{scanInfo && scanInfo.deleted > 0 && (
						<div className="bg-success/10 border border-success/30 text-success text-sm rounded-lg px-4 py-2">
							{scanInfo.deleted} original file{scanInfo.deleted !== 1 ? 's' : ''} deleted from source folder.
						</div>
					)}
				</div>
			)}

			{/* === STEP 3: Single file enrichment === */}
			{step === 3 && extracted && (
				<div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
					{/* Left: preview + file info */}
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
							<div className="flex justify-between"><span className="text-text-secondary">MIME</span><span className="text-text-primary">{extracted.mimeType}</span></div>
							{extracted.width > 0 && <div className="flex justify-between"><span className="text-text-secondary">Dimensions</span><span className="text-text-primary">{extracted.width} x {extracted.height}</span></div>}
							{extracted.c2paJson && <div className="flex justify-between"><span className="text-text-secondary">C2PA</span><span className="text-success">Manifest found</span></div>}
							{assetCategory === 'ai-assets' && extracted.platform && (
								<div className="flex justify-between"><span className="text-text-secondary">Platform</span>
									<span className={`font-medium ${extracted.platform !== 'unknown' ? 'text-accent' : 'text-text-secondary'}`}>
										{PLATFORM_LABELS[extracted.platform] || extracted.platform}
									</span>
								</div>
							)}
						</div>
						<button onClick={() => { setStep(2); setExtracted(null); }}
							className="text-sm text-text-secondary hover:text-text-primary transition-colors">← Change file</button>
					</div>

					{/* Right: type-specific form */}
					<div className="lg:col-span-2">
						{assetCategory === 'ai-assets' && <AIEnrichForm
							{...{ description, setDescription, notes, setNotes, digitalSourceType, setDigitalSourceType,
								generationDate, setGenerationDate, platform, setPlatform, prompt, setPrompt,
								negativePrompt, setNegativePrompt, modelName, setModelName, modelVersion, setModelVersion,
								seed, setSeed, aiSteps, setAiSteps, cfgScale, setCfgScale, width, setWidth,
								height, setHeight, aspectRatio, setAspectRatio }}
							onSubmit={handleSaveAI} saving={saveAI.isPending} error={saveAI.error}
						/>}
						{assetCategory === 'archival' && <ArchivalEnrichForm
							{...{ archName, setArchName, caption, setCaption, sourceUrl, setSourceUrl,
								accessDate, setAccessDate, creator, setCreator, institution, setInstitution,
								license, setLicense, licenseUrl, setLicenseUrl, originalDate, setOriginalDate,
								medium, setMedium, archUsageNotes, setArchUsageNotes }}
							onSubmit={handleSaveArchival} saving={saveArchival.isPending} error={saveArchival.error}
						/>}
						{assetCategory === 'produced' && <ProducedEnrichForm
							{...{ prodName, setProdName, prodDescription, setProdDescription, prodCreator, setProdCreator,
								recordingDate, setRecordingDate, location, setLocation, equipment, setEquipment,
								prodUsageNotes, setProdUsageNotes, prodAssetType, setProdAssetType }}
							onSubmit={handleSaveProduced} saving={saveProduced.isPending} error={saveProduced.error}
						/>}
					</div>
				</div>
			)}

			{/* === STEP 4: Batch review === */}
			{step === 4 && batchResults.length > 0 && (
				<div className="space-y-4">
					<div className="flex items-center justify-between">
						<div>
							<h3 className="text-lg font-semibold text-text-primary">{batchResults.length} files ready to import as {typeLabel}</h3>
							<p className="text-sm text-text-secondary">
								Files have been scanned. You can enrich individual assets after import.
								{scanInfo?.duplicates > 0 && <span className="text-amber-400"> ({scanInfo.duplicates} duplicate{scanInfo.duplicates !== 1 ? 's' : ''} skipped)</span>}
							</p>
						</div>
						<div className="flex items-center gap-3">
							<button onClick={() => { setStep(2); setBatchResults([]); }}
								className="px-4 py-2 text-text-secondary hover:text-text-primary text-sm transition-colors">Cancel</button>
							<button onClick={handleBatchSave} disabled={batchSaving}
								className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40 flex items-center gap-2">
								{batchSaving ? `Saving ${batchSaved}/${batchResults.length}...` : `Import all ${batchResults.length} assets`}
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
								{item.mimeType?.startsWith('audio/') && (
									<div className="aspect-video bg-card-hover flex items-center justify-center">
										<svg className="w-8 h-8 text-text-secondary opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
									</div>
								)}
								<div className="p-3 space-y-1">
									<p className="text-xs font-mono text-text-primary truncate">{item.filename}</p>
									<div className="flex items-center justify-between">
										<span className="text-xs text-text-secondary">{item.mimeType}</span>
										<span className="text-xs text-text-secondary">{(item.fileSize / 1024).toFixed(0)} KB</span>
									</div>
									{item.c2paJson && <p className="text-xs text-success">C2PA manifest</p>}
								</div>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

function Spinner() {
	return (
		<svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
			<circle cx="12" cy="12" r="10" strokeOpacity=".25"/><path d="M12 2a10 10 0 0 1 10 10"/>
		</svg>
	);
}

// === AI Asset Enrichment Form ===
function AIEnrichForm({ description, setDescription, notes, setNotes, digitalSourceType, setDigitalSourceType,
	generationDate, setGenerationDate, platform, setPlatform, prompt, setPrompt,
	negativePrompt, setNegativePrompt, modelName, setModelName, modelVersion, setModelVersion,
	seed, setSeed, aiSteps, setAiSteps, cfgScale, setCfgScale, width, setWidth,
	height, setHeight, aspectRatio, setAspectRatio, onSubmit, saving, error }) {
	return (
		<form onSubmit={onSubmit} className="space-y-6">
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
						<textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="How this asset is used"
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
					<div><label className="block text-sm font-medium text-text-primary mb-1">Model</label>
						<input type="text" value={modelName} onChange={e => setModelName(e.target.value)}
							className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" /></div>
					<div><label className="block text-sm font-medium text-text-primary mb-1">Version</label>
						<input type="text" value={modelVersion} onChange={e => setModelVersion(e.target.value)}
							className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" /></div>
					<div><label className="block text-sm font-medium text-text-primary mb-1">Seed</label>
						<input type="text" value={seed} onChange={e => setSeed(e.target.value)}
							className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm font-mono" /></div>
					<div><label className="block text-sm font-medium text-text-primary mb-1">Steps</label>
						<input type="number" value={aiSteps} onChange={e => setAiSteps(e.target.value)}
							className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" /></div>
					<div><label className="block text-sm font-medium text-text-primary mb-1">CFG Scale</label>
						<input type="text" value={cfgScale} onChange={e => setCfgScale(e.target.value)}
							className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" /></div>
					<div><label className="block text-sm font-medium text-text-primary mb-1">Aspect ratio</label>
						<input type="text" value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} placeholder="16:9"
							className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent text-sm" /></div>
					<div><label className="block text-sm font-medium text-text-primary mb-1">Width</label>
						<input type="number" value={width} onChange={e => setWidth(e.target.value)}
							className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" /></div>
					<div><label className="block text-sm font-medium text-text-primary mb-1">Height</label>
						<input type="number" value={height} onChange={e => setHeight(e.target.value)}
							className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" /></div>
				</div>
			</div>
			{error && <p className="text-sm text-danger">{error.message}</p>}
			<div className="flex justify-end">
				<button type="submit" disabled={saving}
					className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40">
					{saving ? 'Saving...' : 'Save asset'}
				</button>
			</div>
		</form>
	);
}

// === Archival Enrichment Form ===
function ArchivalEnrichForm({ archName, setArchName, caption, setCaption, sourceUrl, setSourceUrl,
	accessDate, setAccessDate, creator, setCreator, institution, setInstitution,
	license, setLicense, licenseUrl, setLicenseUrl, originalDate, setOriginalDate,
	medium, setMedium, archUsageNotes, setArchUsageNotes, onSubmit, saving, error }) {
	return (
		<form onSubmit={onSubmit} className="space-y-4">
			<div className="grid grid-cols-2 gap-4">
				<div className="col-span-2">
					<label className="block text-sm font-medium text-text-primary mb-1">Name <span className="text-danger">*</span></label>
					<input required type="text" value={archName} onChange={e => setArchName(e.target.value)}
						className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
				</div>
				<div className="col-span-2">
					<label className="block text-sm font-medium text-text-primary mb-1">Caption</label>
					<textarea value={caption} onChange={e => setCaption(e.target.value)} rows={2}
						className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm resize-none" />
				</div>
				<div className="col-span-2">
					<label className="block text-sm font-medium text-text-primary mb-1">Source URL</label>
					<input type="url" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)}
						className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm font-mono" />
				</div>
				<div>
					<label className="block text-sm font-medium text-text-primary mb-1">Access date</label>
					<input type="date" value={accessDate} onChange={e => setAccessDate(e.target.value)}
						className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
				</div>
				<div>
					<label className="block text-sm font-medium text-text-primary mb-1">Original date</label>
					<input type="text" value={originalDate} onChange={e => setOriginalDate(e.target.value)} placeholder="1910, circa 1900"
						className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent text-sm" />
				</div>
				<div>
					<label className="block text-sm font-medium text-text-primary mb-1">Creator</label>
					<input type="text" value={creator} onChange={e => setCreator(e.target.value)}
						className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
				</div>
				<div>
					<label className="block text-sm font-medium text-text-primary mb-1">Institution / Archive</label>
					<input type="text" value={institution} onChange={e => setInstitution(e.target.value)}
						className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
				</div>
				<div>
					<label className="block text-sm font-medium text-text-primary mb-1">License</label>
					<input type="text" value={license} onChange={e => setLicense(e.target.value)} list="licenses" placeholder="Public Domain"
						className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent text-sm" />
					<datalist id="licenses">{COMMON_LICENSES.map(l => <option key={l} value={l} />)}</datalist>
				</div>
				<div>
					<label className="block text-sm font-medium text-text-primary mb-1">Medium</label>
					<select value={medium} onChange={e => setMedium(e.target.value)}
						className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm capitalize">
						{MEDIA_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
					</select>
				</div>
				<div className="col-span-2">
					<label className="block text-sm font-medium text-text-primary mb-1">Usage notes</label>
					<textarea value={archUsageNotes} onChange={e => setArchUsageNotes(e.target.value)} rows={2}
						placeholder="How this image is being used in the project"
						className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent text-sm resize-none" />
				</div>
			</div>
			{error && <p className="text-sm text-danger">{error.message}</p>}
			<div className="flex justify-end">
				<button type="submit" disabled={!archName.trim() || saving}
					className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40">
					{saving ? 'Saving...' : 'Save to catalog'}
				</button>
			</div>
		</form>
	);
}

// === Produced Asset Enrichment Form ===
function ProducedEnrichForm({ prodName, setProdName, prodDescription, setProdDescription, prodCreator, setProdCreator,
	recordingDate, setRecordingDate, location, setLocation, equipment, setEquipment,
	prodUsageNotes, setProdUsageNotes, prodAssetType, setProdAssetType, onSubmit, saving, error }) {
	return (
		<form onSubmit={onSubmit} className="space-y-4">
			<div className="grid grid-cols-2 gap-4">
				<div className="col-span-2">
					<label className="block text-sm font-medium text-text-primary mb-1">Name <span className="text-danger">*</span></label>
					<input required type="text" value={prodName} onChange={e => setProdName(e.target.value)}
						className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
				</div>
				<div className="col-span-2">
					<label className="block text-sm font-medium text-text-primary mb-1">Description</label>
					<textarea value={prodDescription} onChange={e => setProdDescription(e.target.value)} rows={2}
						placeholder="What is this recording of?"
						className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent text-sm resize-none" />
				</div>
				<div>
					<label className="block text-sm font-medium text-text-primary mb-1">Asset type</label>
					<select value={prodAssetType} onChange={e => setProdAssetType(e.target.value)}
						className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm capitalize">
						{PRODUCED_ASSET_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
					</select>
				</div>
				<div>
					<label className="block text-sm font-medium text-text-primary mb-1">Recording date</label>
					<input type="date" value={recordingDate} onChange={e => setRecordingDate(e.target.value)}
						className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
				</div>
				<div>
					<label className="block text-sm font-medium text-text-primary mb-1">Creator</label>
					<input type="text" value={prodCreator} onChange={e => setProdCreator(e.target.value)}
						className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent text-sm" />
				</div>
				<div>
					<label className="block text-sm font-medium text-text-primary mb-1">Location</label>
					<input type="text" value={location} onChange={e => setLocation(e.target.value)} placeholder="Recording location"
						className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent text-sm" />
				</div>
				<div className="col-span-2">
					<label className="block text-sm font-medium text-text-primary mb-1">Equipment</label>
					<input type="text" value={equipment} onChange={e => setEquipment(e.target.value)} placeholder="Microphone, camera model, etc."
						className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent text-sm" />
				</div>
				<div className="col-span-2">
					<label className="block text-sm font-medium text-text-primary mb-1">Usage notes</label>
					<textarea value={prodUsageNotes} onChange={e => setProdUsageNotes(e.target.value)} rows={2}
						placeholder="How this asset is used in the project"
						className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent text-sm resize-none" />
				</div>
			</div>
			{error && <p className="text-sm text-danger">{error.message}</p>}
			<div className="flex justify-end">
				<button type="submit" disabled={!prodName.trim() || saving}
					className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40">
					{saving ? 'Saving...' : 'Save asset'}
				</button>
			</div>
		</form>
	);
}

import { useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';

const MEDIA_TYPES = ['photograph', 'illustration', 'map', 'document', 'other'];
const COMMON_LICENSES = ['Public Domain', 'CC BY 4.0', 'CC BY-SA 4.0', 'CC BY-NC 4.0', 'CC BY-NC-SA 4.0', 'CC0 1.0', 'All Rights Reserved'];

export default function ArchivalIngest() {
	const navigate = useNavigate();
	const qc = useQueryClient();

	const fileInputRef = useRef(null);
	const [step, setStep] = useState(1);
	const [mode, setMode] = useState('upload');
	const [input, setInput] = useState('');
	const [extracting, setExtracting] = useState(false);
	const [extractError, setExtractError] = useState('');
	const [extracted, setExtracted] = useState(null);
	const [dragging, setDragging] = useState(false);

	// Editable metadata fields
	const [name, setName] = useState('');
	const [caption, setCaption] = useState('');
	const [sourceUrl, setSourceUrl] = useState('');
	const [accessDate, setAccessDate] = useState('');
	const [creator, setCreator] = useState('');
	const [institution, setInstitution] = useState('');
	const [license, setLicense] = useState('');
	const [licenseUrl, setLicenseUrl] = useState('');
	const [originalDate, setOriginalDate] = useState('');
	const [medium, setMedium] = useState('photograph');
	const [usageNotes, setUsageNotes] = useState('');
	const [notionStrategy, setNotionStrategy] = useState('external_url');

	function prefillFromData(data) {
		setExtracted(data);
		setName(data.filename?.replace(/\.[^.]+$/, '').replace(/_/g, ' ') || '');
		setCaption(data.suggestedCaption || '');
		setSourceUrl(data.sourceUrl || '');
		setAccessDate(data.accessDate || '');
		setCreator(data.suggestedCreator || '');
		setOriginalDate(data.suggestedOriginalDate?.toString()?.slice(0, 10) || '');
	}

	async function handleUpload(fileList) {
		if (!fileList?.length) return;
		setExtracting(true);
		setExtractError('');
		try {
			const formData = new FormData();
			formData.append('module', 'archival');
			for (const file of fileList) formData.append('files', file);
			const res = await fetch('/api/upload', { method: 'POST', body: formData });
			const data = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
			if (!res.ok) { setExtractError(data.error || 'Upload failed'); return; }
			const first = data.results?.find(r => r.success);
			if (!first) { setExtractError(data.results?.[0]?.error || 'Upload failed'); return; }
			prefillFromData(first);
			setStep(2);
		} catch (err) {
			setExtractError(err.message);
		} finally {
			setExtracting(false);
		}
	}

	async function handleExtract() {
		setExtracting(true);
		setExtractError('');
		try {
			const res = await fetch('/api/extract', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(mode === 'url' ? { mode: 'url', sourceUrl: input } : { mode: 'local', filePath: input })
			});
			const data = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
			if (!res.ok) { setExtractError(data.error || 'Extraction failed'); return; }

			setExtracted(data);
			// Pre-fill editable fields from extraction
			setName(data.filename?.replace(/\.[^.]+$/, '').replace(/_/g, ' ') || '');
			setCaption(data.suggestedCaption || '');
			setSourceUrl(data.sourceUrl || input);
			setAccessDate(data.accessDate || '');
			setCreator(data.suggestedCreator || '');
			setOriginalDate(data.suggestedOriginalDate?.toString()?.slice(0, 10) || '');
			setStep(2);
		} catch (err) {
			setExtractError(err.message);
		} finally {
			setExtracting(false);
		}
	}

	const create = useMutation({
		mutationFn: (data) => fetch('/api/archival', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(data)
		}).then(r => r.json()),
		onSuccess: (asset) => {
			qc.invalidateQueries({ queryKey: ['archival'] });
			navigate(`/archival/${asset.id}`);
		}
	});

	function handleConfirm(e) {
		e.preventDefault();
		create.mutate({
			name, caption, sourceUrl, accessDate,
			creator, institution, license, licenseUrl,
			originalDate, medium, usageNotes,
			filePath: extracted.filePath,
			filename: extracted.filename,
			fileHash: extracted.fileHash,
			fileSize: extracted.fileSize,
			mimeType: extracted.mimeType,
			exifJson: extracted.exifJson,
			c2paJson: extracted.c2paJson || null,
			notionImageStrategy: notionStrategy
		});
	}

	return (
		<div>
			<div className="mb-6 flex items-center gap-2 text-sm text-text-secondary">
				<Link to="/archival" className="hover:text-text-primary transition-colors">Archival</Link>
				<span>/</span>
				<span className="text-text-primary">Ingest image</span>
			</div>
			<h2 className="text-2xl font-bold text-text-primary mb-6">Add Archival Image</h2>

			{step === 1 && (
				<div className="max-w-lg space-y-4">
					<div className="flex gap-2">
						{[{ v: 'upload', l: 'Upload file' }, { v: 'url', l: 'From URL' }, { v: 'local', l: 'File path' }].map(opt => (
							<button key={opt.v} onClick={() => { setMode(opt.v); setExtractError(''); }}
								className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${mode === opt.v ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-secondary hover:text-text-primary hover:bg-card-hover'}`}>
								{opt.l}
							</button>
						))}
					</div>

					{mode === 'upload' && (
						<div>
							<input ref={fileInputRef} type="file" accept="image/*" className="hidden"
								onChange={e => handleUpload(e.target.files)} />
							<div
								onClick={() => !extracting && fileInputRef.current?.click()}
								onDragOver={e => { e.preventDefault(); setDragging(true); }}
								onDragLeave={() => setDragging(false)}
								onDrop={e => { e.preventDefault(); setDragging(false); handleUpload(e.dataTransfer.files); }}
								className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
									dragging ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/40 hover:bg-card-hover'
								}`}>
								<svg className="w-8 h-8 text-text-secondary mx-auto mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
									<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
								</svg>
								{extracting ? <p className="text-sm text-accent">Processing…</p> : (
									<>
										<p className="text-sm text-text-primary font-medium">Drop image here or click to browse</p>
										<p className="text-xs text-text-secondary mt-1">Copied to managed storage automatically</p>
									</>
								)}
							</div>
						</div>
					)}

					{(mode === 'url' || mode === 'local') && (
						<>
							<div>
								<label className="block text-sm font-medium text-text-primary mb-1.5">
									{mode === 'url' ? 'Image URL' : 'Absolute file path'}
								</label>
								<input type="text" value={input} onChange={e => setInput(e.target.value)}
									onKeyDown={e => e.key === 'Enter' && input.trim() && handleExtract()}
									placeholder={mode === 'url' ? 'https://upload.wikimedia.org/…' : 'C:/Users/…/image.jpg'}
									className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent font-mono text-sm"
								/>
							</div>
							<button onClick={handleExtract} disabled={!input.trim() || extracting}
								className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2">
								{extracting ? (
									<><svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeOpacity=".25"/><path d="M12 2a10 10 0 0 1 10 10" /></svg> Extracting…</>
								) : 'Extract metadata →'}
							</button>
						</>
					)}

					{extractError && <p className="text-sm text-danger">{extractError}</p>}
				</div>
			)}

			{step === 2 && extracted && (
				<div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
					{/* Left: extracted file info */}
					<div className="space-y-4">
						<div className="bg-card-bg border border-border rounded-lg overflow-hidden">
							<img src={`/api/preview?path=${encodeURIComponent(extracted.filePath)}`}
								alt="Preview" className="w-full object-cover" style={{ maxHeight: 200 }} />
						</div>
						<div className="bg-card-bg border border-border rounded-lg p-3 space-y-1.5 text-xs">
							<div className="flex justify-between"><span className="text-text-secondary">File</span><span className="text-text-primary font-mono truncate ml-4">{extracted.filename}</span></div>
							<div className="flex justify-between"><span className="text-text-secondary">Size</span><span className="text-text-primary">{(extracted.fileSize / 1024).toFixed(0)} KB</span></div>
							{extracted.width > 0 && <div className="flex justify-between"><span className="text-text-secondary">Dimensions</span><span className="text-text-primary">{extracted.width} × {extracted.height}</span></div>}
							<div className="flex justify-between"><span className="text-text-secondary">MIME</span><span className="text-text-primary">{extracted.mimeType}</span></div>
						</div>
						<button onClick={() => { setStep(1); setExtracted(null); }}
							className="text-sm text-text-secondary hover:text-text-primary transition-colors">
							← Change source
						</button>
					</div>

					{/* Right: metadata form */}
					<form onSubmit={handleConfirm} className="lg:col-span-2 space-y-4">
						<div className="grid grid-cols-2 gap-4">
							<div className="col-span-2">
								<label className="block text-sm font-medium text-text-primary mb-1">Name <span className="text-danger">*</span></label>
								<input required type="text" value={name} onChange={e => setName(e.target.value)}
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
								<input type="text" value={originalDate} onChange={e => setOriginalDate(e.target.value)}
									placeholder="1910, circa 1900"
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
								<input type="text" value={license} onChange={e => setLicense(e.target.value)}
									list="licenses" placeholder="Public Domain"
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
								<textarea value={usageNotes} onChange={e => setUsageNotes(e.target.value)} rows={2}
									placeholder="How this image is being used as reference or directly in the project"
									className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent text-sm resize-none" />
							</div>
						</div>

						{create.isError && <p className="text-sm text-danger">{create.error?.message}</p>}

						<div className="flex justify-end">
							<button type="submit" disabled={!name.trim() || create.isPending}
								className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40">
								{create.isPending ? 'Saving…' : 'Save to catalog'}
							</button>
						</div>
					</form>
				</div>
			)}
		</div>
	);
}

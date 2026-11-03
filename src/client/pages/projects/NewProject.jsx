import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';

export default function NewProject() {
	const navigate = useNavigate();
	const qc = useQueryClient();
	const [step, setStep] = useState(1);
	const [name, setName] = useState('');
	const [description, setDescription] = useState('');
	const [prefix, setPrefix] = useState('');
	const [storagePath, setStoragePath] = useState('');
	const [modules, setModules] = useState(['archival']);
	const [notionEnabled, setNotionEnabled] = useState(false);
	const [notionDbId, setNotionDbId] = useState('');

	const create = useMutation({
		mutationFn: (data) => fetch('/api/projects', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(data)
		}).then(r => r.json()),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['projects'] });
			qc.invalidateQueries({ queryKey: ['activeProject'] });
			navigate('/');
		}
	});

	function toggleModule(mod) {
		setModules(prev => prev.includes(mod) ? prev.filter(m => m !== mod) : [...prev, mod]);
	}

	const showNotionStep = modules.includes('archival');
	const totalSteps = showNotionStep ? 3 : 2;

	function handleSubmit() {
		create.mutate({
			name: name.trim(),
			description: description.trim(),
			assetIdPrefix: prefix.trim().toUpperCase() || 'PROJ',
			storagePath: storagePath.trim(),
			modules: JSON.stringify(modules),
			notionEnabled,
			notionArchivalDbId: notionDbId.trim()
		});
	}

	return (
		<div className="min-h-screen bg-app-bg flex items-center justify-center p-8">
			<div className="w-full max-w-md">
				<div className="mb-8 text-center">
					<h1 className="text-2xl font-bold text-text-primary">Create a Project</h1>
					<p className="text-text-secondary mt-1 text-sm">Step {step} of {totalSteps}</p>
				</div>

				<div className="flex gap-2 mb-8">
					{Array.from({ length: totalSteps }).map((_, i) => (
						<div key={i} className={`flex-1 h-1 rounded-full ${i + 1 <= step ? 'bg-accent' : 'bg-border'}`} />
					))}
				</div>

				{step === 1 && (
					<div className="space-y-4">
						<div>
							<label className="block text-sm font-medium text-text-primary mb-1.5">
								Project name <span className="text-danger">*</span>
							</label>
							<input type="text" value={name} onChange={e => setName(e.target.value)}
								placeholder="My Documentary Project"
								className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
							/>
						</div>
						<div>
							<label className="block text-sm font-medium text-text-primary mb-1.5">Description</label>
							<textarea value={description} onChange={e => setDescription(e.target.value)}
								placeholder="Brief description of the production"
								rows={2}
								className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent resize-none"
							/>
						</div>
						<div>
							<label className="block text-sm font-medium text-text-primary mb-1.5">Asset ID prefix</label>
							<input type="text" value={prefix} onChange={e => setPrefix(e.target.value.toUpperCase())}
								placeholder="PROJ" maxLength={8}
								className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent uppercase"
							/>
							<p className="text-xs text-text-secondary mt-1">Used for asset IDs, e.g. PROJ-001</p>
						</div>
						<div>
							<label className="block text-sm font-medium text-text-primary mb-1.5">Storage path <span className="text-text-secondary font-normal">(optional)</span></label>
							<input type="text" value={storagePath} onChange={e => setStoragePath(e.target.value)}
								placeholder="C:\Projects\my-project or leave blank for default"
								className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent font-mono text-sm"
							/>
							<p className="text-xs text-text-secondary mt-1">Where downloaded images are saved. Defaults to <code className="bg-border/40 px-1 rounded">data/archival/images/</code> inside the app folder.</p>
						</div>
						<div className="flex justify-end pt-2">
							<button onClick={() => setStep(2)} disabled={!name.trim()}
								className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
								Next →
							</button>
						</div>
					</div>
				)}

				{step === 2 && (
					<div className="space-y-3">
						<p className="text-sm font-medium text-text-primary mb-3">Which modules does this project need?</p>
						{[
							{ value: 'archival', label: 'Archival Images', desc: 'Track public domain photos, illustrations, and source materials with Notion sync' },
							{ value: 'ai_assets', label: 'AI Assets', desc: 'Track AI-generated images with metadata extraction and C2PA manifest support' }
						].map(mod => (
							<button key={mod.value} onClick={() => toggleModule(mod.value)}
								className={`w-full text-left p-4 rounded-lg border transition-colors ${modules.includes(mod.value) ? 'border-accent bg-accent/10' : 'border-border bg-card-bg hover:bg-card-hover'}`}>
								<div className="flex items-center justify-between">
									<div>
										<p className="font-medium text-text-primary">{mod.label}</p>
										<p className="text-xs text-text-secondary mt-0.5">{mod.desc}</p>
									</div>
									{modules.includes(mod.value) && (
										<svg className="w-5 h-5 text-accent shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
											<polyline points="20 6 9 17 4 12"/>
										</svg>
									)}
								</div>
							</button>
						))}
						<div className="flex justify-between pt-2">
							<button onClick={() => setStep(1)} className="px-4 py-2 text-text-secondary hover:text-text-primary text-sm transition-colors">← Back</button>
							{showNotionStep ? (
								<button onClick={() => setStep(3)} disabled={modules.length === 0}
									className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
									Next →
								</button>
							) : (
								<button onClick={handleSubmit} disabled={modules.length === 0 || create.isPending}
									className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
									{create.isPending ? 'Creating…' : 'Create Project'}
								</button>
							)}
						</div>
					</div>
				)}

				{step === 3 && (
					<div className="space-y-4">
						<p className="text-sm font-medium text-text-primary mb-1">Notion integration</p>
						<p className="text-xs text-text-secondary">Sync archival assets to a Notion database for collaboration.</p>
						<label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg border border-border hover:bg-card-hover transition-colors">
							<input type="checkbox" checked={notionEnabled} onChange={e => setNotionEnabled(e.target.checked)} className="w-4 h-4 accent-accent" />
							<span className="text-sm text-text-primary">Enable Notion sync for this project</span>
						</label>
						{notionEnabled && (
							<div>
								<label className="block text-sm font-medium text-text-primary mb-1.5">Notion Database ID</label>
								<input type="text" value={notionDbId} onChange={e => setNotionDbId(e.target.value)}
									placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
									className="w-full bg-card-bg border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent font-mono text-sm"
								/>
							</div>
						)}
						<div className="bg-card-bg border border-border rounded-lg p-3 text-xs text-text-secondary space-y-1">
							<p className="font-medium text-text-primary">Before syncing, add to your Notion database:</p>
							<p>1. "Access Date" property (Date)</p>
							<p>2. "Medium" property (Select): Photograph, Illustration, Map, Document, Other</p>
							<p>3. Share the database with your Notion integration</p>
							<p>4. Set <code className="bg-border/50 px-1 rounded">NOTION_API_KEY</code> in your <code className="bg-border/50 px-1 rounded">.env</code></p>
						</div>
						<div className="flex justify-between pt-2">
							<button onClick={() => setStep(2)} className="px-4 py-2 text-text-secondary hover:text-text-primary text-sm transition-colors">← Back</button>
							<button onClick={handleSubmit} disabled={create.isPending}
								className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40">
								{create.isPending ? 'Creating…' : 'Create Project'}
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

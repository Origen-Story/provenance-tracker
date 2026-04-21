import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { JobProgress } from './SearchPage.jsx';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMPTY_GROUP = {
	groupId: '',
	groupName: '',
	keywords: { en: [] },
	categories: [],
	notes: '',
	sortOrder: 0
};

function nonEmpty(s) { return typeof s === 'string' && s.trim().length > 0; }

// ---------------------------------------------------------------------------
// Tag input — a chip list + add field
// ---------------------------------------------------------------------------

function TagInput({ values, onChange, placeholder, autoPrefix }) {
	const [draft, setDraft] = useState('');

	function commit() {
		let v = draft.trim();
		if (!v) return;
		if (autoPrefix && !v.startsWith(autoPrefix)) v = autoPrefix + v;
		if (values.includes(v)) { setDraft(''); return; }
		onChange([...values, v]);
		setDraft('');
	}

	function remove(i) {
		onChange(values.filter((_, idx) => idx !== i));
	}

	return (
		<div className="space-y-2">
			{values.length > 0 && (
				<div className="flex flex-wrap gap-1.5">
					{values.map((v, i) => (
						<span key={i} className="group inline-flex items-center gap-1 text-xs bg-card-hover border border-border rounded px-2 py-1 text-text-primary">
							<span className="truncate max-w-xs" title={v}>{v}</span>
							<button type="button" onClick={() => remove(i)} aria-label="Remove"
								className="text-text-secondary hover:text-red-400 transition-colors">×</button>
						</span>
					))}
				</div>
			)}
			<div className="flex gap-2">
				<input
					type="text"
					value={draft}
					onChange={e => setDraft(e.target.value)}
					onKeyDown={e => {
						if (e.key === 'Enter') { e.preventDefault(); commit(); }
					}}
					placeholder={placeholder}
					className="flex-1 bg-sidebar-bg border border-border rounded px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
				/>
				<button type="button" onClick={commit}
					disabled={!draft.trim()}
					className="px-3 py-1.5 text-xs bg-card-hover border border-border rounded text-text-primary hover:bg-card-hover/70 disabled:opacity-40">
					Add
				</button>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Keywords editor — tabs per language dict key
// ---------------------------------------------------------------------------

function KeywordsEditor({ value, onChange }) {
	const entries = Object.entries(value || {});
	const langs = entries.map(([k]) => k);
	const [activeLang, setActiveLang] = useState(langs[0] || 'en');
	const [newLang, setNewLang] = useState('');

	// If the active tab disappears (e.g. language removed), fall back.
	useEffect(() => {
		if (!langs.includes(activeLang) && langs.length > 0) setActiveLang(langs[0]);
	}, [langs, activeLang]);

	function ensureLang(lang) {
		if (!value[lang]) onChange({ ...value, [lang]: [] });
	}

	function setTerms(lang, terms) {
		onChange({ ...value, [lang]: terms });
	}

	function removeLang(lang) {
		if (!confirm(`Remove the "${lang}" language bucket and all its keywords?`)) return;
		const next = { ...value };
		delete next[lang];
		onChange(next);
	}

	function addLang() {
		const key = newLang.trim().toLowerCase();
		if (!key) return;
		if (value[key]) { setActiveLang(key); setNewLang(''); return; }
		onChange({ ...value, [key]: [] });
		setActiveLang(key);
		setNewLang('');
	}

	if (langs.length === 0) {
		// Fresh state — present a minimal "add a language" prompt.
		return (
			<div className="space-y-2">
				<p className="text-xs text-text-secondary">No language buckets yet. Add one to start entering keywords.</p>
				<div className="flex gap-2">
					<input type="text" value={newLang} onChange={e => setNewLang(e.target.value)}
						onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLang(); } }}
						placeholder="Language code (en, ca, es, fr...)"
						className="flex-1 bg-sidebar-bg border border-border rounded px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
					<button type="button" onClick={addLang}
						className="px-3 py-1.5 text-xs bg-accent hover:bg-accent-hover text-white rounded">
						Add language
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			{/* Tabs */}
			<div className="flex items-center gap-1 flex-wrap border-b border-border">
				{langs.map(lang => (
					<button key={lang} type="button"
						onClick={() => setActiveLang(lang)}
						className={`group inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-t -mb-px border-b-2 transition-colors ${
							activeLang === lang
								? 'text-accent border-accent bg-accent/5'
								: 'text-text-secondary border-transparent hover:text-text-primary'
						}`}>
						<span className="uppercase">{lang}</span>
						<span className="text-[10px] opacity-70">({(value[lang] || []).length})</span>
						<span onClick={e => { e.stopPropagation(); removeLang(lang); }}
							className="text-text-secondary hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity ml-0.5"
							title={`Remove ${lang}`}>×</span>
					</button>
				))}
				<div className="flex items-center gap-1 ml-2">
					<input type="text" value={newLang}
						onChange={e => setNewLang(e.target.value)}
						onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLang(); } }}
						placeholder="+ lang"
						className="w-20 bg-transparent border-b border-border px-1 py-0.5 text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
					{newLang.trim() && (
						<button type="button" onClick={addLang} className="text-xs text-accent hover:text-accent-hover">add</button>
					)}
				</div>
			</div>

			<TagInput
				values={value[activeLang] || []}
				onChange={(next) => { ensureLang(activeLang); setTerms(activeLang, next); }}
				placeholder={`New ${activeLang.toUpperCase()} keyword and press Enter`}
			/>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Import modal
// ---------------------------------------------------------------------------

function ImportModal({ onClose, onImport, importing, importResult }) {
	const [text, setText] = useState('');
	const [mode, setMode] = useState('merge');
	const [showHint, setShowHint] = useState(false);
	const [parseError, setParseError] = useState('');

	function submit() {
		setParseError('');
		let parsed;
		try { parsed = JSON.parse(text); } catch (e) { setParseError('Invalid JSON: ' + e.message); return; }
		const groups = Array.isArray(parsed) ? parsed : parsed.groups;
		if (!Array.isArray(groups)) { setParseError('Expected a JSON array of group objects (or { "groups": [...] }).'); return; }
		onImport({ groups, mode });
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
			<div className="bg-sidebar-bg border border-border rounded-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
				<div className="flex items-center justify-between p-4 border-b border-border">
					<h3 className="text-sm font-semibold text-text-primary">Import groups (JSON)</h3>
					<button onClick={onClose} className="text-text-secondary hover:text-text-primary">
						<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
					</button>
				</div>
				<div className="p-4 space-y-3">
					<div className="flex gap-4 text-xs text-text-primary">
						<label className="inline-flex items-center gap-1.5">
							<input type="radio" name="mode" value="merge" checked={mode === 'merge'} onChange={() => setMode('merge')} />
							<span>Merge <span className="text-text-secondary">(upsert by groupId)</span></span>
						</label>
						<label className="inline-flex items-center gap-1.5">
							<input type="radio" name="mode" value="replace" checked={mode === 'replace'} onChange={() => setMode('replace')} />
							<span>Replace <span className="text-text-secondary">(delete all existing, then insert)</span></span>
						</label>
					</div>

					<div>
						<div className="flex items-center justify-between mb-1">
							<label className="text-xs text-text-secondary">Paste JSON</label>
							<button type="button" onClick={() => setShowHint(v => !v)}
								className="text-xs text-accent hover:text-accent-hover">{showHint ? 'Hide' : 'Show'} structure hint</button>
						</div>
						{showHint && (
							<pre className="text-[10px] bg-card-bg border border-border rounded p-2 mb-2 overflow-x-auto text-text-secondary">{`[
  {
    "groupId": "stop_1",
    "groupName": "Hospital de la Santa Creu",
    "keywords": {
      "en": ["keyword one", "keyword two"],
      "ca": ["..."]
    },
    "categories": ["Category:Example"],
    "notes": "",
    "sortOrder": 0
  }
]`}</pre>
						)}
						<textarea
							value={text}
							onChange={e => setText(e.target.value)}
							rows={14}
							placeholder='[{ "groupName": "...", "keywords": {"en": [...]}, "categories": [...] }]'
							className="w-full bg-card-bg border border-border rounded px-2 py-2 text-xs font-mono text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
						/>
					</div>

					{parseError && <p className="text-xs text-red-400">{parseError}</p>}

					{importResult && (
						<div className="text-xs bg-card-bg border border-border rounded p-2 space-y-1">
							<p className="text-emerald-400">✓ Inserted {importResult.inserted}, updated {importResult.updated}{importResult.deleted ? `, deleted ${importResult.deleted}` : ''}</p>
							{importResult.ignoredFields?.length > 0 && (
								<p className="text-text-secondary">Ignored unknown fields: {importResult.ignoredFields.join(', ')}</p>
							)}
							{importResult.errors?.length > 0 && (
								<div className="text-red-400">
									<p>Errors on {importResult.errors.length} entr{importResult.errors.length === 1 ? 'y' : 'ies'}:</p>
									<ul className="list-disc list-inside text-text-secondary">
										{importResult.errors.slice(0, 10).map((e, i) => <li key={i}>entry {e.index}: {e.error}</li>)}
									</ul>
								</div>
							)}
						</div>
					)}
				</div>
				<div className="flex justify-end gap-2 p-4 border-t border-border">
					<button onClick={onClose} className="px-4 py-1.5 text-sm text-text-secondary hover:text-text-primary">Cancel</button>
					<button onClick={submit} disabled={importing || !text.trim()}
						className="px-4 py-1.5 text-sm bg-accent hover:bg-accent-hover text-white rounded-lg disabled:opacity-40">
						{importing ? 'Importing...' : 'Import'}
					</button>
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Delete modal — shows usage + reassign picker when blocked
// ---------------------------------------------------------------------------

function DeleteModal({ group, allGroups, onClose, onDelete, onReassignDelete, deleting }) {
	const [target, setTarget] = useState('');
	const inUse = (group.candidateStats?.total || 0) > 0 || (group.archivalAssetCount || 0) > 0;
	const candidates = group.candidateStats?.total || 0;
	const assets = group.archivalAssetCount || 0;

	const targets = (allGroups || []).filter(g => g.id !== group.id);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
			<div className="bg-sidebar-bg border border-border rounded-xl max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
				<div className="p-4 border-b border-border">
					<h3 className="text-sm font-semibold text-text-primary">Delete "{group.groupName}"?</h3>
				</div>
				<div className="p-4 space-y-3 text-sm">
					{inUse ? (
						<>
							<p className="text-text-primary">This group is in use by:</p>
							<ul className="text-xs text-text-secondary list-disc list-inside space-y-0.5">
								{candidates > 0 && <li>{candidates} candidate{candidates !== 1 ? 's' : ''}</li>}
								{assets > 0 && <li>{assets} archival asset{assets !== 1 ? 's' : ''}</li>}
							</ul>
							<p className="text-text-primary">Reassign them to which group?</p>
							<select value={target} onChange={e => setTarget(e.target.value)}
								className="w-full bg-card-bg border border-border rounded px-2.5 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent">
								<option value="">Pick a target group...</option>
								{targets.map(g => <option key={g.id} value={g.groupId}>{g.groupName}</option>)}
							</select>
						</>
					) : (
						<p className="text-text-primary">This group has no candidates or archival assets. Delete permanently?</p>
					)}
				</div>
				<div className="flex justify-end gap-2 p-4 border-t border-border">
					<button onClick={onClose} className="px-4 py-1.5 text-sm text-text-secondary hover:text-text-primary">Cancel</button>
					{inUse ? (
						<button onClick={() => onReassignDelete(target)} disabled={!target || deleting}
							className="px-4 py-1.5 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg disabled:opacity-40">
							{deleting ? 'Working...' : 'Reassign + Delete'}
						</button>
					) : (
						<button onClick={() => onDelete()} disabled={deleting}
							className="px-4 py-1.5 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg disabled:opacity-40">
							{deleting ? 'Deleting...' : 'Delete'}
						</button>
					)}
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Editor pane — right side
// ---------------------------------------------------------------------------

function GroupEditor({ group, onSave, onDelete, onDuplicate, onSearch, saving, searching }) {
	const [draft, setDraft] = useState(group);
	const [dirty, setDirty] = useState(false);

	// Reset draft whenever the selected group changes
	useEffect(() => {
		setDraft(group);
		setDirty(false);
	}, [group.id, group.updatedAt]);

	function update(patch) {
		setDraft(prev => ({ ...prev, ...patch }));
		setDirty(true);
	}

	const saveDisabled = !dirty || !nonEmpty(draft.groupName) || saving;

	return (
		<div className="space-y-4">
			{/* Header row — identity */}
			<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
				<div>
					<label className="text-xs text-text-secondary block mb-1">Group name *</label>
					<input type="text" value={draft.groupName || ''} onChange={e => update({ groupName: e.target.value })}
						className="w-full bg-card-bg border border-border rounded px-2.5 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent" />
				</div>
				<div>
					<label className="text-xs text-text-secondary block mb-1">Group ID <span className="opacity-60">(stable key)</span></label>
					<input type="text" value={draft.groupId || ''} onChange={e => update({ groupId: e.target.value })}
						placeholder="auto-generated from name if blank"
						className="w-full bg-card-bg border border-border rounded px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
				</div>
			</div>

			{/* Keywords */}
			<div>
				<label className="text-xs text-text-secondary block mb-2">
					Keywords <span className="opacity-60">— one bucket per language, all buckets searched together</span>
				</label>
				<KeywordsEditor value={draft.keywords || {}} onChange={v => update({ keywords: v })} />
			</div>

			{/* Categories */}
			<div>
				<label className="text-xs text-text-secondary block mb-2">
					Wikimedia categories <span className="opacity-60">— crawled to depth 2 (auto-prefixed "Category:")</span>
				</label>
				<TagInput values={draft.categories || []}
					onChange={v => update({ categories: v })}
					placeholder="Example name (prefix added automatically)"
					autoPrefix="Category:" />
			</div>

			{/* Notes */}
			<div>
				<label className="text-xs text-text-secondary block mb-1">Notes</label>
				<textarea value={draft.notes || ''} onChange={e => update({ notes: e.target.value })}
					rows={3}
					className="w-full bg-card-bg border border-border rounded px-2.5 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent" />
			</div>

			{/* Action bar */}
			<div className="flex items-center gap-2 pt-3 border-t border-border sticky bottom-0 bg-app-bg">
				<button onClick={() => onSave(draft)} disabled={saveDisabled}
					className="px-4 py-1.5 text-sm bg-accent hover:bg-accent-hover text-white rounded-lg disabled:opacity-40">
					{saving ? 'Saving...' : dirty ? 'Save changes' : 'Saved'}
				</button>
				<button onClick={() => onSearch(draft.groupId)} disabled={!draft.groupId || dirty || searching}
					title={dirty ? 'Save changes first' : 'Run Wikimedia search for this group'}
					className="px-4 py-1.5 text-sm bg-card-hover border border-border text-text-primary hover:bg-card-hover/70 rounded-lg disabled:opacity-40">
					{searching ? 'Searching...' : 'Search Wikimedia'}
				</button>
				<div className="flex-1" />
				<button onClick={() => onDuplicate(draft)} disabled={!group.id}
					className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary">Duplicate</button>
				<button onClick={onDelete} disabled={!group.id}
					className="px-3 py-1.5 text-sm text-red-400 hover:text-red-300 disabled:opacity-40">Delete</button>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function GroupsManager() {
	const qc = useQueryClient();
	const [selectedId, setSelectedId] = useState(null);
	const [creating, setCreating] = useState(false);
	const [showImport, setShowImport] = useState(false);
	const [deleting, setDeleting] = useState(null); // group object
	const [toast, setToast] = useState('');
	const [importResult, setImportResult] = useState(null);

	const { data: groups = [], isLoading } = useQuery({
		queryKey: ['searchGroupsManager'],
		queryFn: () => fetch('/api/search-groups').then(r => r.json())
	});

	function invalidate() {
		qc.invalidateQueries({ queryKey: ['searchGroupsManager'] });
		qc.invalidateQueries({ queryKey: ['searchGroups'] });
		qc.invalidateQueries({ queryKey: ['searchStats'] });
	}

	function flash(msg) {
		setToast(msg);
		setTimeout(() => setToast(''), 3500);
	}

	const createMut = useMutation({
		mutationFn: (body) => fetch('/api/search-groups', {
			method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Create failed'); return d; }),
		onSuccess: (d) => {
			invalidate();
			setSelectedId(d.group.id);
			setCreating(false);
			flash(`Created "${d.group.groupName}"`);
		},
		onError: (e) => flash(e.message)
	});

	const updateMut = useMutation({
		mutationFn: ({ id, body }) => fetch(`/api/search-groups/${id}`, {
			method: 'PATCH', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Save failed'); return d; }),
		onSuccess: (d) => {
			invalidate();
			flash(`Saved "${d.group.groupName}"`);
		},
		onError: (e) => flash(e.message)
	});

	const deleteMut = useMutation({
		mutationFn: (id) => fetch(`/api/search-groups/${id}`, { method: 'DELETE' })
			.then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Delete failed'); return d; }),
		onSuccess: () => {
			invalidate();
			setSelectedId(null);
			setDeleting(null);
			flash('Group deleted');
		},
		onError: (e) => flash(e.message)
	});

	const reassignMut = useMutation({
		mutationFn: ({ id, targetGroupId }) => fetch(`/api/search-groups/${id}/reassign-delete`, {
			method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ targetGroupId })
		}).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Reassign failed'); return d; }),
		onSuccess: () => {
			invalidate();
			setSelectedId(null);
			setDeleting(null);
			flash('Reassigned + deleted');
		},
		onError: (e) => flash(e.message)
	});

	const importMut = useMutation({
		mutationFn: ({ groups, mode }) => fetch('/api/search-groups/import', {
			method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ groups, mode })
		}).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Import failed'); return d; }),
		onSuccess: (d) => {
			invalidate();
			setImportResult(d);
			const ignored = d.ignoredFields?.length ? ` (ignored: ${d.ignoredFields.join(', ')})` : '';
			flash(`Imported — +${d.inserted} new, ~${d.updated} updated${d.deleted ? `, −${d.deleted} deleted` : ''}${ignored}`);
		},
		onError: (e) => flash(e.message)
	});

	const [activeJobId, setActiveJobId] = useState(null);

	const searchMut = useMutation({
		mutationFn: (groupId) => fetch('/api/search/execute', {
			method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ groupId })
		}).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Search failed'); return d; }),
		onSuccess: (d) => setActiveJobId(d.jobId),
		onError: (e) => flash(e.message)
	});

	const { data: activeJob } = useQuery({
		queryKey: ['searchJob', activeJobId],
		queryFn: () => fetch(`/api/search/jobs/${activeJobId}`).then(r => r.json()),
		enabled: !!activeJobId,
		refetchInterval: (q) => {
			const j = q.state.data;
			if (!j) return 2000;
			return ['queued', 'running'].includes(j.status) ? 2000 : false;
		}
	});

	useEffect(() => {
		if (!activeJob) return;
		if (['completed', 'failed', 'cancelled'].includes(activeJob.status)) {
			invalidate();
			if (activeJob.status === 'completed') flash(`Search done — ${activeJob.candidatesInserted} new candidates`);
			else if (activeJob.status === 'failed') flash(`Search failed: ${activeJob.lastError}`);
			else if (activeJob.status === 'cancelled') flash('Search cancelled');
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [activeJob?.id, activeJob?.status]);

	const cancelJobMut = useMutation({
		mutationFn: (jobId) => fetch(`/api/search/jobs/${jobId}/cancel`, { method: 'POST' })
			.then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; })
	});

	const selected = useMemo(
		() => (selectedId ? groups.find(g => g.id === selectedId) : null),
		[selectedId, groups]
	);

	function handleSave(draft) {
		if (creating || !selected) {
			createMut.mutate(draft);
		} else {
			updateMut.mutate({ id: selected.id, body: draft });
		}
	}

	function handleDuplicate(draft) {
		const copy = {
			...draft,
			groupId: (draft.groupId || 'group') + '_copy',
			groupName: (draft.groupName || 'Group') + ' (copy)'
		};
		delete copy.id;
		delete copy.projectId;
		delete copy.createdAt;
		delete copy.updatedAt;
		delete copy.candidateStats;
		delete copy.archivalAssetCount;
		delete copy.keywordCount;
		delete copy.categoryCount;
		createMut.mutate(copy);
	}

	function handleExport() {
		// Hitting the export endpoint triggers a download
		window.location.href = '/api/search-groups/export';
	}

	return (
		<div>
			<div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
				<div>
					<h2 className="text-2xl font-bold text-text-primary">Search Groups</h2>
					<p className="text-sm text-text-secondary mt-1">Editable archive-search buckets — keywords and categories per group</p>
				</div>
				<div className="flex gap-2">
					<button onClick={handleExport}
						className="px-3 py-1.5 text-sm bg-card-bg border border-border text-text-primary hover:bg-card-hover rounded-lg">
						Export JSON
					</button>
					<button onClick={() => { setShowImport(true); setImportResult(null); }}
						className="px-3 py-1.5 text-sm bg-card-bg border border-border text-text-primary hover:bg-card-hover rounded-lg">
						Import JSON
					</button>
					<button onClick={() => { setCreating(true); setSelectedId(null); }}
						className="px-3 py-1.5 text-sm bg-accent hover:bg-accent-hover text-white rounded-lg">
						+ New group
					</button>
				</div>
			</div>

			{toast && (
				<div className="mb-4 px-3 py-2 bg-card-bg border border-border rounded-lg text-xs text-text-primary">{toast}</div>
			)}

			{activeJob && (
				<div className="mb-4">
					<JobProgress job={activeJob}
						onCancel={() => cancelJobMut.mutate(activeJob.id)}
						onDismiss={() => setActiveJobId(null)}
						cancelling={cancelJobMut.isPending} />
				</div>
			)}

			<div className="flex gap-4 items-start">
				{/* Left: list */}
				<div className="w-2/5 min-w-72 space-y-1">
					{isLoading && <p className="text-text-secondary text-sm">Loading...</p>}
					{!isLoading && groups.length === 0 && !creating && (
						<div className="text-center py-10 text-text-secondary text-sm">
							<p>No groups yet.</p>
							<p className="mt-1 text-xs">Create one or import from JSON to get started.</p>
						</div>
					)}
					{groups.map(g => {
						const isSel = g.id === selectedId && !creating;
						const cs = g.candidateStats || {};
						return (
							<button key={g.id} onClick={() => { setCreating(false); setSelectedId(g.id); }}
								className={`w-full text-left p-3 rounded-lg border transition-colors ${
									isSel ? 'bg-accent/10 border-accent' : 'bg-card-bg border-border hover:bg-card-hover'
								}`}>
								<p className="text-sm text-text-primary font-medium truncate">{g.groupName || '(unnamed)'}</p>
								<p className="text-xs text-text-secondary mt-0.5 truncate">{g.groupId}</p>
								<div className="flex gap-3 mt-1.5 text-[11px] text-text-secondary">
									<span>{g.keywordCount} kw</span>
									<span>{g.categoryCount} cat</span>
									{cs.total > 0 && <span>{cs.total} cand</span>}
									{g.archivalAssetCount > 0 && <span className="text-emerald-400">{g.archivalAssetCount} asset{g.archivalAssetCount !== 1 ? 's' : ''}</span>}
								</div>
							</button>
						);
					})}
				</div>

				{/* Right: editor */}
				<div className="flex-1 bg-card-bg border border-border rounded-lg p-4 min-h-96">
					{creating ? (
						<GroupEditor
							key="new"
							group={EMPTY_GROUP}
							onSave={handleSave}
							onDelete={() => setCreating(false)}
							onDuplicate={() => { /* disabled for new */ }}
							onSearch={() => { /* disabled for new */ }}
							saving={createMut.isPending}
							searching={false}
						/>
					) : selected ? (
						<GroupEditor
							key={selected.id}
							group={selected}
							onSave={handleSave}
							onDelete={() => setDeleting(selected)}
							onDuplicate={handleDuplicate}
							onSearch={(gid) => searchMut.mutate(gid)}
							saving={updateMut.isPending || createMut.isPending}
							searching={searchMut.isPending || (activeJob && ['queued', 'running'].includes(activeJob.status))}
						/>
					) : (
						<div className="text-center py-20 text-text-secondary text-sm">
							<p>Select a group to edit, or create a new one.</p>
							<p className="mt-2 text-xs">
								Not sure where to start? <Link to="/search" className="text-accent hover:text-accent-hover">Go to Archive Search</Link> to run a saved group.
							</p>
						</div>
					)}
				</div>
			</div>

			{showImport && (
				<ImportModal
					onClose={() => setShowImport(false)}
					onImport={(body) => importMut.mutate(body)}
					importing={importMut.isPending}
					importResult={importResult}
				/>
			)}

			{deleting && (
				<DeleteModal
					group={deleting}
					allGroups={groups}
					onClose={() => setDeleting(null)}
					onDelete={() => deleteMut.mutate(deleting.id)}
					onReassignDelete={(targetGroupId) => reassignMut.mutate({ id: deleting.id, targetGroupId })}
					deleting={deleteMut.isPending || reassignMut.isPending}
				/>
			)}
		</div>
	);
}

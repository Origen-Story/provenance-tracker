// Statement tab (phase 4c): the creator's words, and beside them exactly
// what will be signed into the file. The numbers and the per-ingredient rows
// come from the server's builder, the same function the signer calls, so the
// page cannot show something other than what gets signed.
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { POSITIONS, originClassDef, positionDef, pillStyle, positionColor, DETAIL_PATHS } from '../../components/origin/originClasses.js';
import { fmtClock } from '../../components/timeline/LaneStrip.jsx';
import PublicTitleField from '../../components/origin/PublicTitleField.jsx';

async function jsonOrThrow(r) {
	const j = await r.json();
	if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
	return j;
}

const CREDENTIALS_LABELS = {
	none: 'none in the file',
	unreadable: 'present, unreadable',
	present: 'present'
};

function Field({ label, hint, children }) {
	return (
		<label className="block">
			<span className="block text-xs font-medium text-text-primary mb-1">{label}{hint && <span className="text-text-secondary font-normal"> {hint}</span>}</span>
			{children}
		</label>
	);
}

const inputClass = 'w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent';

function LaneNumbers({ title, lane }) {
	if (!lane) return null;
	const rows = POSITIONS.filter(p => lane.byPosition?.[p.id]?.seconds).map(p => ({ id: p.id, label: p.label, ...lane.byPosition[p.id] }));
	return (
		<div>
			<div className="text-[11px] uppercase tracking-wide text-text-secondary mb-1">{title}</div>
			<table className="text-xs w-full">
				<tbody>
					{rows.map(r => (
						<tr key={r.id}>
							<td className="py-0.5 pr-2"><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5 align-middle" style={{ background: positionColor(r.id) }} />{r.label}</td>
							<td className="py-0.5 pr-2 text-right text-text-secondary tabular-nums">{fmtClock(r.seconds)}</td>
							<td className="py-0.5 text-right text-text-primary tabular-nums">{r.percent.toFixed(1)}%</td>
						</tr>
					))}
					{lane.mixed?.seconds > 0 && (
						<tr><td className="py-0.5 pr-2">Mixed</td><td className="py-0.5 pr-2 text-right text-text-secondary tabular-nums">{fmtClock(lane.mixed.seconds)}</td><td className="py-0.5 text-right tabular-nums">{lane.mixed.percent.toFixed(1)}%</td></tr>
					)}
					{lane.gap?.seconds > 0 && (
						<tr><td className="py-0.5 pr-2 text-text-secondary">Nothing</td><td className="py-0.5 pr-2 text-right text-text-secondary tabular-nums">{fmtClock(lane.gap.seconds)}</td><td className="py-0.5 text-right text-text-secondary tabular-nums">{lane.gap.percent.toFixed(1)}%</td></tr>
					)}
				</tbody>
			</table>
		</div>
	);
}

function ClassPill({ code, aiAssisted }) {
	const def = originClassDef(code);
	const pos = positionDef(def.position).id;
	return <span className="border rounded px-1.5 py-0.5 text-[11px] whitespace-nowrap" style={pillStyle(aiAssisted && pos === 'digital' ? 'assisted' : pos)}>{def.label}{aiAssisted ? ', AI-assisted' : ''}</span>;
}

export default function StatementPanel({ producedId, segments }) {
	const qc = useQueryClient();
	const q = useQuery({ queryKey: ['statement', producedId], queryFn: () => fetch(`/api/outputs/${producedId}/statement`).then(jsonOrThrow) });
	const [form, setForm] = useState({ text: '', authorName: '', organization: '', softwareAgent: '' });
	const saved = q.data?.saved;
	useEffect(() => {
		if (saved) setForm({ text: saved.text || '', authorName: saved.authorName || '', organization: saved.organization || '', softwareAgent: saved.softwareAgent || '' });
	}, [saved?.id, saved?.updatedAt]);
	const dirty = !saved ? Object.values(form).some(Boolean) : ['text', 'authorName', 'organization', 'softwareAgent'].some(k => (saved[k] || '') !== form[k]);

	const save = useMutation({
		mutationFn: () => fetch(`/api/outputs/${producedId}/statement`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) }).then(jsonOrThrow),
		onSuccess: (data) => qc.setQueryData(['statement', producedId], data)
	});

	const s = q.data?.statement;
	// Where to set a class or note: the asset's own page.
	const assetLinks = new Map((segments || []).filter(x => x.asset).map(x => [x.asset.filename, `${DETAIL_PATHS[x.asset.type]}/${x.asset.id}`]));

	return (
		<div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6">
			<div className="space-y-3">
				<div className="bg-card-bg border border-border rounded-lg p-4 space-y-3">
					<h3 className="text-sm font-medium text-text-primary">Creator statement</h3>
					<p className="text-xs text-text-secondary">In your own words: what this is, how it was made, and anything a viewer should know about where its parts came from. It is signed into the file next to the numbers on the right.</p>
					<Field label="Statement">
						<textarea value={form.text} onChange={e => setForm(f => ({ ...f, text: e.target.value }))} rows={8} maxLength={4000} className={`${inputClass} resize-y`} />
					</Field>
					<div className="grid sm:grid-cols-2 gap-3">
						<Field label="Your name"><input value={form.authorName} onChange={e => setForm(f => ({ ...f, authorName: e.target.value }))} className={inputClass} /></Field>
						<Field label="Organisation" hint="(optional)"><input value={form.organization} onChange={e => setForm(f => ({ ...f, organization: e.target.value }))} className={inputClass} /></Field>
					</div>
					<Field label="Edited in" hint="(e.g. Premiere Pro 26.5)"><input value={form.softwareAgent} onChange={e => setForm(f => ({ ...f, softwareAgent: e.target.value }))} className={inputClass} /></Field>
					<div className="flex items-center gap-3">
						<button type="button" onClick={() => save.mutate()} disabled={!dirty || save.isPending}
							className="px-4 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-md text-xs font-medium disabled:opacity-40">
							{save.isPending ? 'Saving…' : saved && !dirty ? 'Saved' : 'Save statement'}
						</button>
						{saved?.updatedAt && !dirty && <span className="text-[11px] text-text-secondary">Saved {new Date(saved.updatedAt).toLocaleString()}</span>}
						{save.isError && <span className="text-xs text-danger">{save.error.message}</span>}
					</div>
				</div>
				{s && (
					<PublicTitleField type="produced" id={producedId} asset={{ publicTitle: s.output.publicTitle }} fileName={s.output.title}
						label="Public title of this film" queryKeys={[['produced', String(producedId)]]} />
				)}
			</div>

			<div className="space-y-4">
				{q.isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
				{q.isError && <p className="text-sm text-danger">{q.error.message}</p>}
				{q.data?.reason && <p className="text-sm text-text-secondary">{q.data.reason}</p>}
				{s && (
					<>
						<div className="bg-card-bg border border-border rounded-lg p-4 space-y-3">
							<div className="flex items-center gap-2 flex-wrap">
								<h3 className="text-sm font-medium text-text-primary">What will be signed</h3>
								<ClassPill code={s.output.originClass} />
								<span className="text-xs text-text-secondary ml-auto">{s.output.publicTitle || s.output.title} · {fmtClock(s.output.durationSeconds)}</span>
							</div>
							<div className="grid sm:grid-cols-2 gap-4">
								<LaneNumbers title="Picture" lane={s.composition.picture} />
								<LaneNumbers title="Sound" lane={s.composition.audio} />
							</div>
						</div>

						<div className="bg-card-bg border border-border rounded-lg p-4">
							<h3 className="text-sm font-medium text-text-primary mb-1">Ingredients ({s.ingredients.length})</h3>
							<p className="text-[11px] text-text-secondary mb-2">Each one is placed in the manifest with its class. Where the class is yours rather than the file's, the note says why. Set a class or a note on the asset's page, or on the Composition tab.</p>
							<div className="overflow-x-auto">
								<table className="w-full text-xs">
									<thead>
										<tr className="text-left text-text-secondary">
											<th className="pb-1 pr-2 font-medium">File</th>
											<th className="pb-1 pr-2 font-medium">Class</th>
											<th className="pb-1 pr-2 font-medium" title="Who decided the class: you, or the tracker's proposal from metadata">Set by</th>
											<th className="pb-1 pr-2 font-medium" title="Content Credentials inside the file itself, and the class they declare">File's own credentials</th>
											<th className="pb-1 pr-2 font-medium text-right">On screen</th>
											<th className="pb-1 font-medium text-right">Heard</th>
										</tr>
									</thead>
									<tbody>
										{s.ingredients.map(i => (
											<tr key={i.ref} className="border-t border-border/60 align-top">
												<td className="py-1.5 pr-2 max-w-[14rem]">
													{assetLinks.get(i.title) ? <Link to={assetLinks.get(i.title)} className="truncate block hover:text-accent" title={i.title}>{i.publicTitle || i.title}</Link> : <span className="truncate block" title={i.title}>{i.publicTitle || i.title}</span>}
													{i.publicTitle
														? <div className="text-[11px] text-text-secondary font-mono truncate" title={i.title}>{i.title}</div>
														: <div className="text-[11px] text-text-secondary">no public title, the page shows the file name</div>}
													{i.note && <div className="text-[11px] text-text-secondary mt-0.5 whitespace-pre-line">{i.note}</div>}
												</td>
												<td className="py-1.5 pr-2"><ClassPill code={i.originClass} aiAssisted={i.aiAssisted} /></td>
												<td className="py-1.5 pr-2 text-text-secondary">{i.classSetBy === 'creator' ? 'you' : <span className="text-amber-400" title="Not confirmed yet">proposal</span>}</td>
												<td className="py-1.5 pr-2 text-text-secondary">
													<span className={i.fileCredentials === 'none' ? 'text-amber-300' : ''}>{CREDENTIALS_LABELS[i.fileCredentials]}</span>
													{i.classClaimedByFile && i.classClaimedByFile !== i.originClass && <div className="text-[11px]">declares {originClassDef(i.classClaimedByFile).label}</div>}
													{i.signerName && <div className="text-[11px]">signed by {i.signerName}</div>}
												</td>
												<td className="py-1.5 pr-2 text-right tabular-nums text-text-secondary">{i.pictureSeconds ? fmtClock(i.pictureSeconds) : '—'}</td>
												<td className="py-1.5 text-right tabular-nums text-text-secondary">{i.audioSeconds ? fmtClock(i.audioSeconds) : '—'}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
							{(s.unresolved.length > 0 || s.editorGeneratedClips > 0) && (
								<div className="mt-3 text-[11px] text-text-secondary space-y-1">
									{s.editorGeneratedClips > 0 && <div>{s.editorGeneratedClips} title or generator clip{s.editorGeneratedClips === 1 ? '' : 's'} made in the editor, counted as Human-made.</div>}
									{s.unresolved.length > 0 && (
										<div className="text-amber-300">
											Listed in the statement as not tied to a tracked asset:
											<ul className="list-disc pl-4 text-text-secondary">
												{s.unresolved.map((u, n) => <li key={n}>{u.clip} ({u.track}, {fmtClock(u.startSeconds)}–{fmtClock(u.endSeconds)}): {u.reason}</li>)}
											</ul>
										</div>
									)}
								</div>
							)}
						</div>
					</>
				)}
			</div>
		</div>
	);
}

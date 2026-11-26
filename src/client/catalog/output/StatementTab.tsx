// The creator statement: the creator's words, and beside them exactly what
// would be signed into the file now. The right side comes from the server's
// preview, built by the same function signing calls, so the page cannot show
// something other than what gets signed.

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import {
	assets,
	outputs,
	type AssetRecord,
	type BuiltStatement,
	type Lane,
	type StatementIngredient,
} from "../api.ts";
import { str, useTakeAnswer } from "../asset/shared.ts";
import { OriginBadge } from "../badge.tsx";
import {
	Card,
	Loading,
	Problem,
	SaveBar,
	TextArea,
	TextField,
	when,
} from "../ui.tsx";
import { POSITIONS } from "../../components/origin/originClasses.js";
import { previewKey } from "./shared.tsx";
import { fmtClock } from "./strip.tsx";

type Draft = {
	text: string;
	author: string;
	organization: string;
	edited_with: string;
	public_title: string;
};

function savedOf(asset: AssetRecord): Draft {
	const s = asset.statements[0];
	return {
		text: s?.text ?? "",
		author: s?.author ?? "",
		organization: s?.organization ?? "",
		edited_with: s?.editedWith ?? "",
		public_title: str(asset.fields.public_title),
	};
}

export default function StatementTab({
	projectId,
	asset,
}: {
	projectId: string;
	asset: AssetRecord;
}) {
	return (
		<div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6 items-start">
			<StatementForm projectId={projectId} asset={asset} />
			<Preview projectId={projectId} asset={asset} />
		</div>
	);
}

function StatementForm({
	projectId,
	asset,
}: {
	projectId: string;
	asset: AssetRecord;
}) {
	const take = useTakeAnswer(projectId, asset.id);
	const saved = savedOf(asset);
	const [draft, setDraft] = useState<Draft>(saved);
	const [note, setNote] = useState("");
	const keys = Object.keys(saved) as Array<keyof Draft>;
	const changed = keys.filter((k) => draft[k] !== saved[k]);
	const statementChanged = changed.some((k) => k !== "public_title");
	const save = useMutation({
		mutationFn: async () => {
			let answer: { asset: AssetRecord } | null = null;
			// The film's public title is a field of the asset, kept with its history.
			if (changed.includes("public_title"))
				answer = await assets.edit(
					projectId,
					asset.id,
					{ public_title: draft.public_title },
					note,
				);
			// The statement is a new saved version each time: a signed one never changes.
			if (statementChanged)
				answer = await outputs.saveStatement(projectId, asset.id, {
					text: draft.text,
					author: draft.author,
					organization: draft.organization,
					edited_with: draft.edited_with,
				});
			return answer!;
		},
		onSuccess: (answer) => {
			take(answer);
			setDraft(savedOf(answer.asset));
			setNote("");
		},
	});
	const set = (k: keyof Draft) => (v: string) =>
		setDraft((d) => ({ ...d, [k]: v }));
	return (
		<Card className="space-y-3">
			<SaveBar
				count={changed.length}
				saving={save.isPending}
				onSave={() => save.mutate()}
				onUndo={() => setDraft(saved)}
				error={save.error}
				note={note}
				onNote={changed.includes("public_title") ? setNote : undefined}
				blocked={statementChanged && !draft.text.trim()}
			/>
			<p className="text-xs text-text-secondary">
				In your own words: what this is, how it was made, and anything a viewer
				should know about where its parts came from. It is signed into the file
				with the numbers beside it.
			</p>
			<TextArea
				label="Statement"
				value={draft.text}
				onChange={set("text")}
				rows={8}
			/>
			<div className="grid sm:grid-cols-2 gap-3">
				<TextField
					label="Your name"
					value={draft.author}
					onChange={set("author")}
				/>
				<TextField
					label="Organisation (optional)"
					value={draft.organization}
					onChange={set("organization")}
				/>
			</div>
			<TextField
				label="Edited in"
				value={draft.edited_with}
				onChange={set("edited_with")}
				placeholder="Premiere Pro 26.5"
			/>
			<TextField
				label="Public title of this film"
				value={draft.public_title}
				onChange={set("public_title")}
				hint="What a public page calls it. Without one, it shows the file name."
			/>
			<p className="text-xs text-text-secondary">
				{asset.statements.length
					? `Saved ${when(asset.statements[0].savedAt)}. Each save is kept as a new version (${asset.statements.length} so far), so a signed statement never changes.`
					: "Not saved yet."}
			</p>
		</Card>
	);
}

function Preview({
	projectId,
	asset,
}: {
	projectId: string;
	asset: AssetRecord;
}) {
	const q = useQuery({
		queryKey: previewKey(projectId, asset.id),
		queryFn: () => outputs.preview(projectId, asset.id),
	});
	if (q.isLoading) return <Loading />;
	if (q.error || !q.data) return <Problem error={q.error ?? "No preview"} />;
	const { statement: s, blockers, ingredientAssetIds, identity } = q.data;
	return (
		<div className="space-y-4">
			{blockers.length > 0 && (
				<div className="border border-warning/40 rounded p-3 text-xs text-warning space-y-0.5">
					<p className="font-medium">Before this can be signed here:</p>
					{blockers.map((b) => (
						<p key={b}>{b}</p>
					))}
				</div>
			)}
			{s && identity && (
				<Card className="space-y-1 text-xs text-text-secondary">
					<p>
						<span className="font-medium text-text-primary">Identity:</span>{" "}
						{identity.name}, issued by {identity.issuer}, as the creator. It
						vouches for the statement, the credits, how it was made and the
						AI-training choice, as well as the file itself.
					</p>
					{identity.authorDiffers && (
						<p className="text-warning">
							The statement's author, {s.author}, is not the name on your
							identity certificate, {identity.name}. Verifiers will show the
							certificate's name. Sign anyway if both are you.
						</p>
					)}
				</Card>
			)}
			{s && (
				<Built
					projectId={projectId}
					statement={s}
					assetIds={ingredientAssetIds}
				/>
			)}
		</div>
	);
}

function Built({
	projectId,
	statement: s,
	assetIds,
}: {
	projectId: string;
	statement: BuiltStatement;
	assetIds: number[];
}) {
	return (
		<>
			<Card className="space-y-3">
				<div className="flex flex-wrap items-center gap-2">
					<h4 className="font-medium text-text-primary">What will be signed</h4>
					<OriginBadge originClass={s.output.originClass} confirmed />
					<span className="ml-auto text-xs text-text-secondary">
						{s.output.publicTitle || s.output.title}
						{s.output.durationSeconds != null &&
							` · ${fmtClock(s.output.durationSeconds)}`}
					</span>
				</div>
				<div className="grid sm:grid-cols-2 gap-4">
					<LaneShares title="Picture" lane={s.composition.picture} />
					<LaneShares title="Sound" lane={s.composition.audio} />
				</div>
				<p className="text-xs text-text-secondary">
					The words signed are the saved ones; save to see a change here.
				</p>
			</Card>
			<Card className="space-y-2">
				<h4 className="font-medium text-text-primary">
					Ingredients ({s.ingredients.length})
				</h4>
				<p className="text-xs text-text-secondary">
					Each is placed in the file's credentials with its class. Where the
					class is a person's rather than the file's own, the note says why. Set
					a class or a note on the asset's page.
				</p>
				<div className="overflow-x-auto">
					<table className="w-full text-xs">
						<thead>
							<tr className="text-left text-text-secondary">
								<th className="pb-1 pr-2 font-medium">File</th>
								<th className="pb-1 pr-2 font-medium">Class</th>
								<th className="pb-1 pr-2 font-medium">
									The file's own credentials
								</th>
								<th className="pb-1 pr-2 font-medium text-right">On screen</th>
								<th className="pb-1 font-medium text-right">Heard</th>
							</tr>
						</thead>
						<tbody>
							{s.ingredients.map((i, n) => (
								<IngredientRow
									key={i.ref}
									projectId={projectId}
									i={i}
									assetId={assetIds[n]}
								/>
							))}
						</tbody>
					</table>
				</div>
				{s.editorGeneratedClips > 0 && (
					<p className="text-xs text-text-secondary">
						{s.editorGeneratedClips} title or generator clip
						{s.editorGeneratedClips === 1 ? "" : "s"} made in the editor,
						counted as human-made.
					</p>
				)}
				{s.unresolved.length > 0 && (
					<div className="text-xs text-warning">
						<p>Listed in the statement as not tied to an asset:</p>
						<ul className="list-disc pl-4 text-text-secondary">
							{s.unresolved.map((u, n) => (
								<li key={n}>
									{u.clip || "a clip"} ({u.track}
									{u.startSeconds != null &&
										`, ${fmtClock(u.startSeconds)}–${fmtClock(u.endSeconds)}`}
									): {u.reason}
								</li>
							))}
						</ul>
					</div>
				)}
			</Card>
		</>
	);
}

const CREDENTIALS: Record<string, string> = {
	none: "none in the file",
	unreadable: "there, but unreadable",
	present: "there",
};

function IngredientRow({
	projectId,
	i,
	assetId,
}: {
	projectId: string;
	i: StatementIngredient;
	assetId?: number;
}) {
	return (
		<tr className="border-t border-border/60 align-top">
			<td className="py-1.5 pr-2 max-w-[14rem]">
				<Link
					to={`/catalog/${projectId}/assets/${assetId}`}
					className="block truncate text-text-primary hover:text-accent"
					title={i.title}
				>
					{i.publicTitle || i.title}
				</Link>
				<div className="text-text-secondary truncate" title={i.title}>
					{i.publicTitle
						? i.title
						: "no public title: a page shows the file name"}
				</div>
				{i.note && (
					<div className="text-text-secondary mt-0.5 whitespace-pre-line">
						{i.note}
					</div>
				)}
			</td>
			<td className="py-1.5 pr-2">
				<OriginBadge
					originClass={i.originClass}
					confirmed={i.classSetBy === "creator"}
					aiAssisted={i.aiAssisted}
				/>
				{i.classSetBy !== "creator" && (
					<div className="text-warning mt-0.5">proposed, not confirmed</div>
				)}
			</td>
			<td className="py-1.5 pr-2 text-text-secondary">
				<span className={i.fileCredentials === "none" ? "text-warning" : ""}>
					{CREDENTIALS[i.fileCredentials] ?? i.fileCredentials}
				</span>
				{i.signerName &&
					(i.signedBy === "unverified" ? (
						<div className="text-warning">
							names {i.signerName}; not verified
						</div>
					) : (
						<div>signed by {i.signerName}</div>
					))}
			</td>
			<td className="py-1.5 pr-2 text-right tabular-nums text-text-secondary">
				{i.pictureSeconds ? fmtClock(i.pictureSeconds) : "–"}
			</td>
			<td className="py-1.5 text-right tabular-nums text-text-secondary">
				{i.audioSeconds ? fmtClock(i.audioSeconds) : "–"}
			</td>
		</tr>
	);
}

type Share = { seconds?: number | null; percent: number };

function LaneShares({ title, lane }: { title: string; lane?: Lane }) {
	if (!lane) return null;
	const by = (lane.byPosition ?? {}) as Record<string, Share>;
	const mixed = lane.mixed as Share | undefined;
	const gap = lane.gap as Share | undefined;
	const rows = (POSITIONS as Array<{ id: string; label: string }>).filter(
		(p) => by[p.id]?.seconds,
	);
	return (
		<div>
			<div className="text-xs text-text-secondary mb-1">{title}</div>
			<table className="text-xs w-full">
				<tbody>
					{rows.map((p) => (
						<tr key={p.id}>
							<td className="py-0.5 pr-2">
								<span
									className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5 align-middle"
									style={{ background: `var(--pt-origin-${p.id})` }}
								/>
								{p.label}
							</td>
							<td className="py-0.5 pr-2 text-right text-text-secondary tabular-nums">
								{fmtClock(by[p.id].seconds ?? 0)}
							</td>
							<td className="py-0.5 text-right tabular-nums">
								{by[p.id].percent.toFixed(1)}%
							</td>
						</tr>
					))}
					{!!mixed?.seconds && (
						<tr>
							<td className="py-0.5 pr-2">Mixed</td>
							<td className="py-0.5 pr-2 text-right text-text-secondary tabular-nums">
								{fmtClock(mixed.seconds)}
							</td>
							<td className="py-0.5 text-right tabular-nums">
								{mixed.percent.toFixed(1)}%
							</td>
						</tr>
					)}
					{!!gap?.seconds && (
						<tr className="text-text-secondary">
							<td className="py-0.5 pr-2">Nothing</td>
							<td className="py-0.5 pr-2 text-right tabular-nums">
								{fmtClock(gap.seconds)}
							</td>
							<td className="py-0.5 text-right tabular-nums">
								{gap.percent.toFixed(1)}%
							</td>
						</tr>
					)}
				</tbody>
			</table>
		</div>
	);
}

// One asset: a preview, everything known about it, and the edits a person
// makes, each recorded under their name with its history.

import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { assets, fileUrl, type AssetRecord } from "./api.ts";
import { OriginBadge } from "./badge.tsx";
import { KIND_LABEL, mediaKind } from "./labels.ts";
import {
	Button,
	Card,
	Loading,
	PageTitle,
	Problem,
	Section,
	when,
} from "./ui.tsx";
import Credits from "./asset/Credits.tsx";
import DetailsForm from "./asset/DetailsForm.tsx";
import Files from "./asset/Files.tsx";
import Generation from "./asset/Generation.tsx";
import History from "./asset/History.tsx";
import Links from "./asset/Links.tsx";
import OriginForm from "./asset/OriginForm.tsx";
import SignSidecar from "./asset/SignSidecar.tsx";
import { assetKey, str, useTakeAnswer } from "./asset/shared.ts";

export default function AssetDetail() {
	const { projectId, assetId } = useParams();
	const id = Number(assetId);
	const {
		data: asset,
		isLoading,
		error,
	} = useQuery({
		queryKey: assetKey(projectId!, id),
		queryFn: () => assets.get(projectId!, id),
	});
	if (isLoading) return <Loading />;
	if (error || !asset)
		return <Problem error={error ?? "This asset could not be read"} />;
	const f = asset.fields;
	const fileName = asset.contents[0]?.places[0]?.path.split("/").pop();
	const title = str(f.title) || fileName || `Asset ${asset.id}`;
	const p = projectId!;

	return (
		<div key={asset.id} className="max-w-5xl space-y-8">
			<div>
				<Link
					to=".."
					relative="path"
					className="text-xs text-text-secondary hover:text-text-primary"
				>
					← All assets
				</Link>
				<PageTitle
					title={title}
					description={
						<span className="flex flex-wrap items-center gap-2">
							<OriginBadge
								originClass={str(f.origin_class) || "unknown"}
								confirmed={!!f.origin_class_confirmed}
								aiAssisted={!!f.ai_assisted}
								note={str(f.origin_class_note)}
								signedBy={str(f.signed_by)}
								signerName={str(f.signer_name)}
							/>
							<span>{KIND_LABEL[str(f.kind)] ?? str(f.kind)}</span>
							{!!f.is_output && (
								<Link
									to={`/catalog/${p}/outputs/${asset.id}`}
									className="text-accent hover:underline"
								>
									finished edit: its timeline and signing
								</Link>
							)}
							{!f.is_output &&
								!f.removed_at &&
								mediaKind(fileName) === "video" && (
									<Link
										to={`/catalog/${p}/outputs/${asset.id}`}
										className="text-accent hover:underline"
									>
										a new export? Make it a finished edit
									</Link>
								)}
							{str(f.code) && <span>{str(f.code)}</span>}
							<span>· changed {when(asset.updatedAt)}</span>
						</span>
					}
				/>
				{!!f.removed_at && <Removal projectId={p} asset={asset} />}
			</div>

			<Preview projectId={p} asset={asset} />

			<Section title="Details">
				<DetailsForm projectId={p} asset={asset} />
			</Section>
			<Section title="How it was made">
				<OriginForm projectId={p} asset={asset} />
			</Section>
			<Section title="Credits">
				<Credits projectId={p} asset={asset} />
			</Section>
			{(str(f.kind) === "generated" || asset.generation) && (
				<Section title="Generation details">
					<Generation projectId={p} asset={asset} />
				</Section>
			)}
			<Section title="Links to other assets">
				<Links projectId={p} asset={asset} />
			</Section>
			{f.is_output ? (
				<Section title="Timeline and signing">
					<OutputSummary projectId={p} asset={asset} />
				</Section>
			) : (
				<Section title="Sign with Content Credentials">
					<SignSidecar projectId={p} asset={asset} />
				</Section>
			)}
			<Section title="Files">
				<Files projectId={p} asset={asset} />
			</Section>
			<Section title="History">
				<History asset={asset} />
			</Section>
			{!f.removed_at && (
				<Section title="Remove from the project">
					<Card>
						<Removal projectId={p} asset={asset} />
					</Card>
				</Section>
			)}
		</div>
	);
}

/**
 * Removing hides an asset from lists; restoring undoes it. Its files stay
 * where they are. Remove sits at the foot of the page, away from the edits;
 * once removed, the notice and Restore show at the top.
 */
function Removal({
	projectId,
	asset,
}: {
	projectId: string;
	asset: AssetRecord;
}) {
	const take = useTakeAnswer(projectId, asset.id);
	const removed = !!asset.fields.removed_at;
	const act = useMutation({
		mutationFn: () =>
			removed
				? assets.restore(projectId, asset.id)
				: assets.remove(projectId, asset.id),
		onSuccess: take,
	});
	return (
		<div className="space-y-2">
			{!removed && (
				<p className="text-sm text-text-secondary">
					Removing hides this asset from lists and from new timeline matches.
					Its files are not touched, and it can be restored at any time.
				</p>
			)}
			{removed && (
				<p className="text-sm text-danger">
					Removed {when(str(asset.fields.removed_at))}. It is hidden from lists;
					its files are untouched.
				</p>
			)}
			<Button quiet onClick={() => act.mutate()} disabled={act.isPending}>
				{removed ? "Restore this asset" : "Remove from the project"}
			</Button>
			<Problem error={act.error} />
		</div>
	);
}

function Preview({
	projectId,
	asset,
}: {
	projectId: string;
	asset: AssetRecord;
}) {
	const current = asset.contents.find(
		(c) => !c.signedCopy && c.places.some((p) => p.live),
	);
	const place = current?.places.find((p) => p.live);
	const kind = mediaKind(place?.path);
	if (!current || !kind) return null;
	const src = fileUrl(projectId, current.sha256);
	return (
		<Card className="flex justify-center bg-app-bg">
			{kind === "image" && (
				<img src={src} alt="" className="max-h-[28rem] object-contain" />
			)}
			{kind === "video" && (
				<video
					src={src}
					controls
					preload="metadata"
					className="max-h-[28rem] w-full"
				/>
			)}
			{kind === "audio" && (
				<audio src={src} controls preload="metadata" className="w-full" />
			)}
		</Card>
	);
}

/** A finished edit's timeline, statement and signings, managed on its own page. */
function OutputSummary({
	projectId,
	asset,
}: {
	projectId: string;
	asset: AssetRecord;
}) {
	return (
		<Card className="space-y-2 text-sm">
			<Link
				to={`/catalog/${projectId}/outputs/${asset.id}`}
				className="text-accent hover:underline"
			>
				Open its timeline, statement and signing
			</Link>
			{asset.timelines.length === 0 && (
				<p className="text-text-secondary">No timeline imported yet.</p>
			)}
			{asset.timelines.map((t) => (
				<p key={t.id}>
					Timeline{" "}
					<span className="text-text-primary">
						{t.sequenceName || t.fileName}
					</span>{" "}
					<span className="text-text-secondary">
						imported {when(t.importedAt)}
					</span>
				</p>
			))}
			{asset.statements.length > 0 && (
				<p className="text-text-secondary">
					{asset.statements.length} saved statement
					{asset.statements.length > 1 ? "s" : ""}, the newest by{" "}
					{asset.statements[0].author || "no one named"}
				</p>
			)}
			{asset.signatures.map((s) => (
				<p key={s.id}>
					Signed v{s.version} ({s.kind === "asset" ? "sidecar" : "signed copy"})
					by {s.signerName || "an unnamed signer"}{" "}
					<span className="text-text-secondary">
						{when(s.signedAt)} · {s.status || "read back"}
						{s.timestamped && " · time-stamped"}
					</span>
				</p>
			))}
		</Card>
	);
}

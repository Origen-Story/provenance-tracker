// The image a finished edit is shown by in its credentials: the claim
// thumbnail, which Content Credentials verifiers show for the signed copy
// (D17, D52). A JPEG or PNG from the project, picked per edit, such as the
// film's poster or its YouTube thumbnail.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assets, fileUrl, type AssetRecord } from "../api.ts";
import { assetKey } from "../asset/shared.ts";
import { Card, Problem, Select } from "../ui.tsx";
import { previewKey } from "./shared.tsx";

// What a claim thumbnail can be, by file name; signing checks the bytes.
const THUMBNAIL_FILE = /\.(jpe?g|png)$/i;

/** The image this edit is shown by: the thumbnail_of link's other side is its child. */
export function thumbnailLink(asset: AssetRecord) {
	return asset.relationships.find(
		(r) => r.type === "thumbnail_of" && r.direction === "child",
	);
}

export default function Thumbnail({
	projectId,
	asset,
}: {
	projectId: string;
	asset: AssetRecord;
}) {
	const qc = useQueryClient();
	const { data } = useQuery({
		queryKey: ["catalog", projectId, "assets", { thumbnails: true }],
		queryFn: () => assets.list(projectId, { limit: 1000 }),
	});
	const images = (data?.assets ?? []).filter(
		(a) =>
			a.id !== asset.id &&
			!a.removedAt &&
			a.file &&
			THUMBNAIL_FILE.test(a.file.path),
	);
	const current = thumbnailLink(asset)?.otherAssetId ?? null;
	const shown = images.find((a) => a.id === current);
	const pick = useMutation({
		mutationFn: (imageId: number | null) =>
			assets.setThumbnail(projectId, asset.id, imageId),
		onSuccess: (answer) => {
			qc.setQueryData(assetKey(projectId, asset.id), answer.asset);
			qc.invalidateQueries({ queryKey: previewKey(projectId, asset.id) });
		},
	});
	return (
		<Card className="space-y-3">
			<p className="text-sm text-text-secondary">
				The picture a Content Credentials verifier shows for the signed copy: a
				JPEG or PNG from this project, such as the film's poster or its YouTube
				thumbnail. It goes into the next signed copy; copies already signed keep
				what they have.
			</p>
			<div className="flex flex-wrap items-start gap-4">
				<div className="min-w-72">
					<Select
						label="Thumbnail"
						value={current === null ? "" : String(current)}
						onChange={(v) => pick.mutate(v === "" ? null : Number(v))}
						options={[
							{ value: "", label: "None" },
							...images.map((a) => ({
								value: String(a.id),
								label: `${a.displayTitle} (${a.file!.path.split("/").pop()})`,
							})),
						]}
					/>
				</div>
				{shown?.file && (
					<img
						src={fileUrl(projectId, shown.file.sha256)}
						alt=""
						className="max-h-32 rounded border border-border object-contain"
					/>
				)}
			</div>
			{current === null && (
				<p className="text-xs text-text-secondary">
					No thumbnail picked: verifiers will show no picture for the signed
					copy.
				</p>
			)}
			{current !== null && !shown && data && (
				<p className="text-xs text-warning">
					The picked image is not in this project's files any more. Pick
					another, or None.
				</p>
			)}
			<Problem error={pick.error} />
		</Card>
	);
}

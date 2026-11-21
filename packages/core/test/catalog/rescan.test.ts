import { describe, expect, it } from "vitest";
import {
	classifyFile,
	planRescan,
	type KnownLocation,
} from "../../src/catalog/rescan.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

function known(
	id: number,
	path: string,
	sha256: string,
	extra: Partial<KnownLocation> = {},
): KnownLocation {
	return { id, rootId: 1, path, sha256, size: 10, modifiedMs: 1000, ...extra };
}

describe("planRescan", () => {
	it("skips files whose size and time match, and asks for the rest to be hashed", () => {
		const plan = planRescan(
			[
				known(1, "same.mov", A),
				known(2, "newer.mov", B),
				known(3, "bigger.mov", C),
			],
			[
				{ rootId: 1, path: "same.mov", size: 10, modifiedMs: 1000 },
				{ rootId: 1, path: "newer.mov", size: 10, modifiedMs: 2000 },
				{ rootId: 1, path: "bigger.mov", size: 11, modifiedMs: 1000 },
				{ rootId: 1, path: "new.mov", size: 5, modifiedMs: 1 },
			],
			() => true,
		);
		expect(plan.unchanged.map((k) => k.id)).toEqual([1]);
		expect(plan.toHash.map((f) => [f.path, f.previous?.id ?? null])).toEqual([
			["newer.mov", 2],
			["bigger.mov", 3],
			["new.mov", null],
		]);
		expect(plan.missing).toEqual([]);
	});

	it("tells roots apart: the same path in another root is another file", () => {
		const plan = planRescan(
			[known(1, "a.mov", A)],
			[{ rootId: 2, path: "a.mov", size: 10, modifiedMs: 1000 }],
			() => true,
		);
		expect(plan.unchanged).toEqual([]);
		expect(plan.toHash[0].previous).toBeNull();
		expect(plan.missing.map((k) => k.id)).toEqual([1]);
	});

	it("calls a file missing only where its folder was listed in full", () => {
		const plan = planRescan(
			[
				known(1, "a.mov", A),
				known(2, "locked/b.mov", B),
				known(3, "c.mov", C, { rootId: 9 }),
			],
			[],
			(k) => k.rootId === 1 && !k.path.startsWith("locked/"),
		);
		expect(plan.missing.map((k) => k.id)).toEqual([1]);
	});
});

describe("classifyFile", () => {
	const assets = new Map([
		[A, 10],
		[B, 20],
	]);
	const assetOf = (sha: string) => assets.get(sha);

	it("a known path with the same bytes only has a new time", () => {
		const previous = known(1, "a.mov", A);
		const change = classifyFile(
			{
				rootId: 1,
				path: "a.mov",
				size: 10,
				modifiedMs: 2000,
				previous,
				sha256: A,
			},
			{ assetOf, missing: [] },
		);
		expect(change).toEqual({ kind: "touched", previous });
	});

	it("a known path with new bytes is a new version of the same asset", () => {
		const previous = known(1, "cut.mov", A);
		const change = classifyFile(
			{
				rootId: 1,
				path: "cut.mov",
				size: 12,
				modifiedMs: 2000,
				previous,
				sha256: C,
			},
			{ assetOf, missing: [] },
		);
		expect(change).toEqual({
			kind: "replaced",
			previous,
			content: { kind: "new-version", assetId: 10 },
		});
	});

	it("a known path now holding bytes known elsewhere points at those bytes", () => {
		const previous = known(1, "cut.mov", A);
		const change = classifyFile(
			{
				rootId: 1,
				path: "cut.mov",
				size: 10,
				modifiedMs: 2000,
				previous,
				sha256: B,
			},
			{ assetOf, missing: [] },
		);
		expect(change).toEqual({
			kind: "replaced",
			previous,
			content: { kind: "known", assetId: 20 },
		});
	});

	it("a new path with the bytes of a missing file is a move, each missing file used once", () => {
		const gone1 = known(1, "old/a.mov", A);
		const gone2 = known(2, "old/a copy.mov", A);
		const missing = [gone1, gone2];
		const file = {
			rootId: 1,
			size: 10,
			modifiedMs: 1000,
			previous: null,
			sha256: A,
		};
		expect(
			classifyFile({ ...file, path: "new/a.mov" }, { assetOf, missing }),
		).toEqual({
			kind: "added",
			content: { kind: "known", assetId: 10 },
			movedFrom: gone1,
		});
		expect(
			classifyFile({ ...file, path: "new/a2.mov" }, { assetOf, missing }).kind,
		).toBe("added");
		expect(missing).toEqual([]);
		// A third copy is a duplicate, not a move.
		expect(
			classifyFile({ ...file, path: "new/a3.mov" }, { assetOf, missing }),
		).toMatchObject({ movedFrom: null });
	});

	it("new bytes at a new path are a new asset", () => {
		const change = classifyFile(
			{
				rootId: 1,
				path: "x.wav",
				size: 1,
				modifiedMs: 1,
				previous: null,
				sha256: C,
			},
			{ assetOf, missing: [] },
		);
		expect(change).toEqual({
			kind: "added",
			content: { kind: "new-asset" },
			movedFrom: null,
		});
	});
});

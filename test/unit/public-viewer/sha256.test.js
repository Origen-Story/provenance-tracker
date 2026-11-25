// The viewer's own SHA-256 (D58), held to Node's.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
	Sha256,
	sha256Hex,
	hashBlob,
} from "../../../public-viewer/src/sha256.js";
import { copyVerdict } from "../../../public-viewer/src/model.js";

const node = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * n bytes that look random but are the same on every run (xorshift32), so a
 * failure can be repeated exactly. Not cryptographic randomness, which a
 * hash test has no need of.
 */
function testBytes(n, seed = 0x9e3779b9) {
	const out = new Uint8Array(n);
	let x = seed | 0;
	for (let i = 0; i < n; i++) {
		x ^= x << 13;
		x ^= x >>> 17;
		x ^= x << 5;
		out[i] = x & 0xff;
	}
	return out;
}

describe("Sha256", () => {
	it("gives the standard answers", () => {
		expect(sha256Hex(new Uint8Array(0))).toBe(
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);
		expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});

	it("agrees with Node at every length around a block's edges, whole and in pieces", () => {
		const lengths = [
			1, 2, 31, 55, 56, 57, 63, 64, 65, 111, 119, 120, 127, 128, 129, 1000,
			4096, 65537,
		];
		for (const n of lengths) {
			const bytes = testBytes(n);
			const want = node(bytes);
			expect(sha256Hex(bytes), `${n} bytes`).toBe(want);
			for (const piece of [1, 3, 63, 64, 65, 1000]) {
				const h = new Sha256();
				for (let i = 0; i < n; i += piece)
					h.update(bytes.subarray(i, i + piece));
				expect(h.hex(), `${n} bytes in pieces of ${piece}`).toBe(want);
			}
		}
	});

	it("is finished once read", () => {
		const h = new Sha256().update(new Uint8Array([1]));
		h.hex();
		expect(() => h.update(new Uint8Array([2]))).toThrow(/already finished/);
		expect(() => h.hex()).toThrow(/already finished/);
	});
});

describe("hashBlob", () => {
	it("reads a file a slice at a time, reporting progress, to Node's answer", async () => {
		const bytes = testBytes(1_000_003);
		const seen = [];
		const hex = await hashBlob(new Blob([bytes]), {
			sliceSize: 65536,
			onProgress: (done, total) => seen.push([done, total]),
		});
		expect(hex).toBe(node(bytes));
		expect(seen.length).toBe(Math.ceil(bytes.length / 65536));
		expect(seen.at(-1)).toEqual([bytes.length, bytes.length]);
		expect(seen.every(([d], i) => i === 0 || d > seen[i - 1][0])).toBe(true);
		expect(await hashBlob(new Blob([]))).toBe(node(new Uint8Array(0)));
	});

	it("stops when asked", async () => {
		const ctrl = new AbortController();
		const run = hashBlob(new Blob([testBytes(200_000)]), {
			sliceSize: 1000,
			signal: ctrl.signal,
			onProgress: (done) => {
				if (done >= 5000) ctrl.abort();
			},
		});
		await expect(run).rejects.toMatchObject({ name: "AbortError" });
	});
});

describe("copyVerdict", () => {
	const exp = { signedFile: { sha256: "ab".repeat(32) } };
	it("says a matching copy is the file the record describes, and no more", () => {
		const v = copyVerdict("AB".repeat(32), exp);
		expect(v).toMatchObject({
			tone: "good",
			headline: "This is the file this record describes",
		});
		expect(v.detail).toMatch(/creator's statement and the signature/);
	});
	it("says another copy is not, and why a platform's copy never is", () => {
		const v = copyVerdict("cd".repeat(32), exp);
		expect(v.tone).toBe("bad");
		expect(v.headline).toBe("This is not the file this record describes");
		expect(v.detail).toMatch(/video platform never matches/);
		expect(copyVerdict("", { signedFile: { sha256: "" } }).tone).toBe("bad");
	});
});

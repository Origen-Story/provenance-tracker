// SHA-256 in plain JavaScript, a piece at a time (D58), so the viewer can
// check a large file a visitor picks without holding all of it in memory and
// without a dependency. The browser's crypto.subtle.digest takes the whole
// file at once, which a phone may not have room for, and cannot report
// progress. Checked against Node's own SHA-256 in test/unit/public-viewer/.
//
// Pure: no DOM. hashBlob reads any Blob (a File is one) in slices and yields
// between them, so the page stays usable while it works.

const K = new Int32Array([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
	0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
	0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
	0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
	0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
	0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
	0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
	0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
	0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const INITIAL = [
	0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
	0x1f83d9ab, 0x5be0cd19,
];

/** Run the compression function over every whole 64-byte block of p from off to end; returns where it stopped. */
function blocks(h, w, p, off, end) {
	let h0 = h[0],
		h1 = h[1],
		h2 = h[2],
		h3 = h[3],
		h4 = h[4],
		h5 = h[5],
		h6 = h[6],
		h7 = h[7];
	while (off + 64 <= end) {
		for (let i = 0; i < 16; i++) {
			const j = off + i * 4;
			w[i] = (p[j] << 24) | (p[j + 1] << 16) | (p[j + 2] << 8) | p[j + 3];
		}
		for (let i = 16; i < 64; i++) {
			const x = w[i - 15];
			const y = w[i - 2];
			const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
			const s1 =
				((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
			w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
		}
		let a = h0,
			b = h1,
			c = h2,
			d = h3,
			e = h4,
			f = h5,
			g = h6,
			k = h7;
		for (let i = 0; i < 64; i++) {
			const s1 =
				((e >>> 6) | (e << 26)) ^
				((e >>> 11) | (e << 21)) ^
				((e >>> 25) | (e << 7));
			const t1 = (k + s1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
			const s0 =
				((a >>> 2) | (a << 30)) ^
				((a >>> 13) | (a << 19)) ^
				((a >>> 22) | (a << 10));
			const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
			k = g;
			g = f;
			f = e;
			e = (d + t1) | 0;
			d = c;
			c = b;
			b = a;
			a = (t1 + t2) | 0;
		}
		h0 = (h0 + a) | 0;
		h1 = (h1 + b) | 0;
		h2 = (h2 + c) | 0;
		h3 = (h3 + d) | 0;
		h4 = (h4 + e) | 0;
		h5 = (h5 + f) | 0;
		h6 = (h6 + g) | 0;
		h7 = (h7 + k) | 0;
		off += 64;
	}
	h[0] = h0;
	h[1] = h1;
	h[2] = h2;
	h[3] = h3;
	h[4] = h4;
	h[5] = h5;
	h[6] = h6;
	h[7] = h7;
	return off;
}

/** A SHA-256 that takes its input in pieces: update(bytes) as often as needed, then hex(). */
export class Sha256 {
	constructor() {
		this.h = new Int32Array(INITIAL);
		this.w = new Int32Array(64);
		this.buffer = new Uint8Array(64);
		this.buffered = 0;
		this.length = 0;
		this.finished = false;
	}

	/** @param {Uint8Array} bytes */
	update(bytes) {
		if (this.finished) throw new Error("This hash is already finished");
		let off = 0;
		const end = bytes.length;
		this.length += end;
		if (this.buffered) {
			const take = Math.min(64 - this.buffered, end);
			this.buffer.set(bytes.subarray(0, take), this.buffered);
			this.buffered += take;
			off = take;
			if (this.buffered < 64) return this;
			blocks(this.h, this.w, this.buffer, 0, 64);
			this.buffered = 0;
		}
		off = blocks(this.h, this.w, bytes, off, end);
		if (off < end) {
			this.buffer.set(bytes.subarray(off), 0);
			this.buffered = end - off;
		}
		return this;
	}

	/** The hash as 64 lower-case hex digits. Finishes the hash. */
	hex() {
		if (this.finished) throw new Error("This hash is already finished");
		const bits = this.length * 8;
		const tail = new Uint8Array(this.buffered < 56 ? 64 : 128);
		tail.set(this.buffer.subarray(0, this.buffered));
		tail[this.buffered] = 0x80;
		const at = tail.length - 8;
		const high = Math.floor(bits / 0x100000000);
		const low = bits >>> 0;
		tail[at] = high >>> 24;
		tail[at + 1] = (high >>> 16) & 0xff;
		tail[at + 2] = (high >>> 8) & 0xff;
		tail[at + 3] = high & 0xff;
		tail[at + 4] = low >>> 24;
		tail[at + 5] = (low >>> 16) & 0xff;
		tail[at + 6] = (low >>> 8) & 0xff;
		tail[at + 7] = low & 0xff;
		blocks(this.h, this.w, tail, 0, tail.length);
		this.finished = true;
		return Array.from(this.h, (v) =>
			(v >>> 0).toString(16).padStart(8, "0"),
		).join("");
	}
}

/** The SHA-256 of some bytes, as hex. */
export function sha256Hex(bytes) {
	return new Sha256().update(bytes).hex();
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The SHA-256 of a Blob or File, as hex, read a slice at a time.
 * @param {Blob} blob
 * @param {{ sliceSize?: number, onProgress?: (done: number, total: number) => void, signal?: AbortSignal }} [opts]
 */
export async function hashBlob(blob, opts = {}) {
	const sliceSize = opts.sliceSize ?? 4 * 1024 * 1024;
	const hash = new Sha256();
	for (let at = 0; at < blob.size; at += sliceSize) {
		if (opts.signal?.aborted)
			throw new DOMException("The check was stopped", "AbortError");
		const slice = blob.slice(at, Math.min(at + sliceSize, blob.size));
		hash.update(new Uint8Array(await slice.arrayBuffer()));
		opts.onProgress?.(Math.min(at + sliceSize, blob.size), blob.size);
		await pause();
	}
	if (opts.signal?.aborted)
		throw new DOMException("The check was stopped", "AbortError");
	return hash.hex();
}

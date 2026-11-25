// A minimal CBOR encoder (RFC 8949) and COSE_Sign1 builder (RFC 9052), for
// the CAWG X.509 identity assertion (D55). The C2PA library asks for a
// finished COSE_Sign1 for that kind of identity and has no builder of its
// own, and this is all the structure needs, so it is written here rather
// than taken as a dependency (Phase 7 decision 5a). Pure: no files, no
// network; the signing itself is a function handed in.
//
// Values: safe integers, Uint8Array (a byte string), string (text), arrays,
// Map (keys in insertion order), null, booleans, and Tagged.

export class Tagged {
	readonly tag: number;
	readonly value: CborValue;
	constructor(tag: number, value: CborValue) {
		this.tag = tag;
		this.value = value;
	}
}

export type CborValue =
	| number
	| string
	| boolean
	| null
	| Uint8Array
	| CborValue[]
	| Map<CborValue, CborValue>
	| Tagged;

function head(major: number, n: number, out: number[]): void {
	if (n < 24) out.push((major << 5) | n);
	else if (n < 0x100) out.push((major << 5) | 24, n);
	else if (n < 0x10000) out.push((major << 5) | 25, n >> 8, n & 0xff);
	else if (n < 0x100000000)
		out.push(
			(major << 5) | 26,
			(n >>> 24) & 0xff,
			(n >>> 16) & 0xff,
			(n >>> 8) & 0xff,
			n & 0xff,
		);
	else {
		const big = BigInt(n);
		out.push((major << 5) | 27);
		for (let s = 56n; s >= 0n; s -= 8n) out.push(Number((big >> s) & 0xffn));
	}
}

function encode(v: CborValue, out: number[]): void {
	if (v === null) {
		out.push(0xf6);
		return;
	}
	if (v === true || v === false) {
		out.push(v ? 0xf5 : 0xf4);
		return;
	}
	if (typeof v === "number") {
		if (!Number.isSafeInteger(v))
			throw new Error("CBOR: only whole numbers are encoded");
		if (v >= 0) head(0, v, out);
		else head(1, -1 - v, out);
		return;
	}
	if (v instanceof Uint8Array) {
		head(2, v.length, out);
		for (const b of v) out.push(b);
		return;
	}
	if (typeof v === "string") {
		const b = new TextEncoder().encode(v);
		head(3, b.length, out);
		for (const x of b) out.push(x);
		return;
	}
	if (Array.isArray(v)) {
		head(4, v.length, out);
		for (const x of v) encode(x, out);
		return;
	}
	if (v instanceof Map) {
		head(5, v.size, out);
		for (const [k, x] of v) {
			encode(k, out);
			encode(x, out);
		}
		return;
	}
	if (v instanceof Tagged) {
		head(6, v.tag, out);
		encode(v.value, out);
		return;
	}
	throw new Error(`CBOR: cannot encode ${typeof v}`);
}

/** The CBOR encoding of a value. */
export function cbor(v: CborValue): Uint8Array {
	const out: number[] = [];
	encode(v, out);
	return Uint8Array.from(out);
}

/** COSE algorithm ids (RFC 9053) for the algorithms the tracker signs with. */
export const COSE_ALG = {
	es256: -7,
	es384: -35,
	es512: -36,
	ps256: -37,
	ed25519: -8,
} as const;

export type CoseAlg = keyof typeof COSE_ALG;

/** COSE_Sign1's CBOR tag (RFC 9052, 4.2). */
export const COSE_SIGN1_TAG = 18;

/** The x5chain header label (RFC 9360): the signer's certificate chain, DER. */
export const X5CHAIN = 33;

/**
 * A tagged COSE_Sign1 over `payload`, signed by `sign(toBeSigned)`, which
 * returns the raw signature (r‖s for ECDSA). The algorithm and the
 * certificate chain go in the protected header, so they are signed too; the
 * payload is detached (left out, as C2PA does), since the reader has it.
 * The library's reader refuses an untagged one (found 2026-11-25).
 */
export async function coseSign1(a: {
	alg: CoseAlg;
	/** DER certificates, the signer's first. */
	certificates: Uint8Array[];
	payload: Uint8Array;
	sign: (toBeSigned: Uint8Array) => Promise<Uint8Array>;
}): Promise<Uint8Array> {
	const id = COSE_ALG[a.alg];
	if (id === undefined) throw new Error(`COSE: unknown algorithm ${a.alg}`);
	if (!a.certificates.length) throw new Error("COSE: no certificate");
	const x5chain =
		a.certificates.length === 1 ? a.certificates[0] : a.certificates;
	const protectedBytes = cbor(
		new Map<CborValue, CborValue>([
			[1, id],
			[X5CHAIN, x5chain],
		]),
	);
	// Sig_structure (RFC 9052, 4.4): no external data.
	const toBeSigned = cbor([
		"Signature1",
		protectedBytes,
		new Uint8Array(0),
		a.payload,
	]);
	const signature = await a.sign(toBeSigned);
	return cbor(
		new Tagged(COSE_SIGN1_TAG, [protectedBytes, new Map(), null, signature]),
	);
}

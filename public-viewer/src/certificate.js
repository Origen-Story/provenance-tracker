// The signing certificate inside a copy a visitor picks (D72), found by this
// page's own code, so the page can compare its fingerprint with the one the
// record names. A C2PA reader in a browser gives a signer's name, issuer and
// serial number, all of which anyone can put into a certificate of their
// own; it does not give the certificate.
//
// What this reads: the file's manifest store (the C2PA box of an MP4 or MOV,
// the C2PA chunk of a WAV or a PNG, or a .c2pa file), the last manifest in it (the
// active one), that manifest's one signature, and the first certificate in
// the signature's chain. It hashes that certificate.
//
// What it does not do: check the signature. A certificate is public: it is
// in every file its owner signs, and can be pasted into any other file. So a
// fingerprint means something only beside a reader's word that the signature
// validated, for the same manifest (compareCertificate in model.js).
//
// It never guesses. Two manifest stores, two chains, two manifests of one
// name, bytes left over, anything it does not expect: it stops and says
// why (NotSure), and the page says the certificates were not compared. A
// wrong answer here would be worse than none.
//
// Pure apart from reading the Blob it is given. Tested in
// test/unit/public-viewer/certificate.test.ts against files signed with the
// real library.

import { sha256Hex } from "./sha256.js";

/** Why no certificate was found for sure. Its message is a plain reason. */
export class NotSure extends Error {}
const notSure = (why) => new NotSure(why);

const C2PA_BOX = "d8fec3d61b0e483c92975828877ec481";
const MAX_STORE = 64 * 2 ** 20;
const MAX_BOXES = 10000;

const hex = (bytes) =>
	Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const ascii = (bytes) => String.fromCharCode(...bytes);
const u32 = (b, o) =>
	((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u32le = (b, o) =>
	((b[o + 3] << 24) | (b[o + 2] << 16) | (b[o + 1] << 8) | b[o]) >>> 0;
const u64 = (b, o) => u32(b, o) * 2 ** 32 + u32(b, o + 4);

// ---- CBOR, the part a COSE signature uses. Definite lengths only.

/** One CBOR item at `at`: { value, end }. Maps become Map, byte strings Uint8Array, a tag { tag, value }. */
export function decodeCbor(bytes, at = 0, depth = 0) {
	if (depth > 16) throw notSure("its signature is nested too deeply");
	if (at >= bytes.length) throw notSure("its signature ends early");
	const first = bytes[at];
	const major = first >> 5;
	const info = first & 31;
	let pos = at + 1;
	let n = info;
	const need = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : 8;
	if (info >= 24) {
		if (info > 27)
			throw notSure(
				"its signature is written in a form this page does not read",
			);
		if (pos + need > bytes.length) throw notSure("its signature ends early");
		n =
			info === 24
				? bytes[pos]
				: info === 25
					? (bytes[pos] << 8) | bytes[pos + 1]
					: info === 26
						? u32(bytes, pos)
						: u64(bytes, pos);
		pos += need;
	}
	const many = () => {
		// Each item takes at least a byte, so a count past the end is a lie.
		if (n > bytes.length - pos) throw notSure("its signature ends early");
	};
	switch (major) {
		case 0:
			return { value: n, end: pos };
		case 1:
			return { value: -1 - n, end: pos };
		case 2:
		case 3: {
			many();
			const slice = bytes.subarray(pos, pos + n);
			return {
				value: major === 2 ? slice : new TextDecoder().decode(slice),
				end: pos + n,
			};
		}
		case 4: {
			many();
			const list = [];
			for (let i = 0; i < n; i++) {
				const item = decodeCbor(bytes, pos, depth + 1);
				list.push(item.value);
				pos = item.end;
			}
			return { value: list, end: pos };
		}
		case 5: {
			many();
			const map = new Map();
			for (let i = 0; i < n; i++) {
				const key = decodeCbor(bytes, pos, depth + 1);
				const value = decodeCbor(bytes, key.end, depth + 1);
				if (typeof key.value !== "number" && typeof key.value !== "string")
					throw notSure("its signature has a header this page does not read");
				if (map.has(key.value))
					throw notSure("its signature says one thing twice");
				map.set(key.value, value.value);
				pos = value.end;
			}
			return { value: map, end: pos };
		}
		case 6: {
			const inner = decodeCbor(bytes, pos, depth + 1);
			return { value: { tag: n, value: inner.value }, end: inner.end };
		}
		default:
			// Simple values and floats: skipped over, never used.
			return {
				value: info === 20 ? false : info === 21 ? true : null,
				end: pos,
			};
	}
}

// ---- JUMBF: boxes inside boxes; a superbox's first child describes it.

function boxesIn(bytes, start, end) {
	const list = [];
	let at = start;
	while (at < end) {
		if (list.length >= MAX_BOXES)
			throw notSure("its credentials hold too many boxes");
		if (at + 8 > end) throw notSure("a box in its credentials ends early");
		let size = u32(bytes, at);
		const type = ascii(bytes.subarray(at + 4, at + 8));
		let head = 8;
		if (size === 1) {
			if (at + 16 > end) throw notSure("a box in its credentials ends early");
			size = u64(bytes, at + 8);
			head = 16;
		} else if (size === 0) size = end - at;
		if (size < head || at + size > end)
			throw notSure("a box in its credentials has a wrong size");
		list.push({ type, start: at + head, end: at + size });
		at += size;
	}
	return list;
}

function superbox(bytes, box) {
	if (box.type !== "jumb")
		throw notSure("its credentials are not laid out as expected");
	const [desc, ...children] = boxesIn(bytes, box.start, box.end);
	if (!desc || desc.type !== "jumd" || desc.end - desc.start < 17)
		throw notSure("a box in its credentials has no description");
	let label = "";
	if (bytes[desc.start + 16] & 2) {
		let i = desc.start + 17;
		while (i < desc.end && bytes[i] !== 0) i++;
		if (i === desc.end)
			throw notSure("a box in its credentials has an unfinished name");
		label = ascii(bytes.subarray(desc.start + 17, i));
	}
	return { label, children };
}

/**
 * The signing certificate of the active manifest in a manifest store.
 * @param {Uint8Array} store the store's bytes (what a .c2pa file holds)
 * @returns {{ label: string, certificate: Uint8Array }} the active manifest's
 *   label, and the certificate as it is in the file (DER)
 */
export function certificateOfStore(store) {
	const top = boxesIn(store, 0, store.length);
	if (top.length !== 1)
		throw notSure("it holds more than one set of credentials");
	const root = superbox(store, top[0]);
	if (root.label !== "c2pa")
		throw notSure("its credentials are not laid out as expected");
	const manifests = root.children.map((box) => superbox(store, box));
	if (!manifests.length) throw notSure("its credentials hold no manifest");
	if (new Set(manifests.map((m) => m.label)).size !== manifests.length)
		throw notSure("two of its manifests have the same name");
	// The active manifest is the last one in the store.
	const active = manifests.at(-1);
	const signatures = active.children
		.map((box) => superbox(store, box))
		.filter((box) => box.label === "c2pa.signature");
	if (signatures.length !== 1)
		throw notSure("its active manifest does not have exactly one signature");
	const [content, ...more] = signatures[0].children;
	if (!content || more.length || content.type !== "cbor")
		throw notSure("its signature is not laid out as expected");
	const bytes = store.subarray(content.start, content.end);
	const decoded = decodeCbor(bytes);
	if (decoded.end !== bytes.length)
		throw notSure("there are bytes after its signature");
	const cose = decoded.value?.tag === 18 ? decoded.value.value : decoded.value;
	if (!Array.isArray(cose) || cose.length !== 4)
		throw notSure("its signature is not the kind this page reads");
	const [protectedBytes, unprotectedHeaders] = cose;
	let protectedHeaders = new Map();
	if (protectedBytes instanceof Uint8Array && protectedBytes.length) {
		const p = decodeCbor(protectedBytes);
		if (p.end !== protectedBytes.length)
			throw notSure("there are bytes after its signature's headers");
		protectedHeaders = p.value;
	}
	if (
		!(protectedHeaders instanceof Map) ||
		!(unprotectedHeaders instanceof Map)
	)
		throw notSure("its signature's headers are not laid out as expected");
	// The chain is header 33 (x5chain), in one place only. Older signatures
	// spell the name out.
	const chains = [protectedHeaders, unprotectedHeaders]
		.flatMap((headers) => [headers.get(33), headers.get("x5chain")])
		.filter((chain) => chain !== undefined);
	if (chains.length !== 1)
		throw notSure("its signature does not carry exactly one certificate chain");
	const chain = chains[0] instanceof Uint8Array ? [chains[0]] : chains[0];
	if (
		!Array.isArray(chain) ||
		!chain.length ||
		!chain.every((c) => c instanceof Uint8Array && c.length > 0)
	)
		throw notSure("its certificate chain is not a list of certificates");
	return { label: active.label, certificate: chain[0] };
}

// ---- Where the store is in a file.

const piece = async (blob, start, length) =>
	new Uint8Array(
		await blob.slice(start, Math.min(blob.size, start + length)).arrayBuffer(),
	);

/** The one manifest store in an MP4 or MOV, reading box headers only until it is found. */
async function storeInBmff(blob) {
	const found = [];
	let at = 0;
	for (let count = 0; at < blob.size; count++) {
		if (count >= MAX_BOXES) throw notSure("the file has too many parts");
		const head = await piece(blob, at, 32);
		if (head.length < 8) throw notSure("the file ends in the middle of a part");
		let size = u32(head, 0);
		const type = ascii(head.subarray(4, 8));
		let headSize = 8;
		if (size === 1) {
			if (head.length < 16)
				throw notSure("the file ends in the middle of a part");
			size = u64(head, 8);
			headSize = 16;
		} else if (size === 0) size = blob.size - at;
		if (size < headSize || at + size > blob.size)
			throw notSure("a part of the file has a wrong size");
		if (
			type === "uuid" &&
			head.length >= headSize + 16 &&
			hex(head.subarray(headSize, headSize + 16)) === C2PA_BOX
		)
			found.push({ start: at + headSize + 16, end: at + size });
		at += size;
	}
	const stores = [];
	for (const box of found) {
		if (box.end - box.start > MAX_STORE)
			throw notSure("its credentials are too large to read here");
		const body = await piece(blob, box.start, box.end - box.start);
		// Version and flags, then what the box is for, ending in a zero byte.
		let i = 4;
		while (i < body.length && body[i] !== 0) i++;
		const purpose = ascii(body.subarray(4, i));
		// A manifest box: an eight-byte offset, then the store.
		if (purpose === "manifest") stores.push(body.subarray(i + 9));
		else if (purpose !== "merkle")
			throw notSure(
				"the file holds a credentials box of a kind this page does not read",
			);
	}
	if (stores.length !== 1)
		throw notSure(
			stores.length
				? "the file holds more than one set of credentials"
				: "the file holds no credentials this page can find",
		);
	return stores[0];
}

/** The one manifest store in a WAV: its "C2PA" chunk. */
async function storeInRiff(blob) {
	const found = [];
	let at = 12;
	for (let count = 0; at + 8 <= blob.size; count++) {
		if (count >= MAX_BOXES) throw notSure("the file has too many parts");
		const head = await piece(blob, at, 8);
		const size = u32le(head, 4);
		if (at + 8 + size > blob.size)
			throw notSure("a part of the file has a wrong size");
		if (ascii(head.subarray(0, 4)) === "C2PA")
			found.push({ start: at + 8, end: at + 8 + size });
		at += 8 + size + (size % 2);
	}
	if (found.length !== 1)
		throw notSure(
			found.length
				? "the file holds more than one set of credentials"
				: "the file holds no credentials this page can find",
		);
	if (found[0].end - found[0].start > MAX_STORE)
		throw notSure("its credentials are too large to read here");
	return piece(blob, found[0].start, found[0].end - found[0].start);
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The one manifest store in a PNG: its "caBX" chunk. */
async function storeInPng(blob) {
	const found = [];
	let at = 8;
	for (let count = 0; at + 12 <= blob.size; count++) {
		if (count >= MAX_BOXES) throw notSure("the file has too many parts");
		const head = await piece(blob, at, 8);
		const size = u32(head, 0);
		if (at + 12 + size > blob.size)
			throw notSure("a part of the file has a wrong size");
		if (ascii(head.subarray(4, 8)) === "caBX")
			found.push({ start: at + 8, end: at + 8 + size });
		at += 12 + size;
	}
	if (found.length !== 1)
		throw notSure(
			found.length
				? "the file holds more than one set of credentials"
				: "the file holds no credentials this page can find",
		);
	if (found[0].end - found[0].start > MAX_STORE)
		throw notSure("its credentials are too large to read here");
	return piece(blob, found[0].start, found[0].end - found[0].start);
}

/**
 * The fingerprint of the certificate that signed the active manifest in a
 * copy, for a file this page can read (MP4, MOV, WAV, PNG, .c2pa).
 * @param {Blob} blob the copy, read on the visitor's device
 * @returns {Promise<{ label: string, sha256: string }>} the active manifest's
 *   label and the certificate's SHA-256, lower-case hex
 * @throws {NotSure} with a plain reason, whenever it cannot be sure
 */
export async function signingCertificate(blob) {
	const start = await piece(blob, 0, 12);
	if (start.length < 12) throw notSure("the file is too short");
	const kind = ascii(start.subarray(4, 8));
	let store;
	if (kind === "ftyp") store = await storeInBmff(blob);
	else if (
		ascii(start.subarray(0, 4)) === "RIFF" &&
		ascii(start.subarray(8, 12)) === "WAVE"
	)
		store = await storeInRiff(blob);
	else if (PNG.every((b, i) => start[i] === b)) store = await storeInPng(blob);
	else if (kind === "jumb") {
		if (blob.size > MAX_STORE)
			throw notSure("its credentials are too large to read here");
		store = await piece(blob, 0, blob.size);
	} else
		throw notSure(
			"this page finds the certificate only in MP4, MOV, WAV, PNG and .c2pa files",
		);
	const { label, certificate } = certificateOfStore(store);
	return { label, sha256: sha256Hex(certificate) };
}

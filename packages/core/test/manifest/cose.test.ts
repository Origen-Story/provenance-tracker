import { describe, expect, it } from "vitest";
import {
	cbor,
	coseSign1,
	Tagged,
	type CborValue,
} from "../../src/manifest/cose.ts";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

describe("cbor", () => {
	// RFC 8949, Appendix A: examples of encoded CBOR data items.
	it.each<[CborValue, string]>([
		[0, "00"],
		[1, "01"],
		[10, "0a"],
		[23, "17"],
		[24, "1818"],
		[25, "1819"],
		[100, "1864"],
		[1000, "1903e8"],
		[1000000, "1a000f4240"],
		[1000000000000, "1b000000e8d4a51000"],
		[-1, "20"],
		[-10, "29"],
		[-100, "3863"],
		[-1000, "3903e7"],
		[false, "f4"],
		[true, "f5"],
		[null, "f6"],
		[new Uint8Array(0), "40"],
		[Uint8Array.from([1, 2, 3, 4]), "4401020304"],
		["", "60"],
		["a", "6161"],
		["IETF", "6449455446"],
		["ü", "62c3bc"],
		["水", "63e6b0b4"],
		[[], "80"],
		[[1, 2, 3], "83010203"],
		[[1, [2, 3], [4, 5]], "8301820203820405"],
		[new Map(), "a0"],
		[
			new Map<CborValue, CborValue>([
				[1, 2],
				[3, 4],
			]),
			"a201020304",
		],
		[
			new Map<CborValue, CborValue>([
				["a", 1],
				["b", [2, 3]],
			]),
			"a26161016162820203",
		],
		[new Tagged(1, 1363896240), "c11a514b67b0"],
	])("encodes %o as %s", (value, expected) => {
		expect(hex(cbor(value))).toBe(expected);
	});

	it("refuses what it does not encode", () => {
		expect(() => cbor(1.5)).toThrow(/whole numbers/);
		expect(() => cbor(undefined as unknown as CborValue)).toThrow(
			/cannot encode/,
		);
	});
});

describe("coseSign1", () => {
	it("signs the Sig_structure over the protected header and the payload, and leaves the payload out", async () => {
		const cert = Uint8Array.from([0xde, 0xad]);
		const payload = Uint8Array.from([1, 2, 3]);
		let signed: Uint8Array | null = null;
		const out = await coseSign1({
			alg: "es256",
			certificates: [cert],
			payload,
			sign: async (b) => {
				signed = b;
				return Uint8Array.from([9, 9]);
			},
		});
		// Protected header {1: -7, 33: h'dead'}, as a byte string.
		const protectedHeader = "a2" + "01" + "26" + "1821" + "42dead";
		expect(
			hex(
				cbor(
					new Map<CborValue, CborValue>([
						[1, -7],
						[33, cert],
					]),
				),
			),
		).toBe(protectedHeader);
		// ["Signature1", protected, h'', payload]
		expect(hex(signed!)).toBe(
			`84` +
				`6a5369676e617475726531` +
				`48${protectedHeader}` +
				`40` +
				`43010203`,
		);
		// Tag 18: [protected, {}, null, signature]
		expect(hex(out)).toBe(
			`d2` + `84` + `48${protectedHeader}` + `a0` + `f6` + `420909`,
		);
	});

	it("puts a chain of more than one certificate in as an array, and needs one", async () => {
		const out = await coseSign1({
			alg: "ed25519",
			certificates: [Uint8Array.from([1]), Uint8Array.from([2])],
			payload: new Uint8Array(0),
			sign: async () => new Uint8Array(0),
		});
		// {1: -8, 33: [h'01', h'02']}
		expect(hex(out)).toContain("a20127182182410141" + "02");
		await expect(
			coseSign1({
				alg: "es256",
				certificates: [],
				payload: new Uint8Array(0),
				sign: async () => new Uint8Array(0),
			}),
		).rejects.toThrow(/no certificate/);
	});
});

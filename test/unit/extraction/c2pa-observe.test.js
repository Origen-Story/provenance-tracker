import { describe, it, expect } from "vitest";
import {
	c2paNodeObservation,
	c2patoolObservation,
	observeC2pa,
	legacyC2paSummary,
	extractC2pa,
	parseToolVersion,
} from "../../../src/server/lib/extraction/c2pa.js";
import { makeObservation } from "../../../src/server/lib/extraction/observation.ts";

const manifest = {
	title: "clip.mp4",
	format: "video/mp4",
	claim_generator_info: [{ name: "Pixel Camera" }],
	assertions: [
		{
			label: "c2pa.actions.v2",
			data: { actions: [{ action: "c2pa.created" }] },
		},
	],
	ingredients: [],
	signature_info: {
		issuer: "Google LLC",
		common_name: "Pixel Camera",
		time: "2026-11-02T18:01:13+00:00",
		alg: "Es256",
	},
};
const obs = (extractor, status, extra = {}) =>
	makeObservation({ kind: "c2pa", extractor, status, ...extra });
const okStore = { active_manifest: "urn:x", manifests: { "urn:x": manifest } };
const reader = (o) => async () => o;

describe("c2paNodeObservation", () => {
	const store = {
		active_manifest: {
			...manifest,
			thumbnail: { format: "image/jpeg", data: Buffer.from("jpeg bytes") },
		},
		manifests: { "urn:x": manifest },
		validation_status: [
			{
				code: "signingCredential.untrusted",
				explanation: "signing certificate untrusted",
			},
		],
	};

	it("keeps the whole manifest store and its validation, with binary data reduced to a hash", () => {
		const o = c2paNodeObservation({ result: store, version: "0.5.26" });
		expect(o).toMatchObject({
			kind: "c2pa",
			extractor: "c2pa-node",
			version: "0.5.26",
			status: "ok",
			error: null,
		});
		expect(o.data.manifests["urn:x"].signature_info.issuer).toBe("Google LLC");
		expect(o.data.active_manifest.thumbnail.data).toMatchObject({
			binary: true,
			bytes: 10,
		});
		expect(o.validation).toMatchObject({
			state: null,
			failures: ["signingCredential.untrusted"],
		});
	});

	it("reports a manifest it could not decode as unreadable, keeping why", () => {
		const o = c2paNodeObservation({
			result: {
				active_manifest: null,
				manifests: {},
				validation_status: [
					{ code: "assertion.unsupported", explanation: "unknown field" },
				],
			},
			version: "0.5.26",
		});
		expect(o).toMatchObject({
			status: "unreadable",
			error: "unknown field",
			data: null,
		});
		expect(o.validation.failures).toEqual(["assertion.unsupported"]);
	});

	it("reports a thrown read as unreadable and no manifest as absent", () => {
		expect(
			c2paNodeObservation({
				error: "assertion version is too new",
				version: "0.5.26",
			}),
		).toMatchObject({
			status: "unreadable",
			error: "assertion version is too new",
		});
		expect(
			c2paNodeObservation({ result: null, version: "0.5.26" }).status,
		).toBe("absent");
	});
});

describe("c2patoolObservation", () => {
	const report = {
		active_manifest: "urn:y",
		manifests: { "urn:y": manifest },
		validation_state: "Invalid",
		validation_results: {
			activeManifest: { failure: [{ code: "assertion.bmffHash.mismatch" }] },
		},
	};

	it("reads the report, including the state c2patool gives", () => {
		const o = c2patoolObservation({
			stdout: JSON.stringify(report),
			version: "0.27.1",
		});
		expect(o).toMatchObject({
			extractor: "c2patool",
			version: "0.27.1",
			status: "ok",
		});
		expect(o.validation).toMatchObject({
			state: "Invalid",
			failures: ["assertion.bmffHash.mismatch"],
		});
	});

	it("tells a missing tool, a file with no manifest and a real failure apart", () => {
		expect(
			c2patoolObservation({ err: { code: "ENOENT" }, version: null }).status,
		).toBe("unavailable");
		expect(
			c2patoolObservation({
				err: { stderr: "Error: No claim found" },
				version: "0.27.1",
			}).status,
		).toBe("absent");
		expect(
			c2patoolObservation({
				err: { stderr: "Error: io error" },
				version: "0.27.1",
			}),
		).toMatchObject({
			status: "unreadable",
			error: "c2patool: Error: io error",
		});
		expect(
			c2patoolObservation({ stdout: "not json", version: "0.27.1" }).status,
		).toBe("unreadable");
		expect(
			c2patoolObservation({
				stdout: JSON.stringify({ manifests: {} }),
				version: "0.27.1",
			}).status,
		).toBe("absent");
	});
});

describe("parseToolVersion", () => {
	it("finds the version number in --version output", () => {
		expect(parseToolVersion("c2patool 0.27.1\n")).toBe("0.27.1");
		expect(parseToolVersion("nothing here")).toBeNull();
	});
});

describe("observeC2pa reader routing", () => {
	const ok = (extractor) => obs(extractor, "ok", { data: okStore });

	it("stops at c2pa-node when it reads the file or finds no manifest", async () => {
		let toolCalls = 0;
		const tool = async () => {
			toolCalls++;
			return ok("c2patool");
		};
		expect(
			await observeC2pa("x", { node: reader(ok("c2pa-node")), tool }),
		).toHaveLength(1);
		expect(
			await observeC2pa("x", {
				node: reader(obs("c2pa-node", "absent")),
				tool,
			}),
		).toHaveLength(1);
		expect(toolCalls).toBe(0);
	});

	it("records both attempts when it falls back, so the first reader's verdict is not lost", async () => {
		const both = await observeC2pa("x", {
			node: reader(obs("c2pa-node", "unreadable", { error: "too new" })),
			tool: reader(ok("c2patool")),
		});
		expect(both.map((o) => `${o.extractor}:${o.status}`)).toEqual([
			"c2pa-node:unreadable",
			"c2patool:ok",
		]);
	});
});

describe("legacyC2paSummary (the c2paJson the current app stores)", () => {
	const validation = {
		state: "Valid",
		failures: ["signingCredential.untrusted"],
		statuses: [],
		results: null,
	};
	const ok = (extractor) => obs(extractor, "ok", { data: okStore, validation });

	it("summarises the manifest as before, now with its validation", () => {
		const s = legacyC2paSummary([ok("c2pa-node")]);
		expect(s).toMatchObject({
			title: "clip.mp4",
			claimGenerator: "Pixel Camera",
			signatureInfo: { issuer: "Google LLC" },
		});
		expect(s.validation).toEqual({
			state: "Valid",
			failures: ["signingCredential.untrusted"],
			statuses: [],
		});
		expect(s).not.toHaveProperty("_readerFallback");
	});

	it("marks a summary read by the fallback", () => {
		expect(
			legacyC2paSummary([
				obs("c2pa-node", "unavailable", { error: "blocked" }),
				ok("c2patool"),
			]),
		).toMatchObject({
			_readerFallback: "c2patool",
			title: "clip.mp4",
		});
		expect(
			legacyC2paSummary([
				obs("c2pa-node", "unreadable", { error: "too new" }),
				ok("c2patool"),
			]),
		).toMatchObject({
			_readerFallback: "c2patool",
		});
	});

	it("gives null when the file has no manifest, or when c2patool is the only reader and finds none", () => {
		expect(legacyC2paSummary([obs("c2pa-node", "absent")])).toBeNull();
		expect(
			legacyC2paSummary([
				obs("c2pa-node", "unavailable"),
				obs("c2patool", "absent"),
			]),
		).toBeNull();
		expect(
			legacyC2paSummary([
				obs("c2pa-node", "unavailable"),
				obs("c2patool", "unavailable"),
			]),
		).toBeNull();
	});

	it("keeps the signal that provenance exists when no reader could parse it", () => {
		expect(
			legacyC2paSummary([
				obs("c2pa-node", "unavailable", { error: "blocked" }),
				obs("c2patool", "unreadable", { error: "boom" }),
			]),
		).toEqual({
			_readError: true,
			_reason: "blocked",
			_fallbackReason: "boom",
			validationStatus: [],
		});

		const statuses = [{ code: "x" }];
		const undecodable = obs("c2pa-node", "unreadable", {
			error: "unknown field",
			validation: { state: null, failures: ["x"], statuses, results: null },
		});
		expect(legacyC2paSummary([undecodable, obs("c2patool", "absent")])).toEqual(
			{
				_readError: true,
				_reason: "unknown field",
				_fallbackReason: null,
				validationStatus: statuses,
			},
		);
	});

	it("is what extractC2pa returns", async () => {
		expect(
			await extractC2pa("x", {
				node: reader(ok("c2pa-node")),
				tool: reader(obs("c2patool", "absent")),
			}),
		).toEqual(legacyC2paSummary([ok("c2pa-node")]));
	});
});

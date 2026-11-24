import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DATA, TOOLS, assetFor, verifySha256, reportsVersion } from "../../../scripts/lib/pinned-tools.mjs";

describe("assetFor", () => {
	it("picks the Windows zip and the .exe inside it", () => {
		const a = assetFor("c2patool", "win32", "x64");
		expect(a.file).toBe("c2patool-v0.27.1-x86_64-pc-windows-msvc.zip");
		expect(a.url).toBe(
			"https://github.com/contentauth/c2pa-rs/releases/download/c2patool-v0.27.1/c2patool-v0.27.1-x86_64-pc-windows-msvc.zip",
		);
		expect(a.binaryInArchive).toBe("c2patool/c2patool.exe");
	});

	it("uses the universal build on both Mac architectures", () => {
		expect(assetFor("c2patool", "darwin", "arm64").file).toBe(assetFor("c2patool", "darwin", "x64").file);
		expect(assetFor("c2patool", "darwin", "arm64").binaryInArchive).toBe("c2patool/c2patool");
	});

	it("refuses a machine with no pinned download instead of guessing", () => {
		expect(() => assetFor("c2patool", "linux", "arm64")).toThrow(/no pinned download for linux-arm64/);
		expect(() => assetFor("nope", "win32", "x64")).toThrow(/Unknown tool/);
	});

	it("keeps every asset name on the pinned version, so a half-done bump fails here", () => {
		for (const [name, tool] of Object.entries(TOOLS)) {
			// "…/c2patool-v0.27.1/" or "…%40contentauth%2Fc2pa-node%400.10.1/"
			const v = tool.version;
			expect(
				tool.releaseUrl.endsWith(`v${v}/`) || tool.releaseUrl.endsWith(`%40${v}/`),
				`${name}: ${tool.releaseUrl}`,
			).toBe(true);
			for (const asset of Object.values(tool.assets)) {
				// "c2patool-v0.27.1-x86_64…" or "c2pa-node_x86_64…-v0.10.1.zip"
				expect(
					asset.file.includes(`v${tool.version}-`) ||
						asset.file.includes(`v${tool.version}.`),
					`${name}: ${asset.file}`,
				).toBe(true);
				expect(asset.sha256, name).toMatch(/^[0-9a-f]{64}$/);
			}
		}
	});
});

describe("verifySha256", () => {
	const bytes = Buffer.from("pinned");
	const good = createHash("sha256").update(bytes).digest("hex");

	it("accepts matching bytes, in either case", () => {
		expect(verifySha256(bytes, good)).toBe(good);
		expect(verifySha256(bytes, good.toUpperCase())).toBe(good);
	});

	it("refuses different bytes and says what it found", () => {
		expect(() => verifySha256(Buffer.from("tampered"), good, "c2patool.zip")).toThrow(/c2patool\.zip: SHA-256 is [0-9a-f]{64}, expected/);
	});
});

describe("reportsVersion", () => {
	it("matches the version as a whole word only", () => {
		expect(reportsVersion("c2patool 0.27.1\n", "0.27.1")).toBe(true);
		expect(reportsVersion("c2patool 0.27.10", "0.27.1")).toBe(false);
		expect(reportsVersion("c2patool 10.27.1", "0.27.1")).toBe(false);
		expect(reportsVersion("c2patool 0x27x1", "0.27.1")).toBe(false);
	});
});

describe("the C2PA library's pinned binary (D51)", () => {
	it("is the same version as the package npm installs, so a package bump without a binary bump fails here", () => {
		const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
		const pkg = lock.packages["node_modules/@contentauth/c2pa-node"];
		expect(pkg?.version).toBe(TOOLS["c2pa-node"].version);
	});

	it("has a download for each machine CI and the app support", () => {
		for (const [p, a] of [["win32", "x64"], ["linux", "x64"], ["darwin", "x64"], ["darwin", "arm64"]])
			expect(assetFor("c2pa-node", p, a).binaryInArchive).toBe("index.node");
	});
});

describe("the pinned trust lists (D51)", () => {
	it("name one commit and a SHA-256 per file", () => {
		const t = DATA["trust-lists"];
		expect(t.commit).toMatch(/^[0-9a-f]{40}$/);
		expect(t.baseUrl).toContain(`/${t.commit}/`);
		for (const sha of Object.values(t.files)) expect(sha).toMatch(/^[0-9a-f]{64}$/);
	});
});

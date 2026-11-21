// Helper programs the tracker runs, each pinned to one release and to the
// SHA-256 of each download (docs/dependencies.md). The checksums are copied
// from the digests GitHub records for the release assets; a download whose
// bytes differ is refused. To move to a new release, change the version and
// every checksum together, in one commit with a line in the decisions log.
//
// Pure: scripts/fetch-tools.mjs does the downloading.
import { createHash } from "node:crypto";

export const TOOLS = {
	c2patool: {
		version: "0.27.1",
		releaseUrl:
			"https://github.com/contentauth/c2pa-rs/releases/download/c2patool-v0.27.1/",
		// Where the binary sits inside the archive, and its name on disk.
		binary: { win32: "c2patool/c2patool.exe", default: "c2patool/c2patool" },
		assets: {
			"win32-x64": {
				file: "c2patool-v0.27.1-x86_64-pc-windows-msvc.zip",
				sha256:
					"3f290d272713642aa18f7e7c3fc981301121fe781de84b8fe391af35188d98db",
			},
			"darwin-x64": {
				file: "c2patool-v0.27.1-universal-apple-darwin.zip",
				sha256:
					"d61281d32fbf5f8fa3b113a4706364dd1614478a995dadf3d0d94f9b294e62ae",
			},
			"darwin-arm64": {
				file: "c2patool-v0.27.1-universal-apple-darwin.zip",
				sha256:
					"d61281d32fbf5f8fa3b113a4706364dd1614478a995dadf3d0d94f9b294e62ae",
			},
			"linux-x64": {
				file: "c2patool-v0.27.1-x86_64-unknown-linux-gnu.tar.gz",
				sha256:
					"648ea104a388d04c0e673a5498c75228c0a4be9a9c6def51c44553446ad521ac",
			},
		},
	},
};

/**
 * The download for one tool on one machine.
 * @returns {{ url: string, file: string, sha256: string, binaryInArchive: string, version: string }}
 */
export function assetFor(name, platform, arch) {
	const tool = TOOLS[name];
	if (!tool)
		throw new Error(
			`Unknown tool "${name}". Known: ${Object.keys(TOOLS).join(", ")}`,
		);
	const asset = tool.assets[`${platform}-${arch}`];
	if (!asset) {
		throw new Error(
			`${name} ${tool.version} has no pinned download for ${platform}-${arch}. ` +
				`Install it by hand and set its path in .env (see tools/README.md).`,
		);
	}
	return {
		url: tool.releaseUrl + asset.file,
		file: asset.file,
		sha256: asset.sha256,
		binaryInArchive: tool.binary[platform] ?? tool.binary.default,
		version: tool.version,
	};
}

/** Throws unless the bytes hash to the expected SHA-256 (hex). */
export function verifySha256(bytes, expected, label = "download") {
	const actual = createHash("sha256").update(bytes).digest("hex");
	if (actual !== expected.toLowerCase()) {
		throw new Error(
			`${label}: SHA-256 is ${actual}, expected ${expected}. Refusing to install it.`,
		);
	}
	return actual;
}

/** True when `--version` output names the pinned version, e.g. "c2patool 0.27.1". */
export function reportsVersion(versionOutput, version) {
	// Compare whole words, so 0.27.1 never matches 0.27.10; no pattern is built
	// from the version string.
	return String(versionOutput)
		.split(/\s+/)
		.some((word) => word.replace(/^v/, "") === version);
}

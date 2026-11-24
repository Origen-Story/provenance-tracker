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
	// The native part of @contentauth/c2pa-node (D15, D51). Its install script
	// would download this without a checksum; npm installs it with
	// SKIP_BINARY_DOWNLOAD=1 and the app loads this pinned copy through
	// C2PA_LIBRARY_PATH. The version must equal the package's in
	// package-lock.json (test/unit/tools/pinned-tools.test.js checks).
	"c2pa-node": {
		kind: "library",
		version: "0.10.1",
		// The release tag is "@contentauth/c2pa-node@0.10.1", URL-encoded.
		releaseUrl:
			"https://github.com/contentauth/c2pa-js/releases/download/%40contentauth%2Fc2pa-node%400.10.1/",
		binary: { default: "index.node" },
		assets: {
			"win32-x64": {
				file: "c2pa-node_x86_64-pc-windows-msvc-v0.10.1.zip",
				sha256:
					"3001fa3c696461127c04962d65be43aa354c65996b07b8fc7bd62353b7f76a27",
			},
			"linux-x64": {
				file: "c2pa-node_x86_64-unknown-linux-gnu-v0.10.1.zip",
				sha256:
					"dd6aa62be23ce14b9915eb8c70044531a666296b3c6ff3e63f54b6ee84d66a13",
			},
			"linux-arm64": {
				file: "c2pa-node_aarch64-unknown-linux-gnu-v0.10.1.zip",
				sha256:
					"c89814bc509898bfb25d658d125634997a08264b7d147e4945cff85282c21fc7",
			},
			"darwin-x64": {
				file: "c2pa-node_x86_64-apple-darwin-v0.10.1.zip",
				sha256:
					"6216399f6cdf5e2562a83de640ff69c09993d030c48d002e3482b5831e83b8d3",
			},
			"darwin-arm64": {
				file: "c2pa-node_aarch64-apple-darwin-v0.10.1.zip",
				sha256:
					"618ce6feb247fcdc53a847837184a66e217eed60973b240b5421176f6212a5e7",
			},
		},
	},
};

/**
 * Data files the tracker reads, pinned to one commit of their source and to
 * each file's SHA-256: the C2PA trust lists (D51). The lists change every week
 * or two; moving to a newer commit is a deliberate change, like a tool bump.
 */
export const DATA = {
	"trust-lists": {
		// c2pa-org/conformance-public, trust-list/ at this commit (2026-11-20).
		// Licensed CC BY 4.0 by its authors; downloaded, not committed here.
		source: "c2pa-org/conformance-public",
		commit: "285d98e4b575198180c1d6404a7ee1a317e04911",
		baseUrl:
			"https://raw.githubusercontent.com/c2pa-org/conformance-public/285d98e4b575198180c1d6404a7ee1a317e04911/trust-list/",
		files: {
			// Certificate authorities whose signers are on the C2PA trust list.
			"C2PA-TRUST-LIST.pem":
				"859f422cf4744a45de6f073b258d76381c91a9624c10aaa40543c19c1f124e13",
			// Time-stamp authorities the C2PA trusts.
			"C2PA-TSA-TRUST-LIST.pem":
				"eca8347ee71e31d226e00c85b15aca356116fefe6c26ed8c0ee1f954115b1990",
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

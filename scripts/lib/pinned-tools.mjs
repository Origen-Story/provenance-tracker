// Helper programs the tracker runs, each pinned to one release and to the
// SHA-256 of each download (docs/dependencies.md). The checksums are copied
// from the digests GitHub records for the release assets; a download whose
// bytes differ is refused. To move to a new release, change the version and
// every checksum together, in one commit with a line in the decisions log.
//
// Each download also has the SHA-256 of the program inside it (binarySha256),
// worked out once from the checked archive. That is what the tracker compares
// with before it loads the library or runs c2patool (D69): the file on disk
// has to be the pinned one each time, not only on the day it was installed.
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
				binarySha256:
					"6d5f13e4235e4b83fe7933de5f98a42233042234ad596b9dea9c9b8c0c8001ba",
			},
			"darwin-x64": {
				file: "c2patool-v0.27.1-universal-apple-darwin.zip",
				sha256:
					"d61281d32fbf5f8fa3b113a4706364dd1614478a995dadf3d0d94f9b294e62ae",
				binarySha256:
					"31dd1eeaccaaf57c889827b9708b49b48a4c938f2eb33723cb3a3cb2396aeda3",
			},
			"darwin-arm64": {
				file: "c2patool-v0.27.1-universal-apple-darwin.zip",
				sha256:
					"d61281d32fbf5f8fa3b113a4706364dd1614478a995dadf3d0d94f9b294e62ae",
				binarySha256:
					"31dd1eeaccaaf57c889827b9708b49b48a4c938f2eb33723cb3a3cb2396aeda3",
			},
			"linux-x64": {
				file: "c2patool-v0.27.1-x86_64-unknown-linux-gnu.tar.gz",
				sha256:
					"648ea104a388d04c0e673a5498c75228c0a4be9a9c6def51c44553446ad521ac",
				binarySha256:
					"e408b7c2dca64ed6e5749d76fc46f95bc6f75f20ce1a79df42d726ec98fc3844",
			},
		},
	},
	// The native part of @contentauth/c2pa-node (D15, D51). Its install script
	// would download this without a checksum; .npmrc stops install scripts
	// running, and the app loads only this pinned copy, after checking its
	// bytes. The version must equal the package's in package-lock.json
	// (test/unit/tools/pinned-tools.test.js checks, and so does the loader).
	"c2pa-node": {
		kind: "library",
		version: "0.12.1",
		// The release tag is "@contentauth/c2pa-node@0.12.1", URL-encoded.
		releaseUrl:
			"https://github.com/contentauth/c2pa-js/releases/download/%40contentauth%2Fc2pa-node%400.12.1/",
		binary: { default: "index.node" },
		assets: {
			"win32-x64": {
				file: "c2pa-node_x86_64-pc-windows-msvc-v0.12.1.zip",
				sha256:
					"8b6f6bd33765f838efe27fc77e139e5ce92205f3091ec6600f6ff894dbc026eb",
				binarySha256:
					"e06fc13f060179a9440dc7c18edeeb8a69382b26297a505faede03eb264fadc4",
			},
			"linux-x64": {
				file: "c2pa-node_x86_64-unknown-linux-gnu-v0.12.1.zip",
				sha256:
					"47a83f5dc0f138aa13edc1bebf8089f0706bae75cfcc41a609ccad18c38c2061",
				binarySha256:
					"3962e81703b15723782af742471fdaf75137eaf09d14d64a4126765fc5cafba2",
			},
			"linux-arm64": {
				file: "c2pa-node_aarch64-unknown-linux-gnu-v0.12.1.zip",
				sha256:
					"3421ff2ed9b57f16b6946972b0ab16273b2d13f3958866ace0357ded93da5f71",
				binarySha256:
					"1d0054978a9511d85c54896a340538d92301a8206d16795ef1b15bbba023c03f",
			},
			"darwin-x64": {
				file: "c2pa-node_x86_64-apple-darwin-v0.12.1.zip",
				sha256:
					"58b709363a0cc74e11fb5193fecab4f88d5c393ba12e525ed6de6b8320abd211",
				binarySha256:
					"f8598b5ca4812b1acc972505a058243accc1e86dcdbd50236b37b7a044cb274c",
			},
			"darwin-arm64": {
				file: "c2pa-node_aarch64-apple-darwin-v0.12.1.zip",
				sha256:
					"6155d01d3f2f154e430471d23f577a514526fa1aca1782dfa51ec5758f8d43c5",
				binarySha256:
					"7615e9cf4fcb8ef8d7d59e8e0177d52f9102d7ab135904ee47b0a67538d5bbd2",
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
			`${name} ${tool.version} has no pinned download for ${platform}-${arch}, ` +
				`so it cannot be used on this machine (see tools/README.md).`,
		);
	}
	return {
		url: tool.releaseUrl + asset.file,
		file: asset.file,
		sha256: asset.sha256,
		binarySha256: asset.binarySha256,
		binaryInArchive: tool.binary[platform] ?? tool.binary.default,
		version: tool.version,
	};
}

/**
 * The program one tool is on one machine: its pinned version and the SHA-256
 * its file must have. Null where there is no pinned download.
 * @returns {{ version: string, sha256: string } | null}
 */
export function pinnedBinary(name, platform, arch) {
	const asset = TOOLS[name]?.assets[`${platform}-${arch}`];
	return asset
		? { version: TOOLS[name].version, sha256: asset.binarySha256 }
		: null;
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

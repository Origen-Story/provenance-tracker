#!/usr/bin/env node
// Download the helper programs the tracker runs (today: c2patool) at the
// version pinned in scripts/lib/pinned-tools.mjs, check each download's
// SHA-256 against the recorded one, and install it under tools/.
//
// Usage: npm run tools:fetch            install, or confirm what is installed
//        npm run tools:fetch -- --force replace an installed copy of another version
//
// Network: one HTTPS download per tool from github.com (docs/network.md).
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	TOOLS,
	assetFor,
	reportsVersion,
	verifySha256,
} from "./lib/pinned-tools.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const force = process.argv.includes("--force");

// Windows' own tar (bsdtar) reads .zip; a Git Bash tar earlier on PATH does not.
const tar =
	process.platform === "win32"
		? join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe")
		: "tar";

function installedVersion(binary) {
	if (!existsSync(binary)) return null;
	try {
		return execFileSync(binary, ["--version"], {
			encoding: "utf8",
			timeout: 15_000,
		}).trim();
	} catch (err) {
		return `(does not run: ${err.message.split("\n")[0]})`;
	}
}

async function fetchTool(name) {
	const asset = assetFor(name, process.platform, process.arch);
	const destDir = join(repo, "tools", name);
	const target = join(destDir, basename(asset.binaryInArchive));

	const current = installedVersion(target);
	if (current && reportsVersion(current, asset.version)) {
		console.log(
			`${name}: ${asset.version} already installed at tools/${name}/${basename(target)}`,
		);
		return;
	}
	if (current && !force) {
		throw new Error(
			`tools/${name}/${basename(target)} reports "${current}", but the pinned version is ${asset.version}. ` +
				`Run "npm run tools:fetch -- --force" to replace it.`,
		);
	}

	console.log(`${name}: downloading ${asset.file}`);
	const res = await fetch(asset.url, { redirect: "follow" });
	if (!res.ok)
		throw new Error(
			`${name}: download failed, HTTP ${res.status} from ${asset.url}`,
		);
	const bytes = Buffer.from(await res.arrayBuffer());
	verifySha256(bytes, asset.sha256, asset.file);
	console.log(
		`${name}: SHA-256 matches the pinned ${asset.sha256.slice(0, 16)}...`,
	);

	const work = join(repo, "tools", ".download", name);
	rmSync(work, { recursive: true, force: true });
	mkdirSync(work, { recursive: true });
	try {
		const archive = join(work, asset.file);
		writeFileSync(archive, bytes);
		execFileSync(tar, ["-xf", archive, "-C", work], {
			stdio: ["ignore", "ignore", "pipe"],
		});

		const extracted = join(work, asset.binaryInArchive);
		if (!existsSync(extracted))
			throw new Error(
				`${name}: ${asset.binaryInArchive} is not in ${asset.file}`,
			);
		if (process.platform !== "win32") chmodSync(extracted, 0o755);
		const reported = installedVersion(extracted);
		if (!reportsVersion(reported, asset.version)) {
			throw new Error(
				`${name}: the downloaded binary reports "${reported}", expected ${asset.version}`,
			);
		}

		// Copy beside the target, then rename over it, so a failure never leaves
		// half a binary where the app looks for one.
		mkdirSync(destDir, { recursive: true });
		const staged = `${target}.new`;
		copyFileSync(extracted, staged);
		if (process.platform !== "win32") chmodSync(staged, 0o755);
		renameSync(staged, target);
		for (const doc of ["README.md", "CHANGELOG.md"]) {
			const from = join(dirname(extracted), doc);
			if (existsSync(from)) copyFileSync(from, join(destDir, doc));
		}
		console.log(
			`${name}: installed ${reported} at tools/${name}/${basename(target)}`,
		);
	} finally {
		rmSync(join(repo, "tools", ".download"), { recursive: true, force: true });
	}
}

try {
	for (const name of Object.keys(TOOLS)) await fetchTool(name);
} catch (err) {
	console.error(err.message);
	process.exit(1);
}

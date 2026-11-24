#!/usr/bin/env node
// Download what the tracker runs or reads from outside npm, at the version
// pinned in scripts/lib/pinned-tools.mjs, check each download's SHA-256
// against the recorded one, and install it under tools/: c2patool, the C2PA
// library's native binary, and the C2PA trust lists.
//
// Usage: npm run tools:fetch            install, or confirm what is installed
//        npm run tools:fetch -- --force replace an installed copy of another version
//
// Network: one HTTPS download per tool from github.com, and the trust lists
// from raw.githubusercontent.com (docs/network.md).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	DATA,
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

/**
 * Unpack an archive into a folder. Windows' and macOS's tar (bsdtar) read
 * .zip as well as .tar.gz; GNU tar on Linux reads only tar archives, so a
 * .zip there goes to unzip.
 */
function unpack(archive, into) {
	const zipOnLinux = archive.endsWith(".zip") && process.platform === "linux";
	const [program, args] = zipOnLinux
		? ["unzip", ["-q", "-o", archive, "-d", into]]
		: [tar, ["-xf", archive, "-C", into]];
	try {
		execFileSync(program, args, { stdio: ["ignore", "ignore", "pipe"] });
	} catch (err) {
		if (err.code === "ENOENT")
			throw new Error(
				`${program} is needed to unpack ${basename(archive)} and is not installed here.`,
				{ cause: err },
			);
		throw err;
	}
}

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

const sha256Of = (file) =>
	createHash("sha256").update(readFileSync(file)).digest("hex");

/**
 * A library cannot be asked its version, so installing one writes a marker
 * beside it with the version and the installed file's SHA-256; the marker
 * counts only while the file still has that hash.
 */
function installedLibrary(target) {
	const marker = `${target}.pinned.json`;
	if (!existsSync(target) || !existsSync(marker)) return null;
	try {
		const m = JSON.parse(readFileSync(marker, "utf8"));
		return m.sha256 === sha256Of(target)
			? String(m.version)
			: "(changed since it was installed)";
	} catch {
		return "(unreadable marker)";
	}
}

async function fetchTool(name) {
	const asset = assetFor(name, process.platform, process.arch);
	const library = TOOLS[name].kind === "library";
	const destDir = join(repo, "tools", name);
	const target = join(destDir, basename(asset.binaryInArchive));

	const current = library ? installedLibrary(target) : installedVersion(target);
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
		unpack(archive, work);

		const extracted = join(work, asset.binaryInArchive);
		if (!existsSync(extracted))
			throw new Error(
				`${name}: ${asset.binaryInArchive} is not in ${asset.file}`,
			);
		if (!library && process.platform !== "win32") chmodSync(extracted, 0o755);
		const reported = library
			? `${name} ${asset.version}`
			: installedVersion(extracted);
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
		if (!library && process.platform !== "win32") chmodSync(staged, 0o755);
		renameSync(staged, target);
		if (library)
			writeFileSync(
				`${target}.pinned.json`,
				`${JSON.stringify({ version: asset.version, archive: asset.file, archiveSha256: asset.sha256, sha256: sha256Of(target) }, null, 2)}\n`,
			);
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

/** Plain files pinned by commit and hash: kept when already there with the right hash. */
async function fetchData(name) {
	const set = DATA[name];
	const destDir = join(repo, "tools", name);
	mkdirSync(destDir, { recursive: true });
	for (const [file, sha256] of Object.entries(set.files)) {
		const target = join(destDir, file);
		if (existsSync(target) && sha256Of(target) === sha256) {
			console.log(
				`${name}: ${file} already installed (${set.commit.slice(0, 7)})`,
			);
			continue;
		}
		const url = set.baseUrl + file;
		console.log(
			`${name}: downloading ${file} from ${set.source} at ${set.commit.slice(0, 7)}`,
		);
		const res = await fetch(url, { redirect: "follow" });
		if (!res.ok)
			throw new Error(
				`${name}: download failed, HTTP ${res.status} from ${url}`,
			);
		const bytes = Buffer.from(await res.arrayBuffer());
		verifySha256(bytes, sha256, file);
		const staged = `${target}.new`;
		writeFileSync(staged, bytes);
		renameSync(staged, target);
		console.log(`${name}: installed ${file}`);
	}
	writeFileSync(
		join(destDir, "SOURCE.md"),
		`These files are downloaded by \`npm run tools:fetch\` from ${set.source} at commit ${set.commit}, each checked against the SHA-256 in scripts/lib/pinned-tools.mjs. They are not part of this repository.\n`,
	);
}

try {
	for (const name of Object.keys(TOOLS)) await fetchTool(name);
	for (const name of Object.keys(DATA)) await fetchData(name);
} catch (err) {
	console.error(err.message);
	process.exit(1);
}

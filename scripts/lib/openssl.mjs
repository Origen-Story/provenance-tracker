// Where openssl is on this machine, for scripts/generate-dev-cert.mjs and the
// tests that make throwaway certificates with it. On the path first; on
// Windows, where Git for Windows ships openssl but only Git Bash puts it on
// the path (PowerShell and cmd don't), Git's own copies next. Found
// 2026-11-25: `npm run cert:generate` from PowerShell failed with "exit null".
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const works = (cmd) =>
	spawnSync(cmd, ["version"], { stdio: "ignore", windowsHide: true }).status ===
	0;

/** The openssl to run: a command name or a full path, or null when there is none. */
export function findOpenssl(env = process.env, platform = process.platform) {
	if (works("openssl")) return "openssl";
	if (platform !== "win32") return null;
	const roots = [
		env.ProgramFiles,
		env["ProgramFiles(x86)"],
		env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs"),
	]
		.filter(Boolean)
		.map((p) => path.join(p, "Git"));
	for (const git of roots)
		for (const sub of [
			["usr", "bin"],
			["mingw64", "bin"],
		]) {
			const exe = path.join(git, ...sub, "openssl.exe");
			if (existsSync(exe) && works(exe)) return exe;
		}
	return null;
}

export const OPENSSL_MISSING =
	"openssl was not found. Install Git for Windows (it includes openssl), or put openssl on your PATH.";

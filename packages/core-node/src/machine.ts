// What a function needs to know about the machine it runs on. Passed in, not
// read from process globals, so tests describe a machine of their own and
// never touch this one's settings.

import { homedir } from "node:os";
import path from "node:path";
import type { Platform } from "@provenancetracker/core/catalog/paths.ts";

export type Env = Readonly<Record<string, string | undefined>>;

export interface Machine {
	platform: Platform;
	env: Env;
	/** The user's home folder. */
	home: string;
	/** This machine's settings file (settings.ts). */
	settingsPath: string;
}

/** Overrides where the settings file is; tests always set it. */
export const SETTINGS_ENV = "PROVENANCETRACKER_SETTINGS";

/**
 * Where this machine's settings live. On Windows under Local, not Roaming:
 * Roaming can follow the user to another PC, and these paths are true here.
 */
export function defaultSettingsPath(
	env: Env,
	platform: Platform,
	home: string,
): string {
	const override = env[SETTINGS_ENV];
	if (override) {
		if (!path.isAbsolute(override))
			throw new Error(
				`${SETTINGS_ENV} must be an absolute path (it is ${override})`,
			);
		return override;
	}
	const p = platform === "win32" ? path.win32 : path.posix;
	const base =
		platform === "win32"
			? (env.LOCALAPPDATA ?? p.join(home, "AppData", "Local"))
			: platform === "darwin"
				? p.join(home, "Library", "Application Support")
				: (env.XDG_CONFIG_HOME ?? p.join(home, ".config"));
	return p.join(base, "provenancetracker", "settings.json");
}

/** The machine this process runs on. Only the command line's entry calls it. */
export function thisMachine(env: Env = process.env): Machine {
	const home = homedir();
	return {
		platform: process.platform,
		env,
		home,
		settingsPath: defaultSettingsPath(env, process.platform, home),
	};
}

// The signing engines (D53), picked by name like the platform parsers and
// timeline formats: the C2PA library by default, c2patool when this machine's
// setting or the command line asks for it. There is no silent fallback: an
// engine that cannot run here says why, and the person chooses the other.

import type { Machine } from "../../machine.ts";
import { loadLibrary } from "../../extract/c2pa-library.ts";
import {
	fetchesRemoteCredentials,
	readSettings,
	signingEngineOf,
	type SigningEngineName,
} from "../../settings.ts";
import { libraryObservation } from "@provenancetracker/core/extraction/c2pa-library-read.ts";
import type { SigningEngine } from "../engine.ts";
import { c2patoolEngine } from "./c2patool.ts";
import { libraryEngine } from "./library.ts";

export { SIGNING_ENGINES, type SigningEngineName } from "../../settings.ts";

/** The engine could not be made ready on this machine; the message says what to do. */
export class EngineUnavailableError extends Error {}

/**
 * The engine this machine signs with: the one named, else this machine's
 * setting, else the library.
 */
export async function signingEngineFor(
	machine: Machine,
	name?: SigningEngineName,
): Promise<SigningEngine> {
	const settings = readSettings(machine.settingsPath);
	const chosen = name ?? signingEngineOf(settings);
	const loaded = await loadLibrary(machine.env, {
		remoteManifests: fetchesRemoteCredentials(settings),
	});
	if (chosen === "c2patool") {
		const engine = await c2patoolEngine(machine);
		// Whether a file carries credentials of its own is a reading, and the
		// library is the reader (D15): c2patool takes a .c2pa sidecar beside a
		// file as the file's own, so it would refuse to sign a source again.
		// So is what a source carries, which signing a finished edit reads
		// first: without the library nothing here can, and the engine says why.
		if ("unavailable" in loaded) {
			const why = loaded.unavailable;
			return {
				...engine,
				read: async (_file, sidecar) =>
					libraryObservation({
						kind: sidecar ? "c2pa-sidecar" : "c2pa",
						version: null,
						unavailable: why,
					}),
			};
		}
		const library = libraryEngine(loaded);
		return {
			...engine,
			readEmbedded: library.readEmbedded,
			read: library.read,
		};
	}
	if ("unavailable" in loaded)
		throw new EngineUnavailableError(
			`${loaded.unavailable} To sign with c2patool instead: npm run cli -- settings signing-engine c2patool`,
		);
	return libraryEngine(loaded);
}

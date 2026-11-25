// The credential holders (D54), picked by name like the signing engines:
// today only key files on this machine. A keychain, a hardware token or a
// remote signing service would be added here as another module
// (docs/planned-features.md).

import type { Machine } from "../../machine.ts";
import type { CredentialHolder } from "../holder.ts";
import { signerPaths } from "../signing-settings.ts";
import { KEY_FILES, keyFilesHolder } from "./key-files.ts";

export type { CredentialHolder } from "../holder.ts";

/** The holder kinds this version knows, by name. */
export const HOLDER_KINDS = [KEY_FILES] as const;

/**
 * Open what holds this project's signing key on this machine, for one
 * signing. Throws, in words, when nothing is set up or it cannot be opened.
 */
export async function openHolder(
	machine: Machine,
	projectId: string,
): Promise<CredentialHolder> {
	return keyFilesHolder(signerPaths(machine, projectId));
}

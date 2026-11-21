// What the API says about a project (pure).
//
// The row holds the filesystem paths of the signing certificate and its
// private key. Those never leave the server: a response says only whether
// signing is configured. Every project the API returns goes through here.

const SERVER_ONLY = ["certificatePath", "privateKeyPath"];

export function isSigningConfigured(row) {
	return !!(row?.certificatePath && row?.privateKeyPath);
}

export function toProjectResponse(row) {
	if (!row) return null;
	const out = { ...row };
	for (const key of SERVER_ONLY) delete out[key];
	out.signingConfigured = isSigningConfigured(row);
	return out;
}

/**
 * The signing-path changes in a settings update. The form does not know the
 * saved paths, so it sends one only to replace it: a non-empty string sets the
 * path, and `clearSigning: true` removes both. Anything else leaves them alone.
 */
export function signingPathUpdates(data = {}) {
	if (data.clearSigning === true)
		return { certificatePath: "", privateKeyPath: "" };
	const updates = {};
	for (const key of SERVER_ONLY) {
		if (typeof data[key] === "string" && data[key].trim())
			updates[key] = data[key].trim();
	}
	return updates;
}

import { createC2pa } from 'c2pa-node';

let c2pa = null;

function getC2pa() {
	if (!c2pa) {
		c2pa = createC2pa();
	}
	return c2pa;
}

/**
 * Attempt to read a C2PA manifest from a file.
 * Returns a simplified summary object, or null if no manifest found.
 */
export async function extractC2pa(filePath) {
	try {
		const result = await getC2pa().read({ path: filePath });
		if (!result) return null;

		const active = result.active_manifest;
		if (!active) return null;

		// Pull out the most useful fields for display/storage
		const summary = {
			title: active.title || null,
			format: active.format || null,
			claimGenerator: active.claim_generator || null,
			assertions: [],
			ingredients: [],
			signatureInfo: null
		};

		// Collect assertions (creative work, actions, AI training, etc.)
		if (active.assertions) {
			for (const assertion of active.assertions) {
				summary.assertions.push({
					label: assertion.label,
					data: assertion.data
				});
			}
		}

		// Collect ingredient references
		if (active.ingredients) {
			for (const ingredient of active.ingredients) {
				summary.ingredients.push({
					title: ingredient.title,
					format: ingredient.format,
					relationship: ingredient.relationship
				});
			}
		}

		// Signature / signer info
		if (active.signature_info) {
			summary.signatureInfo = {
				issuer: active.signature_info.issuer || null,
				time: active.signature_info.time || null
			};
		}

		return summary;
	} catch {
		// No manifest or unsupported format — not an error
		return null;
	}
}

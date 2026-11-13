// Pure: turn c2patool's read-back report into a status a person can read.
//
// c2patool prints the manifest store plus `validation_results`: successes,
// informational codes and failures for the active manifest, and per-ingredient
// deltas. The tracker's statuses:
//
//   valid                every check passed and the issuer is on a trust list
//   unrecognised_issuer  every check passed except trust: the certificate is
//                        not on a list this reader knows (a dev certificate,
//                        or no trust list configured). The signature and the
//                        content hash still verified.
//   hash_mismatch        the content does not match what was signed: the file
//                        changed, or this reader cannot check that hash format
//   invalid              any other failure
//   absent               no credentials in the file
//
// A dev-certificate signature is expected to read as unrecognised_issuer.

const UNTRUSTED = 'signingCredential.untrusted';
const HASH_MATCH = /^assertion\.(dataHash|bmffHash|boxesHash|collectionHash)\.match$/;
const HASH_MISMATCH = /^assertion\.(dataHash|bmffHash|boxesHash|collectionHash)\.mismatch$/;

export const STATUS_LABELS = {
	valid: 'Valid',
	unrecognised_issuer: 'Valid, unrecognised issuer',
	hash_mismatch: 'Content does not match the signature',
	invalid: 'Invalid',
	absent: 'No Content Credentials'
};

const codes = (list) => (list || []).map(f => ({ code: f.code, explanation: f.explanation || '' }));

/**
 * @param {object|null} report  parsed c2patool JSON, or null when the file has none
 * @returns {{ status: string, label: string, failures: Array, hashVerified: boolean,
 *   untrusted: boolean, signer: object|null, timestamped: boolean, manifests: number,
 *   ingredients: Array<{ label, title, relationship, credentials, problems }> }}
 */
export function interpretReport(report) {
	if (!report || !report.active_manifest || !report.manifests) {
		return { status: 'absent', label: STATUS_LABELS.absent, failures: [], hashVerified: false, untrusted: false, signer: null, timestamped: false, manifests: 0, ingredients: [] };
	}
	const active = report.manifests[report.active_manifest] || {};
	const results = report.validation_results?.activeManifest || {};
	// Older reports carry only `validation_status`, which lists failures.
	const failures = codes(results.failure || report.validation_status);
	const successes = codes(results.success);
	const untrusted = failures.some(f => f.code === UNTRUSTED);
	const blocking = failures.filter(f => f.code !== UNTRUSTED);

	let status;
	if (blocking.some(f => HASH_MISMATCH.test(f.code))) status = 'hash_mismatch';
	else if (blocking.length) status = 'invalid';
	else status = untrusted ? 'unrecognised_issuer' : 'valid';

	const deltas = new Map();
	for (const d of report.validation_results?.ingredientDeltas || []) {
		const label = String(d.ingredientAssertionURI || '').split('/').pop();
		deltas.set(label, codes(d.validationDeltas?.failure).filter(f => f.code !== UNTRUSTED));
	}
	const ingredients = (active.ingredients || []).map(i => ({
		label: i.label || '',
		title: i.title || '',
		relationship: i.relationship || 'componentOf',
		credentials: i.active_manifest ? 'present' : 'none',
		problems: deltas.get(i.label) || []
	}));

	const si = active.signature_info || null;
	return {
		status,
		label: STATUS_LABELS[status],
		failures,
		hashVerified: successes.some(s => HASH_MATCH.test(s.code)),
		untrusted,
		signer: si ? { issuer: si.issuer || '', commonName: si.common_name || '', time: si.time || null, alg: si.alg || '' } : null,
		timestamped: !!si?.time,
		manifests: Object.keys(report.manifests).length,
		ingredients
	};
}

// The signatures of one asset or output (phase 4c, D13), with how each read
// back. A source asset's signature is a .c2pa sidecar beside the untouched
// file; an output's is a new file with the manifest embedded. Used on the
// asset detail pages and the output's Credentials tab.
import { useQuery } from '@tanstack/react-query';

const STATUS_STYLES = {
	valid: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
	unrecognised_issuer: 'text-sky-300 border-sky-500/40 bg-sky-500/10',
	hash_mismatch: 'text-danger border-danger/40 bg-danger/10',
	invalid: 'text-danger border-danger/40 bg-danger/10',
	absent: 'text-text-secondary border-border bg-border/20'
};

const STATUS_HELP = {
	valid: 'The signature, the content hash and the issuer all check out.',
	unrecognised_issuer: 'The signature and the content hash verified. The issuer is not on a trust list this reader knows, which is expected for a development certificate.',
	hash_mismatch: 'The file\'s content does not match what was signed: it changed after signing, or this reader cannot check that hash format.',
	invalid: 'The manifest did not validate. See the failure codes.',
	absent: 'No Content Credentials were found in the signed copy.'
};

export function StatusPill({ verification }) {
	const status = verification?.status || 'absent';
	return (
		<span title={STATUS_HELP[status]} className={`text-[11px] border rounded px-1.5 py-0.5 ${STATUS_STYLES[status] || STATUS_STYLES.absent}`}>
			{verification?.label || 'Unknown'}
		</span>
	);
}

export const fileName = (p) => String(p || '').split(/[\\/]/).pop();
export const isSidecar = (p) => /\.c2pa$/i.test(String(p || ''));
const isArchivedSidecar = (p) => /\.v\d+\.c2pa$/i.test(String(p || ''));

export function SignatureCard({ sig, children }) {
	const v = sig.verification || {};
	const failures = (v.failures || []).filter(f => f.code !== 'signingCredential.untrusted');
	return (
		<div className="border border-border rounded-lg p-3 space-y-1.5 bg-card-bg">
			<div className="flex items-center gap-2 flex-wrap">
				<span className="text-xs text-text-secondary">v{sig.version}</span>
				<span className="text-sm text-text-primary font-mono truncate max-w-[22rem]" title={sig.signedPath}>{fileName(sig.signedPath)}</span>
				<span className="text-[10px] uppercase tracking-wide text-text-secondary border border-border rounded px-1"
					title={isSidecar(sig.signedPath) ? 'The manifest is in a .c2pa file beside the original; the original is not changed. C2PA readers find it by name.' : 'A new file with the manifest embedded.'}>
					{isSidecar(sig.signedPath) ? 'sidecar' : 'embedded'}
				</span>
				<StatusPill verification={v} />
				{!sig.signedFileExists && <span className="text-[11px] text-amber-400">file missing</span>}
				{isArchivedSidecar(sig.signedPath) && <span className="text-[11px] text-text-secondary">earlier signature</span>}
			</div>
			<p className="text-[11px] text-text-secondary">{STATUS_HELP[v.status]}</p>
			<div className="text-[11px] text-text-secondary flex flex-wrap gap-x-4 gap-y-0.5">
				<span>Signed {new Date(sig.createdAt).toLocaleString()}</span>
				{v.signer && <span>by {v.signer.commonName || 'unnamed certificate'}{v.signer.issuer ? `, issued by ${v.signer.issuer}` : ''}</span>}
				<span>{v.timestamped ? `time-stamped ${new Date(v.signer.time).toLocaleString()}` : 'no trusted time stamp'}</span>
				<span title={sig.signedHash}>SHA-256 {String(sig.signedHash || '').slice(0, 12)}…</span>
			</div>
			{failures.length > 0 && (
				<ul className="text-[11px] text-danger list-disc pl-4">
					{failures.map((f, i) => <li key={i}><code>{f.code}</code> {f.explanation}</li>)}
				</ul>
			)}
			{children}
		</div>
	);
}

export default function SignedCopies({ type, id }) {
	const q = useQuery({ queryKey: ['signatures', type, String(id)], queryFn: () => fetch(`/api/sign/${type}/${id}`).then(r => r.json()) });
	const list = q.data?.signatures || [];
	if (!list.length) return null;
	return (
		<div className="space-y-2">
			<h3 className="text-xs font-medium text-text-secondary">Signatures</h3>
			<p className="text-[11px] text-text-secondary">The file itself is never changed. Its Content Credentials are in a <code>.c2pa</code> sidecar beside it, named like the file, which is where C2PA readers look.</p>
			{list.map(sig => <SignatureCard key={sig.id} sig={sig} />)}
		</div>
	);
}

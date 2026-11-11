import { originInfo, pillStyle, SIGNED_BY_LABELS } from './originClasses.js';

/**
 * Small pill for an asset's origin: the class, coloured by its spectrum
 * position, with the attributes beside it. Pass the asset (or an asset
 * reference) and, in a list that knows its table, the `type`; or pass the
 * fields one by one.
 *
 *   ✓  the file's credentials are signed (hover says by whom)
 *   ?  the class is a proposal the user has not confirmed
 *   ✎  the user left a reason
 */
export default function OriginBadge({ asset = null, type, originClass, confirmed, note, aiAssisted, signedBy, signerName, archive, className = '' }) {
	const a = asset || {};
	const cls = originClass ?? a.originClass ?? 'unknown';
	const isConfirmed = confirmed ?? !!a.originClassConfirmed;
	const reason = note ?? a.originClassNote ?? '';
	const signed = signedBy ?? a.signedBy ?? '';
	const signer = signerName ?? a.signerName ?? '';
	const fromArchive = archive ?? (type || a.type) === 'archival';
	const info = originInfo({ originClass: cls, aiAssisted: aiAssisted ?? !!a.aiAssisted });

	const title = [
		`${info.label}${isConfirmed ? ' (confirmed)' : ' (proposed from metadata, not confirmed)'}`,
		`${info.positionLabel}${info.code !== 'unknown' ? ` · IPTC ${info.code}` : ''}`,
		signed ? `Signed by ${SIGNED_BY_LABELS[signed] || signed}${signer ? `: ${signer}` : ''}` : '',
		fromArchive ? 'From an archive' : '',
		reason ? `Note: ${reason}` : ''
	].filter(Boolean).join('\n');

	return (
		// Unconfirmed: dashed outline and dimmed, so a proposal reads as "probably"
		// at a glance; confirmed: solid and full strength.
		<span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap border ${isConfirmed ? '' : 'border-dashed opacity-70 italic'} ${className}`}
			style={pillStyle(info.position)} title={title}>
			{info.short}
			{signed && <span aria-label="signed">✓</span>}
			{fromArchive && <span className="opacity-80 font-normal">· archive</span>}
			{!isConfirmed && <span className="opacity-80">?</span>}
			{reason && <span className="opacity-80" aria-label="has a note">✎</span>}
		</span>
	);
}

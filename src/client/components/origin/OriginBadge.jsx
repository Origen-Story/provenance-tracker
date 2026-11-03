import { originClassInfo } from './originClasses.js';

// Small pill used on list cards and in relationship rows.
export default function OriginBadge({ originClass, confirmed, className = '' }) {
	const info = originClassInfo(originClass);
	return (
		// Unconfirmed: dashed outline and dimmed, so a proposal reads as "probably"
		// at a glance; confirmed: solid and full strength.
		<span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${info.color} ${confirmed ? 'border' : 'border border-dashed opacity-70 italic'} ${className}`}
			title={`${info.label}${confirmed ? ' (confirmed)' : ' (proposed from metadata, not confirmed)'}`}>
			{info.short}
			{!confirmed && <span className="opacity-80">?</span>}
		</span>
	);
}

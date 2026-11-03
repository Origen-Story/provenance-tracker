import { originClassInfo } from './originClasses.js';

// Small pill used on list cards and in relationship rows.
export default function OriginBadge({ originClass, confirmed, className = '' }) {
	const info = originClassInfo(originClass);
	return (
		<span className={`inline-flex items-center gap-1 border rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${info.color} ${className}`}
			title={`${info.label}${confirmed ? ' (confirmed)' : ' (proposed, not yet confirmed)'}`}>
			{info.short}
			{!confirmed && <span className="opacity-70">?</span>}
		</span>
	);
}

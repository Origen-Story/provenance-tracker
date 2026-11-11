import { ORIGIN_CLASS_DEFS, originClassDef } from './originClasses.js';

const PICKER = ORIGIN_CLASS_DEFS.filter(c => c.picker);
const MORE = ORIGIN_CLASS_DEFS.filter(c => !c.picker);

/**
 * The class dropdown: the short list first, the rarer IPTC terms under
 * "More terms". `placeholder` adds an empty first option for a control that
 * starts with nothing chosen.
 */
export function ClassSelect({ value, onChange, placeholder = null, size = 'md', id }) {
	const cls = size === 'sm'
		? 'bg-card-bg border border-border rounded px-1 py-0.5 text-[11px] text-text-primary focus:outline-none focus:border-accent'
		: 'flex-1 min-w-0 bg-card-bg border border-border rounded-md px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent';
	return (
		<select id={id} value={value} onChange={e => onChange(e.target.value)} className={cls}>
			{placeholder !== null && <option value="">{placeholder}</option>}
			{PICKER.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
			<optgroup label="More terms">
				{MORE.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
			</optgroup>
		</select>
	);
}

/**
 * The AI-assisted flag. Only offered for digital work with no AI in its
 * pixels, where it moves the asset to the AI-assisted position.
 */
export function AiAssistedCheck({ originClass, checked, onChange, compact = false }) {
	if (originClassDef(originClass).position !== 'digital') return null;
	return (
		<label className={`flex items-start gap-1.5 cursor-pointer text-text-secondary ${compact ? 'text-[10px]' : 'text-[11px]'}`}
			title="For an asset where an AI model wrote the instructions (code, a design file) and an ordinary program made the pixels. Not for general help along the way.">
			<input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} className="mt-0.5" />
			<span>An AI wrote the code or design that made this (AI-assisted)</span>
		</label>
	);
}

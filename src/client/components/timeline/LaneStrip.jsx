import { originClassInfo, intervalBackground, MIXED } from '../origin/originClasses.js';

export function fmtClock(seconds) {
	if (seconds == null || Number.isNaN(seconds)) return '0:00.0';
	const m = Math.floor(seconds / 60);
	const s = seconds - m * 60;
	return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

// "V2 Lower third (Unknown) over V1 Clip 01 (Captured ✓)"
export function describeLayers(layers, prefix) {
	return (layers || []).map(l => `${prefix}${l.trackIndex} ${l.name || 'clip'} (${originClassInfo(l.originClass).short})`).join(' over ');
}

export function describeInterval(iv, prefix) {
	if (!iv || iv.state === 'gap') return 'Nothing';
	if (iv.state === 'single') return originClassInfo(iv.classes[0]).label;
	return `${MIXED.label}: ${iv.classes.map(c => originClassInfo(c).short).join(' + ')}`;
}

function Interval({ iv, durationSeconds, prefix, onSeek }) {
	const left = (iv.startSeconds / durationSeconds) * 100;
	const width = ((iv.endSeconds - iv.startSeconds) / durationSeconds) * 100;
	const title = `${fmtClock(iv.startSeconds)}–${fmtClock(iv.endSeconds)}  ${describeInterval(iv, prefix)}${iv.layers?.length ? `\n${describeLayers(iv.layers, prefix)}` : ''}`;
	return (
		<div className={`absolute top-0 h-full ${iv.state === 'gap' ? 'bg-transparent' : ''} ${iv.state !== 'gap' ? 'border-r border-black/30' : ''}`}
			style={{ left: `${left}%`, width: `${width}%`, background: iv.state === 'gap' ? undefined : intervalBackground(iv.classes) }}
			title={title}
			onClick={e => { if (onSeek) { e.stopPropagation(); onSeek(iv.startSeconds); } }} />
	);
}

function Playhead({ currentTime, durationSeconds }) {
	if (currentTime == null || !durationSeconds) return null;
	const left = Math.min(100, Math.max(0, (currentTime / durationSeconds) * 100));
	return <div className="absolute top-0 h-full w-px bg-white pointer-events-none" style={{ left: `${left}%` }} />;
}

/**
 * One composed lane (picture or audio) of an output as a strip across its
 * duration. Click seeks; the playhead follows the player. Expanded, the lane
 * splits into its real tracks.
 */
export default function LaneStrip({ title, lane, durationSeconds, prefix = 'V', currentTime = null, onSeek, expanded = false, onToggle, height = 'h-7' }) {
	if (!lane || !durationSeconds) return null;
	const seek = (e) => {
		if (!onSeek) return;
		const r = e.currentTarget.getBoundingClientRect();
		onSeek(((e.clientX - r.left) / r.width) * durationSeconds);
	};
	const tracks = lane.tracks || [];
	return (
		<div className="space-y-1">
			<div className="flex items-center justify-between text-[11px] text-text-secondary">
				<span className="text-text-primary font-medium">{title}</span>
				{onToggle && tracks.length > 0 && (
					<button type="button" onClick={onToggle} className="hover:text-text-primary">
						{expanded ? 'collapse' : `expand ${tracks.length} track${tracks.length === 1 ? '' : 's'}`}
					</button>
				)}
			</div>
			<div className={`relative ${height} rounded border border-border bg-card-hover overflow-hidden ${onSeek ? 'cursor-pointer' : ''}`} onClick={seek}>
				{lane.intervals.map((iv, i) => <Interval key={i} iv={iv} durationSeconds={durationSeconds} prefix={prefix} onSeek={onSeek} />)}
				<Playhead currentTime={currentTime} durationSeconds={durationSeconds} />
			</div>
			{expanded && tracks.map(t => (
				<div key={t.index} className="flex items-center gap-2">
					<span className="w-7 text-[10px] text-text-secondary text-right shrink-0">{prefix}{t.index}</span>
					<div className={`relative h-4 flex-1 rounded border border-border/60 bg-card-hover overflow-hidden ${onSeek ? 'cursor-pointer' : ''}`} onClick={seek}>
						{t.clips.map((c, i) => (
							<div key={i} className="absolute top-0 h-full border-r border-black/30"
								style={{ left: `${(c.startSeconds / durationSeconds) * 100}%`, width: `${((c.endSeconds - c.startSeconds) / durationSeconds) * 100}%`, background: intervalBackground([c.originClass]) }}
								title={`${fmtClock(c.startSeconds)}–${fmtClock(c.endSeconds)}  ${c.name || 'clip'}: ${originClassInfo(c.originClass).label}${c.matched ? '' : ' (no matched asset)'}`}
								onClick={e => { if (onSeek) { e.stopPropagation(); onSeek(c.startSeconds); } }} />
						))}
						<Playhead currentTime={currentTime} durationSeconds={durationSeconds} />
					</div>
				</div>
			))}
		</div>
	);
}

import { originInfo, positionDef, intervalBackground, MIXED } from '../origin/originClasses.js';

export function fmtClock(seconds) {
	if (seconds == null || Number.isNaN(seconds)) return '0:00.0';
	const m = Math.floor(seconds / 60);
	const s = seconds - m * 60;
	return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

// "V2 Lower third (Human-made) over V1 Clip 01 (Captured)"
export function describeLayers(layers, prefix) {
	return (layers || []).map(l => `${prefix}${l.trackIndex} ${l.name || 'clip'} (${originInfo(l).short})`).join(' over ');
}

export function describeInterval(iv) {
	if (!iv || iv.state === 'gap') return 'Nothing';
	// One position: name the class when there is only one, else the position.
	if (iv.state === 'single') return iv.classes?.length === 1 && iv.layers?.length ? originInfo(iv.layers[0]).label : positionDef(iv.positions[0]).label;
	return `${MIXED.label}: ${iv.positions.map(p => positionDef(p).label).join(' + ')}`;
}

// Width of the label column to the left of every strip. The lane and its
// tracks share it, so their strips have the same left edge and width and a
// playhead at one time is one vertical line down the whole stack.
export const GUTTER = 'w-20 shrink-0';

function Interval({ iv, durationSeconds, prefix, onSeek }) {
	const left = (iv.startSeconds / durationSeconds) * 100;
	const width = ((iv.endSeconds - iv.startSeconds) / durationSeconds) * 100;
	const title = `${fmtClock(iv.startSeconds)}–${fmtClock(iv.endSeconds)}  ${describeInterval(iv)}${iv.layers?.length ? `\n${describeLayers(iv.layers, prefix)}` : ''}`;
	return (
		<div className={`absolute top-0 h-full ${iv.state !== 'gap' ? 'border-r border-black/30' : ''}`}
			style={{ left: `${left}%`, width: `${width}%`, background: iv.state === 'gap' ? undefined : intervalBackground(iv.positions) }}
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
 * splits into its real tracks, each strip aligned under the lane's own.
 * `gutter={false}` drops the label column for compact uses (list cards).
 */
export default function LaneStrip({ title, lane, durationSeconds, prefix = 'V', currentTime = null, onSeek, expanded = false, onToggle, height = 'h-7', gutter = true }) {
	if (!lane || !durationSeconds) return null;
	const seek = (e) => {
		if (!onSeek) return;
		const r = e.currentTarget.getBoundingClientRect();
		onSeek(((e.clientX - r.left) / r.width) * durationSeconds);
	};
	const tracks = lane.tracks || [];
	const canExpand = !!onToggle && tracks.length > 0;
	return (
		<div className="space-y-1">
			<div className="flex items-center gap-2">
				{gutter && (
					<div className={GUTTER}>
						{canExpand ? (
							<button type="button" onClick={onToggle} aria-expanded={expanded}
								title={expanded ? 'Hide the tracks' : `Show the ${tracks.length} track${tracks.length === 1 ? '' : 's'} behind this lane`}
								className="flex items-center gap-1 text-[11px] font-medium text-text-primary hover:text-accent">
								<span className="inline-block w-2.5 text-text-secondary">{expanded ? '▾' : '▸'}</span>
								{title}
							</button>
						) : (
							<span className="text-[11px] font-medium text-text-primary">{title}</span>
						)}
					</div>
				)}
				<div className={`relative ${height} flex-1 min-w-0 rounded border border-border bg-card-hover overflow-hidden ${onSeek ? 'cursor-pointer' : ''}`} onClick={seek}>
					{lane.intervals.map((iv, i) => <Interval key={i} iv={iv} durationSeconds={durationSeconds} prefix={prefix} onSeek={onSeek} />)}
					<Playhead currentTime={currentTime} durationSeconds={durationSeconds} />
				</div>
			</div>
			{expanded && tracks.map(t => (
				<div key={t.index} className="flex items-center gap-2">
					{gutter && <span className={`${GUTTER} pl-3.5 text-[10px] text-text-secondary`}>{prefix}{t.index}</span>}
					<div className={`relative h-4 flex-1 min-w-0 rounded border border-border bg-card-hover overflow-hidden ${onSeek ? 'cursor-pointer' : ''}`} onClick={seek}>
						{t.clips.map((c, i) => (
							<div key={i} className="absolute top-0 h-full border-r border-black/30"
								style={{ left: `${(c.startSeconds / durationSeconds) * 100}%`, width: `${((c.endSeconds - c.startSeconds) / durationSeconds) * 100}%`, background: intervalBackground([c.position]) }}
								title={`${fmtClock(c.startSeconds)}–${fmtClock(c.endSeconds)}  ${c.name || 'clip'}: ${originInfo(c).label}${c.matched ? '' : ' (no matched asset)'}`}
								onClick={e => { if (onSeek) { e.stopPropagation(); onSeek(c.startSeconds); } }} />
						))}
						<Playhead currentTime={currentTime} durationSeconds={durationSeconds} />
					</div>
				</div>
			))}
		</div>
	);
}

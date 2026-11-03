import { useRef, useState } from 'react';
import LaneStrip, { fmtClock, describeInterval, describeLayers } from './LaneStrip.jsx';
import { originClassInfo, intervalBackground, MIXED, GAP } from '../origin/originClasses.js';

function intervalAt(lane, seconds) {
	if (!lane || seconds == null) return null;
	const ivs = lane.intervals || [];
	for (const iv of ivs) if (seconds >= iv.startSeconds && seconds < iv.endSeconds) return iv;
	return ivs.length && seconds >= ivs[ivs.length - 1].endSeconds ? ivs[ivs.length - 1] : null;
}

function Swatch({ classes }) {
	return <span className="inline-block w-3 h-3 rounded-sm border border-black/30 align-middle" style={{ background: intervalBackground(classes) }} />;
}

// Frames and percentages for one lane, derived from the same intervals as
// the strip. Mixed stretches are listed with what was playing together.
function LaneNumbers({ lane, title }) {
	if (!lane) return null;
	const rows = Object.entries(lane.byClass || {}).sort((a, b) => b[1].frames - a[1].frames);
	const combos = Object.entries(lane.mixed?.combos || {}).sort((a, b) => b[1].frames - a[1].frames);
	const cell = (v) => `${v.seconds != null ? `${v.seconds.toFixed(1)} s` : `${v.frames} f`}`;
	return (
		<table className="w-full text-xs">
			<thead><tr className="text-left text-text-secondary"><th className="pb-1 font-medium" colSpan={2}>{title}</th><th className="pb-1 text-right font-medium">time</th><th className="pb-1 text-right font-medium w-14">share</th></tr></thead>
			<tbody>
				{rows.map(([cls, v]) => (
					<tr key={cls} className="border-t border-border/60">
						<td className="py-1 w-5"><Swatch classes={[cls]} /></td>
						<td className="py-1 text-text-secondary">{originClassInfo(cls).label}</td>
						<td className="py-1 text-right text-text-primary">{cell(v)}</td>
						<td className="py-1 text-right text-text-primary font-medium">{v.percent.toFixed(1)}%</td>
					</tr>
				))}
				{lane.mixed?.frames > 0 && (
					<tr className="border-t border-border/60">
						<td className="py-1 w-5"><Swatch classes={combos[0]?.[0].split('+') || []} /></td>
						<td className="py-1 text-text-secondary">
							{MIXED.label}
							<div className="text-[10px] opacity-80">{combos.map(([k, v]) => `${k.split('+').map(c => originClassInfo(c).short).join(' + ')} ${v.percent.toFixed(1)}%`).join(' · ')}</div>
						</td>
						<td className="py-1 text-right text-text-primary align-top">{cell(lane.mixed)}</td>
						<td className="py-1 text-right text-text-primary font-medium align-top">{lane.mixed.percent.toFixed(1)}%</td>
					</tr>
				)}
				{lane.gap?.frames > 0 && (
					<tr className="border-t border-border/60 text-text-secondary">
						<td className="py-1 w-5"><span className="inline-block w-3 h-3 rounded-sm border border-border align-middle" /></td>
						<td className="py-1">{GAP.label}</td>
						<td className="py-1 text-right">{cell(lane.gap)}</td>
						<td className="py-1 text-right">{lane.gap.percent.toFixed(1)}%</td>
					</tr>
				)}
			</tbody>
		</table>
	);
}

function Readout({ label, lane, prefix, seconds }) {
	const iv = intervalAt(lane, seconds);
	if (!iv) return null;
	return (
		<div className="flex items-start gap-2 text-xs">
			<span className="text-text-secondary w-12 shrink-0">{label}</span>
			<Swatch classes={iv.classes} />
			<span className="text-text-primary">{describeInterval(iv, prefix)}</span>
			{iv.layers?.length > 0 && <span className="text-text-secondary truncate" title={describeLayers(iv.layers, prefix)}>{describeLayers(iv.layers, prefix)}</span>}
		</div>
	);
}

/**
 * The output's own file playing above its two composed lanes (decision D10).
 * The readout says what is on screen and audible at the playhead; clicking a
 * lane seeks the player. Expanding a lane shows its real tracks.
 */
export default function Composition({ asset, composition }) {
	const mediaRef = useRef(null);
	const [t, setT] = useState(0);
	const [open, setOpen] = useState({ picture: false, audio: false });
	if (!composition) return null;
	const dur = composition.durationSeconds || asset?.durationSeconds || 0;
	const isVideo = asset?.mimeType?.startsWith('video/');
	const isAudio = asset?.mimeType?.startsWith('audio/');
	const src = asset?.filePath ? `/api/preview?path=${encodeURIComponent(asset.filePath)}` : null;
	const seek = (s) => { const m = mediaRef.current; if (m) { m.currentTime = Math.max(0, Math.min(s, dur)); setT(m.currentTime); } };
	const onTime = (e) => setT(e.currentTarget.currentTime);

	return (
		<div className="bg-card-bg border border-border rounded-lg p-4 space-y-4">
			{src && isVideo && <video ref={mediaRef} src={src} controls preload="metadata" onTimeUpdate={onTime} onSeeked={onTime} className="w-full max-h-[28rem] bg-black rounded" />}
			{src && isAudio && <audio ref={mediaRef} src={src} controls preload="metadata" onTimeUpdate={onTime} onSeeked={onTime} className="w-full" />}
			<div className="flex items-center justify-between text-[11px] text-text-secondary">
				<span>{fmtClock(t)} / {fmtClock(dur)}</span>
				<span>Click a lane to jump there</span>
			</div>
			<LaneStrip title="Picture" lane={composition.picture} durationSeconds={dur} prefix="V" currentTime={t} onSeek={seek} expanded={open.picture} onToggle={() => setOpen(o => ({ ...o, picture: !o.picture }))} />
			<LaneStrip title="Audio" lane={composition.audio} durationSeconds={dur} prefix="A" currentTime={t} onSeek={seek} expanded={open.audio} onToggle={() => setOpen(o => ({ ...o, audio: !o.audio }))} />
			<div className="space-y-1 border-t border-border/60 pt-3">
				<Readout label="Picture" lane={composition.picture} prefix="V" seconds={t} />
				<Readout label="Audio" lane={composition.audio} prefix="A" seconds={t} />
			</div>
			<div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-border/60 pt-3">
				<LaneNumbers lane={composition.picture} title="Picture, share of the sequence" />
				<LaneNumbers lane={composition.audio} title="Audio, share of the sequence" />
			</div>
			<p className="text-[11px] text-text-secondary">
				Legend: {['captured_signed', 'captured', 'archival', 'archival_enhanced', 'generated', 'composited', 'unknown'].map(c => <span key={c} className="mr-2 whitespace-nowrap"><Swatch classes={[c]} /> {originClassInfo(c).label}</span>)}
				<span className="whitespace-nowrap"><Swatch classes={['generated', 'captured']} /> {MIXED.label}</span>
			</p>
		</div>
	);
}

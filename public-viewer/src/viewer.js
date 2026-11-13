// The public viewer: one film, how it was made, and how to check that.
//
//   import { mountViewer } from './src/viewer.js';
//   mountViewer(document.querySelector('#film'), {
//     exportUrl: '/credentials/film.provenance.json',   // or `data: <export object>`
//     video: { youtubeId: 'abc123' },                   // or { src, poster }, or omit for a clock
//     download: { url: 'https://.../film.signed.v1.mp4' },
//     theme: 'dark'                                     // or 'light'
//   });
//
// Everything shown comes from the public export, which may come from anyone:
// text is only ever set as text (no innerHTML), and links are only the ones
// the page passes in.

import { SPECTRUM, clock, sectionAt, laneShares, laneSentence, sectionDetail, ingredientsBySpectrum, ingredientProvenance, signatureVerdict, groupHash, formatBytes, assertViewable, aiShare } from './model.js';
import { videoPlayer, youtubePlayer, clockPlayer } from './players.js';

const VERIFY_URL = 'https://contentcredentials.org/verify';
const LANES = [
	{ key: 'picture', label: 'Picture', kind: 'picture' },
	{ key: 'audio', label: 'Sound', kind: 'audio' }
];

function h(tag, props, ...children) {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(props || {})) {
		if (v == null || v === false) continue;
		if (k === 'class') el.className = v;
		else if (k === 'style') Object.assign(el.style, v);
		else if (k === 'dataset') Object.assign(el.dataset, v);
		else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
		else el.setAttribute(k, v === true ? '' : String(v));
	}
	for (const c of children.flat(Infinity)) {
		if (c == null || c === false) continue;
		el.append(c instanceof Node ? c : document.createTextNode(String(c)));
	}
	return el;
}

const swatch = (id) => h('span', { class: `ptv-swatch ptv-pos-${id}`, 'aria-hidden': 'true' });

function sectionBackground(positions) {
	const list = [...new Set(positions)];
	if (!list.length) return 'transparent';
	if (list.length === 1) {
		return list[0] === 'unknown'
			? 'repeating-linear-gradient(45deg, var(--pt-origin-unknown) 0 2px, transparent 2px 6px)'
			: `var(--pt-origin-${list[0]})`;
	}
	const step = 6;
	return `repeating-linear-gradient(135deg, ${list.map((p, i) => `var(--pt-origin-${p}) ${i * step}px ${(i + 1) * step}px`).join(', ')})`;
}

function rulerStep(duration) {
	if (duration <= 90) return 15;
	if (duration <= 300) return 30;
	if (duration <= 900) return 60;
	return 300;
}

export async function mountViewer(root, opts = {}) {
	root.replaceChildren();
	root.classList.add('ptv');
	root.dataset.theme = opts.theme || 'dark';
	let exp;
	try {
		exp = assertViewable(opts.data || await fetch(opts.exportUrl).then(r => {
			if (!r.ok) throw new Error(`The provenance record could not be loaded (${r.status}).`);
			return r.json();
		}));
	} catch (err) {
		root.append(h('p', { class: 'ptv-error', role: 'alert' }, err.message));
		return null;
	}
	return new Viewer(root, exp, opts);
}

class Viewer {
	constructor(root, exp, opts) {
		this.root = root;
		this.exp = exp;
		this.opts = opts;
		this.duration = exp.film.durationSeconds || Math.max(...LANES.map(l => exp.composition[l.key]?.intervals.at(-1)?.end || 0));
		this.current = { picture: -2, audio: -2 };
		this.pinned = false;
		this.render();
		this.player = this.makePlayer();
		this.player.ready.then(() => this.loop()).catch(err => this.stage.append(h('p', { class: 'ptv-error' }, err.message)));
	}

	makePlayer() {
		const v = this.opts.video || {};
		const title = this.exp.film.title;
		if (v.youtubeId) return youtubePlayer(this.stage, { videoId: v.youtubeId, title });
		if (v.src) return videoPlayer(this.stage, { src: v.src, poster: v.poster, title });
		this.stage.classList.add('ptv-stage-clock');
		return clockPlayer(this.stage, { duration: this.duration });
	}

	loop() {
		let lastT = -1;
		const frame = () => {
			const t = this.player.time();
			if (t !== lastT) { lastT = t; this.showTime(t); }
			this.raf = requestAnimationFrame(frame);
		};
		frame();
	}

	seek(t, announce = false) {
		this.player.seek(t);
		this.showTime(t);
		if (announce) this.announce(t);
	}

	// ---- rendering ---------------------------------------------------------

	render() {
		const { exp } = this;
		const verdict = signatureVerdict(exp.signature);
		this.live = h('p', { class: 'ptv-sr', 'aria-live': 'polite' });
		this.stage = h('div', { class: 'ptv-stage' });
		this.root.append(
			h('header', { class: 'ptv-head' },
				h('p', { class: 'ptv-kicker' }, 'Content Credentials · How this film was made'),
				h('h2', { class: 'ptv-title' }, exp.film.title),
				h('p', { class: 'ptv-lede' }, laneSentence(exp.composition.picture, 'picture'), ' ', laneSentence(exp.composition.audio, 'audio')),
				h('div', { class: 'ptv-headline-stats' },
					this.stat(`${aiShare(exp.composition.picture)}%`, 'of the picture involves generative AI'),
					this.stat(`${aiShare(exp.composition.audio)}%`, 'of the sound involves generative AI'),
					this.stat(String(exp.ingredients.length), exp.ingredients.length === 1 ? 'tracked source' : 'tracked sources')),
				h('a', { class: `ptv-verdict ptv-tone-${verdict.tone}`, href: '#ptv-verify' }, h('span', { class: 'ptv-dot', 'aria-hidden': 'true' }), verdict.headline)
			),
			this.stage,
			this.renderStrip(),
			this.renderNow(),
			this.renderSpectrum(),
			this.renderStatement(),
			this.renderIngredients(),
			this.renderVerify(),
			this.live
		);
	}

	stat(value, label) {
		return h('div', { class: 'ptv-stat' }, h('span', { class: 'ptv-stat-value' }, value), h('span', { class: 'ptv-stat-label' }, label));
	}

	renderStrip() {
		const { exp, duration } = this;
		this.playheads = [];
		this.sectionEls = {};
		const tip = h('div', { class: 'ptv-tip', role: 'presentation', hidden: true });
		const rows = LANES.map(lane => {
			const intervals = exp.composition[lane.key]?.intervals || [];
			const track = h('div', {
				class: 'ptv-track',
				tabindex: 0,
				role: 'group',
				'aria-label': `${lane.label} timeline, ${intervals.length} sections. Left and right arrows move between sections.`,
				onkeydown: (e) => this.keyNav(e, lane.key),
				onclick: (e) => {
					const r = track.getBoundingClientRect();
					this.seek(((e.clientX - r.left) / r.width) * duration, true);
				},
				onpointermove: (e) => this.hover(e, track, lane, tip),
				onpointerleave: () => { tip.hidden = true; }
			});
			this.sectionEls[lane.key] = intervals.map(s => {
				const el = h('div', {
					class: 'ptv-sec',
					dataset: { has: s.positions.join(' ') },
					style: { left: `${(s.start / duration) * 100}%`, width: `${((s.end - s.start) / duration) * 100}%`, background: sectionBackground(s.positions) }
				});
				track.append(el);
				return el;
			});
			const head = h('div', { class: 'ptv-playhead', 'aria-hidden': 'true' });
			this.playheads.push(head);
			track.append(head);
			return h('div', { class: 'ptv-lane' }, h('span', { class: 'ptv-lane-label' }, lane.label), track);
		});
		const step = rulerStep(duration);
		const ticks = [];
		for (let t = 0; t <= duration + 0.01; t += step) ticks.push(h('span', { class: 'ptv-tick', style: { left: `${(t / duration) * 100}%` } }, clock(t)));
		return h('section', { class: 'ptv-strip', 'aria-label': 'Timeline of origins' },
			rows,
			h('div', { class: 'ptv-ruler', 'aria-hidden': 'true' }, h('span', { class: 'ptv-lane-label' }), h('div', { class: 'ptv-ruler-track' }, ticks)),
			tip);
	}

	hover(e, track, lane, tip) {
		const r = track.getBoundingClientRect();
		const t = ((e.clientX - r.left) / r.width) * this.duration;
		const intervals = this.exp.composition[lane.key].intervals;
		const d = sectionDetail(intervals[sectionAt(intervals, t)], this.exp);
		if (!d) { tip.hidden = true; return; }
		const names = d.ingredients.map(i => i.title);
		if (d.untracked) names.push(d.untracked === 1 ? 'an untracked clip' : `${d.untracked} untracked clips`);
		tip.replaceChildren(
			h('span', { class: 'ptv-tip-time' }, clock(t)),
			h('span', { class: 'ptv-tip-pos' }, d.positions.length ? d.positions.map(p => p.label).join(' + ') : 'Nothing'),
			names.length ? h('span', { class: 'ptv-tip-names' }, names.join(', ')) : null
		);
		tip.hidden = false;
		const strip = track.closest('.ptv-strip').getBoundingClientRect();
		tip.style.left = `${Math.min(Math.max(e.clientX - strip.left, 90), strip.width - 90)}px`;
		tip.style.top = `${r.top - strip.top}px`;
	}

	keyNav(e, laneKey) {
		const intervals = this.exp.composition[laneKey].intervals;
		const i = sectionAt(intervals, this.player.time());
		let to = null;
		if (e.key === 'ArrowRight') to = Math.min(intervals.length - 1, i + 1);
		else if (e.key === 'ArrowLeft') to = Math.max(0, i - 1);
		else if (e.key === 'Home') to = 0;
		else if (e.key === 'End') to = intervals.length - 1;
		if (to == null) return;
		e.preventDefault();
		this.seek(intervals[to].start + 0.001, true);
	}

	renderNow() {
		this.nowCols = {};
		const cols = LANES.map(lane => {
			const body = h('div', { class: 'ptv-now-body' });
			this.nowCols[lane.key] = body;
			return h('div', { class: 'ptv-now-col' }, h('h3', { class: 'ptv-now-lane' }, lane.label), body);
		});
		this.nowClock = h('span', { class: 'ptv-now-clock' }, '0:00');
		return h('section', { class: 'ptv-now', 'aria-label': 'Playing now' },
			h('div', { class: 'ptv-now-head' }, h('span', { class: 'ptv-now-title' }, 'Playing now'), this.nowClock),
			h('div', { class: 'ptv-now-cols' }, cols));
	}

	showTime(t) {
		const pct = this.duration ? Math.min(100, Math.max(0, (t / this.duration) * 100)) : 0;
		for (const p of this.playheads) p.style.left = `${pct}%`;
		this.nowClock.textContent = `${clock(t)} / ${clock(this.duration)}`;
		for (const lane of LANES) {
			const intervals = this.exp.composition[lane.key]?.intervals || [];
			const i = sectionAt(intervals, t);
			if (i === this.current[lane.key]) continue;
			this.sectionEls[lane.key][this.current[lane.key]]?.classList.remove('ptv-on');
			this.sectionEls[lane.key][i]?.classList.add('ptv-on');
			this.current[lane.key] = i;
			this.nowCols[lane.key].replaceChildren(this.nowContent(sectionDetail(intervals[i], this.exp), lane.kind));
		}
	}

	nowContent(d, kind) {
		if (!d || (!d.positions.length && !d.ingredients.length)) return h('p', { class: 'ptv-muted' }, kind === 'audio' ? 'Silence.' : 'Nothing on screen.');
		return h('div', {},
			h('p', { class: 'ptv-now-pos' }, d.positions.map((p, n) => [n ? h('span', { class: 'ptv-plus' }, ' + ') : null, swatch(p.id), p.label])),
			h('ul', { class: 'ptv-now-list' },
				d.ingredients.map(i => h('li', {},
					h('span', { class: 'ptv-now-name' }, i.title),
					h('span', { class: 'ptv-now-class' }, i.classLabel, i.aiAssisted ? ', AI-assisted' : ''),
					i.note ? h('span', { class: 'ptv-now-note' }, i.note) : null)),
				d.untracked ? h('li', { class: 'ptv-muted' }, d.untracked === 1 ? 'Plus one clip not tied to a tracked source (such as a title made in the editor).' : `Plus ${d.untracked} clips not tied to a tracked source.`) : null));
	}

	announce(t) {
		const parts = LANES.map(lane => {
			const intervals = this.exp.composition[lane.key]?.intervals || [];
			const d = sectionDetail(intervals[sectionAt(intervals, t)], this.exp);
			return `${lane.label}: ${d?.positions.map(p => p.label).join(' and ') || 'nothing'}${d?.ingredients.length ? ` (${d.ingredients.map(i => i.title).join(', ')})` : ''}`;
		});
		this.live.textContent = `${clock(t)}. ${parts.join('. ')}.`;
	}

	renderSpectrum() {
		const { exp } = this;
		const vocab = new Map(exp.vocabulary.positions.map(p => [p.id, p]));
		const shares = Object.fromEntries(LANES.map(l => [l.key, new Map(laneShares(exp.composition[l.key]).map(r => [r.id, r]))]));
		const used = [...SPECTRUM, 'mixed'].filter(id => LANES.some(l => shares[l.key].get(id)?.rounded > 0));
		const focus = (id) => { if (id) this.root.dataset.focus = id; else delete this.root.dataset.focus; };
		const bars = LANES.map(l => h('div', { class: 'ptv-bar-row' },
			h('span', { class: 'ptv-lane-label' }, l.label),
			h('div', { class: 'ptv-bar', role: 'img', 'aria-label': laneSentence(exp.composition[l.key], l.kind) },
				[...shares[l.key].values()].filter(r => r.percent > 0 && r.id !== 'gap').map(r => h('span', {
					class: 'ptv-bar-seg',
					style: { flexGrow: r.percent, background: r.id === 'mixed' ? 'repeating-linear-gradient(135deg, var(--ptv-muted) 0 2px, transparent 2px 6px)' : sectionBackground([r.id]) }
				})))));
		return h('section', { class: 'ptv-spectrum', 'aria-labelledby': 'ptv-spectrum-h' },
			h('h3', { class: 'ptv-h', id: 'ptv-spectrum-h' }, 'The spectrum'),
			h('p', { class: 'ptv-muted ptv-small' }, 'Every moment is coloured by how much generative AI is in it, from camera-captured to fully synthetic. Hover a row to find it on the timeline.'),
			bars,
			h('ul', { class: 'ptv-legend' }, used.map(id => {
				const p = vocab.get(id) || { label: 'Mixed', desc: 'Two or more kinds at the same moment, such as a title over camera footage or AI music under a recorded voice.' };
				return h('li', {
					class: 'ptv-legend-row', tabindex: 0,
					onpointerenter: () => focus(id), onpointerleave: () => focus(null), onfocus: () => focus(id), onblur: () => focus(null)
				},
				id === 'mixed' ? h('span', { class: 'ptv-swatch ptv-swatch-mixed', 'aria-hidden': 'true' }) : swatch(id),
				h('span', { class: 'ptv-legend-text' }, h('strong', {}, p.long || p.label), h('span', { class: 'ptv-muted' }, p.desc)),
				h('span', { class: 'ptv-legend-nums' }, LANES.map(l => {
					const r = shares[l.key].get(id);
					return h('span', { class: 'ptv-legend-num' }, h('span', { class: 'ptv-num' }, r?.rounded ? `${r.rounded}%` : '–'), h('span', { class: 'ptv-num-label' }, l.label.toLowerCase()));
				})));
			})));
	}

	renderStatement() {
		const s = this.exp.statement;
		if (!s.text) return null;
		const date = s.statedAt ? new Date(s.statedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
		const who = [s.author, s.organization].filter(Boolean).join(', ');
		return h('section', { class: 'ptv-statement', 'aria-labelledby': 'ptv-statement-h' },
			h('h3', { class: 'ptv-h', id: 'ptv-statement-h' }, 'The creator’s statement'),
			h('blockquote', { class: 'ptv-quote' }, s.text.split(/\n{2,}/).map(par => h('p', {}, par))),
			h('p', { class: 'ptv-cite' }, who ? `${who}` : 'The creator', date ? ` · signed ${date}` : '', s.editedWith ? ` · edited in ${s.editedWith}` : ''));
	}

	renderIngredients() {
		const { exp } = this;
		const vocab = new Map(exp.vocabulary.positions.map(p => [p.id, p]));
		const classes = exp.vocabulary.classes;
		const groups = ingredientsBySpectrum(exp);
		const extras = [];
		if (exp.editorMadeClips) extras.push(`${exp.editorMadeClips} title${exp.editorMadeClips === 1 ? '' : 's'} or graphic${exp.editorMadeClips === 1 ? '' : 's'} made in the editor, counted as made on a computer without AI.`);
		if (exp.untracked.length) extras.push(`${exp.untracked.length} clip${exp.untracked.length === 1 ? '' : 's'} not tied to a tracked source: ${exp.untracked.map(u => `${u.track} at ${clock(u.startSeconds)}–${clock(u.endSeconds)}`).join('; ')}.`);
		return h('section', { class: 'ptv-ingredients', 'aria-labelledby': 'ptv-ingredients-h' },
			h('h3', { class: 'ptv-h', id: 'ptv-ingredients-h' }, 'What went into it'),
			groups.map(g => h('div', { class: 'ptv-group' },
				h('h4', { class: 'ptv-group-h' }, swatch(g.id), vocab.get(g.id)?.long || g.id, h('span', { class: 'ptv-muted' }, ` · ${g.ingredients.length}`)),
				h('ul', { class: 'ptv-ing-list' }, g.ingredients.map(i => h('li', { class: 'ptv-ing' },
					h('div', { class: 'ptv-ing-main' },
						h('span', { class: 'ptv-ing-title' }, i.title),
						h('span', { class: 'ptv-ing-class' }, classes[i.originClass]?.label || i.originClass, i.aiAssisted ? ', AI-assisted' : ''),
						h('span', { class: 'ptv-ing-time' }, [i.pictureSeconds ? `${clock(i.pictureSeconds)} on screen` : null, i.audioSeconds ? `${clock(i.audioSeconds)} heard` : null].filter(Boolean).join(' · '))),
					h('p', { class: `ptv-ing-prov${i.credentialsInSignedFile === 'present' ? ' ptv-has-cr' : ''}` }, ingredientProvenance(i)),
					i.note ? h('p', { class: 'ptv-ing-note' }, i.note) : null,
					h('details', { class: 'ptv-more' },
						h('summary', {}, 'Details'),
						h('dl', {},
							h('dt', {}, 'File'), h('dd', { class: 'ptv-mono' }, i.fileName),
							h('dt', {}, 'Source type'), h('dd', {}, i.digitalSourceType ? h('a', { href: i.digitalSourceType, rel: 'noopener', target: '_blank' }, i.originClass) : i.originClass),
							h('dt', {}, 'Class set by'), h('dd', {}, i.classSetBy === 'creator' ? 'the creator' : 'the tracker, from the file’s metadata'),
							i.classClaimedByFile && i.classClaimedByFile !== i.originClass ? [h('dt', {}, 'The file itself says'), h('dd', {}, classes[i.classClaimedByFile]?.label || i.classClaimedByFile)] : null,
							h('dt', {}, 'Manifest ref'), h('dd', { class: 'ptv-mono' }, i.ref)))))))),
			extras.length ? h('ul', { class: 'ptv-extras ptv-muted ptv-small' }, extras.map(x => h('li', {}, x))) : null);
	}

	renderVerify() {
		const { exp, opts } = this;
		const f = exp.signedFile;
		const s = exp.signature;
		const verdict = signatureVerdict(s);
		const copy = h('button', { type: 'button', class: 'ptv-copy' }, 'Copy');
		copy.addEventListener('click', async () => {
			try { await navigator.clipboard.writeText(f.sha256); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select and copy'; }
			setTimeout(() => { copy.textContent = 'Copy'; }, 2000);
		});
		const download = opts.download?.url
			? h('a', { class: 'ptv-button', href: opts.download.url, download: f.fileName, rel: 'noopener' }, `Download the signed film`, f.bytes ? h('span', { class: 'ptv-button-sub' }, ` ${formatBytes(f.bytes)}`) : null)
			: h('p', { class: 'ptv-muted' }, 'The signed file is not linked from this page.');
		return h('section', { class: 'ptv-verify', id: 'ptv-verify', 'aria-labelledby': 'ptv-verify-h' },
			h('h3', { class: 'ptv-h', id: 'ptv-verify-h' }, 'Check it yourself'),
			h('div', { class: `ptv-verdict-card ptv-tone-${verdict.tone}` }, h('strong', {}, verdict.headline), h('p', {}, verdict.detail)),
			opts.video?.youtubeId ? h('p', { class: 'ptv-muted ptv-small' }, 'The video above streams from YouTube, which re-encodes uploads and removes Content Credentials. The signed original is the file below.') : null,
			h('ol', { class: 'ptv-steps' },
				h('li', {}, h('span', { class: 'ptv-step-h' }, 'Download the signed film'), download),
				h('li', {},
					h('span', { class: 'ptv-step-h' }, 'Confirm it is the same file'),
					h('p', { class: 'ptv-small' }, 'Its SHA-256 fingerprint should be:'),
					h('div', { class: 'ptv-hash' }, h('code', { class: 'ptv-mono', title: f.sha256 }, groupHash(f.sha256)), copy),
					h('p', { class: 'ptv-muted ptv-small' }, 'Windows: ', h('code', {}, `certutil -hashfile "${f.fileName}" SHA256`), '. macOS or Linux: ', h('code', {}, `shasum -a 256 "${f.fileName}"`), '.')),
				h('li', {},
					h('span', { class: 'ptv-step-h' }, 'Read its Content Credentials'),
					h('p', { class: 'ptv-small' }, 'Open the file in an independent viewer, such as ', h('a', { href: opts.verifyUrl || VERIFY_URL, rel: 'noopener', target: '_blank' }, 'Content Credentials Verify'), '. It shows the same ingredients and the creator’s statement, signed into the file.'))),
			h('details', { class: 'ptv-more ptv-tech' },
				h('summary', {}, 'Technical details'),
				h('dl', {},
					h('dt', {}, 'Signed file'), h('dd', { class: 'ptv-mono' }, f.fileName, f.bytes ? ` (${f.bytes.toLocaleString()} bytes)` : ''),
					h('dt', {}, 'Signer'), h('dd', {}, s.signer ? `${s.signer.commonName || 'unnamed'}${s.signer.issuer ? `, issued by ${s.signer.issuer}` : ''}` : 'none'),
					h('dt', {}, 'Algorithm'), h('dd', { class: 'ptv-mono' }, s.algorithm || '–'),
					h('dt', {}, 'Time stamp'), h('dd', {}, s.timestamped && s.timestampTime ? new Date(s.timestampTime).toISOString() : 'none'),
					h('dt', {}, 'Content hash'), h('dd', {}, s.hashVerified ? 'verified when signed' : 'not verified'),
					h('dt', {}, 'Manifests in the file'), h('dd', {}, String(s.manifestCount)),
					h('dt', {}, 'Validation codes'), h('dd', { class: 'ptv-mono' }, s.failures.length ? s.failures.join(', ') : 'none'),
					h('dt', {}, 'Statement'), h('dd', {}, `version ${exp.statement.statementVersion}, assertion org.provenancetracker.creator_statement`),
					h('dt', {}, 'Record'), h('dd', {}, `${exp.generator.name} ${exp.generator.version}, ${exp.generatedAt}`, opts.exportUrl ? [' · ', h('a', { href: opts.exportUrl, download: '' }, 'download the JSON')] : null))));
	}
}

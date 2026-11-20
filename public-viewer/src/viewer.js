// The public viewer: one film, how it was made, and how to check that.
//
//   import { mountViewer } from './src/viewer.js';
//   mountViewer(document.querySelector('#film'), {
//     exportUrl: '/credentials/film.provenance.json',   // or `data: <export object>`
//     video: { youtubeId: 'abc123' },                   // or { src, poster }, or omit for a clock
//     download: { url: 'https://.../film.signed.v1.mp4' },
//     theme: 'dark',                                    // or 'light'
//     appName: 'Provenance Tracker',                    // the small line above the title
//     themeToggle: true                                 // light/dark switch, top right
//   });
//
// Everything shown comes from the public export, which may come from anyone:
// text is only ever set as text (no innerHTML), and links are only the ones
// the page passes in.

import { SPECTRUM, clock, sectionAt, filmSummary, sectionDetail, ingredientProvenance, signatureVerdict, groupHash, formatBytes, assertViewable, positionRuns, lanePositions, filterIngredients } from './model.js';
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

const chevron = () => h('span', { class: 'ptv-chevron', 'aria-hidden': 'true' });
// A <details> summary styled like the show/hide buttons; the label can differ open and closed.
const foldSummary = (closed, open = closed) => h('summary', { class: 'ptv-toggle' }, chevron(), h('span', { class: 'ptv-when-closed' }, closed), open !== closed ? h('span', { class: 'ptv-when-open' }, open) : null);

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
		this.pinned = null;
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
			const playing = this.player.playing();
			if (playing !== this.wasPlaying) { this.wasPlaying = playing; this.showPlaying(playing); }
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
		this.live = h('p', { class: 'ptv-sr', 'aria-live': 'polite' });
		this.stage = h('div', { class: 'ptv-stage' });
		this.head = h('header', { class: 'ptv-head' },
			h('p', { class: 'ptv-kicker' }, this.opts.appName || 'Provenance Tracker'),
			h('h2', { class: 'ptv-title' }, exp.film.title),
			this.renderLede());
		this.legend = this.renderLegend();
		this.strip = this.renderStrip();
		this.root.append(
			this.renderThemeToggle(),
			this.head,
			this.stage,
			h('section', { class: 'ptv-timeline', 'aria-label': 'Where each moment came from' },
				this.legend,
				this.strip,
				this.renderFollow()),
			this.renderIngredients(),
			this.renderSignature(),
			this.renderVerify(),
			this.live
		);
		this.root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.pinned) this.pin(null); });
		this.fitStage();
	}

	// A small light/dark switch in the top corner. The page's theme option is
	// the default; a viewer's own choice is remembered in this browser when
	// storage is available. Off with `themeToggle: false`.
	renderThemeToggle() {
		if (this.opts.themeToggle === false) return null;
		const KEY = 'ptv-theme';
		try {
			const saved = localStorage.getItem(KEY);
			if (saved === 'light' || saved === 'dark') this.root.dataset.theme = saved;
		} catch { /* no storage: keep the default */ }
		const button = h('button', { type: 'button', class: 'ptv-theme-toggle' }, h('span', { class: 'ptv-theme-icon', 'aria-hidden': 'true' }));
		const label = () => {
			const text = this.root.dataset.theme === 'light' ? 'Switch to the dark theme' : 'Switch to the light theme';
			button.setAttribute('aria-label', text);
			button.title = text;
		};
		button.addEventListener('click', () => {
			this.root.dataset.theme = this.root.dataset.theme === 'light' ? 'dark' : 'light';
			try { localStorage.setItem(KEY, this.root.dataset.theme); } catch { /* not remembered */ }
			label();
		});
		label();
		return button;
	}

	// The creator's statement when there is one, in their words and marked as
	// theirs; otherwise the tracker's own summary of the composition.
	renderLede() {
		const s = this.exp.statement;
		if (s.text) {
			const who = [s.author, s.organization].filter(Boolean).join(', ') || 'the creator';
			const pars = s.text.split(/\n{2,}/);
			return h('div', { class: 'ptv-lede ptv-lede-statement' },
				pars.map((par, i) => h('p', {}, par, i === pars.length - 1 ? h('span', { class: 'ptv-lede-by' }, ` — ${who}`) : null)));
		}
		return h('div', { class: 'ptv-lede' }, h('p', {}, filmSummary(this.exp)));
	}

	// Keep the header, the video, the legend and the strip on one screen: the
	// video gets whatever height is left, as a 16:9 width, but never narrower
	// than a readable minimum (on a short screen the page scrolls instead).
	// Open layers do not count: they are something the viewer asked for.
	fitStage() {
		const px = (el, prop) => parseFloat(getComputedStyle(el)[prop]) || 0;
		const once = () => {
			// Layout offsets, not getBoundingClientRect: the load animation moves things.
			let above = 0;
			for (let el = this.stage; el; el = el.offsetParent) above += el.offsetTop;
			const layers = [...this.strip.querySelectorAll('.ptv-layers')].reduce((n, el) => n + el.offsetHeight, 0);
			const explain = this.explain.hidden ? 0 : this.explain.offsetHeight;
			const below = px(this.legend.parentElement, 'marginTop') + this.legend.offsetHeight + px(this.strip, 'marginTop') + this.strip.offsetHeight - layers - explain + 16;
			return Math.round(Math.max((window.innerHeight - above - below) * 16 / 9, 320));
		};
		// The header takes the video's width, so a narrower video makes a taller
		// header, which would narrow the video again. Measure once with the
		// header at full width and give both that width; on a short screen the
		// strip may then sit a line or two lower rather than the video collapsing.
		const fit = () => {
			this.root.style.removeProperty('--ptv-stage-max');
			this.root.style.setProperty('--ptv-stage-max', `${once()}px`);
		};
		fit();
		window.addEventListener('resize', fit);
		document.fonts?.ready.then(fit);
	}

	// ---- legend: what the colours mean, and a filter -----------------------

	kinds() {
		if (this._kinds) return this._kinds;
		const vocab = new Map(this.exp.vocabulary.positions.map(p => [p.id, p]));
		const used = new Set(LANES.flatMap(l => lanePositions(this.exp.composition[l.key])));
		const mixed = LANES.some(l => (this.exp.composition[l.key]?.intervals || []).some(s => new Set(s.positions).size > 1));
		const list = SPECTRUM.filter(id => used.has(id)).map(id => ({ id, ...vocab.get(id) }));
		if (mixed) list.push({ id: 'mixed', label: 'Mixed', long: 'Mixed', desc: 'Two or more kinds at the same moment, such as a title over camera footage or AI music under a recorded voice. Show layers to see them apart.' });
		this._kinds = list;
		return list;
	}

	// Under the video: play and layers on the left, the kinds (a filter) on the right.
	// YouTube's newer embed has no play button of its own in its control bar.
	renderLegend() {
		this.chips = [];
		this.playButton = h('button', { type: 'button', class: 'ptv-play', 'aria-label': 'Play', onclick: () => (this.player.playing() ? this.player.pause() : this.player.play()) },
			h('span', { class: 'ptv-play-icon', 'aria-hidden': 'true' }), h('span', { class: 'ptv-play-text' }, 'Play'));
		this.barClock = h('span', { class: 'ptv-bar-clock' }, `0:00 / ${clock(this.duration)}`);
		this.layersButton = h('button', { type: 'button', class: 'ptv-toggle ptv-layers-toggle', 'aria-expanded': 'false', onclick: () => this.toggleLayers() },
			h('span', { class: 'ptv-layers-icon', 'aria-hidden': 'true' }), h('span', { class: 'ptv-layers-text' }, 'Show layers'));
		const chips = this.kinds().map(k => {
			const chip = h('button', {
				type: 'button', class: 'ptv-chip', 'aria-pressed': 'false', title: k.desc || '', dataset: { id: k.id },
				onclick: () => this.pin(this.pinned === k.id ? null : k.id),
				onpointerenter: () => this.preview(k.id), onpointerleave: () => this.preview(null),
				onfocus: () => this.preview(k.id), onblur: () => this.preview(null)
			}, k.id === 'mixed' ? h('span', { class: 'ptv-swatch ptv-swatch-mixed', 'aria-hidden': 'true' }) : swatch(k.id), k.label);
			this.chips.push(chip);
			return chip;
		});
		return h('div', { class: 'ptv-legend-bar' },
			h('div', { class: 'ptv-controls' }, this.playButton, this.barClock, this.layersButton),
			h('div', { class: 'ptv-chips', role: 'group', 'aria-label': 'Kinds of origin. Choose one to highlight it and filter the sources.' }, chips));
	}

	showPlaying(playing) {
		this.playButton.dataset.playing = String(playing);
		this.playButton.setAttribute('aria-label', playing ? 'Pause' : 'Play');
		this.playButton.querySelector('.ptv-play-text').textContent = playing ? 'Pause' : 'Play';
	}

	// Hovering a kind previews it; choosing one pins it, filters the source
	// list and says what it means. Choosing it again, or Escape, clears it.
	preview(id) {
		const show = id || this.pinned;
		if (show) this.root.dataset.focus = show; else delete this.root.dataset.focus;
	}

	pin(id) {
		this.pinned = id;
		this.preview(null);
		for (const c of this.chips) c.setAttribute('aria-pressed', String(c.dataset.id === id));
		// The list has no Mixed filter: Mixed shows every source.
		this.syncListChips();
		const k = this.kinds().find(x => x.id === id);
		this.explain.hidden = !k;
		if (k) {
			const n = id === 'mixed' ? 0 : filterIngredients(this.exp, id).length;
			this.explain.replaceChildren(h('strong', {}, k.long || k.label), ': ', k.desc || '', ...(n ? [' ', h('a', { href: '#ptv-ingredients-h', onclick: () => this.openList(true) }, `See the ${n} source${n === 1 ? '' : 's'}`), '.'] : []));
		}
		this.renderList();
	}

	toggleLayers() {
		const open = this.root.dataset.layers !== 'open';
		if (open) this.root.dataset.layers = 'open'; else delete this.root.dataset.layers;
		this.layersButton.setAttribute('aria-expanded', String(open));
		this.layersButton.querySelector('.ptv-layers-text').textContent = open ? 'Hide layers' : 'Show layers';
		for (const el of this.strip.querySelectorAll('.ptv-layers')) el.hidden = !open;
	}

	// ---- the strip ---------------------------------------------------------

	renderStrip() {
		const { exp, duration } = this;
		this.playheads = [];
		this.sectionEls = {};
		this.tip = h('div', { class: 'ptv-tip', role: 'presentation', hidden: true });
		this.explain = h('p', { class: 'ptv-explain', hidden: true });
		const byRef = new Map(exp.ingredients.map(i => [i.ref, i]));
		const vocab = new Map(exp.vocabulary.positions.map(p => [p.id, p]));
		const place = (start, end) => ({ left: `${(start / duration) * 100}%`, width: `${((end - start) / duration) * 100}%` });
		const track = (cls, label, onTip, keys) => {
			const el = h('div', {
				class: cls,
				tabindex: keys ? 0 : null,
				role: keys ? 'group' : null,
				'aria-label': label,
				onkeydown: keys,
				onclick: (e) => { const r = el.getBoundingClientRect(); this.seek(((e.clientX - r.left) / r.width) * duration, true); },
				onpointermove: (e) => this.showTip(e, el, onTip),
				onpointerdown: (e) => { if (e.pointerType !== 'mouse') this.showTip(e, el, onTip, 2500); },
				onpointerleave: (e) => { if (e.pointerType === 'mouse') this.tip.hidden = true; }
			});
			const head = h('div', { class: 'ptv-playhead', 'aria-hidden': 'true' });
			this.playheads.push(head);
			el.append(head);
			return el;
		};
		const lanes = LANES.map(lane => {
			const data = exp.composition[lane.key];
			const intervals = data?.intervals || [];
			const main = track('ptv-track', `${lane.label} timeline, ${intervals.length} sections. Left and right arrows move between sections.`,
				(t) => this.sectionTip(sectionDetail(intervals[sectionAt(intervals, t)], exp), t),
				(e) => this.keyNav(e, lane.key));
			this.sectionEls[lane.key] = intervals.map(s => {
				const el = h('div', { class: 'ptv-sec', dataset: { has: s.positions.join(' ') }, style: { ...place(s.start, s.end), background: sectionBackground(s.positions) } });
				main.prepend(el);
				return el;
			});
			// One row per kind, so a mixed moment can be read apart.
			const layers = h('div', { class: 'ptv-layers', hidden: true },
				lanePositions(data).map(id => {
					const runs = positionRuns(data, id, exp);
					const row = track('ptv-track ptv-layer-track', null, (t) => {
						const run = runs.find(r => t >= r.start && t < r.end);
						return run ? this.sourcesTip(t, [vocab.get(id)?.label || id], run.refs.map(r => byRef.get(r)).filter(Boolean)) : null;
					});
					row.setAttribute('aria-hidden', 'true');
					for (const r of runs) row.prepend(h('div', { class: 'ptv-sec ptv-run', dataset: { has: id }, style: { ...place(r.start, r.end), background: sectionBackground([id]) } }));
					return h('div', { class: 'ptv-lane ptv-layer' }, h('span', { class: 'ptv-layer-label' }, vocab.get(id)?.label || id), row);
				}));
			return h('div', { class: 'ptv-lane-group' },
				h('div', { class: 'ptv-lane' }, h('span', { class: 'ptv-lane-label' }, lane.label), main),
				layers);
		});
		const step = rulerStep(duration);
		const ticks = [];
		for (let t = 0; t <= duration + 0.01; t += step) ticks.push(h('span', { class: 'ptv-tick', style: { left: `${(t / duration) * 100}%` } }, clock(t)));
		return h('div', { class: 'ptv-strip' },
			lanes,
			h('div', { class: 'ptv-ruler', 'aria-hidden': 'true' }, h('span', { class: 'ptv-lane-label' }), h('div', { class: 'ptv-ruler-track' }, ticks)),
			this.explain,
			this.tip);
	}

	sectionTip(d, t) {
		if (!d) return null;
		const tip = this.sourcesTip(t, d.positions.length ? d.positions.map(p => p.label) : ['Nothing'], d.ingredients);
		if (d.untracked) tip.push(h('span', { class: 'ptv-tip-more' }, d.untracked === 1 ? 'Plus a clip made in the editor or not tracked' : `Plus ${d.untracked} clips made in the editor or not tracked`));
		return tip;
	}

	sourcesTip(t, kinds, sources) {
		const max = 5;
		return [
			h('span', { class: 'ptv-tip-time' }, clock(t)),
			h('span', { class: 'ptv-tip-pos' }, kinds.join(' + ')),
			sources.length ? h('ul', { class: 'ptv-tip-list' }, sources.slice(0, max).map(i => h('li', {},
				h('span', { class: 'ptv-tip-name' }, i.title),
				h('span', { class: 'ptv-tip-class' }, i.classLabel || this.exp.vocabulary.classes[i.originClass]?.label || i.originClass, i.aiAssisted ? ', AI-assisted' : '')))) : null,
			sources.length > max ? h('span', { class: 'ptv-tip-more' }, `and ${sources.length - max} more`) : null
		];
	}

	showTip(e, el, build, hideAfter = 0) {
		const r = el.getBoundingClientRect();
		const t = Math.min(this.duration, Math.max(0, ((e.clientX - r.left) / r.width) * this.duration));
		const body = build(t);
		if (!body) { this.tip.hidden = true; return; }
		this.tip.replaceChildren(...body.filter(Boolean));
		this.tip.hidden = false;
		const strip = this.strip.getBoundingClientRect();
		const half = Math.min(this.tip.offsetWidth / 2 + 4, strip.width / 2);
		this.tip.style.left = `${Math.min(Math.max(e.clientX - strip.left, half), strip.width - half)}px`;
		this.tip.style.top = `${r.top - strip.top}px`;
		clearTimeout(this.tipTimer);
		if (hideAfter) this.tipTimer = setTimeout(() => { this.tip.hidden = true; }, hideAfter);
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

	// ---- follow along (folded) ---------------------------------------------

	renderFollow() {
		this.nowCols = {};
		const cols = LANES.map(lane => {
			const body = h('div', { class: 'ptv-now-body' });
			this.nowCols[lane.key] = body;
			return h('div', { class: 'ptv-now-col' }, h('h3', { class: 'ptv-now-lane' }, lane.label), body);
		});
		this.nowClock = h('span', { class: 'ptv-now-clock' }, '0:00');
		return h('details', { class: 'ptv-fold ptv-follow' },
			foldSummary('Follow along as it plays'),
			h('div', { class: 'ptv-now' },
				h('div', { class: 'ptv-now-head' }, h('span', { class: 'ptv-now-title' }, 'Playing now'), this.nowClock),
				h('div', { class: 'ptv-now-cols' }, cols)));
	}

	showTime(t) {
		const pct = this.duration ? Math.min(100, Math.max(0, (t / this.duration) * 100)) : 0;
		for (const p of this.playheads) p.style.left = `${pct}%`;
		this.nowClock.textContent = `${clock(t)} / ${clock(this.duration)}`;
		this.barClock.textContent = `${clock(t)} / ${clock(this.duration)}`;
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

	// ---- sources: a short list, filtered by kind ---------------------------

	// A topline first: how many sources and of which kinds. The list opens
	// from there, already filtered to the kind chosen.
	renderIngredients() {
		const { exp } = this;
		const vocab = new Map(exp.vocabulary.positions.map(p => [p.id, p]));
		const all = filterIngredients(exp);
		const used = new Set(all.map(i => (SPECTRUM.includes(i.position) ? i.position : 'unknown')));
		const kinds = SPECTRUM.filter(id => used.has(id)).map(id => ({ id, label: id === 'unknown' ? 'Unknown / other' : vocab.get(id)?.label || id, n: filterIngredients(exp, id).length }));
		const choose = (id) => { this.pin(id); this.openList(true); };
		const chip = (id, label, n, sw) => h('button', { type: 'button', class: 'ptv-chip', 'aria-pressed': 'false', dataset: { id }, onclick: () => choose(id === 'all' ? null : id) }, sw, label, h('span', { class: 'ptv-chip-n' }, String(n)));
		this.listChips = [chip('all', 'All', all.length, null), ...kinds.map(k => chip(k.id, k.label, k.n, swatch(k.id)))];
		const bar = h('div', { class: 'ptv-src-bar' },
			kinds.map(k => h('button', {
				type: 'button', class: 'ptv-src-seg', title: `${k.n} ${k.label}`, 'aria-label': `${k.n} ${k.label}: show them`,
				style: { flexGrow: k.n, background: sectionBackground([k.id]) },
				onclick: () => choose(k.id)
			})));
		this.list = h('ul', { class: 'ptv-src-list' });
		this.listPanel = h('div', { class: 'ptv-src-panel', id: 'ptv-src-panel', hidden: true }, this.list);
		this.listToggle = h('button', { type: 'button', class: 'ptv-toggle', 'aria-expanded': 'false', 'aria-controls': 'ptv-src-panel', onclick: () => this.openList(this.listPanel.hidden) }, chevron(), h('span', { class: 'ptv-toggle-text' }, 'Show the list'));
		this.renderList();
		return h('section', { class: 'ptv-ingredients', 'aria-labelledby': 'ptv-ingredients-h' },
			h('div', { class: 'ptv-h-row' },
				h('h3', { class: 'ptv-h', id: 'ptv-ingredients-h' }, 'What was used in this video'),
				h('p', { class: 'ptv-src-count' }, h('strong', {}, String(all.length)), ` source${all.length === 1 ? '' : 's'}, by kind`)),
			bar,
			h('div', { class: 'ptv-src-filters' },
				h('div', { class: 'ptv-chips', role: 'group', 'aria-label': 'Show the sources of one kind' }, this.listChips),
				this.listToggle),
			this.listPanel,
			exp.editorMadeClips ? h('p', { class: 'ptv-extras ptv-muted ptv-small' }, `Also ${exp.editorMadeClips} title${exp.editorMadeClips === 1 ? '' : 's'} or graphic${exp.editorMadeClips === 1 ? '' : 's'} made in the editor, counted as made on a computer without AI.`) : null);
	}

	// While the list is closed no kind is shown as chosen in it; open, the
	// chosen kind (or All) is.
	syncListChips() {
		const open = this.listPanel && !this.listPanel.hidden;
		const listed = (this.listChips || []).some(c => c.dataset.id === this.pinned);
		for (const c of this.listChips || []) c.setAttribute('aria-pressed', String(open && (listed ? c.dataset.id === this.pinned : c.dataset.id === 'all')));
	}

	openList(open) {
		this.listPanel.hidden = !open;
		this.listToggle.setAttribute('aria-expanded', String(open));
		this.listToggle.querySelector('.ptv-toggle-text').textContent = open ? 'Hide the list' : 'Show the list';
		this.syncListChips();
	}

	renderList() {
		if (!this.list) return;
		this.list.replaceChildren(...filterIngredients(this.exp, this.pinned).map(i => this.sourceRow(i)));
	}

	sourceRow(i) {
		const classes = this.exp.vocabulary.classes;
		const span = (s, verb) => (s >= 1 ? `${clock(s)} ${verb}` : s > 0 ? `under 1s ${verb}` : null);
		const time = [span(i.pictureSeconds, 'on screen'), span(i.audioSeconds, 'heard')].filter(Boolean).join(' · ');
		const label = i.originClass === 'unknown' ? 'Unknown' : (classes[i.originClass]?.label || i.originClass);
		return h('li', {},
			h('details', { class: 'ptv-src' },
				h('summary', {},
					swatch(SPECTRUM.includes(i.position) ? i.position : 'unknown'),
					h('span', { class: 'ptv-src-title' }, i.title),
					h('span', { class: 'ptv-src-class' }, label, i.aiAssisted ? ', AI-assisted' : ''),
					h('span', { class: 'ptv-src-time' }, time)),
				i.untracked ? this.untrackedBody(i, label) : this.sourceBody(i, classes)));
	}

	untrackedBody(i, label) {
		const where = `${i.tracks.join(', ')}, ${clock(i.startSeconds)}–${clock(i.endSeconds)}`;
		const why = i.reason === 'nested sequence'
			? 'A sequence placed inside the edit. The tracker does not look inside nested sequences, so the clips in it are not listed as sources.'
			: 'A clip in the edit that is not tied to a tracked source file.';
		const said = i.originClass === 'unknown' ? 'Nobody has said how it was made.' : `The creator classed it as ${label}.`;
		return h('div', { class: 'ptv-src-body' },
			h('p', { class: 'ptv-ing-prov' }, `${why} ${said}`),
			h('dl', {}, h('dt', {}, 'Where'), h('dd', {}, where)));
	}

	sourceBody(i, classes) {
		return h('div', { class: 'ptv-src-body' },
			h('p', { class: `ptv-ing-prov${i.credentialsInSignedFile === 'present' ? ' ptv-has-cr' : ''}` }, ingredientProvenance(i)),
			i.note ? h('p', { class: 'ptv-ing-note' }, i.note) : null,
			h('dl', {},
				h('dt', {}, 'File'), h('dd', { class: 'ptv-mono' }, i.fileName),
				h('dt', {}, 'Source type'), h('dd', {}, i.digitalSourceType ? h('a', { href: i.digitalSourceType, rel: 'noopener', target: '_blank' }, i.originClass) : i.originClass),
				h('dt', {}, 'Class set by'), h('dd', {}, i.classSetBy === 'creator' ? 'the creator' : 'the tracker, from the file’s metadata'),
				i.classClaimedByFile && i.classClaimedByFile !== i.originClass ? [h('dt', {}, 'The file itself says'), h('dd', {}, classes[i.classClaimedByFile]?.label || i.classClaimedByFile)] : null,
				h('dt', {}, 'Manifest ref'), h('dd', { class: 'ptv-mono' }, i.ref)));
	}

	// Who signed, and when, from the creator statement and the signed file.
	signedBy() {
		const s = this.exp.statement;
		const who = [s.author, s.organization].filter(Boolean).join(', ') || this.exp.signature.signer?.commonName || '';
		const when = this.exp.signedFile.signedAt || s.statedAt;
		const date = when ? new Date(when).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
		return h('p', { class: 'ptv-signed-by' }, 'Signed', who ? [' by ', h('strong', {}, who)] : '', date ? ` on ${date}` : '', s.editedWith ? `, edited in ${s.editedWith}` : '', '.');
	}

	// Always shown: who signed it, whether the signature checks out, and the
	// technical record behind that, folded.
	renderSignature() {
		const { exp, opts } = this;
		const f = exp.signedFile;
		const s = exp.signature;
		const verdict = signatureVerdict(s);
		return h('section', { class: 'ptv-signature', 'aria-labelledby': 'ptv-signature-h' },
			h('h3', { class: 'ptv-h', id: 'ptv-signature-h' }, 'Signature'),
			this.signedBy(),
			h('div', { class: `ptv-verdict-card ptv-tone-${verdict.tone}` }, h('strong', {}, verdict.headline), h('p', {}, verdict.detail)),
			h('details', { class: 'ptv-fold ptv-tech' },
				foldSummary('Technical details'),
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

	// Folded at the very bottom: for the few who want to check the file itself.
	renderVerify() {
		const { exp, opts } = this;
		const f = exp.signedFile;
		const copy = h('button', { type: 'button', class: 'ptv-copy' }, 'Copy');
		copy.addEventListener('click', async () => {
			try { await navigator.clipboard.writeText(f.sha256); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select and copy'; }
			setTimeout(() => { copy.textContent = 'Copy'; }, 2000);
		});
		const download = opts.download?.url
			? h('a', { class: 'ptv-button', href: opts.download.url, download: f.fileName, rel: 'noopener' }, 'Download the signed film', f.bytes ? h('span', { class: 'ptv-button-sub' }, ` ${formatBytes(f.bytes)}`) : null)
			: h('p', { class: 'ptv-muted' }, 'The signed file is not linked from this page.');
		return h('section', { class: 'ptv-verify', id: 'ptv-verify', 'aria-labelledby': 'ptv-verify-h' },
			h('h3', { class: 'ptv-h ptv-h-small', id: 'ptv-verify-h' }, 'Check it yourself'),
			h('p', { class: 'ptv-muted ptv-small ptv-verify-sub' }, 'Download the signed film and confirm its Content Credentials.'),
			h('details', { class: 'ptv-fold' },
			foldSummary('Show the steps', 'Hide the steps'),
			opts.video?.youtubeId ? h('p', { class: 'ptv-muted ptv-small ptv-verify-note' }, 'The video above streams from YouTube, which re-encodes uploads and removes Content Credentials. The signed original is the file below.') : null,
			h('ol', { class: 'ptv-steps' },
				h('li', {}, h('span', { class: 'ptv-step-h' }, 'Download the signed film'), download),
				h('li', {},
					h('span', { class: 'ptv-step-h' }, 'Confirm it is the same file'),
					h('p', { class: 'ptv-small' }, 'Its SHA-256 fingerprint should be:'),
					h('div', { class: 'ptv-hash' }, h('code', { class: 'ptv-mono', title: f.sha256 }, groupHash(f.sha256)), copy),
					h('p', { class: 'ptv-muted ptv-small' }, 'Windows: ', h('code', {}, `certutil -hashfile "${f.fileName}" SHA256`), '. macOS or Linux: ', h('code', {}, `shasum -a 256 "${f.fileName}"`), '.')),
				h('li', {},
					h('span', { class: 'ptv-step-h' }, 'Read its Content Credentials'),
					h('p', { class: 'ptv-small' }, 'Open the file in an independent viewer, such as ', h('a', { href: opts.verifyUrl || VERIFY_URL, rel: 'noopener', target: '_blank' }, 'Content Credentials Verify'), '. It shows the same ingredients and the creator’s statement, signed into the file.')))));
	}
}

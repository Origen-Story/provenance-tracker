// Player adapters. Each returns { ready: Promise, time(): seconds, seek(t),
// playing(): boolean, play(), pause(), destroy() } so the viewer can follow and drive any of
// them the same way.
//
// - videoPlayer: a <video> element, e.g. the signed file itself.
// - youtubePlayer: a YouTube embed through the IFrame API, on the
//   no-cookie domain. YouTube re-encodes uploads and drops Content
//   Credentials, so the page also links the signed file.
// - clockPlayer: no video at all, a clock the strip can play and scrub.
//   For the demo page and for previews before the film is online.

export function videoPlayer(container, { src, poster = '', title = '' }) {
	const v = document.createElement('video');
	v.className = 'ptv-video';
	v.controls = true;
	v.preload = 'metadata';
	v.playsInline = true;
	v.src = src;
	if (poster) v.poster = poster;
	if (title) v.setAttribute('aria-label', title);
	container.append(v);
	return {
		ready: new Promise(resolve => (v.readyState >= 1 ? resolve() : v.addEventListener('loadedmetadata', () => resolve(), { once: true }))),
		time: () => v.currentTime,
		seek: (t) => { v.currentTime = t; },
		playing: () => !v.paused && !v.ended,
		play: () => v.play().catch(() => {}),
		pause: () => v.pause(),
		destroy: () => v.remove()
	};
}

let ytApi;
function loadYouTubeApi() {
	if (window.YT?.Player) return Promise.resolve(window.YT);
	if (ytApi) return ytApi;
	ytApi = new Promise((resolve, reject) => {
		const previous = window.onYouTubeIframeAPIReady;
		window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(window.YT); };
		const s = document.createElement('script');
		s.src = 'https://www.youtube.com/iframe_api';
		s.async = true;
		s.onerror = () => reject(new Error('The YouTube player could not be loaded.'));
		document.head.append(s);
	});
	return ytApi;
}

export function youtubePlayer(container, { videoId, title = '' }) {
	const mount = document.createElement('div');
	container.append(mount);
	let player = null;
	let state = -1;
	const ready = loadYouTubeApi().then(YT => new Promise(resolve => {
		player = new YT.Player(mount, {
			host: 'https://www.youtube-nocookie.com',
			videoId,
			width: '100%',
			height: '100%',
			playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
			events: {
				onReady: () => {
					const iframe = player.getIframe?.();
					if (iframe && title) iframe.title = title;
					resolve();
				},
				onStateChange: (e) => { state = e.data; }
			}
		});
	}));
	return {
		ready,
		time: () => (player?.getCurrentTime ? player.getCurrentTime() : 0),
		seek: (t) => player?.seekTo?.(t, true),
		playing: () => state === 1 || state === 3,
		play: () => player?.playVideo?.(),
		pause: () => player?.pauseVideo?.(),
		destroy: () => player?.destroy?.()
	};
}

export function clockPlayer(container, { duration }) {
	let t = 0;
	let started = null;
	let raf = 0;
	const bar = document.createElement('div');
	bar.className = 'ptv-clock';
	const label = document.createElement('span');
	label.className = 'ptv-clock-label';
	label.textContent = 'No video on this page: press Play to run the timeline on its own.';
	bar.append(label);
	container.append(bar);
	const now = () => (started == null ? t : Math.min(duration, t + (performance.now() - started) / 1000));
	const tick = () => {
		if (started != null && now() >= duration) { t = duration; started = null; return; }
		raf = requestAnimationFrame(tick);
	};
	return {
		ready: Promise.resolve(),
		time: now,
		seek: (s) => { t = Math.max(0, Math.min(duration, s)); if (started != null) started = performance.now(); },
		playing: () => started != null,
		play: () => { if (started != null) return; if (t >= duration) t = 0; started = performance.now(); tick(); },
		pause: () => { if (started == null) return; t = now(); started = null; cancelAnimationFrame(raf); },
		destroy: () => { cancelAnimationFrame(raf); bar.remove(); }
	};
}

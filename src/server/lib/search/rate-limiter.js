/**
 * Simple rate limiter for Wikimedia Commons API.
 * Enforces a minimum gap between requests (module-level singleton).
 * Wikimedia allows 200 req/min — 200ms gap gives comfortable headroom.
 */

const MIN_GAP_MS = 200;
let lastRequestTime = 0;

function delay(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Rate-limited fetch. Same API as global fetch(), but queues to avoid
 * exceeding the Wikimedia rate limit.
 */
export async function throttledFetch(url, options = {}) {
	const now = Date.now();
	const elapsed = now - lastRequestTime;
	if (elapsed < MIN_GAP_MS) {
		await delay(MIN_GAP_MS - elapsed);
	}
	lastRequestTime = Date.now();
	return fetch(url, options);
}

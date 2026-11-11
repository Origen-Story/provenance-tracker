// Loads the optional c2pa-node native binding on first use.
//
// c2pa-node ships an unsigned native module. Windows Smart App Control (and
// other application-control policies) can refuse to load it, and a static
// `import ... from 'c2pa-node'` then takes the whole server down at startup.
// The binding is a fast path, not a requirement: reading falls back to the
// bundled c2patool, so a blocked binding must cost speed, never the app.
import { createLogger } from '../logger.js';

const log = createLogger('c2pa');

let attempt = null; // Promise<{ module: object|null, reason: string|null }>

export function loadC2paNode() {
	if (!attempt) {
		attempt = import('c2pa-node')
			.then(module => ({ module: module.default?.createC2pa ? module.default : module, reason: null }))
			.catch(err => {
				const reason = String(err?.message || err).split('\n')[0];
				log.warn(`c2pa-node native binding unavailable (${reason}). Using c2patool for C2PA reads.`);
				return { module: null, reason };
			});
	}
	return attempt;
}

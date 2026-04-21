// Structured logger. Zero dependencies; drop-in replacement for console.*
// Produces output like:  09:15:23 INFO  [search] Starting search for "..."
//
// Usage:
//   import { createLogger } from '../lib/logger.js';
//   const log = createLogger('search');
//   log.info('Starting search', { keywords, categories });
//   log.error('Failed', err);
//
// LOG_LEVEL env var controls verbosity: debug | info | warn | error (default: info).

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT = LEVELS[(process.env.LOG_LEVEL || '').toLowerCase()] ?? LEVELS.info;

function timestamp() {
	return new Date().toISOString().slice(11, 19);
}

function write(level, module, args) {
	if (LEVELS[level] < CURRENT) return;
	const prefix = module ? `[${module}]` : '';
	const head = `${timestamp()} ${level.toUpperCase().padEnd(5)} ${prefix}`.trimEnd();
	const stream = LEVELS[level] >= LEVELS.warn ? console.error : console.log;
	stream(head, ...args);
}

export function createLogger(module = '') {
	return {
		debug: (...args) => write('debug', module, args),
		info: (...args) => write('info', module, args),
		warn: (...args) => write('warn', module, args),
		error: (...args) => write('error', module, args),
		child: (sub) => createLogger(module ? `${module}/${sub}` : sub),
	};
}

export const logger = createLogger();

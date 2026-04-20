/**
 * Centralized User-Agent string for outbound HTTP requests.
 *
 * Wikimedia's User-Agent policy (https://meta.wikimedia.org/wiki/User-Agent_policy)
 * requires bots/scripts to identify themselves with app name + contact info.
 * Unidentified clients are throttled more aggressively and may be blocked.
 *
 * Set APP_CONTACT in .env to override the default (recommended: your email or
 * a URL pointing at the project repo).
 */

const APP_NAME = 'ProvenanceTracker';
const APP_VERSION = '1.0';
const DEFAULT_CONTACT = 'https://github.com/mattlford/provenance-tracker';
const contact = process.env.APP_CONTACT || DEFAULT_CONTACT;

export const USER_AGENT = `${APP_NAME}/${APP_VERSION} (${contact})`;

import { getProjectConfig } from '$lib/shell/settings.server.js';

export function load() {
	const config = getProjectConfig();
	return {
		projectName: config?.projectName || 'Provenance Tracker'
	};
}

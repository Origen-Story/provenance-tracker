import { getProjectConfig, updateProjectConfig } from '$lib/shell/settings.server.js';

export function load() {
	const config = getProjectConfig();
	return { config };
}

export const actions = {
	default: async ({ request }) => {
		const form = await request.formData();
		const data = {
			projectName: form.get('projectName') || '',
			author: form.get('author') || '',
			organization: form.get('organization') || '',
			certificatePath: form.get('certificatePath') || '',
			privateKeyPath: form.get('privateKeyPath') || '',
			storageRootPath: form.get('storageRootPath') || '',
			assetIdPrefix: form.get('assetIdPrefix') || 'GAIA'
		};

		updateProjectConfig(data);
		return { success: true };
	}
};

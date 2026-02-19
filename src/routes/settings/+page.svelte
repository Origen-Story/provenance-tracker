<script>
	import PageHeader from '$lib/shell/components/layout/PageHeader.svelte';
	import Card from '$lib/shell/components/ui/Card.svelte';
	import Button from '$lib/shell/components/ui/Button.svelte';
	import { enhance } from '$app/forms';

	let { data, form } = $props();
	let config = $derived(data.config || {});
</script>

<PageHeader title="Settings" description="Project configuration for provenance tracking" />

{#if form?.success}
	<div class="mb-4 p-3 bg-success/10 border border-success/20 rounded-lg text-sm text-success">
		Settings saved.
	</div>
{/if}

<form method="POST" use:enhance class="max-w-2xl space-y-6">
	<Card>
		<h3 class="text-sm font-semibold text-text-primary mb-4">Project Info</h3>
		<div class="space-y-4">
			<div>
				<label for="projectName" class="block text-xs text-text-secondary mb-1">Project Name</label>
				<input
					id="projectName"
					name="projectName"
					type="text"
					value={config.projectName || ''}
					class="w-full px-3 py-2 bg-app-bg border border-border rounded-lg text-sm text-text-primary
						focus:outline-none focus:ring-2 focus:ring-accent/50"
				/>
			</div>
			<div class="grid grid-cols-2 gap-4">
				<div>
					<label for="author" class="block text-xs text-text-secondary mb-1">Author</label>
					<input
						id="author"
						name="author"
						type="text"
						value={config.author || ''}
						class="w-full px-3 py-2 bg-app-bg border border-border rounded-lg text-sm text-text-primary
							focus:outline-none focus:ring-2 focus:ring-accent/50"
					/>
				</div>
				<div>
					<label for="organization" class="block text-xs text-text-secondary mb-1">Organization</label>
					<input
						id="organization"
						name="organization"
						type="text"
						value={config.organization || ''}
						class="w-full px-3 py-2 bg-app-bg border border-border rounded-lg text-sm text-text-primary
							focus:outline-none focus:ring-2 focus:ring-accent/50"
					/>
				</div>
			</div>
			<div>
				<label for="assetIdPrefix" class="block text-xs text-text-secondary mb-1">Asset ID Prefix</label>
				<input
					id="assetIdPrefix"
					name="assetIdPrefix"
					type="text"
					value={config.assetIdPrefix || 'GAIA'}
					placeholder="GAIA"
					class="w-full px-3 py-2 bg-app-bg border border-border rounded-lg text-sm text-text-primary
						focus:outline-none focus:ring-2 focus:ring-accent/50"
				/>
				<p class="text-xs text-text-secondary mt-1">Asset IDs will be formatted as PREFIX-TYPE-001 (e.g. GAIA-CHAR-001)</p>
			</div>
		</div>
	</Card>

	<Card>
		<h3 class="text-sm font-semibold text-text-primary mb-4">Certificates (Track A Signing)</h3>
		<div class="space-y-4">
			<div>
				<label for="certificatePath" class="block text-xs text-text-secondary mb-1">Certificate Path (.pem)</label>
				<input
					id="certificatePath"
					name="certificatePath"
					type="text"
					value={config.certificatePath || ''}
					placeholder="Path to certificate.pem"
					class="w-full px-3 py-2 bg-app-bg border border-border rounded-lg text-sm text-text-primary
						placeholder:text-text-secondary/40 focus:outline-none focus:ring-2 focus:ring-accent/50"
				/>
			</div>
			<div>
				<label for="privateKeyPath" class="block text-xs text-text-secondary mb-1">Private Key Path (.pem)</label>
				<input
					id="privateKeyPath"
					name="privateKeyPath"
					type="text"
					value={config.privateKeyPath || ''}
					placeholder="Path to private_key.pem"
					class="w-full px-3 py-2 bg-app-bg border border-border rounded-lg text-sm text-text-primary
						placeholder:text-text-secondary/40 focus:outline-none focus:ring-2 focus:ring-accent/50"
				/>
			</div>
		</div>
	</Card>

	<Card>
		<h3 class="text-sm font-semibold text-text-primary mb-4">File Storage</h3>
		<div>
			<label for="storageRootPath" class="block text-xs text-text-secondary mb-1">Storage Root Path</label>
			<input
				id="storageRootPath"
				name="storageRootPath"
				type="text"
				value={config.storageRootPath || ''}
				placeholder="e.g. P:\Projects\GaiasAtmosphere"
				class="w-full px-3 py-2 bg-app-bg border border-border rounded-lg text-sm text-text-primary
					placeholder:text-text-secondary/40 focus:outline-none focus:ring-2 focus:ring-accent/50"
			/>
			<p class="text-xs text-text-secondary mt-1">Optional base path for your project files</p>
		</div>
	</Card>

	<Button type="submit">Save Settings</Button>
</form>

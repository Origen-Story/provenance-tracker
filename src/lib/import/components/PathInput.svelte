<script>
	import Button from '$lib/shell/components/ui/Button.svelte';

	let { onsubmit, scanning = false } = $props();

	let pathValue = $state('');

	function handleSubmit() {
		if (pathValue.trim() && onsubmit) {
			onsubmit(pathValue.trim());
		}
	}

	function handleKeydown(e) {
		if (e.key === 'Enter') handleSubmit();
	}
</script>

<div class="bg-card-bg border-2 border-dashed border-border rounded-xl p-8 text-center">
	<svg class="w-12 h-12 mx-auto mb-4 text-text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
		<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
		<polyline points="17 8 12 3 7 8" />
		<line x1="12" y1="3" x2="12" y2="15" />
	</svg>

	<p class="text-text-primary font-medium mb-1">Import Assets</p>
	<p class="text-sm text-text-secondary mb-6">Paste a folder or file path to scan for AI-generated assets</p>

	<div class="flex gap-3 max-w-xl mx-auto">
		<input
			type="text"
			bind:value={pathValue}
			onkeydown={handleKeydown}
			placeholder="e.g. P:\Projects\GaiasAtmosphere\02_ai_generation"
			disabled={scanning}
			class="flex-1 px-4 py-2.5 bg-app-bg border border-border rounded-lg text-sm text-text-primary
				placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent
				disabled:opacity-50"
		/>
		<Button onclick={handleSubmit} disabled={scanning || !pathValue.trim()}>
			{#if scanning}
				Scanning...
			{:else}
				Scan
			{/if}
		</Button>
	</div>
</div>

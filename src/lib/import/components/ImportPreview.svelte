<script>
	import PlatformBadge from './PlatformBadge.svelte';
	import Card from '$lib/shell/components/ui/Card.svelte';
	import Button from '$lib/shell/components/ui/Button.svelte';
	import { ASSET_TYPES, DIGITAL_SOURCE_TYPES } from '$lib/core/constants.js';

	let { results = [], onconfirm, confirming = false } = $props();

	// Edits for each result, indexed by position
	let edits = $state(results.map(() => ({ description: '', assetType: 'other', generationDate: '', notes: '', digitalSourceType: '' })));

	function handleConfirm() {
		const imports = results.map((r, i) => ({
			extraction: r,
			edits: edits[i]
		}));
		onconfirm?.(imports);
	}

	function filename(filePath) {
		return filePath?.split('/')?.pop() || filePath;
	}

	function formatSize(bytes) {
		if (bytes < 1024) return bytes + ' B';
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
		return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
	}
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between mb-2">
		<p class="text-sm text-text-secondary">{results.length} file{results.length !== 1 ? 's' : ''} found</p>
		<Button onclick={handleConfirm} disabled={confirming}>
			{#if confirming}
				Importing...
			{:else}
				Confirm Import ({results.length})
			{/if}
		</Button>
	</div>

	{#each results as result, i}
		<Card>
			<div class="flex gap-5">
				<!-- Thumbnail / file info -->
				<div class="w-32 h-32 bg-app-bg rounded-lg overflow-hidden shrink-0 flex items-center justify-center">
					{#if result.fileInfo?.mimeType?.startsWith('image/')}
						<img
							src="/api/preview?path={encodeURIComponent(result.fileInfo.path)}"
							alt=""
							class="w-full h-full object-cover"
						/>
					{:else}
						<svg class="w-8 h-8 text-text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
							<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
							<polyline points="14 2 14 8 20 8"/>
						</svg>
					{/if}
				</div>

				<!-- Extracted data + editable fields -->
				<div class="flex-1 min-w-0">
					<div class="flex items-center gap-2 mb-2">
						<p class="text-sm font-medium text-text-primary truncate">{filename(result.fileInfo?.path)}</p>
						<PlatformBadge platform={result.platform} />
						<span class="text-xs text-text-secondary">{formatSize(result.fileInfo?.size || 0)}</span>
						{#if result.fileInfo?.width}
							<span class="text-xs text-text-secondary">{result.fileInfo.width}x{result.fileInfo.height}</span>
						{/if}
					</div>

					<!-- Auto-extracted fields -->
					{#if result.parsed?.prompt}
						<div class="mb-2">
							<span class="text-xs text-success font-medium">Prompt: </span>
							<span class="text-xs text-text-secondary">{result.parsed.prompt}</span>
						</div>
					{/if}
					{#if result.parsed?.modelName}
						<div class="mb-2">
							<span class="text-xs text-success font-medium">Model: </span>
							<span class="text-xs text-text-secondary">{result.parsed.modelName}</span>
							{#if result.parsed?.seed}
								<span class="text-xs text-text-secondary ml-3">Seed: {result.parsed.seed}</span>
							{/if}
							{#if result.parsed?.steps}
								<span class="text-xs text-text-secondary ml-3">Steps: {result.parsed.steps}</span>
							{/if}
						</div>
					{/if}

					<!-- Gaps: editable fields -->
					<div class="grid grid-cols-2 gap-3 mt-3">
						<div>
							<label class="block text-xs text-warning font-medium mb-1">Description</label>
							<input
								type="text"
								bind:value={edits[i].description}
								placeholder="What is this asset?"
								class="w-full px-3 py-1.5 bg-app-bg border border-border rounded text-xs text-text-primary
									placeholder:text-text-secondary/40 focus:outline-none focus:ring-1 focus:ring-accent/50"
							/>
						</div>
						<div>
							<label class="block text-xs text-warning font-medium mb-1">Asset Type</label>
							<select
								bind:value={edits[i].assetType}
								class="w-full px-3 py-1.5 bg-app-bg border border-border rounded text-xs text-text-primary
									focus:outline-none focus:ring-1 focus:ring-accent/50"
							>
								{#each ASSET_TYPES as type}
									<option value={type.value}>{type.label}</option>
								{/each}
							</select>
						</div>
						<div>
							<label class="block text-xs text-warning font-medium mb-1">Digital Source Type</label>
							<select
								bind:value={edits[i].digitalSourceType}
								class="w-full px-3 py-1.5 bg-app-bg border border-border rounded text-xs text-text-primary
									focus:outline-none focus:ring-1 focus:ring-accent/50"
							>
								<option value="">-- Select --</option>
								{#each DIGITAL_SOURCE_TYPES as dst}
									<option value={dst.value}>{dst.short}</option>
								{/each}
							</select>
						</div>
						<div>
							<label class="block text-xs text-text-secondary font-medium mb-1">Notes</label>
							<input
								type="text"
								bind:value={edits[i].notes}
								placeholder="Optional notes"
								class="w-full px-3 py-1.5 bg-app-bg border border-border rounded text-xs text-text-primary
									placeholder:text-text-secondary/40 focus:outline-none focus:ring-1 focus:ring-accent/50"
							/>
						</div>
					</div>
				</div>
			</div>
		</Card>
	{/each}
</div>

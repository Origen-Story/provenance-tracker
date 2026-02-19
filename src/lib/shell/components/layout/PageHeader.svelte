<script>
	let { title, description = '' } = $props();
</script>

<div class="mb-6">
	<h2 class="text-2xl font-bold text-text-primary">{title}</h2>
	{#if description}
		<p class="text-sm text-text-secondary mt-1">{description}</p>
	{/if}
</div>

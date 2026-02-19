<script>
	import Badge from '$lib/shell/components/ui/Badge.svelte';
	import { PLATFORMS } from '$lib/core/constants.js';

	let { platform } = $props();

	const info = $derived(PLATFORMS.find((p) => p.value === platform) || PLATFORMS.at(-1));
</script>

<Badge variant={platform}>
	{info.label}
</Badge>

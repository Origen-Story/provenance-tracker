<script>
	let { padding = true, hover = false, children } = $props();
</script>

<div class="bg-card-bg border border-border rounded-xl {padding ? 'p-5' : ''} {hover ? 'hover:bg-card-hover transition-colors cursor-pointer' : ''}">
	{@render children()}
</div>

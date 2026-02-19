<script>
	let { variant = 'default', children } = $props();

	const variants = {
		default: 'bg-card-bg text-text-secondary border-border',
		accent: 'bg-accent/10 text-accent border-accent/20',
		success: 'bg-success/10 text-success border-success/20',
		warning: 'bg-warning/10 text-warning border-warning/20',
		danger: 'bg-danger/10 text-danger border-danger/20',
		midjourney: 'bg-midjourney/10 text-midjourney border-midjourney/20',
		comfyui: 'bg-comfyui/10 text-comfyui border-comfyui/20',
		freepik: 'bg-freepik/10 text-freepik border-freepik/20',
		'meta-ai': 'bg-meta-ai/10 text-meta-ai border-meta-ai/20'
	};
</script>

<span class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border {variants[variant] || variants.default}">
	{@render children()}
</span>

<script>
	let {
		variant = 'primary',
		size = 'md',
		disabled = false,
		type = 'button',
		href = '',
		children,
		onclick,
		...rest
	} = $props();

	const base = 'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-50 disabled:cursor-not-allowed';

	const variants = {
		primary: 'bg-accent hover:bg-accent-hover text-white',
		secondary: 'bg-card-bg hover:bg-card-hover text-text-primary border border-border',
		ghost: 'hover:bg-card-bg text-text-secondary hover:text-text-primary',
		danger: 'bg-danger/10 hover:bg-danger/20 text-danger'
	};

	const sizes = {
		sm: 'px-3 py-1.5 text-xs gap-1.5',
		md: 'px-4 py-2 text-sm gap-2',
		lg: 'px-6 py-3 text-base gap-2.5'
	};
</script>

{#if href}
	<a {href} class="{base} {variants[variant]} {sizes[size]}" {...rest}>
		{@render children()}
	</a>
{:else}
	<button {type} {disabled} {onclick} class="{base} {variants[variant]} {sizes[size]}" {...rest}>
		{@render children()}
	</button>
{/if}

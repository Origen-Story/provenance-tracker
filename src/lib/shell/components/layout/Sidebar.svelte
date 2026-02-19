<script>
	import { page } from '$app/stores';

	const navItems = [
		{ href: '/', label: 'Dashboard', icon: 'grid' },
		{ href: '/import', label: 'Import', icon: 'upload' },
		{ href: '/assets', label: 'Assets', icon: 'image' },
		{ href: '/manifest', label: 'Manifest', icon: 'file-text' },
		{ href: '/export', label: 'Export', icon: 'download' },
		{ href: '/settings', label: 'Settings', icon: 'settings' }
	];

	let { projectName = 'Provenance Tracker' } = $props();
</script>

<aside class="fixed left-0 top-0 h-screen w-60 bg-sidebar-bg border-r border-border flex flex-col z-10">
	<div class="p-5 border-b border-border">
		<h1 class="text-sm font-bold text-text-primary tracking-wide uppercase">Provenance</h1>
		<p class="text-xs text-text-secondary mt-1 truncate">{projectName}</p>
	</div>

	<nav class="flex-1 py-3">
		{#each navItems as item}
			{@const isActive = item.href === '/'
				? $page.url.pathname === '/'
				: $page.url.pathname.startsWith(item.href)}
			<a
				href={item.href}
				class="flex items-center gap-3 px-5 py-2.5 text-sm transition-colors
					{isActive
						? 'text-accent bg-accent/10 border-r-2 border-accent'
						: 'text-text-secondary hover:text-text-primary hover:bg-card-bg'}"
			>
				<svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					{#if item.icon === 'grid'}
						<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
					{:else if item.icon === 'upload'}
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
					{:else if item.icon === 'image'}
						<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
					{:else if item.icon === 'file-text'}
						<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
					{:else if item.icon === 'download'}
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
					{:else if item.icon === 'settings'}
						<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
					{/if}
				</svg>
				{item.label}
			</a>
		{/each}
	</nav>

	<div class="p-4 border-t border-border text-xs text-text-secondary">
		Phase 1 &middot; Local Tool
	</div>
</aside>

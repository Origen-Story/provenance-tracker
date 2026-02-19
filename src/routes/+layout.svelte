<script>
	import '../app.css';
	import AppShell from '$lib/shell/components/layout/AppShell.svelte';

	let { data, children } = $props();
</script>

<svelte:head>
	<title>{data.projectName} - Provenance Tracker</title>
</svelte:head>

<AppShell projectName={data.projectName}>
	{@render children()}
</AppShell>

<script>
	import Sidebar from './Sidebar.svelte';

	let { children, projectName = 'Provenance Tracker' } = $props();
</script>

<div class="min-h-screen bg-app-bg">
	<Sidebar {projectName} />
	<main class="ml-60 p-8">
		{@render children()}
	</main>
</div>

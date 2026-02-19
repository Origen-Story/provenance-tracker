<script>
	import PageHeader from '$lib/shell/components/layout/PageHeader.svelte';
	import Card from '$lib/shell/components/ui/Card.svelte';
	import Button from '$lib/shell/components/ui/Button.svelte';
</script>

<PageHeader title="Dashboard" description="Overview of your provenance tracking project" />

<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
	<Card>
		<p class="text-xs text-text-secondary uppercase tracking-wider mb-1">Total Assets</p>
		<p class="text-3xl font-bold text-text-primary">0</p>
	</Card>
	<Card>
		<p class="text-xs text-text-secondary uppercase tracking-wider mb-1">Avg. Completeness</p>
		<p class="text-3xl font-bold text-text-primary">--</p>
	</Card>
	<Card>
		<p class="text-xs text-text-secondary uppercase tracking-wider mb-1">Manifests</p>
		<p class="text-3xl font-bold text-text-primary">0</p>
	</Card>
</div>

<div class="flex gap-3">
	<Button href="/import">Import Assets</Button>
	<Button variant="secondary" href="/assets">View Catalog</Button>
</div>

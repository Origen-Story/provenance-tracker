<script>
	import PageHeader from '$lib/shell/components/layout/PageHeader.svelte';
	import PathInput from '$lib/import/components/PathInput.svelte';
	import ImportPreview from '$lib/import/components/ImportPreview.svelte';
	import { goto } from '$app/navigation';

	let scanning = $state(false);
	let confirming = $state(false);
	let results = $state(null);
	let error = $state('');

	async function handleScan(inputPath) {
		scanning = true;
		error = '';
		results = null;

		try {
			const res = await fetch('/api/import', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ path: inputPath })
			});

			const data = await res.json();

			if (!res.ok) {
				error = data.error || 'Scan failed';
				return;
			}

			if (data.results.length === 0) {
				error = 'No supported files found at that path.';
				return;
			}

			results = data.results;
		} catch (err) {
			error = 'Network error: ' + err.message;
		} finally {
			scanning = false;
		}
	}

	async function handleConfirm(imports) {
		confirming = true;
		error = '';

		try {
			const res = await fetch('/api/import/confirm', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ imports })
			});

			const data = await res.json();

			if (!res.ok) {
				error = data.error || 'Import failed';
				return;
			}

			goto('/assets');
		} catch (err) {
			error = 'Network error: ' + err.message;
		} finally {
			confirming = false;
		}
	}
</script>

<PageHeader title="Import Assets" description="Scan a folder or file to extract metadata from AI-generated assets" />

{#if error}
	<div class="mb-4 p-3 bg-danger/10 border border-danger/20 rounded-lg text-sm text-danger">
		{error}
	</div>
{/if}

{#if !results}
	<PathInput onsubmit={handleScan} {scanning} />
{:else}
	<div class="mb-4">
		<button
			onclick={() => { results = null; error = ''; }}
			class="text-sm text-text-secondary hover:text-text-primary transition-colors"
		>
			&larr; Back to path input
		</button>
	</div>
	<ImportPreview {results} onconfirm={handleConfirm} {confirming} />
{/if}

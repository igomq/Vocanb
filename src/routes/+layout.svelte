<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#f7f7f5" />
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
	<title>Vocanb</title>
</svelte:head>

{@render children()}

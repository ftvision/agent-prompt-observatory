<script>
  import { onMount } from 'svelte';
  import Nav from './components/Nav.svelte';
  import Inspector from './components/Inspector.svelte';
  import Overview from './views/Overview.svelte';
  import Prompt from './views/Prompt.svelte';
  import Narrative from './views/Narrative.svelte';
  import Lineage from './views/Lineage.svelte';
  import Genome from './views/Genome.svelte';
  import Method from './views/Method.svelte';
  import { loadVersionsMeta, loadLineages, loadGenome, loadEvidenceIndex } from './stores/data.js';

  let route = $state('overview');
  let loading = $state(true);
  let error = $state(null);

  function parseRoute() {
    const hash = window.location.hash.replace('#/', '') || '';
    const base = hash.split('?')[0];
    route = base || 'overview';
  }

  onMount(async () => {
    parseRoute();
    window.addEventListener('hashchange', parseRoute);

    try {
      await loadVersionsMeta();
      await Promise.all([
        loadLineages(),
        loadGenome(),
        loadEvidenceIndex(),
      ]);
      loading = false;
    } catch (e) {
      error = e.message;
      loading = false;
    }

    return () => window.removeEventListener('hashchange', parseRoute);
  });
</script>

<div id="app-root">
  <Nav currentRoute={route} />

  <main>
    {#if loading}
      <div class="loading-state">
        <p>Loading data...</p>
      </div>
    {:else if error}
      <div class="error-state">
        <h2>Error loading data</h2>
        <p>{error}</p>
        <p>Run <code>python -m analyzer</code> from the repo root to generate data.</p>
      </div>
    {:else}
      {#if route === 'overview'}
        <Overview />
      {:else if route === 'prompt'}
        <Prompt />
      {:else if route === 'narrative'}
        <Narrative />
      {:else if route === 'lineage'}
        <Lineage />
      {:else if route === 'genome'}
        <Genome />
      {:else if route === 'method'}
        <Method />
      {:else}
        <Overview />
      {/if}
    {/if}
  </main>

  <Inspector />
</div>

<style>
  #app-root {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  main {
    flex: 1;
  }

  .loading-state,
  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 60vh;
    text-align: center;
    gap: 0.5rem;
  }

  .error-state h2 {
    color: #dc2626;
  }

  .error-state code {
    background: #f5f5f4;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
  }
</style>

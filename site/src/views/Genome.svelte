<script>
  import { onMount } from 'svelte';
  import { genome as genomeStore } from '../stores/data.js';
  import { drawStackedArea, drawLineChart, drawBarChart } from '../lib/charts.js';

  const LAYER_COLORS = {
    identity: '#6366f1', tools: '#06b6d4', safety: '#ef4444', output: '#f59e0b',
    task_execution: '#10b981', memory: '#8b5cf6', environment: '#64748b',
  };
  const LAYERS = ['identity', 'tools', 'safety', 'output', 'task_execution', 'memory', 'environment'];

  let stackedAreaEl = $state(null);
  let stabilityEl = $state(null);
  let churnEl = $state(null);
  let data = $state(null);

  genomeStore.subscribe(v => data = v);

  $effect(() => {
    if (data && stackedAreaEl) renderCharts();
  });

  function renderCharts() {
    if (!data) return;
    if (stackedAreaEl) {
      drawStackedArea(stackedAreaEl, data.growth, { width: 800, height: 300, layers: LAYERS, colors: LAYER_COLORS });
    }
    if (stabilityEl) {
      const stabData = data.stability.map((val, i) => ({ value: val * 100, label: data.versions[i + 1] || '' }));
      drawLineChart(stabilityEl, stabData, { width: 800, height: 200, color: '#6366f1', label: '% Survived' });
    }
    if (churnEl) {
      const churnData = data.churn.map(c => ({ added: c.added, removed: c.removed, label: c.to_version }));
      drawBarChart(churnEl, churnData, { width: 800, height: 200 });
    }
  }
</script>

<div class="page">
  <div class="page-header">
    <h1>Prompt Genome</h1>
    <p>What are the macro trends in how this prompt evolves?</p>
  </div>

  {#if data}
    <div class="chart-container">
      <h3>Prompt Growth by Layer</h3>
      <div class="legend">
        {#each LAYERS as layer}
          <span class="legend-item">
            <span class="legend-dot" style="background: {LAYER_COLORS[layer]}"></span>
            {layer.replace('_', ' ')}
          </span>
        {/each}
      </div>
      <div bind:this={stackedAreaEl}></div>
    </div>

    <div class="chart-container">
      <h3>Stability (% of text surviving each transition)</h3>
      <div bind:this={stabilityEl}></div>
    </div>

    <div class="chart-container">
      <h3>Churn (units added/removed per transition)</h3>
      <div bind:this={churnEl}></div>
    </div>

    {#if data.hotspots?.length > 0}
      <div class="chart-container">
        <h3>Hotspot Sections (most churned)</h3>
        <table class="hotspot-table">
          <thead><tr><th>Section</th><th>Changes</th></tr></thead>
          <tbody>
            {#each data.hotspots.slice(0, 15) as hotspot}
              <tr><td>{hotspot.path}</td><td>{hotspot.total_changes}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    {#if data.rule_density?.length > 0}
      <div class="chart-container">
        <h3>Rule Density Trend</h3>
        <div class="rule-density-table">
          {#each data.versions as version, i}
            <div class="rd-row">
              <span class="rd-version">{version}</span>
              <div class="rd-bar-track">
                <div class="rd-bar" style="width: {(data.rule_density[i] / Math.max(...data.rule_density)) * 100}%"></div>
              </div>
              <span class="rd-value">{(data.rule_density[i] * 1000).toFixed(2)}/1k</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {:else}
    <p class="empty">Loading genome data...</p>
  {/if}
</div>

<style>
  .legend { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 0.75rem; font-size: 0.8rem; }
  .legend-item { display: flex; align-items: center; gap: 0.25rem; }
  .legend-dot { width: 10px; height: 10px; border-radius: 2px; }
  .hotspot-table { width: 100%; font-size: 0.85rem; border-collapse: collapse; }
  .hotspot-table th, .hotspot-table td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); }
  .hotspot-table th { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .rule-density-table { max-width: 600px; }
  .rd-row { display: grid; grid-template-columns: 100px 1fr 60px; gap: 0.75rem; align-items: center; padding: 0.25rem 0; }
  .rd-version { font-size: 0.8rem; color: var(--text-secondary); }
  .rd-bar-track { height: 12px; background: var(--bg-active); border-radius: 6px; overflow: hidden; }
  .rd-bar { height: 100%; background: var(--accent); border-radius: 6px; min-width: 2px; }
  .rd-value { font-size: 0.75rem; color: var(--text-muted); text-align: right; }
</style>

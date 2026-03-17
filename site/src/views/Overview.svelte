<script>
  import { versionsMeta } from '../stores/data.js';

  let meta = $state([]);
  versionsMeta.subscribe(v => meta = v);

  let latest = $derived(meta.length > 0 ? meta[meta.length - 1] : null);
  let totalVersions = $derived(meta.length);

  const views = [
    { id: 'prompt', label: 'Annotated Prompt', desc: 'Read the full prompt with functional layer annotations and stability badges.' },
    { id: 'narrative', label: 'Change Narrative', desc: 'Classified change feed between any two versions.' },
    { id: 'lineage', label: 'Idea Lineage', desc: 'Track how specific concepts evolve across the full history.' },
    { id: 'genome', label: 'Prompt Genome', desc: 'Macro trends: growth, stability, churn, and rule density.' },
    { id: 'method', label: 'Method & Provenance', desc: 'Pipeline diagram, heuristic rules, and known limitations.' },
  ];
</script>

<div class="page">
  <div class="page-header">
    <h1>Prompt Drift Observatory</h1>
    <p>How does the Claude Code team adapt their system prompt based on what they learn?</p>
  </div>

  {#if latest}
    <div class="stat-grid">
      <div class="stat-card">
        <div class="label">Versions Analyzed</div>
        <div class="value">{totalVersions}</div>
      </div>
      <div class="stat-card">
        <div class="label">Latest Version</div>
        <div class="value">{latest.version}</div>
      </div>
      <div class="stat-card">
        <div class="label">Release Date</div>
        <div class="value">{latest.release_date || 'Unknown'}</div>
      </div>
      <div class="stat-card">
        <div class="label">Sections</div>
        <div class="value">{latest.section_count}</div>
      </div>
      <div class="stat-card">
        <div class="label">Units</div>
        <div class="value">{latest.unit_count}</div>
      </div>
      <div class="stat-card">
        <div class="label">Prompt Size</div>
        <div class="value">{(latest.total_chars / 1000).toFixed(1)}k</div>
      </div>
    </div>

    <h2>Explore</h2>
    <div class="card-grid" style="margin-top: 0.75rem;">
      {#each views as view}
        <a class="view-card card" href="#/{view.id}">
          <h3>{view.label}</h3>
          <p>{view.desc}</p>
        </a>
      {/each}
    </div>

    {#if latest.layer_distribution}
      <h2 style="margin-top: 2rem;">Layer Distribution (Latest)</h2>
      <div class="layer-bars" style="margin-top: 0.75rem;">
        {#each Object.entries(latest.layer_distribution).sort((a, b) => b[1] - a[1]) as [layer, count]}
          <div class="layer-bar-row">
            <span class="layer-name">{layer.replace('_', ' ')}</span>
            <div class="layer-bar-track">
              <div class="layer-bar-fill layer-{layer}" style="width: {(count / latest.unit_count * 100).toFixed(1)}%"></div>
            </div>
            <span class="layer-count">{count}</span>
          </div>
        {/each}
      </div>
    {/if}
  {:else}
    <p class="empty">Loading data...</p>
  {/if}
</div>

<style>
  .view-card { display: block; transition: border-color 0.15s, transform 0.15s; }
  .view-card:hover { border-color: var(--accent); transform: translateY(-2px); text-decoration: none; }
  .view-card h3 { color: var(--accent); margin-bottom: 0.375rem; }
  .view-card p { font-size: 0.85rem; color: var(--text-secondary); }
  .layer-bars { max-width: 600px; }
  .layer-bar-row { display: grid; grid-template-columns: 100px 1fr 40px; gap: 0.75rem; align-items: center; padding: 0.375rem 0; }
  .layer-name { font-size: 0.8rem; text-transform: capitalize; color: var(--text-secondary); }
  .layer-bar-track { height: 16px; background: var(--bg-active); border-radius: 8px; overflow: hidden; }
  .layer-bar-fill { height: 100%; border-radius: 8px; background: var(--layer-color); min-width: 4px; transition: width 0.3s; }
  .layer-count { font-size: 0.8rem; color: var(--text-muted); text-align: right; }
</style>

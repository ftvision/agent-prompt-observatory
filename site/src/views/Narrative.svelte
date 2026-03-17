<script>
  import { versions as versionsStore, allTransitions as allTransStore, loadTransition } from '../stores/data.js';
  import { compareFrom, compareTo } from '../stores/ui.js';
  import VersionSelector from '../components/VersionSelector.svelte';
  import ClassificationPill from '../components/ClassificationPill.svelte';
  import LayerBadge from '../components/LayerBadge.svelte';
  import DiffBlock from '../components/DiffBlock.svelte';

  let allVers = $state([]);
  let allTrans = $state({});
  let transition = $state(null);
  let loading = $state(false);
  let filterClass = $state('');
  let filterLayer = $state('');
  let searchText = $state('');
  let fromVer = $state('');
  let toVer = $state('');

  versionsStore.subscribe(v => {
    allVers = v;
    if (!fromVer && v.length >= 2) fromVer = v[v.length - 2];
    if (!toVer && v.length >= 1) toVer = v[v.length - 1];
  });
  allTransStore.subscribe(v => allTrans = v);
  compareFrom.subscribe(v => { if (v) fromVer = v; });
  compareTo.subscribe(v => { if (v) toVer = v; });

  $effect(() => {
    if (fromVer && toVer && fromVer !== toVer) loadPair(fromVer, toVer);
  });

  async function loadPair(from, to) {
    const key = `${from}_${to}`;
    if (allTrans[key]) {
      transition = allTrans[key];
      return;
    }
    loading = true;
    try {
      transition = await loadTransition(from, to);
    } catch (e) {
      transition = null;
    }
    loading = false;
  }

  let changes = $derived(transition?.changes || []);
  let summary = $derived(transition?.summary || {});

  let filteredChanges = $derived.by(() => {
    return changes.filter(c => {
      if (filterClass && c.classification !== filterClass) return false;
      if (filterLayer && c.layer !== filterLayer) return false;
      if (searchText) {
        const s = searchText.toLowerCase();
        const bt = (c.before_text || '').toLowerCase();
        const at = (c.after_text || '').toLowerCase();
        if (!bt.includes(s) && !at.includes(s)) return false;
      }
      return true;
    });
  });

  let classifications = $derived([...new Set(changes.map(c => c.classification))].sort());
  let layers = $derived([...new Set(changes.map(c => c.layer).filter(Boolean))].sort());

  function summaryLine(s) {
    return Object.entries(s).map(([cls, count]) => `${count} ${cls.replace(/_/g, ' ')}`).join(', ');
  }
</script>

<div class="page">
  <div class="page-header">
    <h1>Change Narrative</h1>
    <p>What decisions were made between version A and B?</p>
  </div>

  <div class="toolbar">
    <VersionSelector versions={allVers} selected={fromVer} label="From" onchange={(v) => { fromVer = v; compareFrom.set(v); }} />
    <VersionSelector versions={allVers} selected={toVer} label="To" onchange={(v) => { toVer = v; compareTo.set(v); }} />

    <div class="separator"></div>

    <select bind:value={filterClass}>
      <option value="">All types</option>
      {#each classifications as cls}
        <option value={cls}>{cls.replace(/_/g, ' ')}</option>
      {/each}
    </select>

    <select bind:value={filterLayer}>
      <option value="">All layers</option>
      {#each layers as layer}
        <option value={layer}>{layer.replace(/_/g, ' ')}</option>
      {/each}
    </select>

    <input type="text" placeholder="Search..." bind:value={searchText} class="search-input" />
  </div>

  {#if loading}
    <p class="empty">Loading transition...</p>
  {:else if transition}
    <div class="summary-bar card">
      <strong>{changes.length} changes:</strong>
      {summaryLine(summary)}
      <span class="pill" style="margin-left: 0.5rem;">Stability: {(transition.stability_ratio * 100).toFixed(1)}%</span>
    </div>

    <div class="change-feed">
      {#each filteredChanges as change}
        <div class="change-card card">
          <div class="pill-row">
            <ClassificationPill classification={change.classification} isOverride={change.is_override} />
            {#if change.layer}
              <LayerBadge layer={change.layer} />
            {/if}
            <span class="pill">{change.after_path || change.before_path || ''}</span>
            {#if change.similarity != null}
              <span class="pill">Sim: {(change.similarity * 100).toFixed(0)}%</span>
            {/if}
            <span class="pill">Conf: {(change.confidence * 100).toFixed(0)}%</span>
          </div>
          <DiffBlock beforeText={change.before_text || ''} afterText={change.after_text || ''} similarity={change.similarity} />
          {#if change.is_override && change.override_note}
            <p class="override-note">Note: {change.override_note}</p>
          {/if}
          <div class="change-signals" style="margin-top: 0.5rem;">
            {#each change.signals || [] as signal}
              <span class="pill">{signal}</span>
            {/each}
          </div>
        </div>
      {/each}
      {#if filteredChanges.length === 0}
        <p class="empty">No changes match the current filters.</p>
      {/if}
    </div>
  {:else}
    <p class="empty">Select two different versions to compare.</p>
  {/if}
</div>

<style>
  .summary-bar { margin-bottom: 1rem; font-size: 0.9rem; }
  .change-feed { display: flex; flex-direction: column; gap: 0.75rem; }
  .change-card { transition: border-color 0.15s; }
  .change-card:hover { border-color: var(--accent); }
  .override-note { font-size: 0.8rem; font-style: italic; color: var(--text-secondary); margin-top: 0.375rem; }
  .search-input { padding: 0.375rem 0.625rem; border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 0.875rem; width: 160px; }
  select { padding: 0.375rem 0.5rem; border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 0.875rem; background: var(--bg); }
</style>

<script>
  import { onMount } from 'svelte';
  import { versions as versionsStore, latestVersion, loadSnapshot, allSnapshots } from '../stores/data.js';
  import { fetchRawMarkdown } from '../lib/api.js';
  import { selectedVersion, showRendered, showLayers, showStability, showCrossRefs, compareMode, compareVersion } from '../stores/ui.js';
  import VersionSelector from '../components/VersionSelector.svelte';
  import LayerBadge from '../components/LayerBadge.svelte';
  import StabilityBadge from '../components/StabilityBadge.svelte';
  import UnitCard from '../components/UnitCard.svelte';

  let allVersions = $state([]);
  let latestVer = $state(null);
  let snapshot = $state(null);
  let compareSnap = $state(null);
  let rawMarkdown = $state('');
  let loading = $state(false);
  let selVer = $state(null);
  let isRendered = $state(true);
  let isLayers = $state(true);
  let isStability = $state(true);
  let isCrossRefs = $state(false);
  let isCompare = $state(false);
  let compareVer = $state(null);
  let snapshots = $state({});

  versionsStore.subscribe(v => allVersions = v);
  latestVersion.subscribe(v => latestVer = v);
  selectedVersion.subscribe(v => selVer = v);
  showRendered.subscribe(v => isRendered = v);
  showLayers.subscribe(v => isLayers = v);
  showStability.subscribe(v => isStability = v);
  showCrossRefs.subscribe(v => isCrossRefs = v);
  compareMode.subscribe(v => isCompare = v);
  compareVersion.subscribe(v => compareVer = v);
  allSnapshots.subscribe(v => snapshots = v);

  let currentVer = $derived(selVer || latestVer);

  $effect(() => {
    if (currentVer) loadVersion(currentVer);
  });

  async function loadVersion(ver) {
    loading = true;
    snapshot = snapshots[ver] || await loadSnapshot(ver);
    loading = false;
  }

  function onVersionChange(ver) {
    selectedVersion.set(ver);
  }

  async function onCompareChange(ver) {
    compareVersion.set(ver);
    compareSnap = snapshots[ver] || await loadSnapshot(ver);
  }

  // Fetch raw markdown when switching to raw mode
  $effect(() => {
    if (!isRendered && currentVer && !rawMarkdown) {
      fetchRawMarkdown(currentVer).then(md => rawMarkdown = md).catch(() => rawMarkdown = '(Failed to load raw markdown)');
    }
    if (isRendered) rawMarkdown = '';
  });

  let compareUnitIds = $derived(
    compareSnap ? new Set(compareSnap.sections.flatMap(s => s.units.map(u => u.id))) : new Set()
  );
</script>

<div class="page">
  <div class="page-header">
    <h1>Annotated Prompt Text</h1>
    <p>What is this prompt trying to make the model do?</p>
  </div>

  <div class="toolbar">
    <VersionSelector versions={allVersions} selected={currentVer || ''} label="Version" onchange={onVersionChange} />

    <div class="separator"></div>

    <label>
      <span class="toggle-switch" class:active={isRendered} onclick={() => showRendered.update(v => !v)} role="switch" tabindex="0" aria-checked={isRendered}></span>
      Rendered
    </label>
    <label>
      <span class="toggle-switch" class:active={isLayers} onclick={() => showLayers.update(v => !v)} role="switch" tabindex="0" aria-checked={isLayers}></span>
      Layers
    </label>
    <label>
      <span class="toggle-switch" class:active={isStability} onclick={() => showStability.update(v => !v)} role="switch" tabindex="0" aria-checked={isStability}></span>
      Stability
    </label>
    <label>
      <span class="toggle-switch" class:active={isCrossRefs} onclick={() => showCrossRefs.update(v => !v)} role="switch" tabindex="0" aria-checked={isCrossRefs}></span>
      Cross-refs
    </label>

    <div class="separator"></div>

    <label>
      <span class="toggle-switch" class:active={isCompare} onclick={() => compareMode.update(v => !v)} role="switch" tabindex="0" aria-checked={isCompare}></span>
      Compare
    </label>
    {#if isCompare}
      <VersionSelector versions={allVersions} selected={compareVer || ''} label="With" onchange={onCompareChange} />
    {/if}
  </div>

  {#if loading}
    <p class="empty">Loading...</p>
  {:else if snapshot}
    <div class="prompt-reader">
      {#each snapshot.sections as section}
        <section class="prompt-section">
          <div class="section-header">
            <h2 class="section-path">{section.path}</h2>
            <span class="pill">{section.unit_count} units</span>
          </div>

          {#if isRendered}
            <div class="section-body rendered">
              {#each section.units as unit}
                <div class="unit-row" class:diff-added={isCompare && compareSnap && !compareUnitIds.has(unit.id)}>
                  {#if isLayers}
                    <div class="gutter-left">
                      <div class="layer-bar layer-{unit.layer}" title={unit.layer}></div>
                    </div>
                  {/if}
                  <div class="unit-content">
                    <UnitCard {unit} showLayer={isLayers} showStability={isStability} compact />
                  </div>
                  {#if isStability && unit.stability}
                    <div class="gutter-right">
                      <StabilityBadge stability={unit.stability} />
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {:else}
            {#if rawMarkdown}
              <pre class="section-raw">{rawMarkdown}</pre>
            {:else}
              <p class="empty">Loading raw text...</p>
            {/if}
          {/if}
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  .prompt-reader { max-width: var(--reading-width); margin: 0 auto; }
  .prompt-section { margin-bottom: 2rem; }
  .section-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border); }
  .section-path { font-size: 1rem; font-weight: 600; }
  .unit-row { display: flex; gap: 0.5rem; align-items: stretch; padding: 0.125rem 0; }
  .gutter-left { width: var(--gutter-width); display: flex; justify-content: center; flex-shrink: 0; padding: 0.375rem 0; }
  .unit-content { flex: 1; min-width: 0; }
  .gutter-right { width: 140px; flex-shrink: 0; display: flex; align-items: center; justify-content: flex-end; }
  .section-raw { font-size: 0.8rem; line-height: 1.5; white-space: pre-wrap; word-break: break-word; max-height: 600px; overflow-y: auto; }
</style>

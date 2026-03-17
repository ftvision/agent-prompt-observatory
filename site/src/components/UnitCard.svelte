<script>
  import LayerBadge from './LayerBadge.svelte';
  import StabilityBadge from './StabilityBadge.svelte';
  import { inspectorOpen, inspectorUnitId } from '../stores/ui.js';

  let { unit = {}, showLayer = true, showStability = true, compact = false } = $props();

  function openInspector() {
    inspectorUnitId.set(unit.id);
    inspectorOpen.set(true);
  }
</script>

<button class="unit-card" class:compact onclick={openInspector}>
  <div class="unit-badges">
    {#if showLayer && unit.layer}
      <LayerBadge layer={unit.layer} confidence={unit.layer_confidence} />
    {/if}
    {#if showStability && unit.stability}
      <StabilityBadge stability={unit.stability} />
    {/if}
  </div>
  <p class="unit-text">{unit.text}</p>
</button>

<style>
  .unit-card { display: block; width: 100%; text-align: left; padding: 0.625rem 0.75rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; transition: background 0.15s, border-color 0.15s; font: inherit; }
  .unit-card:hover { background: var(--bg-hover); border-color: var(--accent); }
  .unit-card.compact { padding: 0.375rem 0.625rem; }
  .unit-badges { display: flex; gap: 0.375rem; margin-bottom: 0.375rem; flex-wrap: wrap; }
  .unit-text { font-size: 0.85rem; color: var(--text); line-height: 1.5; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
  .compact .unit-text { -webkit-line-clamp: 2; font-size: 0.8rem; }
</style>

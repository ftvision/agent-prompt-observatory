<script>
  import { inspectorOpen, inspectorUnitId } from '../stores/ui.js';
  import { evidenceIndex } from '../stores/data.js';
  import { get } from 'svelte/store';
  import LayerBadge from './LayerBadge.svelte';
  import StabilityBadge from './StabilityBadge.svelte';
  import ClassificationPill from './ClassificationPill.svelte';
  import DiffBlock from './DiffBlock.svelte';

  let isOpen = $state(false);
  let unitId = $state(null);
  let evidence = $state({});
  let entry = $derived(unitId && evidence[unitId] ? evidence[unitId] : null);

  inspectorOpen.subscribe(v => isOpen = v);
  inspectorUnitId.subscribe(v => unitId = v);
  evidenceIndex.subscribe(v => evidence = v);

  function close() {
    inspectorOpen.set(false);
    inspectorUnitId.set(null);
  }
</script>

{#if isOpen && entry}
  <div class="inspector-overlay" onclick={close} onkeydown={(e) => e.key === 'Escape' && close()} role="button" tabindex="0"></div>
  <aside class="inspector-panel">
    <header class="inspector-header">
      <h2>Evidence Inspector</h2>
      <button class="inspector-close" onclick={close}>&times;</button>
    </header>

    <div class="inspector-body">
      <section class="inspector-section">
        <h3>Unit Text</h3>
        <p class="unit-full-text">{entry.text}</p>
      </section>

      {#if entry.stability}
        <section class="inspector-section">
          <h3>Stability</h3>
          <StabilityBadge stability={entry.stability} />
          <div class="meta-list">
            <div><strong>First seen:</strong> {entry.stability.first_seen}</div>
            <div><strong>Last seen:</strong> {entry.stability.last_seen}</div>
            <div><strong>Appearances:</strong> {entry.stability.appearance_count}</div>
            <div><strong>Status:</strong> {entry.stability.status}</div>
          </div>
        </section>
      {/if}

      <section class="inspector-section">
        <h3>Version History ({entry.versions?.length || 0})</h3>
        {#each entry.versions || [] as ver}
          <div class="version-entry">
            <span class="pill">{ver.version}</span>
            <span class="version-path">{ver.section_path}</span>
            {#if ver.layer}
              <LayerBadge layer={ver.layer} />
            {/if}
          </div>
        {/each}
      </section>

      {#if entry.changes?.length > 0}
        <section class="inspector-section">
          <h3>Changes ({entry.changes.length})</h3>
          {#each entry.changes as change}
            <div class="change-entry">
              <div class="pill-row">
                <span class="pill">{change.transition}</span>
                <ClassificationPill classification={change.classification} isOverride={change.is_override} />
              </div>
              {#if change.before_text}
                <DiffBlock beforeText={change.before_text} afterText={entry.text} similarity={change.similarity} />
              {/if}
              {#if change.is_override && change.override_note}
                <p class="override-note">Note: {change.override_note}</p>
              {/if}
              <div class="change-signals">
                {#each change.signals || [] as signal}
                  <span class="pill">{signal}</span>
                {/each}
              </div>
            </div>
          {/each}
        </section>
      {/if}

      {#if entry.lineages?.length > 0}
        <section class="inspector-section">
          <h3>Lineages</h3>
          {#each entry.lineages as lin}
            <a class="lineage-link" href="#/lineage?id={lin.lineage_id}">
              {lin.lineage_title}
            </a>
          {/each}
        </section>
      {/if}

      {#if entry.cross_refs?.length > 0}
        <section class="inspector-section">
          <h3>Cross-References ({entry.cross_refs.length})</h3>
          {#each entry.cross_refs as xref}
            <div class="xref-entry">
              <button class="xref-link" onclick={() => { inspectorUnitId.set(xref.other_unit_id); }}>
                {xref.other_path}
              </button>
              <span class="pill">Sim: {(xref.similarity * 100).toFixed(0)}%</span>
            </div>
          {/each}
        </section>
      {/if}
    </div>
  </aside>
{/if}

<style>
  .inspector-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.3); z-index: 200; }
  .inspector-panel { position: fixed; top: 0; right: 0; width: var(--inspector-width); max-width: 90vw; height: 100vh; background: var(--bg-inspector); border-left: 1px solid var(--border); z-index: 201; display: flex; flex-direction: column; box-shadow: var(--shadow-lg); }
  .inspector-header { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border); }
  .inspector-header h2 { font-size: 1rem; }
  .inspector-close { font-size: 1.5rem; background: none; border: none; cursor: pointer; color: var(--text-muted); padding: 0 0.25rem; }
  .inspector-body { flex: 1; overflow-y: auto; padding: 1rem 1.25rem; }
  .inspector-section { margin-bottom: 1.5rem; }
  .inspector-section h3 { font-size: 0.85rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; }
  .unit-full-text { font-family: var(--font-mono); font-size: 0.8rem; line-height: 1.6; padding: 0.75rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-sm); }
  .meta-list { font-size: 0.8rem; margin-top: 0.5rem; }
  .meta-list div { padding: 0.25rem 0; }
  .version-entry { display: flex; align-items: center; gap: 0.375rem; padding: 0.375rem 0; font-size: 0.8rem; flex-wrap: wrap; }
  .version-path { color: var(--text-secondary); font-size: 0.8rem; }
  .change-entry { padding: 0.75rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-sm); margin-bottom: 0.5rem; }
  .override-note { font-size: 0.8rem; font-style: italic; color: var(--text-secondary); margin-top: 0.375rem; }
  .change-signals { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 0.375rem; }
  .lineage-link { display: block; padding: 0.375rem 0; font-size: 0.85rem; }
  .xref-entry { display: flex; align-items: center; gap: 0.5rem; padding: 0.375rem 0; }
  .xref-link { background: none; border: none; color: var(--accent); cursor: pointer; font-size: 0.8rem; padding: 0; }
  .xref-link:hover { text-decoration: underline; }
</style>

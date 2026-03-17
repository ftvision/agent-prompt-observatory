<script>
  import { lineages as lineagesStore, versions as versionsStore } from '../stores/data.js';
  import LayerBadge from '../components/LayerBadge.svelte';
  import TimelineDots from '../components/TimelineDots.svelte';

  let allLineages = $state([]);
  let allVers = $state([]);
  let selectedId = $state(null);

  lineagesStore.subscribe(v => allLineages = v || []);
  versionsStore.subscribe(v => allVers = v);

  let sorted = $derived(
    [...allLineages].sort((a, b) =>
      (b.versions_spanned * b.sections_spanned) - (a.versions_spanned * a.sections_spanned)
    )
  );

  let selected = $derived(sorted.find(l => l.id === selectedId) || sorted[0] || null);

  $effect(() => {
    if (sorted.length > 0 && !selectedId) selectedId = sorted[0].id;
  });

  let presenceVersions = $derived(
    selected ? selected.version_presence.map(i => allVers[i] || '') : []
  );

  let eventMap = $derived.by(() => {
    if (!selected) return {};
    const m = {};
    for (const ev of selected.events || []) {
      m[ev.version] = ev.event_type;
    }
    return m;
  });

  function handleDotClick(version) {
    window.location.hash = `#/prompt?version=${version}`;
  }

  // Parse hash params on load
  $effect(() => {
    const hash = window.location.hash;
    const match = hash.match(/[?&]id=([^&]*)/);
    if (match) {
      const idParam = decodeURIComponent(match[1]);
      if (idParam !== selectedId) selectedId = idParam;
    }
  });
</script>

<div class="page">
  <div class="page-header">
    <h1>Idea Lineage</h1>
    <p>How has a specific concept evolved across the full history?</p>
  </div>

  {#if sorted.length > 0}
    <div class="sidebar-layout">
      <div class="sidebar">
        {#each sorted as lineage}
          <button
            class="sidebar-item"
            class:active={lineage.id === selectedId}
            onclick={() => selectedId = lineage.id}
          >
            <strong>{lineage.title}</strong>
            <br />
            <span>{lineage.versions_spanned}v / {lineage.sections_spanned}s</span>
          </button>
        {/each}
      </div>

      <div class="lineage-main">
        {#if selected}
          <div class="lineage-header">
            <h2>{selected.title}</h2>
            <LayerBadge layer={selected.layer} />
          </div>

          <div class="stat-grid">
            <div class="stat-card">
              <div class="label">Versions Spanned</div>
              <div class="value">{selected.versions_spanned}</div>
            </div>
            <div class="stat-card">
              <div class="label">Sections</div>
              <div class="value">{selected.sections_spanned}</div>
            </div>
            <div class="stat-card">
              <div class="label">Units</div>
              <div class="value">{selected.unit_ids?.length || 0}</div>
            </div>
          </div>

          <div class="card" style="margin-bottom: 1rem;">
            <h3 style="margin-bottom: 0.5rem;">Timeline</h3>
            <TimelineDots
              versions={allVers}
              presence={presenceVersions}
              events={eventMap}
              onDotClick={handleDotClick}
            />
          </div>

          {#if selected.events?.length > 0}
            <h3>Events</h3>
            <div class="event-log">
              {#each selected.events as event}
                <div class="event-entry card">
                  <div class="pill-row">
                    <span class="pill">{event.version}</span>
                    <span class="cls-pill cls-{event.event_type === 'introduced' ? 'new_policy' : event.event_type === 'tightened' ? 'policy_tightening' : event.event_type === 'relaxed' ? 'policy_relaxation' : 'wording_refinement'}">{event.event_type}</span>
                  </div>
                  <p class="event-path">{event.section_path}</p>
                  <p class="event-detail">{event.detail}</p>
                </div>
              {/each}
            </div>
          {/if}

          {#if selected.sections?.length > 0}
            <h3 style="margin-top: 1rem;">Active Sections</h3>
            <div class="sections-list">
              {#each selected.sections as path}
                <div class="pill" style="margin: 0.25rem 0;">{path}</div>
              {/each}
            </div>
          {/if}
        {/if}
      </div>
    </div>
  {:else}
    <p class="empty">No lineages detected. Run the analyzer to generate data.</p>
  {/if}
</div>

<style>
  .lineage-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; }
  .event-log { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.5rem; }
  .event-path { font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.25rem; }
  .event-detail { font-size: 0.85rem; margin-top: 0.25rem; font-family: var(--font-mono); line-height: 1.4; }
</style>

<script>
  let { versions = [], presence = [], events = {}, onDotClick = null } = $props();

  const eventColors = {
    introduced: '#6366f1',
    refined: '#f59e0b',
    tightened: '#ef4444',
    relaxed: '#10b981',
    moved: '#64748b',
    removed: '#78716c',
  };
</script>

<div class="timeline-strip">
  {#each versions as version, i}
    {@const isPresent = presence.includes(version)}
    {@const event = events[version]}
    <button
      class="timeline-dot"
      class:present={isPresent}
      class:absent={!isPresent}
      style={event ? `background: ${eventColors[event] || '#888'}` : ''}
      title={`${version}${event ? ` (${event})` : ''}${isPresent ? '' : ' - absent'}`}
      onclick={() => onDotClick && onDotClick(version)}
    >
      <span class="dot-inner" class:filled={isPresent} class:hollow={!isPresent}></span>
    </button>
    {#if i < versions.length - 1}
      <span class="timeline-connector" class:active={isPresent}></span>
    {/if}
  {/each}
</div>

<style>
  .timeline-strip { display: flex; align-items: center; gap: 0; padding: 0.5rem 0; overflow-x: auto; }
  .timeline-dot { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: none; background: transparent; cursor: pointer; padding: 0; flex-shrink: 0; }
  .dot-inner { width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--accent); transition: all 0.15s; }
  .dot-inner.filled { background: var(--accent); }
  .dot-inner.hollow { background: transparent; border-color: var(--border-strong); }
  .timeline-dot:hover .dot-inner { transform: scale(1.3); }
  .timeline-connector { width: 12px; height: 2px; background: var(--border); flex-shrink: 0; }
  .timeline-connector.active { background: var(--accent); opacity: 0.4; }
</style>

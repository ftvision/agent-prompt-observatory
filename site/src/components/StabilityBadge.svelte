<script>
  let { stability = {} } = $props();

  let status = $derived(stability?.status || 'unknown');

  let label = $derived.by(() => {
    const s = stability;
    if (!s || !s.status) return '';
    switch (s.status) {
      case 'stable': return `Stable since ${s.consecutive_since}`;
      case 'recent': return `Added in ${s.first_seen}`;
      case 'volatile': return `Changed ${s.appearance_count}x`;
      case 'legacy': return `Last seen ${s.last_seen}`;
      default: return '';
    }
  });
</script>

{#if label}
  <span class="pill stability-{status}" title={`First: ${stability.first_seen}, Last: ${stability.last_seen}, Seen: ${stability.appearance_count}x`}>
    {label}
  </span>
{/if}

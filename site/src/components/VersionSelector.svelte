<script>
  let { versions = [], selected = '', label = 'Version', onchange = () => {} } = $props();
</script>

<label class="version-selector">
  <span class="vs-label">{label}</span>
  <select value={selected} onchange={(e) => onchange(e.target.value)}>
    {#each versions as v}
      <option value={v}>{v}</option>
    {/each}
  </select>
</label>

<style>
  .version-selector { display: flex; align-items: center; gap: 0.375rem; font-size: 0.875rem; }
  .vs-label { color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
  select { padding: 0.375rem 0.5rem; border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 0.875rem; background: var(--bg); }
</style>

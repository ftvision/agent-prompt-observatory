<script>
  let { currentRoute = 'overview' } = $props();

  const routes = [
    { id: 'overview', label: 'Overview' },
    { id: 'prompt', label: 'Prompt' },
    { id: 'narrative', label: 'Narrative' },
    { id: 'lineage', label: 'Lineage' },
    { id: 'genome', label: 'Genome' },
    { id: 'method', label: 'Method' },
  ];
</script>

<header class="nav">
  <div class="nav-brand">
    <a href="#/" onclick={(e) => { e.preventDefault(); window.location.hash = '#/'; }}>
      Prompt Drift Observatory
    </a>
    <span class="nav-version">v2</span>
  </div>
  <nav class="nav-links">
    {#each routes as route}
      <a
        class="nav-link"
        class:active={currentRoute === route.id}
        href="#{route.id === 'overview' ? '/' : '/' + route.id}"
        onclick={(e) => { e.preventDefault(); window.location.hash = route.id === 'overview' ? '#/' : '#/' + route.id; }}
      >
        {route.label}
      </a>
    {/each}
  </nav>
</header>

<style>
  .nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: var(--nav-height);
    padding: 0 2rem;
    background: var(--bg-card);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 100;
  }
  .nav-brand { display: flex; align-items: center; gap: 0.5rem; }
  .nav-brand a { font-weight: 700; font-size: 0.95rem; color: var(--text); text-decoration: none; }
  .nav-version { font-size: 0.7rem; padding: 0.1rem 0.35rem; background: var(--accent); color: white; border-radius: var(--radius-sm); font-weight: 600; }
  .nav-links { display: flex; gap: 0.25rem; }
  .nav-link { padding: 0.375rem 0.75rem; font-size: 0.85rem; color: var(--text-secondary); border-radius: var(--radius-sm); text-decoration: none; transition: background 0.15s; }
  .nav-link:hover { background: var(--bg-hover); text-decoration: none; }
  .nav-link.active { background: var(--accent-light); color: var(--accent); font-weight: 500; }
</style>

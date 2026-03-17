<script>
  let { beforeText = '', afterText = '', similarity = null } = $props();
</script>

<div class="diff-block">
  {#if beforeText && afterText}
    <div class="diff-row">
      <div class="diff-cell diff-removed">
        <span class="diff-label">Before</span>
        <p>{beforeText}</p>
      </div>
      <div class="diff-cell diff-added">
        <span class="diff-label">After</span>
        <p>{afterText}</p>
      </div>
    </div>
    {#if similarity != null}
      <div class="diff-meta">Similarity: {(similarity * 100).toFixed(1)}%</div>
    {/if}
  {:else if afterText}
    <div class="diff-cell diff-added">
      <span class="diff-label">Added</span>
      <p>{afterText}</p>
    </div>
  {:else if beforeText}
    <div class="diff-cell diff-removed">
      <span class="diff-label">Removed</span>
      <p>{beforeText}</p>
    </div>
  {/if}
</div>

<style>
  .diff-block { font-size: 0.875rem; border-radius: var(--radius-sm); overflow: hidden; }
  .diff-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--border); }
  .diff-cell { padding: 0.625rem 0.75rem; }
  .diff-label { display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem; opacity: 0.7; }
  .diff-cell p { font-family: var(--font-mono); font-size: 0.8rem; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
  .diff-meta { font-size: 0.75rem; color: var(--text-muted); padding: 0.375rem 0.75rem; background: var(--bg); }
</style>

<script>
  let { classification = '', isOverride = false } = $props();

  const labels = {
    new_policy: 'New Policy',
    policy_tightening: 'Tightening',
    policy_relaxation: 'Relaxation',
    model_calibration: 'Calibration',
    structural_reorg: 'Reorg',
    wording_refinement: 'Refinement',
  };
</script>

<span class="cls-pill cls-{classification}">
  {labels[classification] || classification}
  {#if isOverride}
    <span class="override-badge" title="Manually annotated">*</span>
  {/if}
</span>

<style>
  .override-badge { font-weight: 700; margin-left: 0.125rem; }
</style>

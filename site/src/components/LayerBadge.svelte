<script>
  let { layer = '', confidence = null } = $props();

  const labels = {
    identity: 'Identity',
    tools: 'Tools',
    safety: 'Safety',
    output: 'Output',
    task_execution: 'Task',
    memory: 'Memory',
    environment: 'Env',
  };
</script>

<span class="layer-badge layer-{layer}" title={confidence != null ? `Confidence: ${(confidence * 100).toFixed(0)}%` : ''}>
  {labels[layer] || layer}
</span>

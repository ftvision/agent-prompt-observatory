<script>
  import { versionsMeta, lineages as lineagesStore, genome as genomeStore } from '../stores/data.js';

  let meta = $state([]);
  let lineageCount = $state(0);

  versionsMeta.subscribe(v => meta = v);
  lineagesStore.subscribe(v => lineageCount = (v || []).length);

  let totalVersions = $derived(meta.length);
  let latest = $derived(meta.length > 0 ? meta[meta.length - 1] : null);

  const pipeline = [
    { step: 'Fetch', module: 'fetcher.py', desc: 'Download all available prompt versions from cchistory API. Cache raw markdown in data/raw/.' },
    { step: 'Parse', module: 'parser.py', desc: 'Split markdown into section trees with H1/H2 hierarchy. Extract units (sentences, bullets, code) with char offsets.' },
    { step: 'Layer Tag', module: 'layers.py', desc: 'Classify each unit into a functional layer (identity, tools, safety, output, task, memory, env) using path + content heuristics.' },
    { step: 'Fuzzy Match', module: 'matcher.py', desc: 'Match units across consecutive versions. Exact (SHA) first, then trigram Jaccard fuzzy (>=0.65), then cross-section moves (>=0.75).' },
    { step: 'Classify', module: 'classifier.py', desc: 'Label each change: new_policy, tightening, relaxation, calibration, reorg, or refinement. Supports manual YAML overrides.' },
    { step: 'Stability', module: 'stability.py', desc: 'Track per-unit presence across versions: first_seen, last_seen, appearance_count. Status: stable/recent/volatile/legacy.' },
    { step: 'Lineage', module: 'lineage.py', desc: 'Build graph from cross-version matches. Connected components become lineages. Auto-title from TF-IDF terms.' },
    { step: 'Genome', module: 'genome.py', desc: 'Aggregate trends: growth by layer, stability ratios, churn rates, hotspot sections, rule density.' },
  ];

  const heuristics = [
    'New unit in new section -> new_policy (0.9)',
    'New unit in existing section -> new_policy (0.8)',
    'Similarity >= 0.85 -> wording_refinement',
    'Similarity 0.65-0.85 + more imperatives -> policy_tightening',
    'Similarity 0.65-0.85 + fewer imperatives -> policy_relaxation',
    'New "don\'t/avoid/prefer X over Y" patterns -> model_calibration',
    'Matched across different sections -> structural_reorg',
  ];

  const limitations = [
    'Layer classification relies on keyword heuristics, not semantic understanding.',
    'Fuzzy matching (trigram Jaccard) can miss paraphrased content that preserves meaning but changes wording substantially.',
    'Change classification is heuristic-based. Edge cases exist where similar structural changes get different labels.',
    'Lineage auto-titling uses TF-IDF terms which may not capture the conceptual essence perfectly.',
    'Cross-reference detection threshold (0.55) may produce false positives for short, generic statements.',
    'The analyzer processes the full version history but UI performance may degrade with very large datasets.',
  ];
</script>

<div class="page">
  <div class="page-header">
    <h1>Method & Provenance</h1>
    <p>How the analysis pipeline works, its heuristics, and known limitations.</p>
  </div>

  <div class="stat-grid">
    <div class="stat-card"><div class="label">Versions</div><div class="value">{totalVersions}</div></div>
    <div class="stat-card"><div class="label">Latest</div><div class="value">{latest?.version || '-'}</div></div>
    <div class="stat-card"><div class="label">Lineages</div><div class="value">{lineageCount}</div></div>
    <div class="stat-card"><div class="label">Pipeline Steps</div><div class="value">{pipeline.length}</div></div>
  </div>

  <h2>Pipeline</h2>
  <div class="pipeline">
    {#each pipeline as stage, i}
      <div class="pipeline-step card">
        <div class="pill-row">
          <span class="pill">Step {i + 1}</span>
          <code>{stage.module}</code>
        </div>
        <h3>{stage.step}</h3>
        <p>{stage.desc}</p>
      </div>
      {#if i < pipeline.length - 1}
        <div class="pipeline-arrow">&#8595;</div>
      {/if}
    {/each}
  </div>

  <h2 style="margin-top: 2rem;">Classification Heuristics</h2>
  <div class="heuristic-list" style="margin-top: 0.75rem;">
    {#each heuristics as rule, i}
      <div class="card">
        <div class="pill-row"><span class="pill">Rule {i + 1}</span></div>
        <code>{rule}</code>
      </div>
    {/each}
  </div>

  <h2 style="margin-top: 2rem;">Known Limitations</h2>
  <div class="limitations" style="margin-top: 0.75rem;">
    {#each limitations as limitation}
      <div class="card"><p>{limitation}</p></div>
    {/each}
  </div>
</div>

<style>
  .pipeline { margin-top: 0.75rem; }
  .pipeline-step code { font-size: 0.75rem; color: var(--text-muted); }
  .pipeline-step h3 { margin-top: 0.25rem; }
  .pipeline-step p { font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.25rem; }
  .pipeline-arrow { text-align: center; color: var(--text-muted); padding: 0.25rem 0; font-size: 1.1rem; }
  .heuristic-list code { font-size: 0.85rem; display: block; }
</style>

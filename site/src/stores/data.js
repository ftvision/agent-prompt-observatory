import { writable, derived } from 'svelte/store';

export const versionsMeta = writable([]);
export const currentSnapshot = writable(null);
export const currentTransition = writable(null);
export const lineages = writable([]);
export const genome = writable(null);
export const evidenceIndex = writable({});
export const allSnapshots = writable({});
export const allTransitions = writable({});

export const versions = derived(versionsMeta, ($meta) =>
  $meta.map((m) => m.version)
);

export const latestVersion = derived(versions, ($versions) =>
  $versions.length > 0 ? $versions[$versions.length - 1] : null
);

const BASE = '/data';

async function fetchJSON(path) {
  const res = await fetch(`${BASE}/${path}`);
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
  return res.json();
}

export async function loadVersionsMeta() {
  const data = await fetchJSON('versions_meta.json');
  versionsMeta.set(data);
  return data;
}

export async function loadSnapshot(version) {
  const data = await fetchJSON(`prompt_snapshots/${version}.json`);
  currentSnapshot.set(data);
  allSnapshots.update((s) => ({ ...s, [version]: data }));
  return data;
}

export async function loadTransition(from, to) {
  const data = await fetchJSON(`transitions/${from}_${to}.json`);
  currentTransition.set(data);
  allTransitions.update((t) => ({ ...t, [`${from}_${to}`]: data }));
  return data;
}

export async function loadLineages() {
  const data = await fetchJSON('lineages.json');
  lineages.set(data);
  return data;
}

export async function loadGenome() {
  const data = await fetchJSON('genome.json');
  genome.set(data);
  return data;
}

export async function loadEvidenceIndex() {
  const data = await fetchJSON('evidence_index.json');
  evidenceIndex.set(data);
  return data;
}

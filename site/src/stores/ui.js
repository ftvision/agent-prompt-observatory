import { writable } from 'svelte/store';

export const selectedVersion = writable(null);
export const compareFrom = writable(null);
export const compareTo = writable(null);
export const inspectorOpen = writable(false);
export const inspectorUnitId = writable(null);
export const activeFilters = writable({
  layers: [],
  classifications: [],
  searchText: '',
});
export const showRendered = writable(true);
export const showLayers = writable(true);
export const showStability = writable(true);
export const showCrossRefs = writable(false);
export const compareMode = writable(false);
export const compareVersion = writable(null);

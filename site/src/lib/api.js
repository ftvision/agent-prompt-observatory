const BASE = '/data';

export async function fetchJSON(path) {
  const res = await fetch(`${BASE}/${path}`);
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
  return res.json();
}

export async function fetchRawMarkdown(version) {
  const res = await fetch(`${BASE}/raw/${version}.md`);
  if (!res.ok) throw new Error(`Failed to fetch raw/${version}.md`);
  return res.text();
}

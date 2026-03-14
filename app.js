const DATA_ROOT = ".context/latest5-prototype";

const ROUTES = [
  {
    file: "index.html",
    page: "home",
    label: "Overview",
    description: "Entry page, site map, latest sections, and strongest transitions.",
  },
  {
    file: "sections.html",
    page: "sections",
    label: "Sections",
    description: "Current major sections ranked by stability, density, and change.",
  },
  {
    file: "section.html",
    page: "section-detail",
    label: "Section Detail",
    description: "Current meaning and historical evidence for one selected section.",
  },
  {
    file: "lineages.html",
    page: "lineages",
    label: "Lineages",
    description: "Concept-level index for major idea threads across the prompt.",
  },
  {
    file: "lineage.html",
    page: "lineage-detail",
    label: "Lineage Detail",
    description: "A single idea thread with active sections and transition trail.",
  },
  {
    file: "compare.html",
    page: "compare",
    label: "Compare",
    description: "Direct version-to-version comparison with evidence.",
  },
  {
    file: "method.html",
    page: "method",
    label: "Method",
    description: "Parsing, scoring, limitations, and scientific framing.",
  },
];

const LINEAGES = [
  {
    id: "tool-discovery",
    title: "Tool discovery",
    description: "How the prompt exposes, hides, or reintroduces tool schemas.",
    paths: ["Tools / ToolSearch", "System Prompt / Using your tools"],
    pathPrefixes: ["Tools / "],
  },
  {
    id: "memory-policy",
    title: "Memory policy",
    description: "What the prompt says about persistent memory and recall.",
    paths: ["System Prompt / auto memory"],
    pathPrefixes: [],
  },
  {
    id: "risk-discipline",
    title: "Risk discipline",
    description: "Constraints around reversibility, shared state, and safety.",
    paths: ["System Prompt / Executing actions with care", "System Prompt / System"],
    pathPrefixes: [],
  },
  {
    id: "output-discipline",
    title: "Output discipline",
    description: "How concise and user-facing the assistant should be.",
    paths: ["System Prompt / Output efficiency", "System Prompt / Tone and style"],
    pathPrefixes: [],
  },
  {
    id: "task-execution",
    title: "Task execution",
    description: "How the prompt frames engineering work, planning, and tool use.",
    paths: ["System Prompt / Doing tasks", "System Prompt / Using your tools"],
    pathPrefixes: [],
  },
];

const state = {
  analysis: null,
  parsedVersions: null,
  latestVersion: null,
  changeIndex: new Map(),
  page: document.body.dataset.page,
};

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setStatus(message, isError = false) {
  const el = $("status");
  if (!el) {
    return;
  }
  el.textContent = message;
  el.style.color = isError ? "#8f2f11" : "";
}

function diffScore(diff) {
  return (
    diff.h2.added.length * 6 +
    diff.h2.removed.length * 6 +
    diff.section_unit_added_total +
    diff.section_unit_removed_total
  );
}

function summaryFromUnits(units, count = 2) {
  return units
    .slice(0, count)
    .map((item) => item.text)
    .join(" ");
}

function queryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function buildPageLink(file, params = {}) {
  const url = new URL(file, window.location.href);
  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      url.searchParams.set(key, value);
    }
  });
  return `${url.pathname}${url.search}`;
}

function renderNav() {
  const nav = $("site-nav");
  if (!nav) {
    return;
  }
  nav.innerHTML = `
    <div class="nav-brand">
      <a href="index.html">Prompt Drift Observatory</a>
      <span>7-page prototype</span>
    </div>
    <nav class="nav-links">
      ${ROUTES.map((route) => {
        const active = route.page === state.page ? "active" : "";
        return `<a class="${active}" href="${route.file}">${escapeHtml(route.label)}</a>`;
      }).join("")}
    </nav>
  `;
}

function buildChangeIndex() {
  const index = new Map();

  function ensure(path) {
    if (!index.has(path)) {
      index.set(path, {
        path,
        changeCount: 0,
        addedTransitions: 0,
        removedTransitions: 0,
        unitAdded: 0,
        unitRemoved: 0,
        transitions: [],
      });
    }
    return index.get(path);
  }

  state.analysis.pairwise_diffs.forEach((diff) => {
    diff.h2.added.forEach((path) => {
      const row = ensure(path);
      row.changeCount += 1;
      row.addedTransitions += 1;
      row.transitions.push({
        from: diff.from_version,
        to: diff.to_version,
        mode: "added",
        summary: "Section path appears.",
      });
    });

    diff.h2.removed.forEach((path) => {
      const row = ensure(path);
      row.changeCount += 1;
      row.removedTransitions += 1;
      row.transitions.push({
        from: diff.from_version,
        to: diff.to_version,
        mode: "removed",
        summary: "Section path disappears.",
      });
    });

    diff.changed_sections.forEach((item) => {
      const row = ensure(item.path);
      row.changeCount += 1;
      row.unitAdded += item.added_count;
      row.unitRemoved += item.removed_count;
      row.transitions.push({
        from: diff.from_version,
        to: diff.to_version,
        mode: "rewritten",
        summary: `+${item.added_count} / -${item.removed_count}`,
        addedSample: item.added_samples[0] || "",
        removedSample: item.removed_samples[0] || "",
      });
    });
  });

  state.changeIndex = index;
}

function versionSpan() {
  const versions = state.analysis.versions;
  return `${versions[0].version} -> ${versions[versions.length - 1].version}`;
}

function strongestTransitions(limit = 4) {
  return [...state.analysis.pairwise_diffs]
    .sort((left, right) => diffScore(right) - diffScore(left))
    .slice(0, limit);
}

function sectionRows() {
  const totalVersions = state.analysis.versions.length;
  const latestSections = Object.entries(state.latestVersion.h2_sections).map(([path, info]) => {
    const presence = state.analysis.section_presence.find((item) => item.path === path);
    const change = state.changeIndex.get(path) || {
      changeCount: 0,
      addedTransitions: 0,
      removedTransitions: 0,
      unitAdded: 0,
      unitRemoved: 0,
      transitions: [],
    };
    return {
      path,
      info,
      summary: summaryFromUnits(info.units, 2) || "No unit text parsed for this section.",
      presenceCount: presence ? presence.count : 1,
      presenceLabel: `${presence ? presence.count : 1}/${totalVersions} versions`,
      volatility: change.changeCount,
      unitChurn: change.unitAdded + change.unitRemoved,
      transitions: change.transitions,
    };
  });

  latestSections.sort((left, right) => {
    const scoreRight = right.volatility * 8 + right.unitChurn + right.info.unit_count;
    const scoreLeft = left.volatility * 8 + left.unitChurn + left.info.unit_count;
    return scoreRight - scoreLeft;
  });
  return latestSections;
}

function matchesLineage(path, lineage) {
  if (lineage.paths.includes(path)) {
    return true;
  }
  return lineage.pathPrefixes.some((prefix) => path.startsWith(prefix));
}

function lineageRows() {
  return LINEAGES.map((lineage) => {
    const relatedSections = sectionRows().filter((row) => matchesLineage(row.path, lineage));
    const transitionRows = state.analysis.pairwise_diffs.filter((diff) => {
      return (
        diff.h2.added.some((path) => matchesLineage(path, lineage)) ||
        diff.h2.removed.some((path) => matchesLineage(path, lineage)) ||
        diff.changed_sections.some((item) => matchesLineage(item.path, lineage))
      );
    });

    const presenceMax = relatedSections.reduce((max, row) => Math.max(max, row.presenceCount), 0);
    return {
      ...lineage,
      relatedSections,
      transitionRows,
      sectionCount: relatedSections.length,
      totalChanges: transitionRows.reduce((sum, row) => sum + diffScore(row), 0),
      presenceMax,
    };
  }).sort((left, right) => right.totalChanges - left.totalChanges);
}

function renderInfoGrid(el, rows) {
  el.innerHTML = rows
    .map(
      (row) => `
        <article class="info-card">
          <div class="mini-label">${escapeHtml(row.label)}</div>
          <div class="info-value">${escapeHtml(row.value)}</div>
        </article>
      `
    )
    .join("");
}

function renderOverview() {
  renderInfoGrid($("hero-stats"), [
    { label: "Window", value: versionSpan() },
    { label: "Latest release", value: state.analysis.versions.at(-1).release_date || "Unknown" },
    { label: "Current sections", value: String(Object.keys(state.latestVersion.h2_sections).length) },
    { label: "Major lineages", value: String(LINEAGES.length) },
    { label: "Strongest shift", value: `${strongestTransitions(1)[0].from_version} -> ${strongestTransitions(1)[0].to_version}` },
  ]);

  $("route-cards").innerHTML = ROUTES.map(
    (route, index) => `
      <a class="route-card" href="${route.file}">
        <div class="mini-label">Page ${index + 1}</div>
        <h3>${escapeHtml(route.label)}</h3>
        <p>${escapeHtml(route.description)}</p>
      </a>
    `
  ).join("");

  $("latest-sections").innerHTML = sectionRows()
    .slice(0, 6)
    .map(
      (row) => `
        <article class="card">
          <div class="pill-row">
            <span class="pill">${escapeHtml(row.presenceLabel)}</span>
            <span class="pill signal">${row.volatility} change events</span>
          </div>
          <h3>${escapeHtml(row.path)}</h3>
          <p>${escapeHtml(row.summary)}</p>
          <a class="text-link" href="${buildPageLink("section.html", { path: row.path })}">Open section</a>
        </article>
      `
    )
    .join("");

  $("major-transitions").innerHTML = strongestTransitions()
    .map(
      (diff) => `
        <article class="stack-card">
          <div class="pill-row">
            <span class="pill">${escapeHtml(diff.from_version)} -> ${escapeHtml(diff.to_version)}</span>
            <span class="pill signal">score ${diffScore(diff)}</span>
          </div>
          <strong>${diff.h2.added.length + diff.h2.removed.length} subsection path changes</strong>
          <p>${diff.changed_sections[0] ? escapeHtml(diff.changed_sections[0].path) : "No shared-section churn after filters."}</p>
          <a class="text-link" href="${buildPageLink("compare.html", { from: diff.from_version, to: diff.to_version })}">Compare pair</a>
        </article>
      `
    )
    .join("");
}

function renderSections() {
  $("sections-note").textContent = `${Object.keys(state.latestVersion.h2_sections).length} sections in ${state.latestVersion.version}`;
  $("section-index").innerHTML = sectionRows()
    .map(
      (row) => `
        <article class="card">
          <div class="pill-row">
            <span class="pill">${escapeHtml(row.presenceLabel)}</span>
            <span class="pill signal">${row.unitChurn} unit churn</span>
          </div>
          <h3>${escapeHtml(row.path)}</h3>
          <p>${escapeHtml(row.summary)}</p>
          <div class="meta-line">${row.info.unit_count} current units</div>
          <a class="text-link" href="${buildPageLink("section.html", { path: row.path })}">Inspect section</a>
        </article>
      `
    )
    .join("");
}

function renderSectionDetail() {
  const rows = sectionRows();
  const selectedPath = queryParam("path") || rows[0].path;
  const selected = rows.find((row) => row.path === selectedPath) || rows[0];

  $("section-title").textContent = selected.path;
  $("section-lede").textContent = selected.summary;

  $("section-catalog").innerHTML = rows
    .map((row) => {
      const active = row.path === selected.path ? "active-item" : "";
      return `
        <a class="stack-card ${active}" href="${buildPageLink("section.html", { path: row.path })}">
          <strong>${escapeHtml(row.path)}</strong>
          <span>${escapeHtml(row.presenceLabel)} · ${row.volatility} changes</span>
        </a>
      `;
    })
    .join("");

  renderInfoGrid($("section-summary"), [
    { label: "Current version", value: state.latestVersion.version },
    { label: "Presence", value: selected.presenceLabel },
    { label: "Current units", value: String(selected.info.unit_count) },
    { label: "Tracked changes", value: String(selected.volatility) },
  ]);

  $("section-units").innerHTML = selected.info.units
    .slice(0, 8)
    .map(
      (unit) => `
        <article class="stack-card quote-card">
          <p>${escapeHtml(unit.text)}</p>
        </article>
      `
    )
    .join("") || '<div class="empty">No parsed unit text.</div>';

  $("section-history").innerHTML = selected.transitions
    .map(
      (item) => `
        <article class="stack-card">
          <div class="pill-row">
            <span class="pill">${escapeHtml(item.from)} -> ${escapeHtml(item.to)}</span>
            <span class="pill signal">${escapeHtml(item.mode)}</span>
          </div>
          <p>${escapeHtml(item.summary)}</p>
          ${item.addedSample ? `<div class="sample">Added: ${escapeHtml(item.addedSample)}</div>` : ""}
          ${item.removedSample ? `<div class="sample">Removed: ${escapeHtml(item.removedSample)}</div>` : ""}
        </article>
      `
    )
    .join("") || '<div class="empty">No historical changes in the current window.</div>';
}

function renderLineages() {
  $("lineage-index").innerHTML = lineageRows()
    .map(
      (lineage) => `
        <article class="card">
          <div class="pill-row">
            <span class="pill">${lineage.sectionCount} active sections</span>
            <span class="pill signal">${lineage.transitionRows.length} transitions</span>
          </div>
          <h3>${escapeHtml(lineage.title)}</h3>
          <p>${escapeHtml(lineage.description)}</p>
          <div class="meta-line">Strongest presence: ${lineage.presenceMax}/${state.analysis.versions.length} versions</div>
          <a class="text-link" href="${buildPageLink("lineage.html", { id: lineage.id })}">Open lineage</a>
        </article>
      `
    )
    .join("");
}

function renderLineageDetail() {
  const rows = lineageRows();
  const selectedId = queryParam("id") || rows[0].id;
  const selected = rows.find((row) => row.id === selectedId) || rows[0];

  $("lineage-title").textContent = selected.title;
  $("lineage-lede").textContent = selected.description;

  $("lineage-catalog").innerHTML = rows
    .map((row) => {
      const active = row.id === selected.id ? "active-item" : "";
      return `
        <a class="stack-card ${active}" href="${buildPageLink("lineage.html", { id: row.id })}">
          <strong>${escapeHtml(row.title)}</strong>
          <span>${row.sectionCount} active sections · ${row.transitionRows.length} transitions</span>
        </a>
      `;
    })
    .join("");

  renderInfoGrid($("lineage-profile"), [
    { label: "Window", value: versionSpan() },
    { label: "Active sections", value: String(selected.sectionCount) },
    { label: "Transitions", value: String(selected.transitionRows.length) },
    { label: "Total signal", value: String(selected.totalChanges) },
  ]);

  $("lineage-sections").innerHTML = selected.relatedSections
    .map(
      (row) => `
        <article class="stack-card">
          <div class="pill-row">
            <span class="pill">${escapeHtml(row.presenceLabel)}</span>
            <span class="pill signal">${row.unitChurn} unit churn</span>
          </div>
          <strong>${escapeHtml(row.path)}</strong>
          <p>${escapeHtml(row.summary)}</p>
          <a class="text-link" href="${buildPageLink("section.html", { path: row.path })}">Open section</a>
        </article>
      `
    )
    .join("") || '<div class="empty">No live sections matched this lineage in the latest window.</div>';

  $("lineage-history").innerHTML = selected.transitionRows
    .map((diff) => {
      const relatedChanges = diff.changed_sections.filter((item) => matchesLineage(item.path, selected));
      return `
        <article class="stack-card">
          <div class="pill-row">
            <span class="pill">${escapeHtml(diff.from_version)} -> ${escapeHtml(diff.to_version)}</span>
            <span class="pill signal">${diffScore(diff)} score</span>
          </div>
          <p>${relatedChanges[0] ? escapeHtml(relatedChanges[0].path) : "Structural change inside the lineage."}</p>
          ${
            relatedChanges[0] && relatedChanges[0].added_samples[0]
              ? `<div class="sample">Added: ${escapeHtml(relatedChanges[0].added_samples[0])}</div>`
              : ""
          }
        </article>
      `;
    })
    .join("") || '<div class="empty">No transitions matched this lineage in the current window.</div>';
}

function renderCompare() {
  const versions = state.analysis.versions.map((item) => item.version);
  const fromVersion = queryParam("from") || versions[0];
  const toVersion = queryParam("to") || versions.at(-1);
  const selected = state.analysis.n_back_diffs.find(
    (item) => item.from_version === fromVersion && item.to_version === toVersion
  ) || state.analysis.anchor_diff;

  $("compare-note").textContent = `Window supports arbitrary pairwise comparisons inside ${versionSpan()}`;

  $("compare-controls").innerHTML = `
    <label class="select-label">
      <span>From</span>
      <select id="compare-from" class="browser-select">
        ${versions.map((version) => `<option value="${version}" ${version === selected.from_version ? "selected" : ""}>${version}</option>`).join("")}
      </select>
    </label>
    <label class="select-label">
      <span>To</span>
      <select id="compare-to" class="browser-select">
        ${versions.map((version) => `<option value="${version}" ${version === selected.to_version ? "selected" : ""}>${version}</option>`).join("")}
      </select>
    </label>
    <a class="button-link" id="compare-go" href="${buildPageLink("compare.html", { from: selected.from_version, to: selected.to_version })}">Load pair</a>
  `;

  renderInfoGrid($("compare-summary"), [
    { label: "Pair", value: `${selected.from_version} -> ${selected.to_version}` },
    { label: "Added paths", value: String(selected.h2.added.length) },
    { label: "Removed paths", value: String(selected.h2.removed.length) },
    { label: "Changed sections", value: String(selected.changed_section_count) },
  ]);

  $("compare-detail").innerHTML = `
    <article class="card">
      <div class="mini-label">Added subsection paths</div>
      <div class="pill-row wrap-row">
        ${selected.h2.added.length ? selected.h2.added.map((path) => `<span class="pill">${escapeHtml(path)}</span>`).join("") : '<span class="empty">None</span>'}
      </div>
    </article>
    <article class="card">
      <div class="mini-label">Removed subsection paths</div>
      <div class="pill-row wrap-row">
        ${selected.h2.removed.length ? selected.h2.removed.map((path) => `<span class="pill signal">${escapeHtml(path)}</span>`).join("") : '<span class="empty">None</span>'}
      </div>
    </article>
    <article class="card">
      <div class="mini-label">Shared-section churn</div>
      <div class="stack-list compact-stack">
        ${
          selected.changed_sections.length
            ? selected.changed_sections
                .map(
                  (item) => `
                    <article class="stack-card">
                      <strong>${escapeHtml(item.path)}</strong>
                      <span>+${item.added_count} / -${item.removed_count}</span>
                      ${item.added_samples[0] ? `<div class="sample">Added: ${escapeHtml(item.added_samples[0])}</div>` : ""}
                    </article>
                  `
                )
                .join("")
            : '<div class="empty">No shared-section churn after volatile filters.</div>'
        }
      </div>
    </article>
  `;

  $("compare-from").addEventListener("change", syncCompareLink);
  $("compare-to").addEventListener("change", syncCompareLink);
}

function syncCompareLink() {
  const fromValue = $("compare-from").value;
  const toValue = $("compare-to").value;
  $("compare-go").href = buildPageLink("compare.html", { from: fromValue, to: toValue });
}

function renderMethod() {
  $("method-pipeline").innerHTML = [
    "Fetch prompt markdown for the latest versions.",
    "Parse top-level sections, subsection paths, and unit-level text fragments.",
    "Normalize volatile values such as temporary paths and project memory roots.",
    "Compute consecutive diffs, N-back diffs, anchor diffs, and exact persistent motifs.",
    "Render multipage views for overview, sections, lineages, evidence, and method.",
  ]
    .map(
      (item, index) => `
        <article class="stack-card">
          <div class="pill-row">
            <span class="pill">Step ${index + 1}</span>
          </div>
          <p>${escapeHtml(item)}</p>
        </article>
      `
    )
    .join("");

  renderInfoGrid($("method-facts"), [
    { label: "Versions loaded", value: String(state.analysis.versions.length) },
    { label: "Current sections", value: String(Object.keys(state.latestVersion.h2_sections).length) },
    { label: "Pairwise diffs", value: String(state.analysis.pairwise_diffs.length) },
    { label: "Lineage examples", value: String(LINEAGES.length) },
  ]);

  $("method-limitations").innerHTML = [
    "Section identity is still path-based, so renames and moves are not inferred yet.",
    "Unit drift is exact-text oriented, which undercounts paraphrase-level change.",
    "Lineages in this prototype are example groupings, not model-derived semantic graphs.",
    "The site uses the latest-five data window for live rendering, not the wider 20-version scan.",
  ]
    .map(
      (item) => `
        <article class="card">
          <p>${escapeHtml(item)}</p>
        </article>
      `
    )
    .join("");
}

function renderPage() {
  renderNav();

  if (state.page === "home") {
    renderOverview();
  } else if (state.page === "sections") {
    renderSections();
  } else if (state.page === "section-detail") {
    renderSectionDetail();
  } else if (state.page === "lineages") {
    renderLineages();
  } else if (state.page === "lineage-detail") {
    renderLineageDetail();
  } else if (state.page === "compare") {
    renderCompare();
  } else if (state.page === "method") {
    renderMethod();
  }
}

async function loadData() {
  setStatus("Loading analysis artifacts...");
  try {
    const [analysisResponse, parsedResponse] = await Promise.all([
      fetch(`${DATA_ROOT}/analysis.json`),
      fetch(`${DATA_ROOT}/parsed_versions.json`),
    ]);

    if (!analysisResponse.ok || !parsedResponse.ok) {
      throw new Error("Analysis artifacts are missing. Run python3 analyze_prompts.py first.");
    }

    state.analysis = await analysisResponse.json();
    state.parsedVersions = await parsedResponse.json();
    state.latestVersion = state.parsedVersions.at(-1);
    buildChangeIndex();
    renderPage();
    setStatus(`Loaded ${state.analysis.versions.length} versions for the 7-page prototype.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

loadData();

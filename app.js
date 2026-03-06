const DATA_ROOT = ".context/latest5-prototype";

const state = {
  analysis: null,
  parsedVersions: null,
  selectedDiffIndex: 0,
  selectedVersionIndex: 0,
};

const els = {
  status: document.querySelector("#status"),
  heroStats: document.querySelector("#hero-stats"),
  versionSummary: document.querySelector("#version-summary"),
  versionCards: document.querySelector("#version-cards"),
  nBackMatrix: document.querySelector("#nback-matrix"),
  stableSections: document.querySelector("#stable-sections"),
  diffTabs: document.querySelector("#diff-tabs"),
  selectedDiffNote: document.querySelector("#selected-diff-note"),
  diffDetail: document.querySelector("#diff-detail"),
  versionBrowser: document.querySelector("#version-browser"),
  motifList: document.querySelector("#motif-list"),
};

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function diffScore(diff) {
  return (
    diff.h2.added.length * 6 +
    diff.h2.removed.length * 6 +
    diff.section_unit_added_total +
    diff.section_unit_removed_total
  );
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.style.color = isError ? "#8f2f11" : "";
}

function uniqueStableSections() {
  const totalVersions = state.analysis.versions.length;
  return state.analysis.section_presence.filter((item) => item.count === totalVersions);
}

function strongestTransition() {
  return state.analysis.pairwise_diffs.reduce((best, current, index) => {
    const score = diffScore(current);
    if (!best || score > best.score) {
      return { index, score, diff: current };
    }
    return best;
  }, null);
}

function cellTone(score, maxScore) {
  const normalized = maxScore === 0 ? 0 : score / maxScore;
  const alpha = 0.12 + normalized * 0.52;
  return `rgba(176, 77, 26, ${alpha.toFixed(3)})`;
}

function renderHero() {
  const versions = state.analysis.versions;
  const latest = versions[versions.length - 1];
  const anchor = state.analysis.anchor_diff;
  const major = strongestTransition();

  els.heroStats.innerHTML = [
    {
      label: "Window",
      value: `${versions[0].version} - ${latest.version}`,
    },
    {
      label: "Latest release",
      value: latest.release_date,
    },
    {
      label: "Stable subsection paths",
      value: String(uniqueStableSections().length),
    },
    {
      label: "Anchor subsection drift",
      value: `${anchor.h2.added.length + anchor.h2.removed.length}`,
    },
    {
      label: "Largest shift",
      value: `${major.diff.from_version} -> ${major.diff.to_version}`,
    },
  ]
    .map(
      (item) => `
        <article class="stat-card">
          <div class="stat-label">${escapeHtml(item.label)}</div>
          <div class="stat-value">${escapeHtml(item.value)}</div>
        </article>
      `
    )
    .join("");
}

function renderVersionCards() {
  const versions = state.analysis.versions;
  const totalUnits = versions.reduce((sum, item) => sum + item.unit_count, 0);
  const avgUnits = Math.round(totalUnits / versions.length);
  els.versionSummary.textContent = `Average unit count in window: ${avgUnits}`;

  els.versionCards.innerHTML = versions
    .map(
      (item) => `
        <article class="version-card">
          <div class="version-head">
            <div>
              <div class="mini-label">Version</div>
              <div class="version-title">${escapeHtml(item.version)}</div>
            </div>
            <div class="release-pill">${escapeHtml(item.release_date || "Unknown")}</div>
          </div>
          <div class="version-meta">
            <div class="meta-box">
              <div class="mini-label">Top-level sections</div>
              <strong>${item.h1_count}</strong>
            </div>
            <div class="meta-box">
              <div class="mini-label">Subsections</div>
              <strong>${item.h2_count}</strong>
            </div>
            <div class="meta-box">
              <div class="mini-label">Units</div>
              <strong>${item.unit_count}</strong>
            </div>
          </div>
        </article>
      `
    )
    .join("");
}

function renderNBackMatrix() {
  const versions = state.analysis.versions.map((item) => item.version);
  const maxLag = Math.max(...state.analysis.n_back_diffs.map((item) => item.lag));
  const diffMap = new Map(
    state.analysis.n_back_diffs.map((item) => [`${item.to_version}:${item.lag}`, item])
  );
  const maxScore = Math.max(...state.analysis.n_back_diffs.map(diffScore), 1);

  const header = Array.from({ length: maxLag }, (_, index) => `<th>N-${index + 1}</th>`).join("");
  const rows = versions
    .slice(1)
    .map((version) => {
      const cells = Array.from({ length: maxLag }, (_, idx) => {
        const lag = idx + 1;
        const diff = diffMap.get(`${version}:${lag}`);
        if (!diff) {
          return '<td><div class="matrix-cell empty">-</div></td>';
        }
        const score = diffScore(diff);
        return `
          <td>
            <div class="matrix-cell" style="background:${cellTone(score, maxScore)}">
              <span class="big">${diff.h2.added.length + diff.h2.removed.length}</span>
              <span class="small">subsection drift</span>
            </div>
          </td>
        `;
      }).join("");
      return `
        <tr>
          <th>${escapeHtml(version)}</th>
          ${cells}
        </tr>
      `;
    })
    .join("");

  els.nBackMatrix.innerHTML = `
    <table class="matrix">
      <thead>
        <tr>
          <th>Target</th>
          ${header}
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

function renderStableSections() {
  const stable = uniqueStableSections();
  els.stableSections.innerHTML = stable
    .map((item) => `<div class="chip">${escapeHtml(item.path)}</div>`)
    .join("");
}

function renderDiffTabs() {
  els.diffTabs.innerHTML = state.analysis.pairwise_diffs
    .map((diff, index) => {
      const active = index === state.selectedDiffIndex ? "active" : "";
      const score = diffScore(diff);
      return `
        <button class="diff-tab ${active}" data-diff-index="${index}" type="button">
          <div class="mini-label">Transition</div>
          <div class="tab-title">${escapeHtml(diff.from_version)} -> ${escapeHtml(diff.to_version)}</div>
          <div class="tab-meta">
            <span>${diff.h2.added.length + diff.h2.removed.length} subsection drift</span>
            <span class="score-pill">score ${score}</span>
          </div>
        </button>
      `;
    })
    .join("");

  els.diffTabs.querySelectorAll("[data-diff-index]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedDiffIndex = Number(button.dataset.diffIndex);
      renderDiffTabs();
      renderDiffDetail();
    });
  });
}

function renderDiffDetail() {
  const diff = state.analysis.pairwise_diffs[state.selectedDiffIndex];
  els.selectedDiffNote.textContent = `${diff.changed_section_count} changed shared sections`;

  const addedSubsections = diff.h2.added.length
    ? diff.h2.added.map((item) => `<span class="pill">${escapeHtml(item)}</span>`).join("")
    : '<div class="empty">No new subsection paths.</div>';

  const removedSubsections = diff.h2.removed.length
    ? diff.h2.removed.map((item) => `<span class="pill signal">${escapeHtml(item)}</span>`).join("")
    : '<div class="empty">No removed subsection paths.</div>';

  const sectionChanges = diff.changed_sections.length
    ? diff.changed_sections
        .map((item) => {
          const addedSample = item.added_samples[0]
            ? `<div class="sample">Added: ${escapeHtml(item.added_samples[0])}</div>`
            : "";
          const removedSample = item.removed_samples[0]
            ? `<div class="sample">Removed: ${escapeHtml(item.removed_samples[0])}</div>`
            : "";
          return `
            <div class="section-change">
              <strong>${escapeHtml(item.path)}</strong>
              <div class="mini-label">+${item.added_count} / -${item.removed_count}</div>
              ${addedSample}
              ${removedSample}
            </div>
          `;
        })
        .join("")
    : '<div class="empty">No unit-level changes in shared sections after volatile filters.</div>';

  els.diffDetail.innerHTML = `
    <article class="detail-card">
      <h3>Added subsection paths</h3>
      <div class="pill-list">${addedSubsections}</div>
    </article>
    <article class="detail-card">
      <h3>Removed subsection paths</h3>
      <div class="pill-list">${removedSubsections}</div>
    </article>
    <article class="detail-card">
      <h3>Shared subsection drift</h3>
      <div class="list-block">
        <div class="mini-label">units added ${diff.section_unit_added_total}</div>
        <div class="mini-label">units removed ${diff.section_unit_removed_total}</div>
        ${sectionChanges}
      </div>
    </article>
  `;
}

function renderVersionBrowser() {
  const parsed = state.parsedVersions[state.selectedVersionIndex];
  const options = state.parsedVersions
    .map(
      (item, index) =>
        `<option value="${index}" ${index === state.selectedVersionIndex ? "selected" : ""}>${escapeHtml(item.version)}</option>`
    )
    .join("");

  const h1Cards = Object.entries(parsed.h1_sections)
    .map(([h1, info]) => {
      const h2Items = Object.values(parsed.h2_sections)
        .filter((section) => section.h1 === h1)
        .sort((left, right) => right.unit_count - left.unit_count)
        .map(
          (section) => `
            <div class="h2-item">
              <span>${escapeHtml(section.h2)}</span>
              <span class="mini-label">${section.unit_count}</span>
            </div>
          `
        )
        .join("");
      return `
        <article class="browser-card">
          <div class="mini-label">Top-level section</div>
          <h3>${escapeHtml(h1)}</h3>
          <div class="lag-pill">${info.unit_count} direct units</div>
          <div class="h2-list">${h2Items || '<div class="empty">No named subsections.</div>'}</div>
        </article>
      `;
    })
    .join("");

  els.versionBrowser.innerHTML = `
    <div class="browser-toolbar">
      <select class="browser-select" id="version-select">${options}</select>
      <div class="inline-note">${escapeHtml(parsed.release_date || "Unknown release date")}</div>
    </div>
    <div class="browser-grid">${h1Cards}</div>
  `;

  els.versionBrowser.querySelector("#version-select").addEventListener("change", (event) => {
    state.selectedVersionIndex = Number(event.target.value);
    renderVersionBrowser();
  });
}

function renderMotifs() {
  els.motifList.innerHTML = state.analysis.global_duplicates
    .map(
      (item) => `
        <article class="motif-card">
          <div class="mini-label">Exact persistent unit</div>
          <p>${escapeHtml(item.text)}</p>
          <div class="pill-list">
            <span class="pill">${item.version_count} versions</span>
            <span class="pill">${item.path_count} paths</span>
          </div>
        </article>
      `
    )
    .join("");
}

function render() {
  renderHero();
  renderVersionCards();
  renderNBackMatrix();
  renderStableSections();
  renderDiffTabs();
  renderDiffDetail();
  renderVersionBrowser();
  renderMotifs();
  setStatus("Loaded latest-five analysis.");
}

async function loadData() {
  setStatus("Loading analysis artifacts...");
  try {
    const [analysisResponse, parsedResponse] = await Promise.all([
      fetch(`${DATA_ROOT}/analysis.json`),
      fetch(`${DATA_ROOT}/parsed_versions.json`),
    ]);

    if (!analysisResponse.ok || !parsedResponse.ok) {
      throw new Error("Analysis artifacts are missing. Run the analyzer first.");
    }

    state.analysis = await analysisResponse.json();
    state.parsedVersions = await parsedResponse.json();
    const major = strongestTransition();
    state.selectedDiffIndex = major ? major.index : 0;
    state.selectedVersionIndex = state.parsedVersions.length - 1;
    render();
  } catch (error) {
    setStatus(error.message, true);
  }
}

loadData();

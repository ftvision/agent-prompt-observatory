/**
 * SVG chart primitives for the Genome view.
 */

export function createSVG(width, height) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', height);
  svg.style.overflow = 'visible';
  return svg;
}

export function svgEl(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  return el;
}

export function drawStackedArea(container, data, { width = 800, height = 300, layers, colors }) {
  container.innerHTML = '';
  const svg = createSVG(width, height);
  const margin = { top: 20, right: 20, bottom: 40, left: 60 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;
  const g = svgEl('g', { transform: `translate(${margin.left},${margin.top})` });

  if (!data.length) { container.appendChild(svg); return; }

  // Compute stacked values
  const maxTotal = Math.max(...data.map((d) => {
    let sum = 0;
    for (const l of layers) sum += (d.layer_chars?.[l] || 0);
    return sum;
  }));

  const xStep = w / Math.max(data.length - 1, 1);

  // Draw areas bottom-up
  for (let li = layers.length - 1; li >= 0; li--) {
    const layer = layers[li];
    let pathD = '';
    const topPoints = [];

    for (let i = 0; i < data.length; i++) {
      let y0 = 0;
      for (let j = 0; j <= li; j++) {
        y0 += (data[i].layer_chars?.[layers[j]] || 0);
      }
      const x = i * xStep;
      const y = h - (y0 / maxTotal) * h;
      topPoints.push(`${x},${y}`);
    }

    const bottomPoints = [];
    for (let i = 0; i < data.length; i++) {
      let y0 = 0;
      for (let j = 0; j < li; j++) {
        y0 += (data[i].layer_chars?.[layers[j]] || 0);
      }
      const x = i * xStep;
      const y = h - (y0 / maxTotal) * h;
      bottomPoints.push(`${x},${y}`);
    }

    pathD = `M ${topPoints.join(' L ')} L ${bottomPoints.reverse().join(' L ')} Z`;
    g.appendChild(svgEl('path', {
      d: pathD,
      fill: colors[layer] || '#888',
      opacity: '0.7',
      stroke: colors[layer] || '#888',
      'stroke-width': '0.5',
    }));
  }

  // X-axis labels
  for (let i = 0; i < data.length; i++) {
    if (i % Math.max(1, Math.floor(data.length / 8)) === 0 || i === data.length - 1) {
      const x = i * xStep;
      const label = svgEl('text', {
        x, y: h + 20, 'text-anchor': 'middle', 'font-size': '10', fill: '#666',
      });
      label.textContent = data[i].version || '';
      g.appendChild(label);
    }
  }

  // Y-axis label
  const yLabel = svgEl('text', {
    x: -h / 2, y: -45, transform: 'rotate(-90)', 'text-anchor': 'middle', 'font-size': '11', fill: '#666',
  });
  yLabel.textContent = 'Characters';
  g.appendChild(yLabel);

  svg.appendChild(g);
  container.appendChild(svg);
}

export function drawLineChart(container, data, { width = 800, height = 200, color = '#6366f1', label = '' }) {
  container.innerHTML = '';
  const svg = createSVG(width, height);
  const margin = { top: 20, right: 20, bottom: 40, left: 60 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;
  const g = svgEl('g', { transform: `translate(${margin.left},${margin.top})` });

  if (!data.length) { container.appendChild(svg); return; }

  const values = data.map((d) => d.value);
  const maxVal = Math.max(...values, 0.01);
  const minVal = Math.min(...values, 0);
  const range = maxVal - minVal || 1;
  const xStep = w / Math.max(data.length - 1, 1);

  const points = data.map((d, i) => {
    const x = i * xStep;
    const y = h - ((d.value - minVal) / range) * h;
    return `${x},${y}`;
  });

  g.appendChild(svgEl('polyline', {
    points: points.join(' '),
    fill: 'none',
    stroke: color,
    'stroke-width': '2',
  }));

  // Dots
  data.forEach((d, i) => {
    const x = i * xStep;
    const y = h - ((d.value - minVal) / range) * h;
    g.appendChild(svgEl('circle', {
      cx: x, cy: y, r: '3', fill: color,
    }));
  });

  // X-axis labels
  data.forEach((d, i) => {
    if (i % Math.max(1, Math.floor(data.length / 8)) === 0 || i === data.length - 1) {
      const x = i * xStep;
      const t = svgEl('text', {
        x, y: h + 20, 'text-anchor': 'middle', 'font-size': '10', fill: '#666',
      });
      t.textContent = d.label || '';
      g.appendChild(t);
    }
  });

  // Y label
  const yLabel = svgEl('text', {
    x: -h / 2, y: -45, transform: 'rotate(-90)', 'text-anchor': 'middle', 'font-size': '11', fill: '#666',
  });
  yLabel.textContent = label;
  g.appendChild(yLabel);

  svg.appendChild(g);
  container.appendChild(svg);
}

export function drawBarChart(container, data, { width = 800, height = 200, positiveColor = '#10b981', negativeColor = '#ef4444' }) {
  container.innerHTML = '';
  const svg = createSVG(width, height);
  const margin = { top: 20, right: 20, bottom: 40, left: 60 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;
  const g = svgEl('g', { transform: `translate(${margin.left},${margin.top})` });

  if (!data.length) { container.appendChild(svg); return; }

  const maxVal = Math.max(...data.map((d) => Math.max(d.added || 0, d.removed || 0)), 1);
  const barWidth = Math.max(2, (w / data.length) * 0.35);
  const gap = w / data.length;

  data.forEach((d, i) => {
    const x = i * gap + gap * 0.15;
    const addedH = ((d.added || 0) / maxVal) * (h / 2);
    const removedH = ((d.removed || 0) / maxVal) * (h / 2);
    const mid = h / 2;

    // Added (above center)
    g.appendChild(svgEl('rect', {
      x, y: mid - addedH, width: barWidth, height: addedH,
      fill: positiveColor, opacity: '0.8',
    }));
    // Removed (below center)
    g.appendChild(svgEl('rect', {
      x: x + barWidth + 1, y: mid, width: barWidth, height: removedH,
      fill: negativeColor, opacity: '0.8',
    }));

    // Label
    if (i % Math.max(1, Math.floor(data.length / 8)) === 0 || i === data.length - 1) {
      const t = svgEl('text', {
        x: x + barWidth, y: h + 20, 'text-anchor': 'middle', 'font-size': '10', fill: '#666',
      });
      t.textContent = d.label || '';
      g.appendChild(t);
    }
  });

  // Center line
  g.appendChild(svgEl('line', {
    x1: 0, y1: h / 2, x2: w, y2: h / 2,
    stroke: '#ccc', 'stroke-width': '1',
  }));

  svg.appendChild(g);
  container.appendChild(svg);
}

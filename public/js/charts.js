import { esc } from './ui.js';

/**
 * Single-series line chart (0..1 y-scale) with crosshair + tooltip.
 * points: [{ x: number, y: 0..1, tip: html }]
 */
export function lineChart(container, points, { height = 220, yLabel = '', xLabel = '' } = {}) {
  const W = Math.max(320, container.clientWidth || 640);
  const H = height;
  const m = { l: 40, r: 12, t: 12, b: 28 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const n = points.length;
  const x = (i) => m.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => m.t + (1 - v) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
  const xTicks = n <= 1 ? [0] : [...new Set([0, Math.round((n - 1) / 2), n - 1])];

  container.classList.add('chart');
  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(yLabel)}">
      ${ticks.map((t) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--grid)" stroke-width="1"/>
        <text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${t * 100}%</text>`).join('')}
      ${xTicks.map((i) => `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--muted)">${i + 1}</text>`).join('')}
      <text x="${W - m.r}" y="${H - 8}" text-anchor="end" font-size="11" fill="var(--muted)" dx="0" dy="0"></text>
      <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${n <= 40 ? points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.y)}" r="3" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>`).join('') : ''}
      <line id="xh" y1="${m.t}" y2="${m.t + ih}" stroke="var(--axis)" stroke-width="1" visibility="hidden"/>
      <circle id="dot" r="5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>
      <rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent" id="hit"/>
    </svg>
    <div class="tooltip"></div>
    ${xLabel ? `<div class="muted small" style="text-align:center">${esc(xLabel)}</div>` : ''}`;
  const svg = container.querySelector('svg');
  const tip = container.querySelector('.tooltip');
  const xh = svg.querySelector('#xh');
  const dot = svg.querySelector('#dot');
  const hit = svg.querySelector('#hit');
  const show = (evt) => {
    if (!n) return;
    const r = svg.getBoundingClientRect();
    const px = ((evt.clientX - r.left) / r.width) * W;
    const i = n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / iw) * (n - 1))));
    const p = points[i];
    xh.setAttribute('x1', x(i)); xh.setAttribute('x2', x(i)); xh.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(p.y)); dot.setAttribute('visibility', 'visible');
    tip.innerHTML = p.tip;
    tip.style.display = 'block';
    const left = (x(i) / W) * r.width;
    tip.style.left = `${Math.min(r.width - tip.offsetWidth - 4, Math.max(0, left + 12))}px`;
    tip.style.top = `${(y(p.y) / H) * r.height - tip.offsetHeight - 10}px`;
  };
  const hide = () => { tip.style.display = 'none'; xh.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); };
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', hide);
}

/** Sequential blue ramp for 0..1 mastery (heatmaps). Returns [background, text color]. */
export function seqColor(v) {
  if (v === null || v === undefined) return null;
  const steps = ['--seq-1', '--seq-2', '--seq-3', '--seq-4', '--seq-5', '--seq-6', '--seq-7'];
  const i = Math.min(steps.length - 1, Math.floor(v * steps.length));
  return [`var(${steps[i]})`, i >= 3 ? '#ffffff' : '#0b0b0b'];
}

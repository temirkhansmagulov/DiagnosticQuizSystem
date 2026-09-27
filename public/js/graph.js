import { GET, esc, pct, meta, session, statusChip, SUBJECT_COLORS } from './ui.js';

const LEVEL_COLOR = { mastered: 'var(--good)', proficient: 'var(--accent)', developing: 'var(--warning)', 'needs-work': 'var(--critical)', 'not-assessed': 'var(--na)' };

/** Deterministic force-directed layout, clustered by subject. */
function layout(graph, W, H) {
  const subjects = [...new Set(graph.nodes.map((n) => n.subject))];
  const R = Math.min(W, H) * 0.4;
  const centers = Object.fromEntries(subjects.map((s, i) => {
    const a = (i / subjects.length) * Math.PI * 2 - Math.PI / 2;
    return [s, { x: W / 2 + R * Math.cos(a), y: H / 2 + R * Math.sin(a) }];
  }));
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const nodes = graph.nodes.map((n) => ({ ...n, x: centers[n.subject].x + (rnd() - 0.5) * 80, y: centers[n.subject].y + (rnd() - 0.5) * 80, vx: 0, vy: 0 }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = graph.edges.map((e) => ({ ...e, s: byId.get(e.source), t: byId.get(e.target) })).filter((l) => l.s && l.t);
  for (let it = 0; it < 400; it++) {
    const alpha = 1 - it / 400;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]; const b = nodes[j];
        let dx = b.x - a.x; let dy = b.y - a.y;
        const d2 = Math.max(dx * dx + dy * dy, 25);
        const f = ((a.subject === b.subject ? 3200 : 2400) / d2) * alpha;
        const d = Math.sqrt(d2); dx /= d; dy /= d;
        a.vx -= dx * f; a.vy -= dy * f; b.vx += dx * f; b.vy += dy * f;
      }
    }
    for (const l of links) {
      const dx = l.t.x - l.s.x; const dy = l.t.y - l.s.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const same = l.s.subject === l.t.subject;
      const f = ((d - (same ? 85 : 220)) / d) * (same ? 0.06 : 0.002) * alpha;
      l.s.vx += dx * f; l.s.vy += dy * f; l.t.vx -= dx * f; l.t.vy -= dy * f;
    }
    for (const n of nodes) {
      const c = centers[n.subject];
      n.vx += (c.x - n.x) * 0.02 * alpha; n.vy += (c.y - n.y) * 0.02 * alpha;
      n.x += n.vx; n.y += n.vy; n.vx *= 0.6; n.vy *= 0.6;
    }
  }
  return { nodes, links, byId, centers, subjects };
}

/**
 * Render the subtopic graph into `container`.
 * opts: { profile, colorBy: 'subject' | 'mastery', compact, onSelect, subjectFilter }
 */
export function mountGraph(container, graph, opts = {}) {
  const W = 1000; const H = 760;
  const L = layout(graph, W, H);
  const subjectIndex = Object.fromEntries(L.subjects.map((s, i) => [s, i]));
  // initial view: fit the laid-out nodes (plus room for labels)
  const xs = L.nodes.map((n) => n.x); const ys = L.nodes.map((n) => n.y);
  const pad = 50;
  const home = { x: Math.min(...xs) - pad * 2, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 4, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
  let view = { ...home };
  let selected = null;

  const colorOf = (n) => {
    if (opts.colorBy === 'mastery' && opts.profile) return LEVEL_COLOR[opts.profile.subtopics[n.id].status];
    return SUBJECT_COLORS[subjectIndex[n.subject] % SUBJECT_COLORS.length];
  };
  const radiusOf = (n) => (opts.compact ? 7 : 9) + Math.min(5, (n.questionCount || 0));

  container.innerHTML = `<svg viewBox="${view.x} ${view.y} ${view.w} ${view.h}" aria-label="Graph of related subtopics">
    <defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--axis)"/></marker>
      <marker id="arrow-hl" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--text-2)"/></marker></defs>
    <g class="clusters"></g><g class="links"></g><g class="nodes"></g></svg>`;
  const svg = container.querySelector('svg');
  const gLinks = svg.querySelector('.links');
  const gNodes = svg.querySelector('.nodes');
  const gClusters = svg.querySelector('.clusters');

  function edgePath(l) {
    const dx = l.t.x - l.s.x; const dy = l.t.y - l.s.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const r1 = radiusOf(l.s) + 1; const r2 = radiusOf(l.t) + 3;
    return [l.s.x + (dx / d) * r1, l.s.y + (dy / d) * r1, l.t.x - (dx / d) * r2, l.t.y - (dy / d) * r2];
  }
  function draw() {
    const focus = selected ? new Set([selected, ...L.links.filter((l) => l.s.id === selected || l.t.id === selected).flatMap((l) => [l.s.id, l.t.id])]) : null;
    const dimSubject = opts.subjectFilter || null;
    const faded = (n) => (focus ? !focus.has(n.id) : dimSubject ? n.subject !== dimSubject : false);
    gClusters.innerHTML = opts.compact ? '' : L.subjects.map((s) => {
      const ns = L.nodes.filter((n) => n.subject === s);
      const cx = ns.reduce((a, n) => a + n.x, 0) / ns.length;
      const top = Math.min(...ns.map((n) => n.y)) - 26;
      return `<text x="${cx}" y="${top}" text-anchor="middle" style="font-size:13px;font-weight:700;fill:var(--text)" opacity="${dimSubject && dimSubject !== s ? 0.25 : 1}">${esc(ns[0].subjectName)}</text>`;
    }).join('');
    gLinks.innerHTML = L.links.map((l) => {
      const [x1, y1, x2, y2] = edgePath(l);
      const hl = focus && (l.s.id === selected || l.t.id === selected);
      const op = focus ? (hl ? 1 : 0.08) : dimSubject ? (l.s.subject === dimSubject || l.t.subject === dimSubject ? 0.9 : 0.1) : 0.75;
      return l.kind === 'prerequisite'
        ? `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${hl ? 'var(--text-2)' : 'var(--axis)'}" stroke-width="${hl ? 2 : 1.3}" marker-end="url(#${hl ? 'arrow-hl' : 'arrow'})" opacity="${op}"/>`
        : `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${hl ? 'var(--text-2)' : 'var(--axis)'}" stroke-width="1.3" stroke-dasharray="4 4" opacity="${op}"/>`;
    }).join('');
    gNodes.innerHTML = L.nodes.map((n) => {
      const st = opts.profile ? opts.profile.subtopics[n.id] : null;
      const hollow = opts.colorBy === 'mastery' && st && st.status === 'not-assessed';
      const tip = `${n.name} (${n.subjectName} › ${n.topicName})${st ? ` — ${st.mastery === null ? 'not assessed' : `${Math.round(st.mastery * 100)}% ${st.label}`}` : ''}`;
      return `<g data-id="${esc(n.id)}" transform="translate(${n.x},${n.y})" opacity="${faded(n) ? 0.18 : 1}" style="cursor:pointer">
        <title>${esc(tip)}</title>
        <circle r="${radiusOf(n) + 8}" fill="transparent"/>
        <circle r="${radiusOf(n)}" fill="${hollow ? 'var(--surface)' : colorOf(n)}" stroke="${hollow ? 'var(--muted)' : 'var(--surface)'}" stroke-width="${n.id === selected ? 3 : 2}" ${hollow ? 'stroke-dasharray="3 2"' : ''}/>
        ${n.id === selected ? `<circle r="${radiusOf(n) + 4}" fill="none" stroke="var(--text)" stroke-width="2"/>` : ''}
        ${opts.compact && !focus ? '' : `<text y="${radiusOf(n) + 13}" text-anchor="middle">${esc(n.name.length > 26 ? n.name.slice(0, 25) + '…' : n.name)}</text>`}
      </g>`;
    }).join('');
  }
  function applyView() { svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`); }

  // ----- interaction: click/drag nodes, pan background, wheel zoom -----
  const toSvg = (evt) => {
    const r = svg.getBoundingClientRect();
    const scale = Math.max(view.w / r.width, view.h / r.height);
    const ox = (r.width * scale - view.w) / 2; const oy = (r.height * scale - view.h) / 2;
    return { x: view.x - ox + (evt.clientX - r.left) * scale, y: view.y - oy + (evt.clientY - r.top) * scale, scale };
  };
  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('g[data-id]');
    const p = toSvg(e);
    drag = g ? { node: L.byId.get(g.dataset.id), start: p, moved: false } : { pan: true, start: p, view: { ...view }, moved: false, cx: e.clientX, cy: e.clientY };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.node) {
      const p = toSvg(e);
      if (Math.abs(p.x - drag.start.x) + Math.abs(p.y - drag.start.y) > 3) drag.moved = true;
      if (drag.moved) { drag.node.x = p.x; drag.node.y = p.y; draw(); }
    } else {
      const r = svg.getBoundingClientRect();
      const scale = Math.max(view.w / r.width, view.h / r.height);
      if (Math.abs(e.clientX - drag.cx) + Math.abs(e.clientY - drag.cy) > 3) drag.moved = true;
      view.x = drag.view.x - (e.clientX - drag.cx) * scale;
      view.y = drag.view.y - (e.clientY - drag.cy) * scale;
      applyView();
    }
  });
  svg.addEventListener('pointerup', () => {
    if (drag && !drag.moved) {
      selected = drag.node ? (selected === drag.node.id ? null : drag.node.id) : null;
      draw();
      opts.onSelect && opts.onSelect(selected ? L.byId.get(selected) : null, L);
    }
    drag = null;
  });
  const onWheel = (e) => {
    if (opts.compact) return;
    e.preventDefault();
    const p = toSvg(e);
    const k = Math.exp(e.deltaY * 0.0015);
    const w = Math.min(home.w * 3, Math.max(home.w / 6, view.w * k));
    const f = w / view.w;
    view = { x: p.x - (p.x - view.x) * f, y: p.y - (p.y - view.y) * f, w, h: view.h * f };
    applyView();
  };
  svg.addEventListener('wheel', onWheel, { passive: false });

  draw();
  return {
    select(id) { selected = id; draw(); opts.onSelect && opts.onSelect(id ? L.byId.get(id) : null, L); },
    update(newOpts) { Object.assign(opts, newOpts); draw(); },
    reset() { view = { ...home }; applyView(); },
    layout: L,
  };
}

/** Full-page graph view. */
export async function graphView(el) {
  const params = new URLSearchParams((location.hash.split('?')[1]) || '');
  const userId = params.get('user') || (session.user.role === 'student' ? session.user.id : null);
  const [graph, m, profile] = await Promise.all([GET('/graph'), meta(), userId ? GET(`/users/${userId}/profile`) : Promise.resolve(null)]);
  const subjects = [...m.subjects.values()];

  el.innerHTML = `
    <div class="page-head"><div><h1>Topic graph</h1>
      <p class="secondary">${graph.nodes.length} subtopics. Arrows point from a prerequisite to the skill that builds on it; dashed lines join related skills. Click a node for details, drag to rearrange, scroll to zoom.</p></div>
      <div class="row">
        ${profile ? `<label class="field">Colour by<select id="color"><option value="mastery">${userId === session.user.id ? 'My' : esc(profile.user.name + "'s")} mastery</option><option value="subject">Subject</option></select></label>` : ''}
        <label class="field">Highlight subject<select id="subj"><option value="">All subjects</option>${subjects.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
        <button id="reset" style="align-self:flex-end">Reset view</button>
      </div>
    </div>
    <div class="legend" id="legend" style="margin-bottom:10px"></div>
    <div class="graph-wrap" id="g"><div class="card graph-panel" id="panel" hidden></div></div>`;

  const panel = el.querySelector('#panel');
  const legend = el.querySelector('#legend');
  const colorSel = el.querySelector('#color');
  const renderLegend = (by) => {
    legend.innerHTML = by === 'mastery'
      ? [['mastered', 'Mastered'], ['proficient', 'Proficient'], ['developing', 'Developing'], ['needs-work', 'Needs work'], ['not-assessed', 'Not assessed']]
        .map(([k, l]) => `<span><span class="sw" style="background:${LEVEL_COLOR[k]}${k === 'not-assessed' ? ';border:1px dashed var(--muted);background:transparent' : ''}"></span>${l}</span>`).join('')
      : subjects.map((s, i) => `<span><span class="sw" style="background:${SUBJECT_COLORS[i]}"></span>${esc(s.name)}</span>`).join('');
    legend.innerHTML += '<span>→ prerequisite</span><span>┄ related</span>';
  };

  const onSelect = (n, L) => {
    if (!n) { panel.hidden = true; return; }
    const pre = L.links.filter((l) => l.kind === 'prerequisite' && l.t.id === n.id).map((l) => l.s);
    const next = L.links.filter((l) => l.kind === 'prerequisite' && l.s.id === n.id).map((l) => l.t);
    const rel = L.links.filter((l) => l.kind === 'related' && (l.s.id === n.id || l.t.id === n.id)).map((l) => (l.s.id === n.id ? l.t : l.s));
    const st = profile ? profile.subtopics[n.id] : null;
    const link = (x) => `<li><a href="#" data-sel="${esc(x.id)}">${esc(x.name)}</a> <span class="muted small">${esc(x.subjectName)}</span>
      ${profile ? ` ${statusChip(profile.subtopics[x.id])}` : ''}</li>`;
    const section = (title, xs) => `<h3 style="margin-top:12px">${title}</h3>${xs.length ? `<ul class="list small">${xs.map(link).join('')}</ul>` : '<p class="muted small">None</p>'}`;
    panel.innerHTML = `<div class="row"><b style="flex:1">${esc(n.name)}</b><button class="btn-sm btn-ghost" id="close" aria-label="Close">✕</button></div>
      <div class="muted small">${esc(n.subjectName)} › ${esc(n.topicName)} · ${n.questionCount} question${n.questionCount === 1 ? '' : 's'} in bank</div>
      ${st ? `<div style="margin-top:8px">${st.mastery === null ? '<span class="muted">Not assessed yet</span>' : `<b>${pct(st.mastery)}</b> ${statusChip(st)} <span class="muted small">${st.correct}/${st.attempts} correct</span>`}</div>` : ''}
      ${section('Builds on', pre)}${section('Unlocks', next)}${section('Related', rel)}`;
    panel.hidden = false;
    panel.querySelector('#close').addEventListener('click', () => api.select(null));
    panel.querySelectorAll('[data-sel]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); api.select(a.dataset.sel); }));
  };

  const by = profile ? 'mastery' : 'subject';
  const api = mountGraph(el.querySelector('#g'), graph, { profile, colorBy: by, onSelect });
  el.querySelector('#g').appendChild(panel);
  renderLegend(by);
  colorSel?.addEventListener('change', () => { api.update({ colorBy: colorSel.value }); renderLegend(colorSel.value); });
  el.querySelector('#subj').addEventListener('change', (e) => api.update({ subjectFilter: e.target.value || null }));
  el.querySelector('#reset').addEventListener('click', () => api.reset());
}

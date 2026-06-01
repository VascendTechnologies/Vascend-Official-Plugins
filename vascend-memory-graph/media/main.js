// Webview: grafo force-directed stile Obsidian su canvas, zero dipendenze.
// Riceve {type:'data', payload} dall'extension host. Costruisce da se' tutta la
// UI (pannello controlli, ricerca, filtri, tooltip) dentro #app. Funzioni:
//  - render con glow radiale, archi soft, sfondo dark + vignette, HiDPI crisp;
//  - hover che mette a fuoco un nodo e i suoi vicini attenuando il resto;
//  - etichette che compaiono con lo zoom / sul focus, con dissolvenza;
//  - zoom verso il cursore e pan con inerzia, click su nodo per centrarlo;
//  - fisica con repulsione/link/centratura/collisione regolabili da slider;
//  - animazione d'ingresso.
(function () {
  'use strict';

  const vscode = acquireVsCodeApi();

  // Palette per azione (12 azioni della voce Danilov) per gli archi a fuoco.
  const ACTION_COLORS = {
    read: '#4FC1FF', find: '#9CDCFE', plan: '#C586C0', edit: '#4EC9B0',
    new: '#73C991', fix: '#DCDCAA', error: '#F14C4C', run: '#CE9178',
    test: '#B5CEA8', warn: '#E5C07B', skip: '#808080', next: '#569CD6',
  };

  // ---- util colore ----
  function hexToRgb(hex) {
    const h = String(hex).replace('#', '');
    const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const int = parseInt(n, 16);
    return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
  }
  function rgba(hex, a) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }
  function themeColor(name, fallback) {
    const v = getComputedStyle(document.body).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  // ---- stato ----
  let payload = null;
  let nodes = [];
  let edges = [];
  const nodeById = new Map();
  const adjacency = new Map(); // id -> Set<id>

  let zoom = 1, targetZoom = 1, offsetX = 0, offsetY = 0;
  let anchorSx = 0, anchorSy = 0, anchorWx = 0, anchorWy = 0;
  let panVX = 0, panVY = 0;
  let dpr = 1;
  let worldCx = 0, worldCy = 0;

  let dragNode = null, panning = false, lastX = 0, lastY = 0, downX = 0, downY = 0, moved = false;
  let hoverNode = null, focusNode = null;
  let camAnim = null;
  let alpha = 1, intro = 0;

  const params = { repel: 1, link: 1, center: 1, collide: 1, arrows: true, labels: true };

  let accent = '#f2f2f2', fg = '#eaeaea', bg = '#0d0d0d', edgeBase = '#6b6b6b';

  // ---- costruzione UI ----
  function el(tag, attrs, kids) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === 'class') e.className = attrs[k];
        else if (k === 'text') e.textContent = attrs[k];
        else if (k.startsWith('on') && typeof attrs[k] === 'function') e.addEventListener(k.slice(2), attrs[k]);
        else e.setAttribute(k, attrs[k]);
      }
    }
    for (const c of kids || []) e.appendChild(c);
    return e;
  }

  const canvas = el('canvas', { id: 'graph' });
  const ctx = canvas.getContext('2d');
  const tooltip = el('div', { class: 'tooltip hidden' });
  const emptyEl = el('div', { class: 'empty hidden' });

  const selProject = el('select', { class: 'v-select' });
  const selPlan = el('select', { class: 'v-select' });
  const selAction = el('select', { class: 'v-select' });
  const searchInput = el('input', { class: 'v-search', type: 'text', placeholder: 'Cerca un nodo…' });
  const searchResults = el('div', { class: 'v-search-results hidden' });
  const statsEl = el('div', { class: 'v-stats' });

  function slider(label, key, min, max, step) {
    const input = el('input', { class: 'v-range', type: 'range', min, max, step, value: params[key] });
    input.addEventListener('input', () => { params[key] = parseFloat(input.value); reheat(0.5); });
    return el('label', { class: 'v-ctl' }, [el('span', { class: 'v-ctl-label', text: label }), input]);
  }
  function toggle(label, key) {
    const input = el('input', { class: 'v-check', type: 'checkbox' });
    input.checked = params[key];
    input.addEventListener('change', () => { params[key] = input.checked; });
    return el('label', { class: 'v-toggle' }, [input, el('span', { text: label })]);
  }

  const panel = el('div', { class: 'v-panel' }, [
    el('div', { class: 'v-brand' }, [el('span', { class: 'v-dot' }), el('span', { text: 'VASCEND' }), el('span', { class: 'v-sub', text: 'memory graph' })]),
    el('div', { class: 'v-search-wrap' }, [searchInput, searchResults]),
    el('div', { class: 'v-group' }, [
      el('div', { class: 'v-row' }, [el('span', { class: 'v-lbl', text: 'Progetto' }), selProject]),
      el('div', { class: 'v-row' }, [el('span', { class: 'v-lbl', text: 'Sessione' }), selPlan]),
      el('div', { class: 'v-row' }, [el('span', { class: 'v-lbl', text: 'Azione' }), selAction]),
    ]),
    el('div', { class: 'v-group' }, [
      slider('Repulsione', 'repel', 0.2, 3, 0.1),
      slider('Distanza link', 'link', 0.3, 3, 0.1),
      slider('Centratura', 'center', 0, 3, 0.1),
      slider('Collisione', 'collide', 0, 2, 0.1),
    ]),
    el('div', { class: 'v-group v-toggles' }, [toggle('Frecce', 'arrows'), toggle('Etichette', 'labels')]),
    statsEl,
  ]);

  const hint = el('div', { class: 'v-hint', text: 'scroll: zoom · trascina: sposta · click su un nodo: centra' });

  function mount() {
    const app = document.getElementById('app') || document.body;
    app.appendChild(canvas);
    app.appendChild(panel);
    app.appendChild(emptyEl);
    app.appendChild(tooltip);
    app.appendChild(hint);
  }

  // ---- selects + ricerca ----
  function fillSelect(sel, options, selected, allLabel) {
    sel.innerHTML = '';
    const optAll = el('option', { value: '', text: allLabel });
    sel.appendChild(optAll);
    for (const o of options) sel.appendChild(el('option', { value: o.value, text: o.label }));
    sel.value = selected != null ? selected : '';
  }
  selProject.addEventListener('change', postSelect);
  selPlan.addEventListener('change', postSelect);
  selAction.addEventListener('change', postSelect);
  function postSelect() {
    vscode.postMessage({ type: 'select', project: selProject.value || null, plan: selPlan.value || null, action: selAction.value || null });
  }

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    searchResults.innerHTML = '';
    if (!q) { searchResults.classList.add('hidden'); return; }
    const hits = nodes.filter((n) => n.label.toLowerCase().includes(q)).slice(0, 8);
    if (!hits.length) { searchResults.classList.add('hidden'); return; }
    for (const n of hits) {
      const item = el('div', { class: 'v-search-item', text: n.label });
      item.addEventListener('click', () => { focusNode = n; centerOn(n, 1.6); searchResults.classList.add('hidden'); searchInput.value = n.label; });
      searchResults.appendChild(item);
    }
    searchResults.classList.remove('hidden');
  });

  // ---- dati -> scena ----
  function setData(p) {
    payload = p;
    fillSelect(selProject, p.projects.map((x) => ({ value: x.project, label: `${x.project} (${x.events})` })), p.selected.project, 'Tutti i progetti');
    fillSelect(selPlan, p.plans.map((x) => ({ value: x, label: x })), p.selected.plan, 'Tutte le sessioni');
    fillSelect(selAction, p.actions.map((x) => ({ value: x, label: x })), p.selected.action, 'Tutte le azioni');
    const g = p.graph;
    statsEl.textContent = `${g.stats.nodes} nodi · ${g.stats.edges} archi · ${p.recordCount} eventi`;
    if (!g.nodes.length) {
      emptyEl.classList.remove('hidden');
      emptyEl.textContent = p.fileCount === 0
        ? `Nessun file .vascend in ${p.memoryDir}. La memoria si popola a fine turno di un DanilovGoal.`
        : 'Nessun evento per i filtri selezionati.';
    } else {
      emptyEl.classList.add('hidden');
    }
    buildScene(g);
  }

  function degreeOf(id) { const s = adjacency.get(id); return s ? s.size : 0; }

  function buildScene(g) {
    const prev = new Map(nodes.map((n) => [n.id, n]));
    nodeById.clear();
    adjacency.clear();
    const w = canvas.clientWidth || 1200;
    const h = canvas.clientHeight || 800;
    worldCx = w / 2;
    worldCy = h / 2;
    nodes = g.nodes.map((n, i) => {
      const old = prev.get(n.id);
      const ang = (i / Math.max(1, g.nodes.length)) * Math.PI * 2;
      const node = {
        id: n.id, label: n.label, count: n.count,
        x: old ? old.x : worldCx + Math.cos(ang) * (30 + (i % 11) * 4),
        y: old ? old.y : worldCy + Math.sin(ang) * (30 + (i % 7) * 4),
        vx: 0, vy: 0,
      };
      nodeById.set(n.id, node);
      adjacency.set(n.id, new Set());
      return node;
    });
    edges = g.edges.map((e) => ({
      source: nodeById.get(e.source), target: nodeById.get(e.target),
      action: e.action, plan: e.plan, note: e.note || '',
    })).filter((e) => e.source && e.target);
    for (const e of edges) {
      adjacency.get(e.source.id).add(e.target.id);
      adjacency.get(e.target.id).add(e.source.id);
    }
    for (const n of nodes) n.deg = degreeOf(n.id);
    focusNode = null;
    hoverNode = null;
    intro = 0;
    reheat(1);
    resetView();
  }

  function nodeRadius(n) { return 3.2 + Math.sqrt((n.deg || 0) + 1) * 2.6; }

  // ---- viewport ----
  function resize() {
    dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
  }
  function toScreenX(x) { return x * zoom + offsetX; }
  function toScreenY(y) { return y * zoom + offsetY; }
  function toWorldX(sx) { return (sx - offsetX) / zoom; }
  function toWorldY(sy) { return (sy - offsetY) / zoom; }
  function resetView() {
    zoom = 0.85; targetZoom = 0.85;
    offsetX = canvas.clientWidth / 2 - worldCx * zoom;
    offsetY = canvas.clientHeight / 2 - worldCy * zoom;
  }
  function reheat(a) { alpha = Math.max(alpha, a); }

  function centerOn(n, z) {
    const toZoom = z || zoom;
    camAnim = {
      fromX: offsetX, fromY: offsetY, fromZoom: zoom,
      toZoom,
      tx: n.x, ty: n.y, // mira al nodo: offset calcolato a runtime per centrarlo
      t: 0, dur: 28,
    };
  }

  // ---- simulazione ----
  function tick() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (intro < 1) intro = Math.min(1, intro + 0.02);

    if (alpha > 0.005 && nodes.length) {
      const kRep = 6800 * params.repel;
      const kSpring = 0.02 * params.link;
      const restLen = 64 * params.link;
      const kCenter = 0.012 * params.center;
      const kCollide = params.collide;

      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) { dx = (i - j) * 0.5 + 0.1; dy = 0.1; d2 = dx * dx + dy * dy; }
          const dist = Math.sqrt(d2);
          const f = kRep / d2;
          const fx = (dx / dist) * f, fy = (dy / dist) * f;
          a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
          // collisione (anti-overlap)
          if (kCollide > 0) {
            const minD = nodeRadius(a) + nodeRadius(b) + 6;
            if (dist < minD) {
              const push = (minD - dist) * 0.5 * kCollide;
              const px = (dx / dist) * push, py = (dy / dist) * push;
              a.vx += px; a.vy += py; b.vx -= px; b.vy -= py;
            }
          }
        }
        a.vx += (worldCx - a.x) * kCenter;
        a.vy += (worldCy - a.y) * kCenter;
      }
      for (const e of edges) {
        const dx = e.target.x - e.source.x, dy = e.target.y - e.source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const f = (dist - restLen) * kSpring;
        const fx = (dx / dist) * f, fy = (dy / dist) * f;
        e.source.vx += fx; e.source.vy += fy; e.target.vx -= fx; e.target.vy -= fy;
      }
      for (const n of nodes) {
        if (n === dragNode) { n.vx = 0; n.vy = 0; continue; }
        n.vx *= 0.82; n.vy *= 0.82;
        n.x += n.vx * alpha; n.y += n.vy * alpha;
      }
      alpha *= 0.986;
    }

    // camera: zoom smoothing verso ancora
    if (Math.abs(targetZoom - zoom) > 0.001) {
      zoom = lerp(zoom, targetZoom, 0.22);
      offsetX = anchorSx - anchorWx * zoom;
      offsetY = anchorSy - anchorWy * zoom;
    }
    // pan inertia
    if (!panning && (Math.abs(panVX) > 0.05 || Math.abs(panVY) > 0.05)) {
      offsetX += panVX; offsetY += panVY; panVX *= 0.9; panVY *= 0.9;
    }
    // animazione click-to-center
    if (camAnim) {
      camAnim.t++;
      const t = easeInOut(Math.min(1, camAnim.t / camAnim.dur));
      const z = lerp(camAnim.fromZoom, camAnim.toZoom, t);
      const wantOffX = w / 2 - camAnim.tx * z;
      const wantOffY = h / 2 - camAnim.ty * z;
      zoom = z; targetZoom = z;
      offsetX = lerp(camAnim.fromX, wantOffX, t);
      offsetY = lerp(camAnim.fromY, wantOffY, t);
      if (camAnim.t >= camAnim.dur) camAnim = null;
    }

    draw();
    requestAnimationFrame(tick);
  }

  // ---- rendering ----
  function focusSet() {
    if (!focusNode) return null;
    const s = adjacency.get(focusNode.id);
    const set = new Set(s ? [...s] : []);
    set.add(focusNode.id);
    return set;
  }

  function draw() {
    // Monocromo (bianco e nero): ignora il tema, sfondo nero e elementi bianchi/grigi.
    accent = '#f2f2f2';
    fg = '#eaeaea';
    bg = '#0d0d0d';

    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // sfondo + vignette
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    const fset = focusSet();
    const introA = easeOut(intro);

    // archi
    ctx.lineCap = 'round';
    for (const e of edges) {
      const active = fset && (fset.has(e.source.id) && (e.source === focusNode || e.target === focusNode || fset.has(e.target.id)) && (e.source === focusNode || e.target === focusNode));
      let a;
      if (!fset) a = 0.16 * introA;
      else if (e.source === focusNode || e.target === focusNode) a = 0.85;
      else a = 0.04;
      const color = (fset && (e.source === focusNode || e.target === focusNode)) ? '#ffffff' : edgeBase;
      drawEdge(e, color, a, (e.source === focusNode || e.target === focusNode));
    }

    // nodi
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const n of nodes) {
      const x = toScreenX(n.x), y = toScreenY(n.y);
      const r = nodeRadius(n) * zoom;
      const inFocus = !fset || fset.has(n.id);
      const isHub = n === focusNode;
      const a = (inFocus ? 1 : 0.18) * introA;

      // glow
      ctx.save();
      ctx.globalAlpha = a;
      ctx.shadowColor = rgba(accent, inFocus ? 0.9 : 0.3);
      ctx.shadowBlur = (isHub ? 26 : inFocus ? 14 : 5) * Math.max(0.6, zoom);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = isHub ? '#ffffff' : accent;
      ctx.fill();
      ctx.restore();

      // anello sul nodo a fuoco
      if (isHub) {
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(accent, 0.9);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // etichetta
      const showLabel = params.labels && (isHub || (fset && fset.has(n.id)) || zoom > 1.05 || n.deg >= 6);
      if (showLabel) {
        const labelA = Math.min(1, (isHub || (fset && fset.has(n.id))) ? 1 : Math.max(0, (zoom - 0.9) * 2)) * introA;
        if (labelA > 0.02) {
          const text = n.label.length > 28 ? n.label.slice(0, 27) + '…' : n.label;
          ctx.font = `${Math.max(9, Math.min(13, 11 * Math.max(0.8, zoom)))}px var(--vscode-font-family), sans-serif`;
          ctx.globalAlpha = labelA;
          ctx.lineWidth = 3;
          ctx.strokeStyle = rgba(bg, 0.9);
          ctx.strokeText(text, x, y + r + 9);
          ctx.fillStyle = inFocus ? fg : rgba(fg, 0.6);
          ctx.fillText(text, x, y + r + 9);
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  function drawEdge(e, color, a, withArrow) {
    const x1 = toScreenX(e.source.x), y1 = toScreenY(e.source.y);
    const x2 = toScreenX(e.target.x), y2 = toScreenY(e.target.y);
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / len, uy = dy / len;
    const tr = nodeRadius(e.target) * zoom;
    const ex = x2 - ux * (tr + 1.5), ey = y2 - uy * (tr + 1.5);
    // curva leggera
    const mx = (x1 + ex) / 2 - uy * len * 0.06;
    const my = (y1 + ey) / 2 + ux * len * 0.06;

    ctx.globalAlpha = a;
    ctx.strokeStyle = color;
    ctx.lineWidth = withArrow ? 1.6 : 1;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(mx, my, ex, ey);
    ctx.stroke();

    if (params.arrows && (withArrow || !focusNode)) {
      const ang = Math.atan2(ey - my, ex - mx);
      const ah = withArrow ? 7 : 5;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - ah * Math.cos(ang - Math.PI / 6), ey - ah * Math.sin(ang - Math.PI / 6));
      ctx.lineTo(ex - ah * Math.cos(ang + Math.PI / 6), ey - ah * Math.sin(ang + Math.PI / 6));
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function nodeAt(sx, sy) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const x = toScreenX(n.x), y = toScreenY(n.y);
      const r = nodeRadius(n) * zoom + 5;
      if ((sx - x) ** 2 + (sy - y) ** 2 <= r * r) return n;
    }
    return null;
  }

  // ---- eventi ----
  canvas.addEventListener('mousedown', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
    downX = sx; downY = sy; moved = false;
    const n = nodeAt(sx, sy);
    camAnim = null;
    if (n) { dragNode = n; focusNode = n; }
    else { panning = true; canvas.classList.add('dragging'); }
    panVX = 0; panVY = 0; lastX = sx; lastY = sy;
  });

  window.addEventListener('mousemove', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
    if (Math.abs(sx - downX) > 3 || Math.abs(sy - downY) > 3) moved = true;
    if (dragNode) {
      dragNode.x = toWorldX(sx); dragNode.y = toWorldY(sy); reheat(0.5);
    } else if (panning) {
      const ddx = sx - lastX, ddy = sy - lastY;
      offsetX += ddx; offsetY += ddy; panVX = ddx; panVY = ddy;
    } else {
      const n = nodeAt(sx, sy);
      if (n !== hoverNode) { hoverNode = n; focusNode = n; }
      updateTooltip(n, ev.clientX, ev.clientY);
      canvas.style.cursor = n ? 'pointer' : 'grab';
    }
    lastX = sx; lastY = sy;
  });

  window.addEventListener('mouseup', () => {
    if (dragNode && !moved) centerOn(dragNode, Math.max(1.4, zoom));
    dragNode = null; panning = false; canvas.classList.remove('dragging');
  });

  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    anchorSx = ev.clientX - rect.left; anchorSy = ev.clientY - rect.top;
    anchorWx = toWorldX(anchorSx); anchorWy = toWorldY(anchorSy);
    const factor = ev.deltaY < 0 ? 1.18 : 1 / 1.18;
    targetZoom = Math.min(4.5, Math.max(0.2, targetZoom * factor));
    camAnim = null;
  }, { passive: false });

  function updateTooltip(n, cx, cy) {
    if (!n) { tooltip.classList.add('hidden'); return; }
    const ins = edges.filter((e) => e.target === n).length;
    const outs = edges.filter((e) => e.source === n).length;
    tooltip.innerHTML = '';
    tooltip.appendChild(el('div', { class: 't-title', text: n.label }));
    tooltip.appendChild(el('div', { class: 't-row', text: `${n.deg} collegamenti · ${outs} uscenti · ${ins} entranti` }));
    tooltip.style.left = cx + 14 + 'px';
    tooltip.style.top = cy + 14 + 'px';
    tooltip.classList.remove('hidden');
  }

  window.addEventListener('resize', () => { resize(); });
  window.addEventListener('message', (ev) => {
    const msg = ev.data;
    if (msg && msg.type === 'data') { resize(); setData(msg.payload); }
  });

  mount();
  resize();
  requestAnimationFrame(tick);
  vscode.postMessage({ type: 'ready' });
})();

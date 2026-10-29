// board.js — turns a lesson (JSON) into a hand-drawn SVG and steps through it.
// Exposes window.WB = { parseLesson, Board }. Uses rough.js when it loaded, plain SVG otherwise.
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const MAX_NODES = 12, MAX_ARROWS = 16, MAX_STEPS = 10;
  const KINDS = ['server', 'database', 'phone', 'person', 'cloud', 'note', 'switch'];
  // rough.js writes literal colours; we draw with these placeholders and swap them for CSS classes.
  const STROKE = '#ff0000', FILL = '#00ff00';
  const colX = (c) => 110 + c * 195;
  const rowY = (r) => 80 + r * 145;

  const cssVar = (name, fallback) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  let HAND = null, READ = null;
  function fonts() {
    if (!HAND) { HAND = cssVar('--hand', 'cursive'); READ = cssVar('--read', 'sans-serif'); }
  }

  function hash(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return (h % 2147483646) + 1;
  }

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, String(attrs[k]));
    if (parent) parent.appendChild(e);
    return e;
  }

  // ---------------------------------------------------------------- lesson parsing
  const str = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

  function parseLesson(text, fallbackTitle) {
    let raw;
    try { raw = JSON.parse(text); } catch (e) { return { ok: false, error: e.message }; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: 'The file must hold one JSON object: { "title": ..., "nodes": [...], "arrows": [...], "steps": [...] }' };
    }
    const warn = [];
    const lesson = { title: str(raw.title) || fallbackTitle || 'Untitled lesson', oneLine: str(raw.oneLine), nodes: [], arrows: [], steps: [] };

    // nodes
    const ids = new Map(); // id -> 'node' | 'arrow'
    const used = new Set();
    const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
    if (raw.nodes != null && !Array.isArray(raw.nodes)) warn.push('"nodes" is not a list; no nodes drawn.');
    const placed = [];
    rawNodes.forEach((n, i) => {
      if (lesson.nodes.length >= MAX_NODES) { if (lesson.nodes.length === MAX_NODES && !placed.capped) { warn.push(`Only the first ${MAX_NODES} nodes are drawn.`); placed.capped = true; } return; }
      if (!n || typeof n !== 'object') { warn.push(`nodes[${i}] is not an object; skipped.`); return; }
      const id = str(n.id);
      if (!id) { warn.push(`nodes[${i}] has no "id"; skipped.`); return; }
      if (ids.has(id)) { warn.push(`Node id "${id}" is used twice; the second one is skipped.`); return; }
      let kind = str(n.kind).toLowerCase();
      if (!KINDS.includes(kind)) { if (kind) warn.push(`Node "${id}": unknown kind "${kind}", drawn as a server.`); kind = 'server'; }
      const cell = (v, max, name) => {
        const num = Number(v);
        if (v == null || v === '' || !Number.isFinite(num)) return null;
        const r = Math.min(max, Math.max(0, Math.round(num)));
        if (r !== num) warn.push(`Node "${id}": ${name} ${v} moved to ${r} (allowed 0–${max}).`);
        return r;
      };
      ids.set(id, 'node');
      lesson.nodes.push({ id, kind, label: str(n.label) || id, sub: str(n.sub), col: cell(n.col, 4, 'col'), row: cell(n.row, 3, 'row') });
    });
    // grid placement: a missing or taken cell moves to the nearest free one
    for (const n of lesson.nodes) {
      let col = n.col, row = n.row;
      const want = { col: col == null ? 0 : col, row: row == null ? 0 : row };
      if (col == null || row == null || used.has(col + ',' + row)) {
        let best = null, bestD = Infinity;
        for (let r = 0; r <= 3; r++) for (let c = 0; c <= 4; c++) {
          if (used.has(c + ',' + r)) continue;
          const d = Math.hypot((c - want.col) * 195, (r - want.row) * 145);
          if (d < bestD - 0.01) { bestD = d; best = { c, r }; }
        }
        if (col != null && row != null) warn.push(`Node "${n.id}": cell col ${col}, row ${row} is taken; moved to col ${best.c}, row ${best.r}.`);
        col = best.c; row = best.r;
      }
      used.add(col + ',' + row);
      n.col = col; n.row = row;
    }

    // arrows
    const rawArrows = Array.isArray(raw.arrows) ? raw.arrows : [];
    if (raw.arrows != null && !Array.isArray(raw.arrows)) warn.push('"arrows" is not a list; no arrows drawn.');
    rawArrows.forEach((a, i) => {
      if (!a || typeof a !== 'object') { warn.push(`arrows[${i}] is not an object; skipped.`); return; }
      if (lesson.arrows.length >= MAX_ARROWS) { if (!lesson.arrowsCapped) { warn.push(`Only the first ${MAX_ARROWS} arrows are drawn.`); lesson.arrowsCapped = true; } return; }
      const id = str(a.id) || `arrow${i + 1}`;
      const from = str(a.from), to = str(a.to);
      if (ids.get(from) !== 'node' || ids.get(to) !== 'node') { warn.push(`Arrow "${id}": unknown end "${ids.get(from) === 'node' ? to : from}"; skipped.`); return; }
      if (from === to) { warn.push(`Arrow "${id}" goes from "${from}" to itself; skipped.`); return; }
      if (ids.has(id)) { warn.push(`Arrow id "${id}" is already used; skipped.`); return; }
      ids.set(id, 'arrow');
      const bend = Number(a.bend);
      const at = Number(a.labelAt);
      lesson.arrows.push({
        id, from, to, label: str(a.label), dashed: a.dashed === true,
        bend: Number.isFinite(bend) ? Math.max(-220, Math.min(220, bend)) : 0,
        labelAt: Number.isFinite(at) ? Math.max(0.15, Math.min(0.85, at)) : 0.5,
        labelFixed: Number.isFinite(at),
      });
    });

    // steps
    const unknown = new Set();
    const pick = (list, kind, field, si) => {
      if (list == null) return [];
      if (!Array.isArray(list)) { warn.push(`steps[${si}].${field} is not a list; ignored.`); return []; }
      const out = [];
      for (const v of list) {
        const id = str(v);
        const k = ids.get(id);
        if (!k || (kind && k !== kind)) { if (!unknown.has(field + ':' + id)) { unknown.add(field + ':' + id); warn.push(`steps[${si}].${field}: "${id}" is not a known ${kind || 'node or arrow'}; ignored.`); } continue; }
        if (!out.includes(id)) out.push(id);
      }
      return out;
    };
    const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
    if (raw.steps != null && !Array.isArray(raw.steps)) warn.push('"steps" is not a list; showing everything in one step.');
    rawSteps.forEach((s, i) => {
      if (lesson.steps.length >= MAX_STEPS) { if (!lesson.stepsCapped) { warn.push(`Only the first ${MAX_STEPS} steps are used.`); lesson.stepsCapped = true; } return; }
      if (!s || typeof s !== 'object') { warn.push(`steps[${i}] is not an object; skipped.`); return; }
      const labels = {};
      if (s.labels && typeof s.labels === 'object' && !Array.isArray(s.labels)) {
        for (const [k, v] of Object.entries(s.labels)) {
          if (!ids.has(k)) { warn.push(`steps[${i}].labels: "${k}" is not a known node or arrow; ignored.`); continue; }
          labels[k] = str(v);
        }
      }
      lesson.steps.push({
        say: str(s.say),
        show: pick(s.show, null, 'show', i),
        flow: pick(s.flow, 'arrow', 'flow', i),
        cross: pick(s.cross, 'node', 'cross', i),
        ok: pick(s.ok, 'node', 'ok', i),
        labels,
      });
    });
    if (!lesson.steps.length) lesson.steps.push({ say: lesson.oneLine, show: [], flow: [], cross: [], ok: [], labels: {} });
    delete lesson.arrowsCapped; delete lesson.stepsCapped;
    return { ok: true, lesson, warnings: warn };
  }

  // ---------------------------------------------------------------- text fitting
  const mctx = document.createElement('canvas').getContext('2d');
  function textW(t, size, fam, weight) { mctx.font = `${weight} ${size}px ${fam}`; return mctx.measureText(t).width; }

  function wrap(text, size, fam, weight, maxW, hard) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '', overflow = false;
    const W = (t) => textW(t, size, fam, weight);
    for (const w of words) {
      if (W(w) > maxW) {
        if (!hard) overflow = true;
        else {
          if (cur) { lines.push(cur); cur = ''; }
          let chunk = '';
          for (const ch of w) { if (chunk && W(chunk + ch) > maxW) { lines.push(chunk); chunk = ch; } else chunk += ch; }
          cur = chunk;
          continue;
        }
      }
      const next = cur ? cur + ' ' + w : w;
      if (!cur || W(next) <= maxW) cur = next; else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return { lines, overflow, width: lines.reduce((m, l) => Math.max(m, W(l)), 0) };
  }

  function pack(L, S, a, b) {
    const lh = L * 1.02, sh = S * 1.28, gap = a.lines.length && b.lines.length ? 5 : 0;
    return { L, S, label: a.lines, sub: b.lines, lh, sh, gap, height: a.lines.length * lh + gap + b.lines.length * sh, width: Math.max(a.width, b.width) };
  }

  function fitBlock(label, sub, spec) {
    fonts();
    const none = { lines: [], overflow: false, width: 0 };
    let L = spec.L, S = spec.S;
    // first choice: the label on one line, shrunk a little at most
    for (let s = 1; s >= 0.8; s -= 0.04) {
      L = spec.L * s;
      const a = wrap(label, L, HAND, 700, spec.w, false);
      if (a.lines.length > 1 || a.overflow) continue;
      const b = sub ? wrap(sub, S, READ, 400, spec.w, false) : none;
      if (!b.overflow && b.lines.length <= spec.maxS) return pack(L, S, a, b);
    }
    for (let s = 1; s >= 0.66; s -= 0.04) {
      L = spec.L * s; S = Math.max(10.5, spec.S * s);
      const a = wrap(label, L, HAND, 700, spec.w, false);
      const b = sub ? wrap(sub, S, READ, 400, spec.w, false) : none;
      if (!a.overflow && !b.overflow && a.lines.length <= spec.maxL && b.lines.length <= spec.maxS) return pack(L, S, a, b);
    }
    return pack(L, S, wrap(label, L, HAND, 700, spec.w, true), sub ? wrap(sub, S, READ, 400, spec.w, true) : none);
  }

  function drawTextBlock(g, fit, cx, top) {
    g.textContent = '';
    if (fit.label.length) {
      const t = el('text', { class: 'lbl', 'text-anchor': 'middle', 'font-size': fit.L.toFixed(1) }, g);
      fit.label.forEach((line, i) => { el('tspan', { x: cx, y: (top + i * fit.lh + fit.L * 0.8).toFixed(1) }, t).textContent = line; });
    }
    if (fit.sub.length) {
      const base = top + fit.label.length * fit.lh + fit.gap;
      const t = el('text', { class: 'sub', 'text-anchor': 'middle', 'font-size': fit.S.toFixed(1) }, g);
      fit.sub.forEach((line, i) => { el('tspan', { x: cx, y: (base + i * fit.sh + fit.S * 0.98).toFixed(1) }, t).textContent = line; });
    }
  }

  // ---------------------------------------------------------------- shapes
  const SPEC = {
    server:   { w: 170, minH: 78,  tw: 148, padT: 11, padB: 11, maxL: 2, maxS: 3 },
    note:     { w: 172, minH: 78,  tw: 146, padT: 11, padB: 14, maxL: 2, maxS: 5 },
    switch:   { w: 172, minH: 86,  tw: 150, padT: 30, padB: 10, maxL: 2, maxS: 3 },
    database: { w: 164, minH: 100, tw: 140, padT: 30, padB: 14, maxL: 2, maxS: 3 },
    phone:    { w: 134, minH: 118, tw: 114, padT: 22, padB: 26, maxL: 2, maxS: 3 },
    cloud:    { w: 200, minH: 100, tw: 136, padT: 24, padB: 24, maxL: 2, maxS: 2 },
    person:   { w: 170, minH: 0,   tw: 168, padT: 0,  padB: 0,  maxL: 2, maxS: 2 },
  };

  function rectExit(a, r, dx, dy) {
    let t = Infinity;
    if (dx > 1e-9) t = Math.min(t, (r.x + r.w - a.x) / dx); else if (dx < -1e-9) t = Math.min(t, (r.x - a.x) / dx);
    if (dy > 1e-9) t = Math.min(t, (r.y + r.h - a.y) / dy); else if (dy < -1e-9) t = Math.min(t, (r.y - a.y) / dy);
    if (!Number.isFinite(t)) t = 0;
    return { x: a.x + dx * t, y: a.y + dy * t };
  }
  function ellipseExit(a, rx, ry, dx, dy) {
    const q = Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
    const t = q > 0 ? 1 / q : 0;
    return { x: a.x + dx * t, y: a.y + dy * t };
  }
  function roundRect(x, y, w, h, r) {
    return `M${x + r} ${y} L${x + w - r} ${y} Q${x + w} ${y} ${x + w} ${y + r} L${x + w} ${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} L${x + r} ${y + h} Q${x} ${y + h} ${x} ${y + h - r} L${x} ${y + r} Q${x} ${y} ${x + r} ${y} Z`;
  }
  function cloudPath(cx, cy, rx, ry, n) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n + 0.12;
      pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
    }
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < n; i++) {
      const p = pts[(i + 1) % n], q = pts[i];
      const r = (Math.hypot(p[0] - q[0], p[1] - q[1]) / 2) * 1.08;
      d += ` A${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
    }
    return d + ' Z';
  }

  // Layout one node: size from its widest label variant, plus how arrows meet its edge.
  function layoutNode(n, variants) {
    const spec = SPEC[n.kind];
    const fits = {};
    let textH = 0, textWmax = 0;
    for (const v of variants) {
      const f = fitBlock(v, n.sub, { w: spec.tw, L: 26, S: 14.5, maxL: spec.maxL, maxS: spec.maxS });
      fits[v] = f; textH = Math.max(textH, f.height); textWmax = Math.max(textWmax, f.width);
    }
    const x = colX(n.col), y = rowY(n.row);
    const L = { node: n, fits, x, y };
    if (n.kind === 'person') {
      const figH = 64, total = figH + 6 + textH, top = y - total / 2;
      const bw = Math.max(textWmax, 48) + 12;
      L.top = top;
      L.bounds = { x: x - bw / 2, y: top - 2, w: bw, h: total + 4 };
      L.anchor = { x, y: top + 34 };
      const fig = { x: x - 26, y: top - 2, w: 52, h: figH + 4 };
      L.exit = (dx, dy) => {
        const p = rectExit(L.anchor, fig, dx, dy);
        return p.y < fig.y + fig.h - 0.5 ? p : rectExit(L.anchor, L.bounds, dx, dy);
      };
      L.textTop = (f) => top + figH + 6 + (textH - f.height) / 2;
    } else {
      const w = spec.w, h = Math.max(spec.minH, textH + spec.padT + spec.padB);
      L.bounds = { x: x - w / 2, y: y - h / 2, w, h };
      L.anchor = { x, y };
      L.exit = n.kind === 'cloud'
        ? (dx, dy) => ellipseExit(L.anchor, w / 2 - 5, h / 2 - 5, dx, dy)
        : (dx, dy) => rectExit(L.anchor, L.bounds, dx, dy);
      const avail = h - spec.padT - spec.padB;
      L.textTop = (f) => L.bounds.y + spec.padT + (avail - f.height) / 2;
    }
    return L;
  }

  function plainGen() {
    function build(o, make) {
      const g = el('g');
      if (o.fill) { const f = make(); f.setAttribute('fill', o.fill); f.setAttribute('stroke', 'none'); g.appendChild(f); }
      if (o.stroke && o.stroke !== 'none') {
        const s = make();
        s.setAttribute('fill', 'none'); s.setAttribute('stroke', o.stroke); s.setAttribute('stroke-width', o.strokeWidth || 1.7);
        s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
        if (o.strokeLineDash) s.setAttribute('stroke-dasharray', o.strokeLineDash.join(' '));
        g.appendChild(s);
      }
      return g;
    }
    return {
      path: (d, o) => build(o, () => el('path', { d })),
      line: (x1, y1, x2, y2, o) => build(o, () => el('line', { x1, y1, x2, y2 })),
      linearPath: (pts, o) => build(o, () => el('polyline', { points: pts.map((p) => p.join(',')).join(' ') })),
      circle: (cx, cy, d, o) => build(o, () => el('circle', { cx, cy, r: d / 2 })),
    };
  }

  function tag(g) {
    for (const p of g.querySelectorAll('*')) {
      const s = p.getAttribute('stroke'), f = p.getAttribute('fill');
      if (s === STROKE) { p.classList.add('rf-stroke'); p.setAttribute('stroke', '#333'); }
      else if (s === FILL) { p.classList.add('rf-hatch'); p.setAttribute('stroke', '#ccc'); }
      if (f === FILL) { p.classList.add('rf-fill'); p.setAttribute('fill', '#eee'); }
    }
    return g;
  }

  // ---------------------------------------------------------------- the board
  class Board {
    constructor(svg) {
      this.svg = svg;
      this.usingRough = !!(window.rough && typeof window.rough.svg === 'function');
      this.gen = this.usingRough ? window.rough.svg(svg) : plainGen();
      this.raf = 0;
      this.reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    }

    opts(id, part, extra) {
      return Object.assign({ seed: ((hash(id) + part * 7919) % 2147483646) + 1, roughness: 1.1, bowing: 0.9, stroke: STROKE, strokeWidth: 1.7 }, extra || {});
    }

    draw(group, fn) { const g = tag(fn(this.gen)); group.appendChild(g); return g; }

    load(lesson) {
      this.stopFlows();
      this.lesson = lesson;
      const svg = this.svg;
      svg.textContent = '';
      const { nodes, arrows, steps } = lesson;

      // when does each element first appear?
      const hasShow = steps.some((s) => s.show.length);
      const first = {};
      for (const x of [...nodes, ...arrows]) {
        let k = 0;
        if (hasShow) { const i = steps.findIndex((s) => s.show.includes(x.id)); k = i < 0 ? 0 : i; }
        first[x.id] = k;
      }
      for (const a of arrows) first[a.id] = Math.max(first[a.id], first[a.from], first[a.to]);
      this.first = first;

      // label in force at each step (overrides carry forward)
      const base = {};
      for (const x of [...nodes, ...arrows]) base[x.id] = x.label;
      this.labelsAt = [];
      let cur = Object.assign({}, base);
      for (const s of steps) { cur = Object.assign({}, cur, s.labels); this.labelsAt.push(cur); }
      const variants = {};
      for (const x of [...nodes, ...arrows]) variants[x.id] = new Set([base[x.id]]);
      for (const m of this.labelsAt) for (const id in m) variants[id].add(m[id]);

      this.layers = {
        arrows: el('g', { class: 'layer-arrows' }, svg),
        nodes: el('g', { class: 'layer-nodes' }, svg),
        labels: el('g', { class: 'layer-labels' }, svg),
        marks: el('g', { class: 'layer-marks' }, svg),
        flow: el('g', { class: 'layer-flow' }, svg),
      };

      if (!nodes.length) {
        el('text', { x: 500, y: 300, 'text-anchor': 'middle', class: 'lbl', 'font-size': 30 }, this.layers.nodes).textContent = 'This lesson has no nodes yet';
      }

      this.nodeL = {};
      for (const n of nodes) this.nodeL[n.id] = layoutNode(n, [...variants[n.id]]);
      for (const n of nodes) this.drawNode(n);
      this.arrowG = {};
      for (const a of arrows) this.drawArrow(a);
      this.shownLabel = {};
      this.step = -1;
    }

    drawNode(n) {
      const L = this.nodeL[n.id];
      const b = L.bounds;
      const g = el('g', { class: `el node kind-${n.kind}`, 'data-id': n.id }, this.layers.nodes);
      const shape = el('g', { class: 'shape' }, g);
      const filled = (part) => this.opts(n.id, part, { fill: FILL, fillStyle: 'solid' });
      const plain = (part, extra) => this.opts(n.id, part, extra);
      const { x } = L;
      switch (n.kind) {
        case 'database': {
          const ry = 12, x0 = b.x, x1 = b.x + b.w, top = b.y, bot = b.y + b.h, rx = b.w / 2;
          const sil = `M${x0} ${top + ry} L${x0} ${bot - ry} A${rx} ${ry} 0 0 0 ${x1} ${bot - ry} L${x1} ${top + ry} A${rx} ${ry} 0 0 0 ${x0} ${top + ry} Z`;
          this.draw(shape, (r) => r.path(sil, filled(1)));
          this.draw(shape, (r) => r.path(`M${x0} ${top + ry} A${rx} ${ry} 0 0 0 ${x1} ${top + ry}`, plain(2)));
          break;
        }
        case 'phone':
          this.draw(shape, (r) => r.path(roundRect(b.x, b.y, b.w, b.h, 16), filled(1)));
          this.draw(shape, (r) => r.line(x - 15, b.y + 11, x + 15, b.y + 11, plain(2)));
          this.draw(shape, (r) => r.circle(x, b.y + b.h - 13, 11, plain(3)));
          break;
        case 'cloud':
          this.draw(shape, (r) => r.path(cloudPath(x, L.y, b.w / 2 - 15, b.h / 2 - 15, 10), filled(1)));
          break;
        case 'note': {
          const f = 16, x1 = b.x + b.w, y1 = b.y + b.h;
          this.draw(shape, (r) => r.path(`M${b.x} ${b.y} L${x1} ${b.y} L${x1} ${y1 - f} L${x1 - f} ${y1} L${b.x} ${y1} Z`, filled(1)));
          this.draw(shape, (r) => r.linearPath([[x1, y1 - f], [x1 - f, y1 - f], [x1 - f, y1]], plain(2)));
          break;
        }
        case 'switch': {
          this.draw(shape, (r) => r.path(roundRect(b.x, b.y, b.w, b.h, 8), filled(1)));
          const px = b.x + 12, py = b.y + 9, pw = 40, ph = 17;
          this.draw(shape, (r) => r.path(roundRect(px, py, pw, ph, ph / 2), plain(2)));
          const knob = el('g', { class: 'knob' }, shape);
          this.draw(knob, (r) => r.circle(px + pw - ph / 2, py + ph / 2, ph - 5, filled(3)));
          break;
        }
        case 'person': {
          const t = L.top;
          this.draw(shape, (r) => r.circle(x, t + 12, 23, plain(1)));
          this.draw(shape, (r) => r.line(x, t + 24, x, t + 46, plain(2)));
          this.draw(shape, (r) => r.linearPath([[x - 18, t + 41], [x, t + 30], [x + 18, t + 41]], plain(3)));
          this.draw(shape, (r) => r.linearPath([[x - 14, t + 64], [x, t + 46], [x + 14, t + 64]], plain(4)));
          break;
        }
        default:
          this.draw(shape, (r) => r.path(roundRect(b.x, b.y, b.w, b.h, 6), filled(1)));
      }
      L.g = g;
      L.text = el('g', { class: 'txt' }, g);

      // marks: drawn once, toggled per step
      const m = 8;
      L.markX = el('g', { class: 'mark mark-x off' }, this.layers.marks);
      const xo = (part) => this.opts(n.id, 20 + part, { strokeWidth: 6, roughness: 1.3, disableMultiStroke: true });
      this.draw(L.markX, (r) => r.line(b.x + m, b.y + m, b.x + b.w - m, b.y + b.h - m, xo(1)));
      this.draw(L.markX, (r) => r.line(b.x + b.w - m, b.y + m, b.x + m, b.y + b.h - m, xo(2)));
      L.markOk = el('g', { class: 'mark mark-ok off' }, this.layers.marks);
      const tx = b.x + b.w - 4, ty = b.y + 4;
      el('circle', { class: 'ok-bg', cx: tx, cy: ty, r: 19 }, L.markOk);
      this.draw(L.markOk, (r) => r.linearPath([[tx - 10, ty + 1], [tx - 3, ty + 9], [tx + 11, ty - 9]], this.opts(n.id, 30, { strokeWidth: 5, roughness: 0.9, disableMultiStroke: true })));
    }

    drawArrow(a) {
      const A = this.nodeL[a.from], B = this.nodeL[a.to];
      const pa = A.anchor, pb = B.anchor;
      const dx = pb.x - pa.x, dy = pb.y - pa.y, len = Math.hypot(dx, dy) || 1;
      let s, e, c = null;
      if (a.bend) {
        const nx = -dy / len, ny = dx / len;
        c = { x: (pa.x + pb.x) / 2 + nx * a.bend, y: (pa.y + pb.y) / 2 + ny * a.bend };
        s = A.exit(c.x - pa.x, c.y - pa.y); e = B.exit(c.x - pb.x, c.y - pb.y);
      } else {
        s = A.exit(dx, dy); e = B.exit(-dx, -dy);
      }
      // small gaps so lines do not touch the shapes
      const toward = (p, q, d) => { const l = Math.hypot(q.x - p.x, q.y - p.y) || 1; return { x: p.x + ((q.x - p.x) / l) * d, y: p.y + ((q.y - p.y) / l) * d }; };
      s = toward(s, c || e, 4); e = toward(e, c || s, 6);
      const geo = { s, e, c };
      geo.at = (t) => c
        ? { x: (1 - t) * (1 - t) * s.x + 2 * (1 - t) * t * c.x + t * t * e.x, y: (1 - t) * (1 - t) * s.y + 2 * (1 - t) * t * c.y + t * t * e.y }
        : { x: s.x + (e.x - s.x) * t, y: s.y + (e.y - s.y) * t };
      let L = 0, prev = geo.at(0);
      for (let i = 1; i <= 24; i++) { const p = geo.at(i / 24); L += Math.hypot(p.x - prev.x, p.y - prev.y); prev = p; }
      geo.len = L;

      const g = el('g', { class: `el arrow${a.dashed ? ' dashed' : ''}`, 'data-id': a.id }, this.layers.arrows);
      const o = (part) => this.opts(a.id, part, a.dashed ? { strokeLineDash: [9, 7], disableMultiStroke: true, roughness: 0.8 } : { roughness: 0.9 });
      if (c) this.draw(g, (r) => r.path(`M${s.x} ${s.y} Q${c.x} ${c.y} ${e.x} ${e.y}`, o(1)));
      else this.draw(g, (r) => r.line(s.x, s.y, e.x, e.y, o(1)));
      const from = c || s;
      const hx = e.x - from.x, hy = e.y - from.y, hl = Math.hypot(hx, hy) || 1;
      const ux = hx / hl, uy = hy / hl;
      const head = [[e.x - ux * 15 - uy * 7.5, e.y - uy * 15 + ux * 7.5], [e.x, e.y], [e.x - ux * 15 + uy * 7.5, e.y - uy * 15 - ux * 7.5]];
      this.draw(g, (r) => r.linearPath(head, this.opts(a.id, 2, { roughness: 0.6, disableMultiStroke: true })));
      const lg = el('g', { class: 'el alabel', 'data-id': a.id }, this.layers.labels);
      this.arrowG[a.id] = { g, lg, geo, arrow: a };
    }

    renderArrowLabel(id, text) {
      const A = this.arrowG[id];
      A.lg.textContent = '';
      A.labelBox = null;
      if (!text) return;
      fonts();
      let size = 20, w = wrap(text, size, HAND, 700, 150, false);
      while ((w.overflow || w.lines.length > 2) && size > 16) { size -= 1; w = wrap(text, size, HAND, 700, 150, size <= 16); }
      const lh = size * 1.0, bw = w.width + 12, bh = w.lines.length * lh + 6;
      A.placed = A.placed || {};
      const p = A.placed[text] || (A.placed[text] = this.placeLabel(id, bw, bh));
      const box = { x: p.x - bw / 2, y: p.y - bh / 2, w: bw, h: bh };
      A.labelBox = box;
      el('rect', { x: box.x.toFixed(1), y: box.y.toFixed(1), width: bw.toFixed(1), height: bh.toFixed(1), rx: 6 }, A.lg);
      const t = el('text', { 'text-anchor': 'middle', 'font-size': size }, A.lg);
      w.lines.forEach((line, i) => { el('tspan', { x: p.x.toFixed(1), y: (box.y + 3 + i * lh + size * 0.78).toFixed(1) }, t).textContent = line; });
    }

    // Pick a label spot: on the line near the middle if there is room, else beside it, keeping clear
    // of boxes, labels already placed and other arrows. Deterministic, so labels never jump.
    placeLabel(id, bw, bh) {
      const { geo, arrow } = this.arrowG[id];
      const ts = arrow.labelFixed ? [arrow.labelAt] : [0.5, 0.42, 0.58, 0.34, 0.66, 0.27, 0.73];
      const ov = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      const others = Object.values(this.arrowG).filter((o) => o.arrow.id !== id);
      const samples = others.map((o) => { const pts = []; for (let i = 1; i < 40; i++) pts.push(o.geo.at(i / 40)); return pts; });
      let best = null, bestScore = Infinity;
      for (const t of ts) {
        const p = geo.at(t);
        const q = geo.at(Math.min(1, t + 0.01)), r = geo.at(Math.max(0, t - 0.01));
        const tl = Math.hypot(q.x - r.x, q.y - r.y) || 1;
        const ux = (q.x - r.x) / tl, uy = (q.y - r.y) / tl;
        let nx = -uy, ny = ux;
        if (ny > 0 || (Math.abs(ny) < 1e-6 && nx > 0)) { nx = -nx; ny = -ny; }
        const side = Math.abs(nx) * bw / 2 + Math.abs(ny) * bh / 2 + 6;
        const along = Math.abs(ux) * bw / 2 + Math.abs(uy) * bh / 2;
        for (const o of [0, side, -side]) {
          const c = { x: p.x + nx * o, y: p.y + ny * o };
          const box = { x: c.x - bw / 2, y: c.y - bh / 2, w: bw, h: bh };
          let score = Math.abs(t - arrow.labelAt) * 60 + (o ? 25 + (o < 0 ? 5 : 0) : 0);
          if (o === 0 && Math.min(t, 1 - t) * geo.len - along < 14) score += 600; // would cover the arrow's end
          for (const L of Object.values(this.nodeL)) {
            const b = L.bounds;
            score += ov(box, { x: b.x - 5, y: b.y - 5, w: b.w + 10, h: b.h + 10 }) * 2;
          }
          for (const oth of others) if (oth.labelBox) score += ov(box, oth.labelBox) * 3;
          for (const pts of samples) for (const s of pts) if (s.x > box.x && s.x < box.x + box.w && s.y > box.y && s.y < box.y + box.h) score += 40;
          if (box.x < 4 || box.y < 4 || box.x + box.w > 996 || box.y + box.h > 596) score += 2000;
          if (score < bestScore - 0.01) { bestScore = score; best = c; }
        }
      }
      return best;
    }

    get stepCount() { return this.lesson ? this.lesson.steps.length : 0; }

    setStep(k) {
      const { nodes, arrows, steps } = this.lesson;
      k = Math.max(0, Math.min(steps.length - 1, k));
      const prevLabels = this.step >= 0 ? this.labelsAt[this.step] : null;
      this.step = k;
      const s = steps[k];
      const labels = this.labelsAt[k];
      const hl = new Set(s.show);
      for (const id in s.labels) if (!prevLabels || k === 0 || this.labelsAt[k - 1][id] !== s.labels[id]) hl.add(id);
      const cross = new Set(s.cross), ok = new Set(s.ok);

      for (const n of nodes) {
        const L = this.nodeL[n.id];
        const vis = this.first[n.id] <= k;
        L.g.classList.toggle('hidden', !vis);
        L.g.classList.toggle('hl', vis && hl.has(n.id));
        L.g.classList.toggle('down', vis && cross.has(n.id));
        L.markX.classList.toggle('off', !(vis && cross.has(n.id)));
        L.markOk.classList.toggle('off', !(vis && ok.has(n.id)));
        const text = labels[n.id];
        if (this.shownLabel[n.id] !== text) {
          const f = L.fits[text];
          drawTextBlock(L.text, f, L.x, L.textTop(f));
          this.shownLabel[n.id] = text;
        }
      }
      for (const a of arrows) {
        const A = this.arrowG[a.id];
        const vis = this.first[a.id] <= k;
        for (const g of [A.g, A.lg]) { g.classList.toggle('hidden', !vis); g.classList.toggle('hl', vis && hl.has(a.id)); }
        const text = labels[a.id];
        if (this.shownLabel[a.id] !== text) { this.renderArrowLabel(a.id, text); this.shownLabel[a.id] = text; }
      }
      this.startFlows(s.flow.filter((id) => this.first[id] <= k));
      return k;
    }

    // ------------------------------------------------------------ moving dots
    stopFlows() {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      if (this.layers) this.layers.flow.textContent = '';
    }

    startFlows(ids) {
      this.stopFlows();
      if (!ids.length) return;
      const layer = this.layers.flow;
      const dot = () => { const g = el('g', { class: 'flow' }, layer); el('circle', { class: 'flow-halo', r: 12 }, g); el('circle', { class: 'flow-dot', r: 6.5 }, g); return g; };
      if (this.reduce.matches) {
        for (const id of ids) {
          const A = this.arrowG[id];
          const p = A.geo.at(A.arrow.label ? 0.2 : 0.5);
          dot().setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
        }
        return;
      }
      // arrows that continue one another (a→b, then b→c) form one journey, played in order
      const chains = [];
      for (const id of ids) {
        const a = this.arrowG[id].arrow;
        const ch = chains.find((c) => this.arrowG[c[c.length - 1]].arrow.to === a.from && !c.includes(id));
        if (ch) ch.push(id); else chains.push([id]);
      }
      const runs = chains.map((c) => {
        const segs = c.map((id) => { const geo = this.arrowG[id].geo; return { geo, dur: Math.max(0.8, Math.min(1.8, geo.len / 230)) }; });
        return { segs, period: segs.reduce((t, sg) => t + sg.dur, 0) + 0.7, g: dot() };
      });
      const t0 = performance.now();
      const tick = (now) => {
        const t = (now - t0) / 1000;
        for (const r of runs) {
          let u = t % r.period, shown = false;
          for (const sg of r.segs) {
            if (u <= sg.dur) {
              const f = u / sg.dur, e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
              const p = sg.geo.at(e);
              r.g.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
              shown = true; break;
            }
            u -= sg.dur;
          }
          r.g.style.opacity = shown ? '1' : '0';
        }
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    }

    // ------------------------------------------------------------ layout check (for tuning lessons)
    check() {
      const issues = [];
      const ov = (a, b, pad = 0) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
      const inside = (p, r) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
      const nodes = this.lesson.nodes, last = this.lesson.steps.length - 1;
      const boxes = {};
      for (const a of this.lesson.arrows) {
        this.renderArrowLabel(a.id, this.labelsAt[last][a.id]);
        boxes[a.id] = this.arrowG[a.id].labelBox;
      }
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++)
        if (ov(this.nodeL[nodes[i].id].bounds, this.nodeL[nodes[j].id].bounds, 4)) issues.push(`node ${nodes[i].id} touches node ${nodes[j].id}`);
      for (const a of this.lesson.arrows) {
        const box = boxes[a.id];
        const geo = this.arrowG[a.id].geo;
        for (const n of nodes) {
          const r = this.nodeL[n.id].bounds;
          if (box && ov(box, r)) issues.push(`label of ${a.id} overlaps node ${n.id}`);
          if (n.id !== a.from && n.id !== a.to) {
            for (let i = 1; i < 40; i++) if (inside(geo.at(i / 40), r)) { issues.push(`arrow ${a.id} crosses node ${n.id}`); break; }
          }
        }
        for (const b of this.lesson.arrows) {
          if (b.id === a.id) continue;
          const ob = boxes[b.id];
          if (ob && box && b.id > a.id && ov(box, ob)) issues.push(`label of ${a.id} overlaps label of ${b.id}`);
          if (ob) for (let i = 1; i < 60; i++) if (inside(geo.at(i / 60), ob)) { issues.push(`arrow ${a.id} runs through label of ${b.id}`); break; }
        }
      }
      for (const n of nodes) { const r = this.nodeL[n.id].bounds; if (r.y < 2 || r.y + r.h > 598) issues.push(`node ${n.id} leaves the board`); }
      // restore the labels for the current step
      this.shownLabel = {};
      if (this.step >= 0) { const k = this.step; this.step = -1; this.setStep(k); }
      return issues;
    }
  }

  window.WB = { parseLesson, Board };
})();

// Tidy: boxes that are roughly in a row or a column are lined up exactly and spaced evenly, and boxes of
// nearly the same size get the same size. Arrows attached to them and the text inside them follow.

import { CaptureUpdateAction, newElementWith } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { type El, absPoints, centreOf, edgePoint } from './elements';
import type { P } from '../ink/geometry';

const median = (a: number[]) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** Groups of values that sit close together (each value with its index). */
function clusters(vals: { i: number; v: number }[], tol: number) {
  const sorted = vals.slice().sort((a, b) => a.v - b.v);
  const out: { i: number; v: number }[][] = [];
  for (const x of sorted) {
    const g = out[out.length - 1];
    if (g && Math.abs(x.v - g.reduce((s, y) => s + y.v, 0) / g.length) <= tol) g.push(x);
    else out.push([x]);
  }
  return out;
}

/** Arrows attached to changed shapes: move their ends to the shapes' new outlines; labels to their middle. */
export function reroute(all: readonly El[], changed: Map<string, El>): Map<string, El> {
  const byId = new Map(all.map((e) => [e.id, changed.get(e.id) ?? e]));
  const out = new Map<string, El>();
  for (const a of all) {
    if (a.type !== 'arrow' || a.isDeleted) continue;
    const sId = a.startBinding?.elementId, eId = a.endBinding?.elementId;
    if (!(sId && changed.has(sId)) && !(eId && changed.has(eId))) continue;
    const S = sId ? byId.get(sId) : undefined, E = eId ? byId.get(eId) : undefined;
    const pts = absPoints(a);
    const n = pts.length;
    let p = pts[0], q = pts[n - 1];
    if (n === 2 && S && E) { p = edgePoint(S, centreOf(E), a.startBinding!.gap); q = edgePoint(E, centreOf(S), a.endBinding!.gap); }
    else {
      if (S) p = edgePoint(S, pts[1], a.startBinding!.gap);
      if (E) q = edgePoint(E, pts[n - 2], a.endBinding!.gap);
    }
    const abs: P[] = [p, ...pts.slice(1, -1), q];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const v of abs) { minX = Math.min(minX, v.x); minY = Math.min(minY, v.y); maxX = Math.max(maxX, v.x); maxY = Math.max(maxY, v.y); }
    const moved = newElementWith(a, {
      x: p.x, y: p.y, angle: 0 as never,
      points: abs.map((v) => [v.x - p.x, v.y - p.y] as never),
      width: maxX - minX, height: maxY - minY,
    } as never) as El;
    out.set(a.id, moved);
    // its label sits in the middle of the line
    const label = a.boundElements?.find((b) => b.type === 'text');
    const t = label && byId.get(label.id);
    if (t) {
      const mid = abs.length === 2 ? { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } : abs[Math.floor(abs.length / 2)];
      out.set(t.id, newElementWith(t, { x: mid.x - t.width / 2, y: mid.y - t.height / 2 } as never) as El);
    }
  }
  // text inside a changed box stays in its middle
  for (const t of all) {
    if (t.type !== 'text' || !t.containerId || !changed.has(t.containerId)) continue;
    const c = changed.get(t.containerId)!;
    out.set(t.id, newElementWith(t, { x: c.x + (c.width - t.width) / 2, y: c.y + (c.height - t.height) / 2 } as never) as El);
  }
  return out;
}

export function tidy(api: ExcalidrawImperativeAPI, ids: Iterable<string>): number {
  const want = new Set(ids);
  const all = api.getSceneElementsIncludingDeleted() as readonly El[];
  const items = all.filter((e) => want.has(e.id) && !e.isDeleted && !['arrow', 'line', 'freedraw'].includes(e.type) && !(e.type === 'text' && e.containerId));
  if (items.length < 2) return 0;
  const W = items.map((e) => e.width), H = items.map((e) => e.height);
  const mw = median(W), mh = median(H);

  // Same size for boxes that are nearly the same size (and the same kind).
  const size = new Map<string, { w: number; h: number }>();
  const kinds = new Set(items.map((e) => e.type));
  if (kinds.size === 1 && items[0].type !== 'text' && items.every((e) => Math.abs(e.width - mw) <= mw * 0.25 && Math.abs(e.height - mh) <= mh * 0.25)) {
    for (const e of items) size.set(e.id, { w: mw, h: mh });
  }
  const cx = items.map((e) => e.x + e.width / 2), cy = items.map((e) => e.y + e.height / 2);
  const nx = cx.slice(), ny = cy.slice();

  // Rows (close centre-y) and columns (close centre-x).
  const rows = clusters(cy.map((v, i) => ({ i, v })), mh * 0.5).filter((g) => g.length >= 2).map((g) => g.map((x) => x.i));
  const cols = clusters(cx.map((v, i) => ({ i, v })), mw * 0.5).filter((g) => g.length >= 2).map((g) => g.map((x) => x.i));
  const rowOf = new Map<number, number[]>(), colOf = new Map<number, number[]>();
  rows.forEach((g) => g.forEach((i) => rowOf.set(i, g)));
  cols.forEach((g) => g.forEach((i) => colOf.set(i, g)));

  // 1. Line them up exactly.
  for (const g of rows) { const m = g.reduce((s, i) => s + cy[i], 0) / g.length; g.forEach((i) => { ny[i] = m; }); }
  for (const g of cols) { const m = g.reduce((s, i) => s + cx[i], 0) / g.length; g.forEach((i) => { nx[i] = m; }); }

  // 2. Space rows and columns of three or more evenly (when the gaps are roughly alike); a box's column
  //    (or row) moves with it, so step 1 holds.
  const spread = (groups: number[][], pos: number[], partners: Map<number, number[]>) => {
    for (const g of groups) {
      if (g.length < 3) continue;
      const along = g.slice().sort((a, b) => pos[a] - pos[b]);
      const first = pos[along[0]], last = pos[along[along.length - 1]];
      const avg = (last - first) / (along.length - 1);
      const gaps = along.slice(1).map((i, k) => pos[i] - pos[along[k]]);
      if (!gaps.every((d) => d > avg * 0.4 && d < avg * 1.6)) continue;
      along.forEach((i, k) => {
        const target = first + avg * k;
        for (const j of partners.get(i) ?? [i]) pos[j] = target;
      });
    }
  };
  spread(rows, nx, colOf);
  spread(cols, ny, rowOf);

  const changed = new Map<string, El>();
  items.forEach((e, i) => {
    const s = size.get(e.id) ?? { w: e.width, h: e.height };
    const x = nx[i] - s.w / 2, y = ny[i] - s.h / 2;
    if (Math.abs(x - e.x) < 0.5 && Math.abs(y - e.y) < 0.5 && s.w === e.width && s.h === e.height) return;
    changed.set(e.id, newElementWith(e, { x, y, width: s.w, height: s.h } as never) as El);
  });
  if (!changed.size) return 0;
  const follow = reroute(all, changed);
  api.updateScene({
    elements: all.map((e) => changed.get(e.id) ?? follow.get(e.id) ?? e),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return changed.size;
}

// Geometry on Excalidraw elements: their real points on the board, which shape is under a point, and
// where a connecting arrow meets a shape's outline.

import type { ExcalidrawElement, NonDeletedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { type P, rotate } from '../ink/geometry';

export type El = ExcalidrawElement;
type WithPoints = El & { points: readonly (readonly [number, number])[] };

export const hasPoints = (el: El): el is WithPoints =>
  el.type === 'freedraw' || el.type === 'line' || el.type === 'arrow';

/** Centre of an element (Excalidraw rotates elements around this point). */
export function centreOf(el: El): P {
  if (hasPoints(el)) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of el.points) {
      if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
    return { x: el.x + (minX + maxX) / 2, y: el.y + (minY + maxY) / 2 };
  }
  return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
}

/** The element's points as they sit on the board (rotation included). */
export function absPoints(el: El): P[] {
  if (!hasPoints(el)) return [];
  const pts = el.points.map(([x, y]) => ({ x: el.x + x, y: el.y + y }));
  if (!el.angle) return pts;
  const c = centreOf(el);
  return pts.map((p) => rotate(p, c, el.angle));
}

const BINDABLE = new Set(['rectangle', 'ellipse', 'diamond']);
export const isBindable = (el: El) => BINDABLE.has(el.type) && !el.isDeleted;

/** The top-most box, circle or diamond at a point (with some slack), or null. */
export function shapeAt(p: P, elements: readonly NonDeletedExcalidrawElement[], slack: number): El | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (!isBindable(el)) continue;
    const c = centreOf(el);
    const q = el.angle ? rotate(p, c, -el.angle) : p;
    const hw = el.width / 2 + slack, hh = el.height / 2 + slack;
    const dx = Math.abs(q.x - c.x), dy = Math.abs(q.y - c.y);
    if (el.type === 'rectangle' && dx <= hw && dy <= hh) return el;
    if (el.type === 'ellipse' && (dx / hw) ** 2 + (dy / hh) ** 2 <= 1) return el;
    if (el.type === 'diamond' && dx / hw + dy / hh <= 1) return el;
  }
  return null;
}

/** Where a straight line from the shape's centre towards `towards` leaves the shape's outline, plus a gap. */
export function edgePoint(el: El, towards: P, gap = 6): P {
  const c = centreOf(el);
  const t = el.angle ? rotate(towards, c, -el.angle) : towards;
  let dx = t.x - c.x, dy = t.y - c.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  const hw = el.width / 2, hh = el.height / 2;
  let s: number;
  if (el.type === 'ellipse') s = 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2);
  else if (el.type === 'diamond') s = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else s = Math.min(Math.abs(dx) > 1e-9 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-9 ? hh / Math.abs(dy) : Infinity);
  const local = { x: c.x + dx * (s + gap), y: c.y + dy * (s + gap) };
  return el.angle ? rotate(local, c, el.angle) : local;
}

/** Bounding box of a set of points. */
export function boundsOf(pts: readonly P[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** Distance from a point to an element's drawn line (for freedraw / line / arrow). */
export function distToElementLine(p: P, el: El): number {
  const pts = absPoints(el);
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

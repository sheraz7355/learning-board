// Turns one hand-drawn stroke into the shape it was meant to be.
//
// How it decides (the approach drawing apps use: fit each candidate, keep the best fit):
//  1. Even out the stroke (64 points spaced along its length), so slow and fast parts count the same.
//  2. Open or closed? A stroke whose ends meet is a closed shape; otherwise a line or a free curve.
//  3. Closed: find its corners (Ramer–Douglas–Peucker). 3 corners → triangle, 4 → rectangle or diamond.
//     In parallel, fit an ellipse along the stroke's main axes. The shape with the smaller error wins;
//     an ellipse whose two radii are close becomes a circle.
//  4. Nearly level or upright shapes and lines are snapped straight.
// Runs in well under a millisecond for a stroke, so it can run on every stroke.

import {
  type P, bbox, cornerAngle, dedupe, dist, pathLength, pca, pointSegDist, rdpClosed, resample, rotate, snapAngle,
} from './geometry';

export type Shape =
  | { kind: 'line'; a: P; b: P; score: number }
  | { kind: 'curve'; a: P; b: P; score: number } // an open stroke that is not straight (a candidate connector)
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; angle: number; circle: boolean; score: number }
  | { kind: 'rectangle'; cx: number; cy: number; w: number; h: number; angle: number; square: boolean; score: number }
  | { kind: 'diamond'; cx: number; cy: number; w: number; h: number; score: number }
  | { kind: 'triangle'; pts: [P, P, P]; score: number };

const N = 64;

export function recognize(raw: readonly P[]): Shape | null {
  const clean = dedupe(raw, 0.5);
  if (clean.length < 3) return null;
  const L = pathLength(clean);
  if (L < 10) return null;
  const pts = resample(clean, N);
  const bb = bbox(pts);
  const diag = Math.hypot(bb.w, bb.h);
  if (diag < 8) return null;

  const first = pts[0], last = pts[pts.length - 1];
  const gap = dist(first, last);
  const closed = gap < Math.max(0.25 * diag, 0.1 * L) && L > 1.8 * diag;

  if (!closed) {
    const straightness = gap / L;
    if (straightness > 0.93) {
      // Straight line: snap to level / upright / 45° when close.
      const ang = snapAngle(Math.atan2(last.y - first.y, last.x - first.x), 45, 6);
      const len = gap;
      const mid = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
      const a = { x: mid.x - (Math.cos(ang) * len) / 2, y: mid.y - (Math.sin(ang) * len) / 2 };
      const b = { x: mid.x + (Math.cos(ang) * len) / 2, y: mid.y + (Math.sin(ang) * len) / 2 };
      return { kind: 'line', a, b, score: straightness };
    }
    return { kind: 'curve', a: first, b: last, score: straightness };
  }

  // ── Closed: candidates ──────────────────────────────────────────────────────
  // A hand-drawn loop overlaps where it closes; that overlap would read as an extra sharp corner. Cut the
  // tail where it comes back nearest the start, and the head where it is nearest the new end.
  const loop = resample(trimOverlap(pts), N);
  const ell = fitEllipse(loop);
  const corners = cornersOf(loop, diag);

  let best: Shape | null = null;
  let bestErr = Infinity;

  if (corners.length === 3) {
    const tri = corners as [P, P, P];
    const err = meanDistToPolygon(loop, tri) / (diag / 2);
    if (err < 0.09 && err < ell.err * 0.85) { best = { kind: 'triangle', pts: tri, score: 1 - err }; bestErr = err; }
  }
  if (corners.length === 4 && quadIsRightAngled(corners)) {
    const rect = fitRect(loop, corners);
    const diamond = fitDiamond(loop, bbox(loop));
    if (diamond && diamond.err < rect.err && diamond.err < 0.1) {
      if (diamond.err < bestErr && diamond.err < ell.err * 0.85) {
        best = { kind: 'diamond', cx: diamond.cx, cy: diamond.cy, w: diamond.w, h: diamond.h, score: 1 - diamond.err };
        bestErr = diamond.err;
      }
    } else if (rect.err < 0.15 && rect.err < bestErr && rect.err < ell.err * 1.15) {
      // Four right-angled corners are strong evidence on their own (a circle never has them), so the
      // rectangle wins unless the ellipse fits clearly better.
      const square = Math.abs(rect.w - rect.h) / Math.max(rect.w, rect.h) < 0.12;
      const side = (rect.w + rect.h) / 2;
      best = {
        kind: 'rectangle', cx: rect.cx, cy: rect.cy, w: square ? side : rect.w, h: square ? side : rect.h,
        angle: rect.angle, square, score: 1 - rect.err,
      };
      bestErr = rect.err;
    }
  } else if (corners.length === 4) {
    // Four corners that are not right angles: a diamond drawn as a rhombus.
    const diamond = fitDiamond(loop, bbox(loop));
    if (diamond && diamond.err < 0.1 && diamond.err < ell.err * 0.85) {
      best = { kind: 'diamond', cx: diamond.cx, cy: diamond.cy, w: diamond.w, h: diamond.h, score: 1 - diamond.err };
      bestErr = diamond.err;
    }
  }
  if (!best && ell.err < 0.16) {
    const circle = Math.abs(ell.rx - ell.ry) / Math.max(ell.rx, ell.ry) < 0.2;
    const r = (ell.rx + ell.ry) / 2;
    best = {
      kind: 'ellipse', cx: ell.cx, cy: ell.cy, rx: circle ? r : ell.rx, ry: circle ? r : ell.ry,
      angle: circle ? 0 : ell.angle, circle, score: 1 - ell.err,
    };
  }
  return best;
}

function trimOverlap(pts: readonly P[]): P[] {
  const n = pts.length;
  let end = n - 1, best = Infinity;
  for (let i = Math.floor(n * 0.7); i < n; i++) {
    const d = dist(pts[i], pts[0]);
    if (d < best) { best = d; end = i; }
  }
  let start = 0;
  best = Infinity;
  for (let i = 0; i <= Math.floor(n * 0.3); i++) {
    const d = dist(pts[i], pts[end]);
    if (d < best) { best = d; start = i; }
  }
  const out = pts.slice(start, end + 1);
  return out.length >= 8 ? out : pts.slice();
}

/** Ellipse along the stroke's main axes; radii from the stroke's extent on each axis. Error = mean radial miss. */
function fitEllipse(pts: readonly P[]) {
  const c = pca(pts);
  let angle = c.angle;
  const ca = Math.cos(-angle), sa = Math.sin(-angle);
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  const uv = pts.map((p) => {
    const dx = p.x - c.cx, dy = p.y - c.cy;
    const u = dx * ca - dy * sa, v = dx * sa + dy * ca;
    if (u < minU) minU = u; if (u > maxU) maxU = u; if (v < minV) minV = v; if (v > maxV) maxV = v;
    return { u, v };
  });
  let rx = (maxU - minU) / 2, ry = (maxV - minV) / 2;
  const ou = (maxU + minU) / 2, ov = (maxV + minV) / 2;
  // centre in scene coordinates
  const cx = c.cx + ou * Math.cos(angle) - ov * Math.sin(angle);
  const cy = c.cy + ou * Math.sin(angle) + ov * Math.cos(angle);
  let err = 0;
  for (const { u, v } of uv) {
    const du = (u - ou) / (rx || 1), dv = (v - ov) / (ry || 1);
    err += Math.abs(Math.sqrt(du * du + dv * dv) - 1);
  }
  err /= uv.length;
  // Level or upright when close: an ellipse tilted by 4° looks like a mistake.
  const snapped = snapAngle(angle, 90, 12);
  if (snapped !== angle) {
    angle = snapped;
    if (Math.abs(Math.round(snapped / (Math.PI / 2))) % 2 === 1) [rx, ry] = [ry, rx];
    angle = 0;
  }
  return { cx, cy, rx, ry, angle, err };
}

/** The corners of a closed stroke: RDP, then merge corners that are too close or nearly straight. */
function cornersOf(pts: readonly P[], diag: number): P[] {
  let c = rdpClosed(pts, 0.085 * diag);
  for (let pass = 0; pass < 3; pass++) {
    const out: P[] = [];
    for (let i = 0; i < c.length; i++) {
      const prev = c[(i - 1 + c.length) % c.length], cur = c[i], next = c[(i + 1) % c.length];
      if (cornerAngle(prev, cur, next) > 155) continue; // nearly straight: not a corner
      if (out.length && dist(out[out.length - 1], cur) < 0.12 * diag) continue; // a double corner
      out.push(cur);
    }
    if (out.length >= 2 && dist(out[0], out[out.length - 1]) < 0.12 * diag) out.pop();
    const merged = mergeCutCorners(out, diag);
    if (merged.length === c.length) { c = merged; break; }
    c = merged;
  }
  return c;
}

/** A corner where the stroke started or ended often comes out cut off: two blunt corners close together.
 *  Put them back as one sharp corner where the two neighbouring sides meet. */
function mergeCutCorners(c: P[], diag: number): P[] {
  if (c.length < 4) return c;
  const n = c.length;
  const ang = c.map((p, i) => cornerAngle(c[(i - 1 + n) % n], p, c[(i + 1) % n]));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (ang[i] > 105 && ang[i] < 165 && ang[j] > 105 && ang[j] < 165 && dist(c[i], c[j]) < 0.3 * diag) {
      const prev = c[(i - 1 + n) % n], next = c[(j + 1) % n];
      const x = intersect(prev, c[i], c[j], next) ?? { x: (c[i].x + c[j].x) / 2, y: (c[i].y + c[j].y) / 2 };
      const out: P[] = [];
      for (let k = 0; k < n; k++) {
        if (k === i) out.push(x);
        else if (k !== j) out.push(c[k]);
      }
      return out;
    }
  }
  return c;
}

/** Where the line a→b meets the line c→d (null when they are parallel). */
function intersect(a: P, b: P, c: P, d: P): P | null {
  const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  return { x: a.x + t * r.x, y: a.y + t * r.y };
}

function quadIsRightAngled(q: readonly P[]): boolean {
  for (let i = 0; i < 4; i++) {
    const ang = cornerAngle(q[(i + 3) % 4], q[i], q[(i + 1) % 4]);
    if (Math.abs(ang - 90) > 28) return false;
  }
  return true;
}

function meanDistToPolygon(pts: readonly P[], poly: readonly P[]): number {
  let s = 0;
  for (const p of pts) {
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) best = Math.min(best, pointSegDist(p, poly[i], poly[(i + 1) % poly.length]));
    s += best;
  }
  return s / pts.length;
}

/** Rectangle along the quad's edge direction; error = mean distance to its outline / half its size. */
function fitRect(pts: readonly P[], q: readonly P[]) {
  // Direction: average of the 4 edge angles folded into [0, 90°).
  let sx = 0, sy = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const ang = Math.atan2(b.y - a.y, b.x - a.x) * 4; // ×4 folds 90° turns onto one direction
    sx += Math.cos(ang); sy += Math.sin(ang);
  }
  // Scored at the angle it was really drawn at; levelled afterwards (levelling first would count a
  // 3° tilt over a long side as a bad fit).
  const fitted = Math.atan2(sy, sx) / 4;
  const c = { x: 0, y: 0 };
  for (const p of pts) { c.x += p.x; c.y += p.y; }
  c.x /= pts.length; c.y /= pts.length;
  const local = pts.map((p) => rotate(p, c, -fitted));
  const box = bbox(local);
  // Each side sits at the median of the points nearest to it (the extremes would let one wobble push a
  // whole side outwards).
  const sides: number[][] = [[], [], [], []]; // left, right, top, bottom
  for (const p of local) {
    const d = [p.x - box.minX, box.maxX - p.x, p.y - box.minY, box.maxY - p.y];
    let k = 0;
    for (let i = 1; i < 4; i++) if (d[i] < d[k]) k = i;
    sides[k].push(k < 2 ? p.x : p.y);
  }
  const med = (a: number[], fallback: number) => {
    if (!a.length) return fallback;
    const s = a.slice().sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  };
  const b = {
    minX: med(sides[0], box.minX), maxX: med(sides[1], box.maxX), minY: med(sides[2], box.minY), maxY: med(sides[3], box.maxY),
    w: 0, h: 0,
  };
  b.w = b.maxX - b.minX; b.h = b.maxY - b.minY;
  const cxL = (b.minX + b.maxX) / 2, cyL = (b.minY + b.maxY) / 2;
  const centre = rotate({ x: cxL, y: cyL }, c, fitted);
  const outline: P[] = [
    { x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY },
  ];
  const err = meanDistToPolygon(local, outline) / (Math.min(b.w, b.h) / 2 || 1);
  // Level (or upright) when within 10°; a quarter turn swaps width and height.
  let angle = snapAngle(fitted, 90, 10);
  let w = b.w, h = b.h;
  if (angle !== fitted) {
    const quarter = Math.round(angle / (Math.PI / 2));
    if (Math.abs(quarter) % 2 === 1) [w, h] = [h, w];
    angle = 0;
  }
  return { cx: centre.x, cy: centre.y, w, h, angle, err };
}

/** A level diamond (corners at top, right, bottom, left of its box). Null when the corners are elsewhere. */
function fitDiamond(pts: readonly P[], bb: ReturnType<typeof bbox>) {
  const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
  const poly: P[] = [{ x: cx, y: bb.minY }, { x: bb.maxX, y: cy }, { x: cx, y: bb.maxY }, { x: bb.minX, y: cy }];
  const err = meanDistToPolygon(pts, poly) / (Math.min(bb.w, bb.h) / 2 || 1);
  return { cx, cy, w: bb.w, h: bb.h, err };
}

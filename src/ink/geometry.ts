// Small, fast geometry helpers for ink. Plain arrays of {x, y}; no allocations in hot loops beyond the output.

export type P = { x: number; y: number };

export const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);

export function pathLength(pts: readonly P[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  return L;
}

/** Drop consecutive duplicates (a held mouse adds the same point again and again). */
export function dedupe(pts: readonly P[], minGap = 0.01): P[] {
  const out: P[] = [];
  for (const p of pts) if (!out.length || dist(out[out.length - 1], p) > minGap) out.push({ x: p.x, y: p.y });
  return out;
}

/** n points spaced evenly along the path (so a slow and a fast part of a stroke weigh the same). */
export function resample(pts: readonly P[], n: number): P[] {
  const L = pathLength(pts);
  if (pts.length < 2 || L === 0) return pts.map((p) => ({ ...p }));
  const step = L / (n - 1);
  const out: P[] = [{ ...pts[0] }];
  let acc = 0;
  let prev = pts[0];
  for (let i = 1; i < pts.length && out.length < n; i++) {
    let cur = pts[i];
    let d = dist(prev, cur);
    while (acc + d >= step && out.length < n) {
      const t = (step - acc) / d;
      const q = { x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) };
      out.push(q);
      prev = q;
      d = dist(prev, cur);
      acc = 0;
    }
    acc += d;
    prev = cur;
  }
  while (out.length < n) out.push({ ...pts[pts.length - 1] });
  return out;
}

export function bbox(pts: readonly P[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function pointSegDist(p: P, a: P, b: P): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distToPolyline(p: P, pts: readonly P[], closed = false): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, pointSegDist(p, pts[i - 1], pts[i]));
  if (closed && pts.length > 2) best = Math.min(best, pointSegDist(p, pts[pts.length - 1], pts[0]));
  return best;
}

/** Ramer–Douglas–Peucker: keep only the points that matter (the corners). */
export function rdp(pts: readonly P[], eps: number): P[] {
  if (pts.length < 3) return pts.slice();
  let idx = -1, maxD = -1;
  const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = pointSegDist(pts[i], a, b);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [a, b];
  const left = rdp(pts.slice(0, idx + 1), eps);
  const right = rdp(pts.slice(idx), eps);
  return left.slice(0, -1).concat(right);
}

/** RDP for a closed loop: split at the point farthest from the start, simplify both halves. */
export function rdpClosed(pts: readonly P[], eps: number): P[] {
  if (pts.length < 4) return pts.slice();
  let far = 0, maxD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[0], pts[i]);
    if (d > maxD) { maxD = d; far = i; }
  }
  const a = rdp(pts.slice(0, far + 1), eps);
  const b = rdp(pts.slice(far).concat([pts[0]]), eps);
  const loop = a.slice(0, -1).concat(b.slice(0, -1));
  return loop;
}

/** Centre, main direction and spread of a point cloud. */
export function pca(pts: readonly P[]) {
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= pts.length; cy /= pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) {
    const dx = p.x - cx, dy = p.y - cy;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  sxx /= pts.length; syy /= pts.length; sxy /= pts.length;
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  return { cx, cy, angle, l1: tr / 2 + disc, l2: tr / 2 - disc };
}

export function rotate(p: P, c: P, a: number): P {
  const s = Math.sin(a), co = Math.cos(a);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * co - dy * s, y: c.y + dx * s + dy * co };
}

/** Interior angle at b (degrees) of the path a-b-c. */
export function cornerAngle(a: P, b: P, c: P): number {
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const l = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (l === 0) return 180;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / l));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Chaikin corner cutting: a smoother line with the same overall shape. */
export function chaikin(pts: readonly P[], iterations = 1): P[] {
  let cur = pts.slice();
  for (let k = 0; k < iterations; k++) {
    if (cur.length < 3) return cur;
    const out: P[] = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i], b = cur[i + 1];
      out.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y });
      out.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
    }
    out.push(cur[cur.length - 1]);
    cur = out;
  }
  return cur;
}

/** Nearest "nice" angle (0, 45, 90 …) when within tolerance, else the angle itself. Radians. */
export function snapAngle(a: number, stepDeg = 45, tolDeg = 7): number {
  const step = (stepDeg * Math.PI) / 180;
  const snapped = Math.round(a / step) * step;
  return Math.abs(a - snapped) <= (tolDeg * Math.PI) / 180 ? snapped : a;
}

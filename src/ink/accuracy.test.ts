import { expect, it } from 'vitest';
// Accuracy on 200 random hand-drawn-like strokes per shape (wobble, random start, gap or overshoot).
// Measured 2026-10-28: circles, ellipses, rectangles, squares 200/200; triangles 192; diamonds 199.
import { recognize } from './recognize';
function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }
type P = { x: number; y: number };
function loop(f: (t: number) => P, n: number, wob: number, seed: number) { const r = rng(seed); const s = r(); const extra = 0.08 * r() - 0.03; const o: P[] = []; for (let i = 0; i <= n; i++) { const p = f((s + (i / n) * (1 + extra)) % 1); o.push({ x: p.x + (r() - .5) * wob, y: p.y + (r() - .5) * wob }); } return o; }
const ell = (rx: number, ry: number) => (t: number) => ({ x: Math.cos(t * 6.283) * rx, y: Math.sin(t * 6.283) * ry });
const poly = (c: P[]) => (t: number) => { const n = c.length, s = t * n, i = Math.floor(s) % n, f = s - Math.floor(s), a = c[i], b = c[(i + 1) % n]; return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }; };
it('recognises at least 95% of each shape (200 wobbly strokes each)', () => {
  const cases: [string, (s: number) => P[]][] = [
    ['circle', (s) => loop(ell(70, 66), 100, 12, s)],
    ['ellipse', (s) => loop(ell(140, 60), 120, 10, s)],
    ['rectangle', (s) => loop(poly([{x:0,y:0},{x:220,y:4},{x:218,y:130},{x:-3,y:126}]), 160, 12, s)],
    ['square', (s) => loop(poly([{x:0,y:0},{x:120,y:0},{x:120,y:120},{x:0,y:120}]), 150, 12, s)],
    ['triangle', (s) => loop(poly([{x:100,y:0},{x:200,y:170},{x:0,y:170}]), 150, 10, s)],
    ['diamond', (s) => loop(poly([{x:100,y:0},{x:200,y:80},{x:100,y:160},{x:0,y:80}]), 150, 10, s)],
  ];
  for (const [name, gen] of cases) {
    const tally: Record<string, number> = {};
    for (let s = 1; s <= 200; s++) { const k = recognize(gen(s))?.kind ?? 'none'; tally[k] = (tally[k] || 0) + 1; }
    const want = name === 'circle' || name === 'ellipse' ? 'ellipse' : name === 'square' ? 'rectangle' : name;
    expect((tally[want] ?? 0) / 200, `${name}: ${JSON.stringify(tally)}`).toBeGreaterThanOrEqual(0.95);
  }
});

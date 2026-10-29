import { describe, expect, it } from 'vitest';
import { recognize } from './recognize';
import type { P } from './geometry';

// A seeded random so a failing case can be replayed.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/** A hand-drawn closed path: wobble on every point, a random start, and a small gap or overshoot at the end. */
function wobblyLoop(f: (t: number) => P, n: number, wobble: number, seed: number, endExtra = 0.04): P[] {
  const r = rng(seed);
  const start = r();
  const out: P[] = [];
  for (let i = 0; i <= n; i++) {
    const t = start + (i / n) * (1 + endExtra);
    const p = f(t % 1);
    out.push({ x: p.x + (r() - 0.5) * wobble, y: p.y + (r() - 0.5) * wobble });
  }
  return out;
}

const ellipse = (cx: number, cy: number, rx: number, ry: number, tilt = 0) => (t: number): P => {
  const a = t * Math.PI * 2;
  const x = Math.cos(a) * rx, y = Math.sin(a) * ry;
  return { x: cx + x * Math.cos(tilt) - y * Math.sin(tilt), y: cy + x * Math.sin(tilt) + y * Math.cos(tilt) };
};

const polygon = (pts: P[]) => (t: number): P => {
  const n = pts.length;
  const s = t * n;
  const i = Math.floor(s) % n;
  const f = s - Math.floor(s);
  const a = pts[i], b = pts[(i + 1) % n];
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
};

const rect = (cx: number, cy: number, w: number, h: number, tilt = 0) => {
  const c = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  return polygon(c.map(([x, y]) => ({ x: cx + x * Math.cos(tilt) - y * Math.sin(tilt), y: cy + x * Math.sin(tilt) + y * Math.cos(tilt) })));
};

describe('recognize: what a messy stroke was meant to be', () => {
  it('a wobbly circle becomes a perfect circle, centred where it was drawn', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = recognize(wobblyLoop(ellipse(200, 150, 80, 76), 90, 10, seed));
      expect(s?.kind, `seed ${seed}`).toBe('ellipse');
      if (s?.kind !== 'ellipse') continue;
      expect(s.circle).toBe(true);
      expect(Math.abs(s.cx - 200)).toBeLessThan(8);
      expect(Math.abs(s.rx - 78)).toBeLessThan(10);
    }
  });

  it('a long oval stays an ellipse (not a circle); a tilted one keeps its tilt', () => {
    const s = recognize(wobblyLoop(ellipse(0, 0, 150, 60), 120, 8, 3));
    expect(s?.kind).toBe('ellipse');
    if (s?.kind === 'ellipse') { expect(s.circle).toBe(false); expect(s.angle).toBe(0); expect(s.rx).toBeGreaterThan(s.ry * 2); }
    const t = recognize(wobblyLoop(ellipse(0, 0, 150, 60, 0.6), 120, 6, 4));
    expect(t?.kind).toBe('ellipse');
    if (t?.kind === 'ellipse') expect(Math.abs(Math.abs(t.angle) - 0.6)).toBeLessThan(0.12);
  });

  it('a shaky rectangle becomes a level rectangle; a near-square becomes a square', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = recognize(wobblyLoop(rect(300, 200, 220, 120, 0.05), 160, 9, seed));
      expect(s?.kind, `seed ${seed}`).toBe('rectangle');
      if (s?.kind === 'rectangle') { expect(s.angle).toBe(0); expect(Math.abs(s.w - 220)).toBeLessThan(16); }
    }
    const sq = recognize(wobblyLoop(rect(0, 0, 120, 112), 140, 6, 9));
    expect(sq?.kind).toBe('rectangle');
    if (sq?.kind === 'rectangle') { expect(sq.square).toBe(true); expect(sq.w).toBe(sq.h); }
  });

  it('a clearly tilted rectangle keeps its tilt', () => {
    const s = recognize(wobblyLoop(rect(0, 0, 200, 110, 0.45), 160, 6, 11));
    expect(s?.kind).toBe('rectangle');
    if (s?.kind === 'rectangle') expect(Math.abs(Math.abs(s.angle) - 0.45)).toBeLessThan(0.1);
  });

  it('a triangle becomes a triangle', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const s = recognize(wobblyLoop(polygon([{ x: 100, y: 0 }, { x: 200, y: 170 }, { x: 0, y: 170 }]), 150, 7, seed));
      expect(s?.kind, `seed ${seed}`).toBe('triangle');
    }
  });

  it('a diamond becomes a diamond', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const s = recognize(wobblyLoop(polygon([{ x: 100, y: 0 }, { x: 200, y: 80 }, { x: 100, y: 160 }, { x: 0, y: 80 }]), 150, 6, seed));
      expect(s?.kind, `seed ${seed}`).toBe('diamond');
    }
  });

  it('a shaky straight stroke becomes a line, snapped level when nearly level', () => {
    const r = rng(5);
    const pts: P[] = Array.from({ length: 50 }, (_, i) => ({ x: i * 6, y: 100 + i * 0.2 + (r() - 0.5) * 3 }));
    const s = recognize(pts);
    expect(s?.kind).toBe('line');
    if (s?.kind === 'line') expect(Math.abs(s.a.y - s.b.y)).toBeLessThan(0.001);
  });

  it('handwriting-like strokes are left alone (open curves are not shapes)', () => {
    // an "S"
    const s: P[] = Array.from({ length: 60 }, (_, i) => {
      const t = i / 59;
      return { x: 40 * Math.sin(t * Math.PI * 2), y: t * 100 };
    });
    expect(recognize(s)?.kind).toBe('curve');
    // an "L"
    const l: P[] = [...Array.from({ length: 20 }, (_, i) => ({ x: 0, y: i * 5 })), ...Array.from({ length: 20 }, (_, i) => ({ x: i * 4, y: 100 }))];
    expect(recognize(l)?.kind).toBe('curve');
    // a dot
    expect(recognize([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }])).toBeNull();
  });

  it('is fast: 1,000 strokes in well under a second', () => {
    const strokes = Array.from({ length: 1000 }, (_, i) => wobblyLoop(ellipse(0, 0, 80, 70), 120, 8, i + 1));
    const t0 = performance.now();
    for (const st of strokes) recognize(st);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

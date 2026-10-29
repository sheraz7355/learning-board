// A see-through layer over the board that draws what moves: dots flowing along arrows, the pulse around
// what a step just revealed, ticks and crosses, and step numbers while editing. It draws only while
// something moves (otherwise once per scroll or change), and pauses when the window is hidden.

import { useEffect, useRef } from 'react';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { type El, absPoints, boundsOf, hasPoints } from '../board/elements';
import type { P } from '../ink/geometry';
import { flowsAlways, flowsAt, markAt, stepOf } from './steps';

type Props = {
  api: ExcalidrawImperativeAPI | null;
  mode: 'edit' | 'play';
  step?: number;
  pulseIds?: ReadonlySet<string>;
  showBadges?: boolean;
  dark: boolean;
};

const SPACING = 70; // board units between dots
const SPEED = 90; // board units per second

/** Points along a smooth curve through the given points (how Excalidraw draws a rounded arrow). */
function catmull(pts: readonly P[], perSeg = 12): P[] {
  const out: P[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < perSeg; k++) {
      const t = k / perSeg, t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function pathOf(el: El): P[] {
  let pts = absPoints(el);
  if (el.roundness && pts.length >= 3) pts = catmull(pts);
  // Dots travel towards the arrow head (or backwards when the only head is at the start).
  if (el.type === 'arrow' && !el.endArrowhead && el.startArrowhead) pts = pts.slice().reverse();
  return pts;
}

function boxOf(el: El) {
  if (hasPoints(el)) return boundsOf(absPoints(el));
  return { minX: el.x, minY: el.y, maxX: el.x + el.width, maxY: el.y + el.height, w: el.width, h: el.height };
}

export function FlowLayer({ api, mode, step = 0, pulseIds, showBadges, dark }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef({ mode, step, pulseIds, showBadges });
  live.current = { mode, step, pulseIds, showBadges };

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !api) return;
    const ctx = canvas.getContext('2d')!;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let w = 0, h = 0, dpr = 1;

    const resize = () => {
      const r = canvas.parentElement!.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      schedule();
    };

    const draw = (now: number): boolean => {
      const { mode: m, step: s, pulseIds: pulse, showBadges: badges } = live.current;
      const st = api.getAppState();
      const z = st.zoom.value;
      const toV = (p: P) => ({ x: (p.x + st.scrollX) * z, y: (p.y + st.scrollY) * z });
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const els = api.getSceneElements() as readonly El[];
      let moving = false;

      // Flowing dots.
      for (const el of els) {
        if (el.type !== 'arrow' && el.type !== 'line') continue;
        const flows = m === 'play' ? flowsAt(el, s) : flowsAlways(el) || Array.isArray(el.customData?.flowAt);
        if (!flows) continue;
        const pts = pathOf(el).map(toV);
        const seg: number[] = [0];
        for (let i = 1; i < pts.length; i++) seg.push(seg[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
        const len = seg[seg.length - 1];
        if (len < 8) continue;
        const spacing = SPACING * z;
        const offset = reduceMotion ? spacing / 2 : ((now / 1000) * SPEED * z) % spacing;
        const r = Math.max(3, Math.min(9, el.strokeWidth * 1.8 * z));
        ctx.fillStyle = el.strokeColor === 'transparent' ? '#1e1e1e' : el.strokeColor;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1, r / 3);
        let i = 1;
        for (let d = offset; d < len; d += spacing) {
          while (i < seg.length - 1 && seg[i] < d) i++;
          const t = (d - seg[i - 1]) / (seg[i] - seg[i - 1] || 1);
          const x = pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y = pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        moving = moving || !reduceMotion;
      }

      if (m === 'play') {
        // Pulse around what this step revealed.
        if (pulse?.size) {
          const a = reduceMotion ? 0.6 : 0.35 + 0.35 * Math.sin(now / 260);
          ctx.strokeStyle = `rgba(14, 165, 233, ${a})`;
          ctx.lineWidth = 4;
          for (const el of els) {
            if (!pulse.has(el.id) || (el.type === 'text' && el.containerId)) continue;
            const b = boxOf(el);
            const p = toV({ x: b.minX, y: b.minY });
            const pad = 8;
            ctx.beginPath();
            ctx.roundRect(p.x - pad, p.y - pad, b.w * z + pad * 2, b.h * z + pad * 2, 12);
            ctx.stroke();
          }
          moving = moving || !reduceMotion;
        }
        // Ticks and crosses for this step.
        for (const el of els) {
          const mk = markAt(el, s);
          if (!mk) continue;
          const b = boxOf(el);
          const p = toV({ x: b.minX, y: b.minY });
          const bw = b.w * z, bh = b.h * z;
          ctx.lineCap = 'round';
          if (mk === 'cross') {
            ctx.strokeStyle = 'rgba(220, 38, 38, 0.9)';
            ctx.lineWidth = Math.max(4, Math.min(bw, bh) * 0.08);
            ctx.beginPath();
            ctx.moveTo(p.x + bw * 0.1, p.y + bh * 0.1); ctx.lineTo(p.x + bw * 0.9, p.y + bh * 0.9);
            ctx.moveTo(p.x + bw * 0.9, p.y + bh * 0.1); ctx.lineTo(p.x + bw * 0.1, p.y + bh * 0.9);
            ctx.stroke();
          } else {
            const r = Math.max(14, Math.min(28, Math.min(bw, bh) * 0.25));
            const cx = p.x + bw, cy = p.y;
            ctx.fillStyle = '#16a34a';
            ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = r * 0.22;
            ctx.beginPath();
            ctx.moveTo(cx - r * 0.45, cy); ctx.lineTo(cx - r * 0.1, cy + r * 0.38); ctx.lineTo(cx + r * 0.5, cy - r * 0.38);
            ctx.stroke();
          }
        }
      } else if (badges) {
        // Step numbers while editing.
        ctx.font = '600 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const el of els) {
          const s2 = stepOf(el);
          if (!s2 || (el.type === 'text' && el.containerId)) continue;
          const b = boxOf(el);
          const p = toV({ x: b.minX, y: b.minY });
          ctx.fillStyle = '#7c3aed';
          ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.fillText(String(s2), p.x, p.y + 0.5);
        }
      }
      return moving;
    };

    const loop = (now: number) => {
      raf = 0;
      if (document.hidden) return;
      const moving = draw(now);
      if (moving) raf = requestAnimationFrame(loop);
    };
    function schedule() {
      if (!raf) raf = requestAnimationFrame(loop);
    }

    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);
    resize();
    const offChange = api.onChange(() => schedule());
    const offScroll = api.onScrollChange(() => schedule());
    const onVis = () => { if (!document.hidden) schedule(); };
    document.addEventListener('visibilitychange', onVis);
    canvas.addEventListener('lb-redraw', schedule);
    schedule();
    return () => {
      canvas.removeEventListener('lb-redraw', schedule);
      cancelAnimationFrame(raf);
      ro.disconnect();
      offChange();
      offScroll();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [api]);

  // Redraw when the step, the pulse or the badges change.
  useEffect(() => {
    const c = ref.current;
    if (c) c.dispatchEvent(new Event('lb-redraw'));
  }, [mode, step, pulseIds, showBadges]);

  return (
    <canvas
      ref={ref}
      className="lb-flow-layer"
      style={{ filter: dark ? 'invert(93%) hue-rotate(180deg)' : undefined }}
      aria-hidden="true"
    />
  );
}

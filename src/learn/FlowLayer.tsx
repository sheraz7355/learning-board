// A see-through layer over the board that draws what moves:
//  • flows along arrows, in five kinds — Dot (one bright glowing dot that eases along the arrow and travels on
//    through arrows that continue one another, as one journey: the lessons' look), Stream (a steady line of
//    dots), Comet (a dot with a fading tail), Ants (marching dashes) and Wave (a glowing band);
//  • in Play: the pulse around what a step just revealed, and ticks and crosses;
//  • while editing: step numbers.
// It draws only while something moves (otherwise once per scroll or change) and pauses in a hidden window.

import { useEffect, useRef } from 'react';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { type El, absPoints, boundsOf, hasPoints } from '../board/elements';
import type { P } from '../ink/geometry';
import { flowsAlways, flowsAt, markAt, stepOf } from './steps';

export type FlowKind = 'dot' | 'stream' | 'comet' | 'ants' | 'wave';
export const FLOW_KINDS: { id: FlowKind; name: string }[] = [
  { id: 'dot', name: 'Dot' }, { id: 'stream', name: 'Stream' }, { id: 'comet', name: 'Comet' }, { id: 'ants', name: 'Ants' }, { id: 'wave', name: 'Wave' },
];
export const FLOW_COLOURS = ['#22c55e', '#3b82f6', '#f97316', '#ec4899', '#facc15', '#a855f7'];
export const flowKindOf = (el: El): FlowKind => {
  const k = el.customData?.flowStyle;
  return FLOW_KINDS.some((f) => f.id === k) ? (k as FlowKind) : 'dot';
};

type Props = {
  api: ExcalidrawImperativeAPI | null;
  mode: 'edit' | 'play';
  step?: number;
  pulseIds?: ReadonlySet<string>;
  showBadges?: boolean;
  flowColour: string;
};

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
  // Flows go towards the arrow head (backwards when the only head is at the start).
  if (el.type === 'arrow' && !el.endArrowhead && el.startArrowhead) pts = pts.slice().reverse();
  return pts;
}

function boxOf(el: El) {
  if (hasPoints(el)) return boundsOf(absPoints(el));
  return { minX: el.x, minY: el.y, maxX: el.x + el.width, maxY: el.y + el.height, w: el.width, h: el.height };
}

/** A path on screen with its running length, and a point at any distance along it. */
type Track = { pts: P[]; cum: number[]; len: number; sceneLen: number };
function track(pts: P[], z: number): Track {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const len = cum[cum.length - 1];
  return { pts, cum, len, sceneLen: len / z };
}
function at(t: Track, d: number): P {
  if (d <= 0) return t.pts[0];
  if (d >= t.len) return t.pts[t.pts.length - 1];
  let i = 1;
  while (i < t.cum.length - 1 && t.cum[i] < d) i++;
  const f = (d - t.cum[i - 1]) / (t.cum[i] - t.cum[i - 1] || 1);
  return { x: t.pts[i - 1].x + (t.pts[i].x - t.pts[i - 1].x) * f, y: t.pts[i - 1].y + (t.pts[i].y - t.pts[i - 1].y) * f };
}
const ease = (f: number) => (f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2);

export function FlowLayer({ api, mode, step = 0, pulseIds, showBadges, flowColour }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef({ mode, step, pulseIds, showBadges, flowColour });
  live.current = { mode, step, pulseIds, showBadges, flowColour };

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

    const glowDot = (p: P, r: number, colour: string, alpha = 1) => {
      ctx.globalAlpha = 0.28 * alpha;
      ctx.fillStyle = colour;
      ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.9, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = colour; ctx.shadowBlur = r * 2.2;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.85 * alpha;
      ctx.beginPath(); ctx.arc(p.x - r * 0.3, p.y - r * 0.3, r * 0.32, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    };

    const draw = (now: number): boolean => {
      const { mode: m, step: s, pulseIds: pulse, showBadges: badges, flowColour: defColour } = live.current;
      const st = api.getAppState();
      const z = st.zoom.value;
      const sz = Math.max(0.6, Math.min(1.6, z));
      const toV = (p: P) => ({ x: (p.x + st.scrollX) * z, y: (p.y + st.scrollY) * z });
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const els = api.getSceneElements() as readonly El[];
      const t = now / 1000;
      let moving = false;

      // ── Flows ──────────────────────────────────────────────────────────────
      const flowing = els.filter((el) => (el.type === 'arrow' || el.type === 'line') &&
        (m === 'play' ? flowsAt(el, s) : flowsAlways(el) || Array.isArray(el.customData?.flowAt)));
      // Dots and comets travel on through arrows that continue one another (a→b, then b→c): one journey.
      const chains: El[][] = [];
      for (const el of flowing) {
        const k = flowKindOf(el);
        if (k !== 'dot' && k !== 'comet') { chains.push([el]); continue; }
        const from = el.type === 'arrow' ? el.startBinding?.elementId : undefined;
        const chain = from && chains.find((c) => {
          const last = c[c.length - 1];
          return flowKindOf(last) === k && last.type === 'arrow' && last.endBinding?.elementId === from;
        });
        if (chain) chain.push(el); else chains.push([el]);
      }
      for (const chain of chains) {
        const kind = flowKindOf(chain[0]);
        const colour = (chain[0].customData?.flowColor as string) || defColour;
        const tracks = chain.map((el) => track(pathOf(el).map(toV), z)).filter((tr) => tr.len > 6);
        if (!tracks.length) continue;
        if (reduceMotion) { glowDot(at(tracks[0], tracks[0].len / 2), 6.5 * sz, colour); continue; }
        moving = true;

        if (kind === 'dot' || kind === 'comet') {
          const durs = tracks.map((tr) => Math.max(0.8, Math.min(1.8, tr.sceneLen / 230)));
          const period = durs.reduce((a, b) => a + b, 0) + 0.7;
          let u = t % period;
          for (let i = 0; i < tracks.length; i++) {
            if (u > durs[i]) { u -= durs[i]; continue; }
            const f = u / durs[i];
            const tr = tracks[i];
            if (kind === 'comet') {
              // the tail: 16 fading beads behind the head, about a third of the arrow long
              for (let k = 16; k >= 1; k--) {
                const back = ease(Math.max(0, f - k * 0.022));
                const p = at(tr, back * tr.len);
                ctx.globalAlpha = Math.pow(1 - k / 17, 1.3) * 0.85;
                ctx.fillStyle = colour;
                ctx.beginPath(); ctx.arc(p.x, p.y, 6.5 * sz * (1 - k / 22), 0, Math.PI * 2); ctx.fill();
              }
              ctx.globalAlpha = 1;
            }
            glowDot(at(tr, ease(f) * tr.len), 6.5 * sz, colour);
            break;
          }
          continue;
        }

        for (const tr of tracks) {
          if (kind === 'stream') {
            const spacing = 64 * z;
            const off = (t * 90 * z) % spacing;
            for (let d = off; d < tr.len; d += spacing) glowDot(at(tr, d), 4.2 * sz, colour);
          } else if (kind === 'ants') {
            ctx.save();
            ctx.strokeStyle = colour;
            ctx.lineWidth = 4 * sz;
            ctx.lineCap = 'round';
            ctx.setLineDash([11 * sz, 10 * sz]);
            ctx.lineDashOffset = -t * 48 * sz;
            ctx.shadowColor = colour; ctx.shadowBlur = 6 * sz;
            ctx.beginPath();
            tr.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
            ctx.stroke();
            ctx.restore();
          } else if (kind === 'wave') {
            const band = Math.min(tr.len * 0.45, 140 * z);
            const head = ((t * 160 * z) % (tr.len + band));
            for (let d = Math.max(0, head - band); d <= Math.min(tr.len, head); d += 3) {
              const a = 1 - (head - d) / band;
              ctx.globalAlpha = a * a * 0.8;
              ctx.fillStyle = colour;
              ctx.beginPath(); ctx.arc(at(tr, d).x, at(tr, d).y, 5 * sz * (0.5 + a * 0.6), 0, Math.PI * 2); ctx.fill();
            }
            ctx.globalAlpha = 1;
          }
        }
      }

      if (m === 'play') {
        // Pulse around what this step revealed.
        if (pulse?.size) {
          const a = reduceMotion ? 0.6 : 0.35 + 0.35 * Math.sin(now / 260);
          ctx.strokeStyle = `rgba(14, 165, 233, ${a})`;
          ctx.lineWidth = 4;
          for (const el of els) {
            if (!pulse.has(el.id) || (el.type === 'text' && el.containerId)) continue;
            if (el.type === 'arrow' || el.type === 'line') {
              // an arrow glows along its own line (its box can be half the board)
              const pts = pathOf(el).map(toV);
              ctx.save();
              ctx.lineWidth = 11; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
              ctx.beginPath();
              pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
              ctx.stroke();
              ctx.restore();
              continue;
            }
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
          let p: P;
          if (el.type === 'arrow' || el.type === 'line') {
            // on the line itself, a third of the way along (the middle is where its label sits)
            const tr = track(pathOf(el).map(toV), z);
            p = at(tr, tr.len / 3);
          } else {
            const b = boxOf(el);
            p = toV({ x: b.minX, y: b.minY });
          }
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
      if (draw(now)) raf = requestAnimationFrame(loop);
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

  // Redraw when the step, the pulse, the badges or the colour change.
  useEffect(() => {
    ref.current?.dispatchEvent(new Event('lb-redraw'));
  }, [mode, step, pulseIds, showBadges, flowColour]);

  return <canvas ref={ref} className="lb-flow-layer" aria-hidden="true" />;
}

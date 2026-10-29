// The gestures that perfect ink:
//  • Hold: finish a pen stroke and keep the mouse still for a moment before letting go → a ring shows,
//    and on release the stroke becomes the shape (how GoodNotes and iPad apps do it).
//  • Double-click a stroke (with any tool) → perfected.
//  • Auto (optional, off by default so writing is not turned into shapes): every stroke that is clearly a
//    shape is perfected on release.

import { useCallback, useEffect, useRef, useState } from 'react';
import { viewportCoordsToSceneCoords } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { perfectStrokes, type PerfectResult } from './inkActions';
import { distToElementLine } from './elements';

const HOLD_MS = 250; // short: a brief pause at the end of a stroke is enough

type Opts = {
  hold: boolean;
  auto: boolean;
  onPerfected: (r: PerfectResult) => void;
};

export function useSmartInk(api: ExcalidrawImperativeAPI | null, opts: Opts) {
  const o = useRef(opts);
  o.current = opts;
  const s = useRef({ down: false, startedAt: 0, last: { x: 0, y: 0 }, armed: false, timer: 0 as ReturnType<typeof setTimeout> | 0 });
  const [ring, setRing] = useState<{ x: number; y: number } | null>(null);
  // Where the mouse is on the board (for "hold C": the writing under or nearest the mouse).
  const pointer = useRef<{ x: number; y: number; at: number } | null>(null);

  const showRing = useCallback((sceneX: number, sceneY: number) => {
    if (!api) return;
    const st = api.getAppState();
    setRing({ x: (sceneX + st.scrollX) * st.zoom.value + st.offsetLeft, y: (sceneY + st.scrollY) * st.zoom.value + st.offsetTop });
  }, [api]);

  // Movement while the pen is down (Excalidraw reports pointer moves in board coordinates).
  const onPointerUpdate = useCallback((p: { pointer: { x: number; y: number }; button: 'down' | 'up' }) => {
    pointer.current = { x: p.pointer.x, y: p.pointer.y, at: Date.now() };
    const st = s.current;
    if (!api || !st.down || p.button !== 'down') return;
    if (api.getAppState().activeTool.type !== 'freedraw') return;
    const z = api.getAppState().zoom.value;
    if (Math.hypot(p.pointer.x - st.last.x, p.pointer.y - st.last.y) * z > 3) {
      st.last = { x: p.pointer.x, y: p.pointer.y };
      if (st.armed) { st.armed = false; setRing(null); }
      if (st.timer) clearTimeout(st.timer);
      if (o.current.hold) {
        st.timer = setTimeout(() => {
          if (st.down) {
            st.armed = true;
            showRing(st.last.x, st.last.y);
            try { navigator.vibrate?.(10); } catch { /* no vibration on this device */ }
          }
        }, HOLD_MS);
      }
    }
  }, [api, showRing]);

  useEffect(() => {
    if (!api) return;
    const offDown = api.onPointerDown((tool, state) => {
      const st = s.current;
      st.down = true;
      st.armed = false;
      st.startedAt = Date.now();
      st.last = { x: state.origin.x, y: state.origin.y };
      if (st.timer) clearTimeout(st.timer);
      void tool;
    });
    const offUp = api.onPointerUp((tool) => {
      const st = s.current;
      st.down = false;
      if (st.timer) { clearTimeout(st.timer); st.timer = 0; }
      const armed = st.armed;
      st.armed = false;
      setRing(null);
      if (tool.type !== 'freedraw' || !(armed || o.current.auto)) return;
      const startedAt = st.startedAt;
      // Excalidraw finishes the stroke right after this event.
      setTimeout(() => {
        const els = api.getSceneElements();
        for (let i = els.length - 1; i >= 0; i--) {
          const e = els[i];
          if (e.type !== 'freedraw') continue;
          if (e.updated < startedAt - 50) break;
          const r = perfectStrokes(api, [e.id]);
          if (r.changed) o.current.onPerfected(r);
          break;
        }
      }, 0);
    });
    return () => { offDown(); offUp(); };
  }, [api]);

  // Double-click on a stroke: perfect it. Runs before Excalidraw sees the double-click.
  useEffect(() => {
    if (!api) return;
    const onDbl = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || target.tagName !== 'CANVAS' || !target.closest('.lb-editor')) return;
      const st = api.getAppState();
      const p = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, st);
      const z = st.zoom.value;
      const els = api.getSceneElements();
      const t0 = Date.now();
      for (let i = els.length - 1; i >= 0; i--) {
        const el = els[i];
        if (el.type !== 'freedraw') continue;
        // the two clicks of a double-click with the pen leave two dots; they are not the target
        if (el.updated > t0 - 800 && el.width * z < 6 && el.height * z < 6) continue;
        if (distToElementLine(p, el) <= el.strokeWidth / 2 + 10 / z) {
          e.stopPropagation();
          e.preventDefault();
          const r = perfectStrokes(api, [el.id], { select: st.activeTool.type === 'selection' });
          // remove the dots the double-click itself drew with the pen
          setTimeout(() => {
            const dots = api.getSceneElements().filter((d) =>
              d.type === 'freedraw' && d.updated > t0 - 800 && d.width * z < 6 && d.height * z < 6);
            if (dots.length) {
              const ids = new Set(dots.map((d) => d.id));
              api.updateScene({ elements: api.getSceneElementsIncludingDeleted().filter((d) => !ids.has(d.id)) });
            }
          }, 30);
          if (r.changed) o.current.onPerfected(r);
          return;
        }
      }
    };
    window.addEventListener('dblclick', onDbl, true);
    return () => window.removeEventListener('dblclick', onDbl, true);
  }, [api]);

  return { onPointerUpdate, ring, pointer };
}

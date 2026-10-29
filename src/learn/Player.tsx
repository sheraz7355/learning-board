// Play: the board one step at a time — what each step adds pulses, its note shows below, dots flow where
// that step says, ticks and crosses appear, quiz cards hide answers until clicked, and Spotlight dims
// earlier steps. The editing board is not touched: Play shows a copy.

import { useEffect, useMemo, useRef, useState } from 'react';
import { CaptureUpdateAction, convertToExcalidrawElements, Excalidraw, ROUNDNESS, viewportCoordsToSceneCoords } from '@excalidraw/excalidraw';
import type { BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { type El, absPoints, boundsOf, hasPoints } from '../board/elements';
import { FlowLayer } from './FlowLayer';
import { isCover, maxStep, stepOf } from './steps';

type Props = {
  elements: readonly El[];
  files: BinaryFiles;
  notes: readonly string[];
  background: string;
  dark: boolean;
  startStep?: number;
  onClose: () => void;
};

const COVER = 'cover:';

function boxOf(el: El) {
  if (hasPoints(el)) return boundsOf(absPoints(el));
  return { minX: el.x, minY: el.y, maxX: el.x + el.width, maxY: el.y + el.height, w: el.width, h: el.height };
}

export function Player({ elements, files, notes, background, dark, startStep, onClose }: Props) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const byId = useMemo(() => new Map(elements.map((e) => [e.id, e])), [elements]);

  // The step an element really appears in: a box's text with its box; an arrow not before both its ends.
  const eff = useMemo(() => {
    const m = new Map<string, number>();
    const own = (e: El) => stepOf(e);
    for (const e of elements) {
      let s = own(e);
      if (e.type === 'text' && e.containerId && byId.get(e.containerId)) s = Math.max(s, own(byId.get(e.containerId)!));
      if (e.type === 'arrow') {
        for (const b of [e.startBinding, e.endBinding]) if (b && byId.get(b.elementId)) s = Math.max(s, own(byId.get(b.elementId)!));
      }
      m.set(e.id, s);
    }
    // an arrow's label follows the arrow
    for (const e of elements) if (e.type === 'text' && e.containerId && m.has(e.containerId)) m.set(e.id, Math.max(m.get(e.id)!, m.get(e.containerId)!));
    return m;
  }, [elements, byId]);

  const last = maxStep(elements);
  const first = elements.some((e) => (eff.get(e.id) ?? 0) === 0) || notes[0] ? 0 : 1;
  const [step, setStep] = useState(() => Math.min(Math.max(startStep ?? first, first), last));
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
  const [spotlight, setSpotlight] = useState(false);
  const [pulse, setPulse] = useState<ReadonlySet<string>>(new Set());

  const visible = useMemo(() => elements.filter((e) => (eff.get(e.id) ?? 0) <= step), [elements, eff, step]);

  const scene = useMemo(() => {
    const out: El[] = visible.map((e) =>
      spotlight && step > 0 && (eff.get(e.id) ?? 0) < step ? ({ ...e, opacity: Math.round(e.opacity * 0.22) } as El) : e);
    const covers = visible.filter((e) => isCover(e) && !revealed.has(e.id) && !(e.type === 'text' && e.containerId));
    if (covers.length) {
      out.push(...(convertToExcalidrawElements(covers.map((e) => {
        const b = boxOf(e);
        return {
          type: 'rectangle', id: COVER + e.id, x: b.minX - 8, y: b.minY - 8, width: b.w + 16, height: b.h + 16,
          backgroundColor: '#ffec99', fillStyle: 'solid', strokeColor: '#f08c00', strokeWidth: 2, roughness: 0,
          roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
          label: { text: '?  click to reveal', fontSize: Math.max(14, Math.min(28, b.h / 4)), strokeColor: '#c2410c' },
        };
      }) as never, { regenerateIds: false }) as El[]));
    }
    return out;
  }, [visible, spotlight, step, eff, revealed]);

  // Show the scene; keep everything in view; pulse what this step added for a few seconds.
  const firstFit = useRef(true);
  useEffect(() => {
    if (!api) return;
    api.updateScene({ elements: scene, captureUpdate: CaptureUpdateAction.NEVER });
    api.scrollToContent(scene.length ? scene : undefined, { fitToViewport: true, viewportZoomFactor: 0.88, animate: !firstFit.current, duration: 450 });
    firstFit.current = false;
  }, [api, scene]);

  useEffect(() => {
    if (step === 0) { setPulse(new Set()); return; }
    setPulse(new Set(elements.filter((e) => (eff.get(e.id) ?? 0) === step).map((e) => e.id)));
    const t = setTimeout(() => setPulse(new Set()), 3200);
    return () => clearTimeout(t);
  }, [step, elements, eff]);

  // Click a quiz card to reveal what it hides. (In view mode Excalidraw does not report clicks, so the
  // click is read from the page and turned into a board position here.)
  const canvasBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = canvasBox.current;
    if (!api || !host) return;
    let downAt: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { downAt = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return; // a drag pans, not a click
      const p = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, api.getAppState());
      const hit = api.getSceneElements().find((el) =>
        el.id.startsWith(COVER) && p.x >= el.x && p.x <= el.x + el.width && p.y >= el.y && p.y <= el.y + el.height);
      if (hit) setRevealed((r) => new Set(r).add(hit.id.slice(COVER.length)));
    };
    host.addEventListener('pointerdown', onDown, true);
    host.addEventListener('pointerup', onUp, true);
    return () => { host.removeEventListener('pointerdown', onDown, true); host.removeEventListener('pointerup', onUp, true); };
  }, [api]);

  // Keys: → / Space next, ← back, S spotlight, Esc close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); e.stopPropagation(); setStep((s) => Math.min(last, s + 1)); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); e.stopPropagation(); setStep((s) => Math.max(first, s - 1)); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
      else if (e.code === 'KeyS' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); e.stopPropagation(); setSpotlight((v) => !v); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [last, first, onClose]);

  const note = notes[step] ?? '';
  const steps = Array.from({ length: last - first + 1 }, (_, i) => first + i);

  return (
    <div className="lb-player" role="dialog" aria-label="Play">
      <div className="lb-player-canvas" ref={canvasBox}>
        <Excalidraw
          excalidrawAPI={setApi}
          viewModeEnabled
          zenModeEnabled
          theme={dark ? 'dark' : 'light'}
          initialData={{ elements: scene, appState: { viewBackgroundColor: background }, files, scrollToContent: true }}
          UIOptions={{ canvasActions: { changeViewBackgroundColor: false, clearCanvas: false, export: false, loadScene: false, saveToActiveFile: false, toggleTheme: false, saveAsImage: false } }}
        />
        <FlowLayer api={api} mode="play" step={step} pulseIds={pulse} dark={dark} />
      </div>
      <div className="lb-player-bar">
        <button type="button" className="lb-btn" onClick={() => setStep((s) => Math.max(first, s - 1))} disabled={step <= first} aria-label="Back (←)">←</button>
        <div className="lb-player-note">
          <div className="lb-player-dots" aria-label={`Step ${step} of ${last}`}>
            {steps.map((s) => (
              <button key={s} type="button" className={`lb-dot${s === step ? ' on' : s < step ? ' done' : ''}`} onClick={() => setStep(s)} aria-label={`Step ${s}`} />
            ))}
          </div>
          <p>{note || (step === last ? 'The end. Press Esc to go back to editing.' : ' ')}</p>
        </div>
        <button type="button" className="lb-btn primary" onClick={() => setStep((s) => Math.min(last, s + 1))} disabled={step >= last} aria-label="Next (→ or Space)">→</button>
        <div className="lb-player-tools">
          <button type="button" className={`lb-btn${spotlight ? ' on' : ''}`} onClick={() => setSpotlight((v) => !v)} title="Dim earlier steps (S)">Spotlight</button>
          {revealed.size > 0 && <button type="button" className="lb-btn" onClick={() => setRevealed(new Set())} title="Cover the answers again">Hide answers</button>}
          <button type="button" className="lb-btn" onClick={onClose} title="Back to editing (Esc)">Close</button>
        </div>
      </div>
    </div>
  );
}

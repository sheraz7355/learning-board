// What the smart ink does to the board. Every change is one undo step: Ctrl/Cmd+Z brings the original
// ink back (the professional pattern: the rough stroke is kept, only hidden).

import { CaptureUpdateAction, convertToExcalidrawElements, FONT_FAMILY, newElementWith, ROUNDNESS } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { NonDeletedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { recognize, type Shape } from '../ink/recognize';
import { readHandwriting } from '../ink/handwriting';
import { type P, chaikin, pca, rotate } from '../ink/geometry';
import { type El, absPoints, boundsOf, centreOf, edgePoint, shapeAt } from './elements';

type API = ExcalidrawImperativeAPI;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Skeleton = any;

/** Excalidraw expects a line or arrow to start at its own x, y (first point exactly [0, 0]). */
function normalised<T extends El>(el: T): T {
  if (el.type !== 'arrow' && el.type !== 'line') return el;
  const pts = (el as unknown as { points: readonly (readonly [number, number])[] }).points;
  const [dx, dy] = pts[0];
  if (!dx && !dy) return el;
  return newElementWith(el as never, {
    x: el.x + dx,
    y: el.y + dy,
    points: pts.map(([x, y]) => [x - dx, y - dy]),
  } as never) as T;
}

const styleOf = (s: El) => ({
  strokeColor: s.strokeColor,
  backgroundColor: 'transparent',
  fillStyle: 'solid' as const,
  strokeWidth: Math.max(1, Math.min(4, Math.round(s.strokeWidth))),
  strokeStyle: 'solid' as const,
  roughness: 0, // replaced below by the board's style (perfectStrokes)
  opacity: s.opacity,
  groupIds: s.groupIds,
  frameId: s.frameId,
});

function shapeSkeleton(shape: Exclude<Shape, { kind: 'curve' }>, style: ReturnType<typeof styleOf>): Skeleton {
  switch (shape.kind) {
    case 'ellipse':
      return { type: 'ellipse', x: shape.cx - shape.rx, y: shape.cy - shape.ry, width: 2 * shape.rx, height: 2 * shape.ry, angle: shape.angle, ...style };
    case 'rectangle':
      return {
        type: 'rectangle', x: shape.cx - shape.w / 2, y: shape.cy - shape.h / 2, width: shape.w, height: shape.h,
        angle: shape.angle, roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS }, ...style,
      };
    case 'diamond':
      return { type: 'diamond', x: shape.cx - shape.w / 2, y: shape.cy - shape.h / 2, width: shape.w, height: shape.h, ...style };
    case 'triangle': {
      const [a, b, c] = shape.pts;
      return { type: 'line', x: a.x, y: a.y, points: [[0, 0], [b.x - a.x, b.y - a.y], [c.x - a.x, c.y - a.y], [0, 0]], ...style };
    }
    case 'line':
      return { type: 'line', x: shape.a.x, y: shape.a.y, points: [[0, 0], [shape.b.x - shape.a.x, shape.b.y - shape.a.y]], ...style };
  }
}

export type PerfectResult = { changed: number; kinds: string[]; newIds: string[] };

/**
 * Perfect the given strokes: a closed stroke becomes the shape it was meant to be; a stroke from one shape
 * to another becomes an arrow attached to both (it follows when they move); a straight stroke becomes a
 * straight line. Strokes that are none of these (handwriting) are left alone.
 */
export function perfectStrokes(api: API, ids: Iterable<string>, opts: { select?: boolean } = {}): PerfectResult {
  const want = new Set(ids);
  const scene = api.getSceneElements();
  const zoom = api.getAppState().zoom.value;
  const strokes = scene.filter((e) => e.type === 'freedraw' && want.has(e.id));
  if (!strokes.length) return { changed: 0, kinds: [], newIds: [] };

  const removed = new Set<string>();
  const updated = new Map<string, El>(); // shapes that gained an arrow
  const added: El[] = [];
  const kinds: string[] = [];
  const others = scene.filter((e) => !want.has(e.id)) as NonDeletedExcalidrawElement[];

  for (const stroke of strokes) {
    const pts = absPoints(stroke);
    const shape = recognize(pts);
    if (!shape) continue;
    // The perfect shape is drawn in the board's style: Sketch keeps a hand-drawn line, Clean is crisp.
    const style = { ...styleOf(stroke), roughness: api.getAppState().currentItemRoughness };

    if (shape.kind === 'line' || shape.kind === 'curve') {
      const slack = 14 / zoom;
      const from = shapeAt(pts[0], others, slack);
      const to = shapeAt(pts[pts.length - 1], others, slack);
      if (from && to && from.id !== to.id) {
        const fromShape = updated.get(from.id) ?? from;
        const toShape = updated.get(to.id) ?? to;
        const a = edgePoint(fromShape, centreOf(toShape));
        const b = edgePoint(toShape, centreOf(fromShape));
        const [arrow0] = convertToExcalidrawElements([{
          type: 'arrow', x: a.x, y: a.y, points: [[0, 0], [b.x - a.x, b.y - a.y]],
          startArrowhead: null, endArrowhead: 'arrow', ...style, roundness: null,
        } as Skeleton]);
        const arrow = newElementWith(normalised(arrow0 as El) as never, {
          startBinding: { elementId: fromShape.id, focus: 0, gap: 6 },
          endBinding: { elementId: toShape.id, focus: 0, gap: 6 },
        } as never) as El;
        for (const s of [fromShape, toShape]) {
          updated.set(s.id, newElementWith(s as never, {
            boundElements: [...(s.boundElements ?? []), { id: arrow.id, type: 'arrow' }],
          } as never) as El);
        }
        added.push(arrow);
        removed.add(stroke.id);
        kinds.push('arrow');
        continue;
      }
      if (shape.kind === 'curve') continue; // a free curve (or handwriting): keep it as drawn
    }
    const [el] = convertToExcalidrawElements([shapeSkeleton(shape as Exclude<Shape, { kind: 'curve' }>, style)]);
    added.push(normalised(el as El));
    removed.add(stroke.id);
    kinds.push(shape.kind === 'ellipse' && shape.circle ? 'circle' : shape.kind === 'rectangle' && shape.square ? 'square' : shape.kind);
  }

  if (!removed.size) return { changed: 0, kinds: [], newIds: [] };
  const all = api.getSceneElementsIncludingDeleted().map((e) =>
    removed.has(e.id) ? newElementWith(e, { isDeleted: true }) : updated.get(e.id) ?? e);
  const appState = opts.select
    ? { selectedElementIds: Object.fromEntries(added.map((e) => [e.id, true])) as never }
    : undefined;
  api.updateScene({ elements: [...all, ...added], appState, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  return { changed: removed.size, kinds, newIds: added.map((e) => e.id) };
}

/** Line up handwriting: turn the selected strokes so the writing runs level, and smooth the shake. */
export function straightenStrokes(api: API, ids: Iterable<string>): number {
  const want = new Set(ids);
  const strokes = api.getSceneElements().filter((e) => e.type === 'freedraw' && want.has(e.id));
  if (!strokes.length) return 0;
  const all: P[] = strokes.flatMap((s) => absPoints(s));
  const { angle } = pca(all);
  // The writing direction: the long axis, folded into (-90°, 90°].
  let a = angle;
  if (a > Math.PI / 2) a -= Math.PI;
  if (a < -Math.PI / 2) a += Math.PI;
  const tilt = Math.abs(a) <= (40 * Math.PI) / 180 ? a : 0;
  const b = boundsOf(all);
  const centre = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  const changed = new Map<string, El>();
  for (const s of strokes) {
    if (s.type !== 'freedraw') continue;
    // Redraw the points level (rather than rotating the stroke), so it stays an ordinary upright stroke.
    let abs = absPoints(s).map((p) => rotate(p, centre, -tilt));
    let pressures = s.pressures;
    if (!s.pressures.length && abs.length > 4) abs = chaikin(abs, 1);
    else if (s.pressures.length !== abs.length) pressures = [];
    const x0 = abs[0].x, y0 = abs[0].y;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of abs) { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; }
    changed.set(s.id, newElementWith(s, {
      x: x0,
      y: y0,
      angle: 0 as never,
      points: abs.map((p) => [p.x - x0, p.y - y0] as never),
      pressures,
      width: maxX - minX,
      height: maxY - minY,
    } as never) as El);
  }
  const els = api.getSceneElementsIncludingDeleted().map((e) => changed.get(e.id) ?? e);
  api.updateScene({ elements: els, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  return changed.size;
}

export type TextResult = { text: string; alternatives: string[]; textId: string };

/** Read the selected handwriting and replace it with neat text in the same place, same size and colour. */
export async function strokesToText(api: API, ids: Iterable<string>, signal?: AbortSignal): Promise<TextResult | null> {
  const want = new Set(ids);
  const strokes = api.getSceneElements().filter((e) => e.type === 'freedraw' && want.has(e.id));
  if (!strokes.length) return null;
  const inks = strokes.map((s) => absPoints(s)); // scene order = the order they were written
  const candidates = await readHandwriting(inks, navigator.language?.slice(0, 2) || 'en', signal);
  if (!candidates.length) throw new Error('Nothing readable in that writing');
  const b = boundsOf(inks.flat());
  // Letter height: the median height of the strokes, so one tall letter does not blow the size up.
  const heights = inks.map((s) => boundsOf(s).h).sort((x, y) => x - y);
  const letter = heights[Math.floor(heights.length / 2)] || b.h;
  const fontSize = Math.max(14, Math.min(160, Math.round(Math.max(letter, b.h * 0.6) * 1.1)));
  const [text] = convertToExcalidrawElements([{
    type: 'text', x: b.minX, y: b.minY, text: candidates[0], fontSize, fontFamily: FONT_FAMILY.Excalifont,
    strokeColor: strokes[0].strokeColor, opacity: strokes[0].opacity, groupIds: strokes[0].groupIds,
  } as Skeleton]);
  // Centre the text on where the writing was.
  const placed = newElementWith(text as never, {
    x: b.minX + b.w / 2 - (text as El).width / 2,
    y: b.minY + b.h / 2 - (text as El).height / 2,
  } as never) as El;
  const all = api.getSceneElementsIncludingDeleted().map((e) => (want.has(e.id) ? newElementWith(e, { isDeleted: true }) : e));
  api.updateScene({
    elements: [...all, placed],
    appState: { selectedElementIds: { [placed.id]: true } as never },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return { text: candidates[0], alternatives: candidates.slice(1, 5), textId: placed.id };
}

/** Swap a text element's words (an alternative reading), keeping its centre. */
export function replaceText(api: API, textId: string, value: string) {
  const el = api.getSceneElements().find((e) => e.id === textId);
  if (!el || el.type !== 'text') return;
  const [fresh] = convertToExcalidrawElements([{
    type: 'text', x: el.x, y: el.y, text: value, fontSize: el.fontSize, fontFamily: el.fontFamily,
    strokeColor: el.strokeColor, opacity: el.opacity, groupIds: el.groupIds,
  } as Skeleton]);
  const c = centreOf(el);
  const next = newElementWith(el, {
    text: value, originalText: value,
    width: (fresh as El).width, height: (fresh as El).height,
    x: c.x - (fresh as El).width / 2, y: c.y - (fresh as El).height / 2,
  } as never);
  api.updateScene({
    elements: api.getSceneElementsIncludingDeleted().map((e) => (e.id === textId ? next : e)),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

/**
 * The handwriting you mean: the strokes of the word or line around a point (or around the last thing you
 * wrote). Strokes join when they sit close beside each other on the same line, so a dot on an i or the bar
 * of a t comes along, but the line above or below does not.
 */
export function writingNear(api: API, at: P | null): string[] {
  const z = api.getAppState().zoom.value;
  const strokes = api.getSceneElements().filter((e) => e.type === 'freedraw');
  if (!strokes.length) return [];
  const box = new Map(strokes.map((s) => [s.id, boundsOf(absPoints(s))]));
  let seed = strokes[strokes.length - 1];
  if (at) {
    let best = Infinity;
    for (const s of strokes) {
      const b = box.get(s.id)!;
      const d = Math.max(b.minX - at.x, 0, at.x - b.maxX) + Math.max(b.minY - at.y, 0, at.y - b.maxY);
      if (d < best) { best = d; seed = s; }
    }
    if (best > 160 / z) seed = [...strokes].sort((a, b) => b.updated - a.updated)[0];
  }
  const sb = box.get(seed.id)!;
  const line = Math.max(18 / z, sb.h);
  const group = new Set([seed.id]);
  let g = { ...sb };
  for (let grew = true; grew && group.size < 160;) {
    grew = false;
    for (const s of strokes) {
      if (group.has(s.id)) continue;
      const b = box.get(s.id)!;
      if (b.h > line * 3.2) continue; // a big drawing, not a letter
      const padX = line * 1.25, padY = line * 0.55;
      if (b.maxX >= g.minX - padX && b.minX <= g.maxX + padX && b.maxY >= g.minY - padY && b.minY <= g.maxY + padY) {
        group.add(s.id);
        g = { minX: Math.min(g.minX, b.minX), minY: Math.min(g.minY, b.minY), maxX: Math.max(g.maxX, b.maxX), maxY: Math.max(g.maxY, b.maxY), w: 0, h: 0 };
        grew = true;
      }
    }
  }
  return strokes.filter((s) => group.has(s.id)).map((s) => s.id);
}

/**
 * Clean up the whole board: every rough stroke that is clearly a shape, a line between two shapes, or a long
 * straight line becomes perfect. Small strokes (letters such as O or l) are left as written.
 */
export function cleanUpBoard(api: API): PerfectResult {
  const z = api.getAppState().zoom.value;
  const ids: string[] = [];
  for (const s of api.getSceneElements()) {
    if (s.type !== 'freedraw') continue;
    const b = boundsOf(absPoints(s));
    if (Math.max(b.w, b.h) < 46 / Math.min(1, z)) continue;
    ids.push(s.id);
  }
  return perfectStrokes(api, ids);
}

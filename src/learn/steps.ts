// Learning data lives on each element (customData), so it travels with the element when copied, saved or
// exported:
//   step      number  the step it appears in (0 or missing = always there)
//   flow      true    dots flow along this arrow all the time
//   flowAt    number[] dots flow along this arrow only during these steps (lessons use this)
//   cover     true    a quiz card hides it in Play until clicked
//   markAt    { [step]: 'ok' | 'cross' }  a green tick / red cross on it during that step

import { CaptureUpdateAction, newElementWith } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { El } from '../board/elements';

export const stepOf = (el: El): number => {
  const s = el.customData?.step;
  return typeof s === 'number' && s > 0 ? Math.floor(s) : 0;
};
export const flowsAlways = (el: El) => el.customData?.flow === true;
export const flowsAt = (el: El, step: number) =>
  flowsAlways(el) || (Array.isArray(el.customData?.flowAt) && el.customData!.flowAt.includes(step));
export const isCover = (el: El) => el.customData?.cover === true;
export const markAt = (el: El, step: number): 'ok' | 'cross' | null => {
  const m = el.customData?.markAt?.[step];
  return m === 'ok' || m === 'cross' ? m : null;
};

export const maxStep = (els: readonly El[]) => els.reduce((m, e) => Math.max(m, stepOf(e)), 0);

/** The last step: steps that only say something, or only tick, cross or flow, count too. */
export function lastStep(els: readonly El[], notes: readonly string[]): number {
  let last = Math.max(maxStep(els), notes.length - 1);
  for (const e of els) {
    for (const k of Object.keys(e.customData?.markAt ?? {})) last = Math.max(last, Number(k) || 0);
    for (const s of (Array.isArray(e.customData?.flowAt) ? e.customData!.flowAt : [])) last = Math.max(last, Number(s) || 0);
  }
  return last;
}

/** The ids plus what belongs with them: a box's own text, an arrow's label, a text's box, group-mates. */
export function withAttached(scene: readonly El[], ids: Iterable<string>): Set<string> {
  const out = new Set(ids);
  const byId = new Map(scene.map((e) => [e.id, e]));
  const groups = new Set<string>();
  for (const id of out) for (const g of byId.get(id)?.groupIds ?? []) groups.add(g);
  for (const e of scene) {
    if (e.groupIds.some((g) => groups.has(g))) out.add(e.id);
  }
  for (const id of [...out]) {
    const e = byId.get(id);
    if (!e) continue;
    for (const b of e.boundElements ?? []) if (b.type === 'text') out.add(b.id);
    if (e.type === 'text' && e.containerId) out.add(e.containerId);
  }
  return out;
}

/** Set (or with `undefined`, remove) learning fields on elements. One undo step. */
export function setLearning(api: ExcalidrawImperativeAPI, ids: Iterable<string>, patch: Record<string, unknown>) {
  const want = new Set(ids);
  const els = api.getSceneElementsIncludingDeleted().map((e) => {
    if (!want.has(e.id)) return e;
    const customData: Record<string, unknown> = { ...(e.customData ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete customData[k];
      else customData[k] = v;
    }
    return newElementWith(e, { customData } as never);
  });
  api.updateScene({ elements: els, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
}

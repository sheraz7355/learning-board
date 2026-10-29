// Lessons: the explanation files written into lessons/ (the format in README.md, "Lesson format"). They are
// served by the local server (npm start). Opening one makes an editable board: boxes, attached arrows, the
// steps, each step's note, flowing dots, ticks and crosses. Without the server (or with no lessons) the
// list is simply empty.

import { convertToExcalidrawElements, FONT_FAMILY, ROUNDNESS } from '@excalidraw/excalidraw';
import { type El, edgePoint } from './elements';

export type LessonRow = { id: string; title?: string; error?: string; updatedAt?: number };
type Node = { id: string; label?: string; sub?: string; col?: number; row?: number; kind?: string };
type Arrow = { id?: string; from: string; to: string; label?: string; dashed?: boolean; bend?: number };
type Step = { say?: string; show?: string[]; flow?: string[]; cross?: string[]; ok?: string[] };
export type Lesson = { title?: string; oneLine?: string; nodes?: Node[]; arrows?: Arrow[]; steps?: Step[] };

export async function fetchLessons(): Promise<LessonRow[]> {
  try {
    const r = await fetch('/api/lessons', { cache: 'no-store' });
    if (!r.ok) return [];
    const rows = await r.json();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export async function fetchLesson(id: string): Promise<Lesson> {
  const r = await fetch(`/api/lessons/${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Lesson ${id} not found`);
  return JSON.parse(await r.text());
}

// The lessons' look (the Sketch style): rough hand-drawn lines, the old player's soft fills, handwriting,
// and a small picture for each kind of box.
const KIND: Record<string, { type: 'rectangle' | 'ellipse' | 'diamond'; w: number; h: number; bg: string; icon: string }> = {
  server: { type: 'rectangle', w: 230, h: 110, bg: '#eef3fb', icon: '🖥️' },
  database: { type: 'ellipse', w: 240, h: 125, bg: '#edf6ef', icon: '🗄️' },
  phone: { type: 'rectangle', w: 160, h: 170, bg: '#f3effa', icon: '📱' },
  person: { type: 'ellipse', w: 180, h: 125, bg: '#fbf0e6', icon: '🙂' },
  cloud: { type: 'ellipse', w: 250, h: 125, bg: '#eef6fb', icon: '☁️' },
  note: { type: 'rectangle', w: 240, h: 130, bg: '#fff1a8', icon: '📝' },
  switch: { type: 'diamond', w: 250, h: 160, bg: '#fbf0e6', icon: '🔀' },
};
const INK = '#1f2429';
export const LESSON_STYLE = 'sketch';
export const LESSON_PAPER = '#fdfdfa';

/** Text is measured when it is made: the handwriting font must be loaded first, or words are cut off. */
export async function fontsReady() {
  try {
    await Promise.all([document.fonts.load('20px Excalifont'), document.fonts.load('20px Nunito')]);
  } catch { /* measured with what is there */ }
}

/** A lesson as board elements plus the note for each step ([0] = the one-line answer). */
export function lessonToBoard(lesson: Lesson): { elements: El[]; notes: string[] } {
  const nodes = (lesson.nodes ?? []).slice(0, 12);
  const arrows = (lesson.arrows ?? []).slice(0, 16);
  const steps = (lesson.steps ?? []).slice(0, 10);
  const nodeIds = new Set(nodes.map((n) => n.id));

  // Steps are cumulative: an element appears in the first step that shows it; never shown = step 1.
  const firstShown = new Map<string, number>();
  steps.forEach((s, i) => (s.show ?? []).forEach((id) => { if (!firstShown.has(id)) firstShown.set(id, i + 1); }));
  const stepFor = (id: string) => (steps.length ? firstShown.get(id) ?? 1 : 0);

  const flowAt = new Map<string, number[]>();
  const marks = new Map<string, Record<number, 'ok' | 'cross'>>();
  steps.forEach((s, i) => {
    for (const id of s.flow ?? []) flowAt.set(id, [...(flowAt.get(id) ?? []), i + 1]);
    for (const id of s.cross ?? []) marks.set(id, { ...(marks.get(id) ?? {}), [i + 1]: 'cross' });
    for (const id of s.ok ?? []) marks.set(id, { ...(marks.get(id) ?? {}), [i + 1]: 'ok' });
  });

  const used = new Set<string>();
  const skeleton: unknown[] = [];
  const boxes = new Map<string, El>(); // where each box sits, to start and end arrows on their outlines
  if (lesson.title) {
    skeleton.push({
      type: 'text', x: 60, y: 0, text: lesson.title, fontSize: 38, fontFamily: FONT_FAMILY.Excalifont, strokeColor: INK,
    });
  }
  for (const n of nodes) {
    const k = KIND[n.kind ?? 'server'] ?? KIND.server;
    let col = Math.max(0, Math.min(4, Math.round(n.col ?? 0)));
    let row = Math.max(0, Math.min(3, Math.round(n.row ?? 0)));
    while (used.has(`${col},${row}`) && col < 5) col++;
    used.add(`${col},${row}`);
    const cx = 160 + col * 350, cy = 170 + row * 240;
    const text = `${k.icon} ${n.label ?? n.id}${n.sub ? `\n${n.sub}` : ''}`;
    boxes.set(n.id, { type: k.type, x: cx - k.w / 2, y: cy - k.h / 2, width: k.w, height: k.h, angle: 0 } as unknown as El);
    skeleton.push({
      type: k.type, id: n.id, x: cx - k.w / 2, y: cy - k.h / 2, width: k.w, height: k.h,
      backgroundColor: k.bg, fillStyle: 'solid', strokeColor: INK, strokeWidth: 2, roughness: 1,
      roundness: k.type === 'rectangle' ? { type: ROUNDNESS.ADAPTIVE_RADIUS } : null,
      label: { text, fontSize: 19, fontFamily: FONT_FAMILY.Excalifont, strokeColor: INK },
      customData: learning(stepFor(n.id), undefined, marks.get(n.id)),
    });
  }
  arrows.forEach((a, i) => {
    if (!nodeIds.has(a.from) || !nodeIds.has(a.to) || a.from === a.to) return;
    const id = a.id ?? `arrow${i + 1}`;
    const s = Math.max(stepFor(id), stepFor(a.from), stepFor(a.to));
    const from = boxes.get(a.from)!, to = boxes.get(a.to)!;
    const centre = (b: El) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
    // Two arrows between the same two boxes (there and back) curve apart, each to its own right, so
    // neither the lines nor their labels sit on top of each other. A lesson's own `bend` wins.
    const twoWay = arrows.some((o) => o !== a && ((o.from === a.to && o.to === a.from) || (o.from === a.from && o.to === a.to)));
    const bend = typeof a.bend === 'number' ? Math.max(-220, Math.min(220, a.bend)) : twoWay ? 55 : 0;
    const c1 = centre(from), c2 = centre(to);
    const len = Math.hypot(c2.x - c1.x, c2.y - c1.y) || 1;
    const nx = -(c2.y - c1.y) / len, ny = (c2.x - c1.x) / len; // the right-hand side of the direction of travel
    const mid = { x: (c1.x + c2.x) / 2 + nx * bend, y: (c1.y + c2.y) / 2 + ny * bend };
    const p = edgePoint(from, bend ? mid : c2, 8), q = edgePoint(to, bend ? mid : c1, 8);
    const points = bend ? [[0, 0], [mid.x - p.x, mid.y - p.y], [q.x - p.x, q.y - p.y]] : [[0, 0], [q.x - p.x, q.y - p.y]];
    skeleton.push({
      type: 'arrow', id, x: p.x, y: p.y, points, roundness: bend ? { type: ROUNDNESS.PROPORTIONAL_RADIUS } : null,
      strokeColor: INK, strokeWidth: 2, roughness: 1,
      strokeStyle: a.dashed ? 'dashed' : 'solid', endArrowhead: 'arrow',
      start: { id: a.from }, end: { id: a.to },
      label: a.label ? { text: a.label, fontSize: 17, fontFamily: FONT_FAMILY.Excalifont, strokeColor: '#5a636c' } : undefined,
      customData: learning(s, flowAt.get(id), undefined),
    });
  });
  const elements = convertToExcalidrawElements(skeleton as never, { regenerateIds: false }) as El[];
  const notes = [lesson.oneLine ?? '', ...steps.map((s) => s.say ?? '')];
  return { elements, notes };
}

function learning(step: number, flowAt?: number[], marks?: Record<number, 'ok' | 'cross'>) {
  const d: Record<string, unknown> = {};
  if (step) d.step = step;
  if (flowAt?.length) d.flowAt = flowAt;
  if (marks) d.markAt = marks;
  return Object.keys(d).length ? d : undefined;
}

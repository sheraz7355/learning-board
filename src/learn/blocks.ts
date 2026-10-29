// Blocks: type a data structure, get a clean diagram in the board's style (for learning DSA fast).
//
//   array 3 1 4 1 5        cells with their indexes
//   list 1 2 3             linked list: nodes, next arrows, null
//   tree 8 3 10 1 6 14     binary search tree (values inserted in that order)
//   heap 9 7 8 3 2         complete binary tree in level order (heaps, level-order trees)
//   stack 1 2 3            last value on top
//   queue a b c            front on the left, rear on the right
//   graph A-B B-C C->A A-D:5   undirected (-), directed (->), weight after ':'
//   matrix 1 2 3; 4 5 6    rows separated by ';'      grid 3x4   empty rows × columns
//   hash 7 apple pear      buckets 0..6, words placed by a simple hash
//
// Boxes in trees, lists and graphs stay separate so you can drag them (their arrows follow); arrays,
// stacks, queues, grids and hash tables are grouped so they move as one.

import { convertToExcalidrawElements, ROUNDNESS } from '@excalidraw/excalidraw';
import { type El, edgePoint } from '../board/elements';
import { type ArtStyle, fillFor } from './styles';

type Box = { id: string; type: 'rectangle' | 'ellipse' | 'diamond'; x: number; y: number; w: number; h: number; text: string; bg: string; size?: number };
type Link = { from: string; to: string; head: boolean; label?: string };
type Txt = { x: number; y: number; text: string; size: number; muted?: boolean };
type Layout = { boxes: Box[]; links: Link[]; texts: Txt[]; group: boolean };

export type Look = { stroke: string; roughness: number; strokeWidth: number; font: number; fill: string; style: ArtStyle };

let seq = 0;
const nid = (p: string) => `${p}-${Date.now().toString(36)}${(seq++).toString(36)}`;

const PALE = { blue: '#e7f5ff', green: '#ebfbee', yellow: '#fff9db', violet: '#f3f0ff', orange: '#fff4e6', pink: '#fff0f6' };

function values(args: string[], fallback: number): string[] {
  const v = args.join(' ').split(/[\s,]+/).filter(Boolean);
  return v.length ? v : Array.from({ length: fallback }, () => '');
}

// ── the structures ──────────────────────────────────────────────────────────
function array(args: string[]): Layout {
  const v = values(args, 5);
  const cw = Math.max(64, ...v.map((s) => 22 + s.length * 12)), ch = 60;
  const boxes = v.map((t, i) => ({ id: nid('cell'), type: 'rectangle' as const, x: i * cw, y: 0, w: cw, h: ch, text: t, bg: PALE.blue }));
  const texts = v.map((_, i) => ({ x: i * cw + cw / 2 - 5, y: ch + 8, text: String(i), size: 14, muted: true }));
  return { boxes, links: [], texts, group: true };
}

function list(args: string[]): Layout {
  const v = values(args, 3);
  const w = Math.max(80, ...v.map((s) => 30 + s.length * 12)), h = 56, gap = 70;
  const boxes = v.map((t, i) => ({ id: nid('node'), type: 'rectangle' as const, x: i * (w + gap), y: 0, w, h, text: t, bg: PALE.green }));
  const links = boxes.slice(1).map((b, i) => ({ from: boxes[i].id, to: b.id, head: true }));
  const texts = [{ x: v.length * (w + gap) - gap + 14, y: h / 2 - 12, text: '→ null', size: 18, muted: true }];
  return { boxes, links, texts, group: false };
}

type TNode = { v: string; l?: TNode; r?: TNode };
const num = (s: string) => (Number.isFinite(Number(s)) ? Number(s) : NaN);
const less = (a: string, b: string) => (Number.isNaN(num(a)) || Number.isNaN(num(b)) ? a < b : num(a) < num(b));

function treeLayout(root: TNode | undefined, bg: string): Layout {
  const boxes: Box[] = [], links: Link[] = [];
  let order = 0;
  const walk = (n: TNode | undefined, depth: number): string | null => {
    if (!n) return null;
    const left = walk(n.l, depth + 1);
    const id = nid('tn');
    const size = Math.max(56, 24 + n.v.length * 12);
    boxes.push({ id, type: 'ellipse', x: order++ * 74, y: depth * 100, w: size, h: 56, text: n.v, bg });
    const right = walk(n.r, depth + 1);
    if (left) links.push({ from: id, to: left, head: false });
    if (right) links.push({ from: id, to: right, head: false });
    return id;
  };
  walk(root, 0);
  return { boxes, links, texts: [], group: false };
}

function bst(args: string[]): Layout {
  const v = values(args, 0);
  if (!v.length) v.push('8', '3', '10', '1', '6', '14', '4', '7', '13');
  let root: TNode | undefined;
  for (const x of v) {
    if (!root) { root = { v: x }; continue; }
    let n = root;
    for (;;) {
      if (less(x, n.v)) { if (n.l) n = n.l; else { n.l = { v: x }; break; } }
      else if (n.r) n = n.r; else { n.r = { v: x }; break; }
    }
  }
  return treeLayout(root, PALE.green);
}

function heap(args: string[]): Layout {
  const v = values(args, 0);
  if (!v.length) v.push('9', '7', '8', '3', '2', '6', '5');
  const make = (i: number): TNode | undefined => (i < v.length ? { v: v[i], l: make(2 * i + 1), r: make(2 * i + 2) } : undefined);
  const lay = treeLayout(make(0), PALE.orange);
  // index under each node (level order)
  const byText = new Map<string, number[]>();
  v.forEach((t, i) => byText.set(t, [...(byText.get(t) ?? []), i]));
  return lay;
}

function stack(args: string[]): Layout {
  const v = values(args, 3);
  const w = Math.max(120, ...v.map((s) => 30 + s.length * 12)), h = 50;
  // last value on top
  const boxes = v.map((t, i) => ({ id: nid('st'), type: 'rectangle' as const, x: 0, y: (v.length - 1 - i) * h, w, h, text: t, bg: PALE.violet }));
  const texts = [{ x: -74, y: h / 2 - 12, text: 'top →', size: 18, muted: true }];
  return { boxes, links: [], texts, group: true };
}

function queue(args: string[]): Layout {
  const v = values(args, 4);
  const w = Math.max(70, ...v.map((s) => 26 + s.length * 12)), h = 60;
  const boxes = v.map((t, i) => ({ id: nid('q'), type: 'rectangle' as const, x: i * w, y: 0, w, h, text: t, bg: PALE.yellow }));
  const texts = [
    { x: 0, y: -30, text: 'front', size: 16, muted: true },
    { x: (v.length - 1) * w, y: -30, text: 'rear', size: 16, muted: true },
  ];
  return { boxes, links: [], texts, group: true };
}

function graph(args: string[]): Layout {
  const edges = args.join(' ').split(/[\s,]+/).filter(Boolean);
  const names: string[] = [];
  const parsed: { a: string; b: string; directed: boolean; w?: string }[] = [];
  for (const e of edges) {
    const m = /^([^-:>]+)(->|-)([^:]+)(?::(.+))?$/.exec(e);
    if (!m) { if (!names.includes(e)) names.push(e); continue; }
    const [, a, op, b, w] = m;
    for (const n of [a, b]) if (!names.includes(n)) names.push(n);
    parsed.push({ a, b, directed: op === '->', w });
  }
  if (!names.length) { names.push('A', 'B', 'C', 'D'); parsed.push({ a: 'A', b: 'B', directed: false }, { a: 'B', b: 'C', directed: false }, { a: 'C', b: 'A', directed: false }, { a: 'A', b: 'D', directed: false }); }
  const R = Math.max(130, names.length * 34);
  const ids = new Map<string, string>();
  const boxes = names.map((n, i) => {
    const a = (i / names.length) * Math.PI * 2 - Math.PI / 2;
    const id = nid('v');
    ids.set(n, id);
    const size = Math.max(58, 26 + n.length * 12);
    return { id, type: 'ellipse' as const, x: R + Math.cos(a) * R - size / 2, y: R + Math.sin(a) * R - 29, w: size, h: 58, text: n, bg: PALE.blue };
  });
  const links = parsed.map((p) => ({ from: ids.get(p.a)!, to: ids.get(p.b)!, head: p.directed, label: p.w }));
  return { boxes, links, texts: [], group: false };
}

function matrix(args: string[], gridSpec?: [number, number]): Layout {
  let rows: string[][];
  if (gridSpec) rows = Array.from({ length: gridSpec[0] }, () => Array.from({ length: gridSpec[1] }, () => ''));
  else rows = args.join(' ').split(';').map((r) => r.split(/[\s,]+/).filter(Boolean)).filter((r) => r.length);
  if (!rows.length) rows = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']];
  const cols = Math.max(...rows.map((r) => r.length));
  const cw = Math.max(56, ...rows.flat().map((s) => 22 + s.length * 12)), ch = 56;
  const boxes: Box[] = [];
  const texts: Txt[] = [];
  rows.forEach((r, i) => {
    texts.push({ x: -26, y: i * ch + ch / 2 - 10, text: String(i), size: 14, muted: true });
    for (let j = 0; j < cols; j++) boxes.push({ id: nid('m'), type: 'rectangle', x: j * cw, y: i * ch, w: cw, h: ch, text: r[j] ?? '', bg: PALE.pink });
  });
  for (let j = 0; j < cols; j++) texts.push({ x: j * cw + cw / 2 - 5, y: -24, text: String(j), size: 14, muted: true });
  return { boxes, links: [], texts, group: true };
}

function hash(args: string[]): Layout {
  const first = Number(args[0]);
  const n = Number.isInteger(first) && first > 0 && first <= 32 ? first : 7;
  const words = (Number.isInteger(first) ? args.slice(1) : args).join(' ').split(/[\s,]+/).filter(Boolean);
  const buckets: string[][] = Array.from({ length: n }, () => []);
  for (const w of words) {
    let h = 0;
    for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    buckets[h % n].push(w);
  }
  const boxes: Box[] = [], texts: Txt[] = [];
  buckets.forEach((b, i) => {
    texts.push({ x: 0, y: i * 48 + 12, text: String(i), size: 16, muted: true });
    boxes.push({ id: nid('hb'), type: 'rectangle', x: 34, y: i * 48, w: Math.max(170, 30 + b.join(' → ').length * 10), h: 44, text: b.join(' → '), bg: PALE.blue, size: 16 });
  });
  return { boxes, links: [], texts, group: true };
}

export const BLOCK_HELP: [string, string][] = [
  ['array 3 1 4 1 5', 'cells with indexes'],
  ['list 1 2 3', 'linked list'],
  ['tree 8 3 10 1 6 14', 'binary search tree'],
  ['heap 9 7 8 3 2', 'complete tree, level order'],
  ['stack 1 2 3', 'last value on top'],
  ['queue a b c', 'front → rear'],
  ['graph A-B B->C A-D:5', '- undirected, -> directed, :weight'],
  ['matrix 1 2; 3 4', 'rows split by ;'],
  ['grid 3x4', 'empty rows × columns'],
  ['hash 7 apple pear', 'buckets by a simple hash'],
];

/** Parse a block command into a layout; null when the word is unknown. */
export function layoutFor(command: string): Layout | null {
  const [word, ...args] = command.trim().split(/\s+/);
  switch ((word ?? '').toLowerCase()) {
    case 'array': case 'arr': return array(args);
    case 'list': case 'linked': case 'll': return list(args);
    case 'tree': case 'bst': return bst(args);
    case 'heap': case 'complete': return heap(args);
    case 'stack': return stack(args);
    case 'queue': case 'q': return queue(args);
    case 'graph': return graph(args);
    case 'matrix': return matrix(args);
    case 'grid': {
      const m = /^(\d+)\s*[x×*]\s*(\d+)$/i.exec(args.join(''));
      return matrix([], m ? [Math.min(20, +m[1]), Math.min(20, +m[2])] : [3, 3]);
    }
    case 'hash': case 'table': return hash(args);
    default: return null;
  }
}

/** The layout as board elements, centred on `at`, in the board's look. */
export function buildBlock(layout: Layout, at: { x: number; y: number }, look: Look): El[] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of layout.boxes) { minX = Math.min(minX, b.x); minY = Math.min(minY, b.y); maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h); }
  for (const t of layout.texts) { minX = Math.min(minX, t.x); minY = Math.min(minY, t.y); maxX = Math.max(maxX, t.x + 40); maxY = Math.max(maxY, t.y + t.size); }
  const dx = at.x - (minX + maxX) / 2, dy = at.y - (minY + maxY) / 2;
  const muted = look.style.dark ? '#b9c6bd' : '#6b7280';
  const pos = new Map<string, El>();
  const sk: unknown[] = [];
  for (const b of layout.boxes) {
    const x = b.x + dx, y = b.y + dy;
    pos.set(b.id, { type: b.type, x, y, width: b.w, height: b.h, angle: 0 } as unknown as El);
    sk.push({
      type: b.type, id: b.id, x, y, width: b.w, height: b.h,
      strokeColor: look.stroke, backgroundColor: fillFor(b.bg, look.style), fillStyle: look.fill,
      strokeWidth: look.strokeWidth, roughness: look.roughness,
      roundness: b.type === 'rectangle' ? { type: ROUNDNESS.ADAPTIVE_RADIUS } : null,
      label: b.text ? { text: b.text, fontSize: b.size ?? 20, fontFamily: look.font, strokeColor: look.stroke } : undefined,
    });
  }
  for (const l of layout.links) {
    const A = pos.get(l.from), B = pos.get(l.to);
    if (!A || !B) continue;
    const c = (e: El) => ({ x: e.x + e.width / 2, y: e.y + e.height / 2 });
    const p = edgePoint(A, c(B), 4), q = edgePoint(B, c(A), 4);
    sk.push({
      type: 'arrow', x: p.x, y: p.y, points: [[0, 0], [q.x - p.x, q.y - p.y]],
      start: { id: l.from }, end: { id: l.to }, startArrowhead: null, endArrowhead: l.head ? 'arrow' : null,
      strokeColor: look.stroke, strokeWidth: look.strokeWidth, roughness: look.roughness, roundness: null,
      label: l.label ? { text: l.label, fontSize: 16, fontFamily: look.font, strokeColor: muted } : undefined,
    });
  }
  for (const t of layout.texts) {
    sk.push({ type: 'text', x: t.x + dx, y: t.y + dy, text: t.text, fontSize: t.size, fontFamily: look.font, strokeColor: t.muted ? muted : look.stroke });
  }
  const els = convertToExcalidrawElements(sk as never, { regenerateIds: false }) as El[];
  if (!layout.group) return els;
  const gid = nid('grp');
  return els.map((e) => ({ ...e, groupIds: [...e.groupIds, gid] }) as El);
}

// Art styles: one click restyles the whole board — line roughness, line width, fill pattern, font, ink and
// paper colours, and the colour of the flowing dots. New drawing follows the style too.
// "Sketch" is the hand-drawn look of the lessons (rough lines, soft fills, handwriting).

import { CaptureUpdateAction, FONT_FAMILY, newElementWith, restoreElements } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { El } from '../board/elements';

export type ArtStyle = {
  id: string;
  name: string;
  hint: string;
  paper: string;
  grid: boolean;
  roughness: 0 | 1 | 2;
  strokeWidth: number;
  font: number;
  fontName: string; // the CSS font family, for the preview
  ink: string;
  dark: boolean; // light ink on dark paper
  fill: 'solid' | 'hachure' | 'cross-hatch' | 'zigzag';
  flow: string; // colour of the flowing dots
};

export const STYLES: ArtStyle[] = [
  { id: 'sketch', name: 'Sketch', hint: 'hand-drawn, like the lessons', paper: '#fdfdfa', grid: false, roughness: 1, strokeWidth: 2, font: FONT_FAMILY.Excalifont, fontName: 'Excalifont', ink: '#1f2429', dark: false, fill: 'solid', flow: '#22c55e' },
  { id: 'chalk', name: 'Chalkboard', hint: 'chalk on a green board', paper: '#22322b', grid: false, roughness: 2, strokeWidth: 2, font: FONT_FAMILY.Virgil, fontName: 'Virgil', ink: '#edf1ea', dark: true, fill: 'hachure', flow: '#7cff9b' },
  { id: 'clean', name: 'Clean', hint: 'crisp lines, plain font', paper: '#ffffff', grid: false, roughness: 0, strokeWidth: 2, font: FONT_FAMILY.Nunito, fontName: 'Nunito', ink: '#1e1e1e', dark: false, fill: 'solid', flow: '#16a34a' },
  { id: 'marker', name: 'Marker', hint: 'bold felt-tip, playful', paper: '#fffef5', grid: false, roughness: 2, strokeWidth: 4, font: FONT_FAMILY['Comic Shanns'], fontName: 'Comic Shanns', ink: '#111827', dark: false, fill: 'hachure', flow: '#f97316' },
  { id: 'blueprint', name: 'Blueprint', hint: 'white lines on blueprint blue', paper: '#0b3a75', grid: false, roughness: 0, strokeWidth: 2, font: FONT_FAMILY.Cascadia, fontName: 'Cascadia', ink: '#e0f2fe', dark: true, fill: 'cross-hatch', flow: '#67e8f9' },
  { id: 'notebook', name: 'Notebook', hint: 'blue pen on squared paper', paper: '#ffffff', grid: true, roughness: 1, strokeWidth: 1, font: FONT_FAMILY.Excalifont, fontName: 'Excalifont', ink: '#1d4ed8', dark: false, fill: 'hachure', flow: '#22c55e' },
];

export const styleById = (id?: string | null) => STYLES.find((s) => s.id === id) ?? STYLES[0];

// ── colour helpers ────────────────────────────────────────────────────────────
function rgb(c: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const lum = ([r, g, b]: [number, number, number]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const mix = (a: [number, number, number], b: [number, number, number], t: number) => hex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);

const INKS = new Set(STYLES.map((s) => s.ink.toLowerCase()).concat(['#1e1e1e', '#000000', '#343a40', '#1f2429']));

/** A line or text colour that reads on this style's paper. */
export function inkFor(color: string, st: ArtStyle): string {
  if (INKS.has(color.toLowerCase())) return st.ink;
  const c = rgb(color);
  if (!c) return color;
  const L = lum(c);
  if (st.dark && L < 0.5) return mix(c, [255, 255, 255], 0.55);
  if (!st.dark && L > 0.78) return mix(c, [0, 0, 0], 0.55);
  return color;
}

/** A fill that sits well on this style's paper (soft fills turn into deep tints on dark paper and back). */
export function fillFor(color: string, st: ArtStyle): string {
  if (color === 'transparent') return color;
  const c = rgb(color);
  if (!c) return color;
  const L = lum(c);
  const paper = rgb(st.paper)!;
  if (st.dark && L > 0.6) return mix(c, paper, 0.72);
  if (!st.dark && L < 0.35) return mix(c, [255, 255, 255], 0.8);
  return color;
}

/** Restyle every element and the paper. One undo step. Fonts are loaded first so text is re-measured right. */
export async function applyStyle(api: ExcalidrawImperativeAPI, st: ArtStyle) {
  try { await document.fonts.load(`20px "${st.fontName}"`); } catch { /* measured with what is there */ }
  const els = api.getSceneElementsIncludingDeleted() as readonly El[];
  const restyled = els.map((e) => {
    if (e.isDeleted) return e;
    const up: Record<string, unknown> = { strokeColor: inkFor(e.strokeColor, st) };
    if (e.type !== 'freedraw' && e.type !== 'text' && e.type !== 'image') {
      up.roughness = st.roughness;
      up.strokeWidth = st.strokeWidth;
    }
    if (e.backgroundColor && e.backgroundColor !== 'transparent' && e.type !== 'text') {
      up.backgroundColor = fillFor(e.backgroundColor, st);
      up.fillStyle = st.fill;
    }
    if (e.type === 'text') up.fontFamily = st.font;
    return newElementWith(e as never, up as never);
  });
  // Re-measures every text for its new font (and keeps text inside its box).
  const measured = restoreElements(restyled as never, null, { refreshDimensions: true, repairBindings: true });
  api.updateScene({
    elements: measured,
    appState: {
      viewBackgroundColor: st.paper,
      gridModeEnabled: st.grid,
      currentItemRoughness: st.roughness,
      currentItemStrokeWidth: st.strokeWidth,
      currentItemFontFamily: st.font as never,
      currentItemStrokeColor: st.ink,
      currentItemFillStyle: st.fill,
    } as never,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

// Handwriting → text with Google's handwriting service (the one behind Google's handwriting keyboards).
// It reads the strokes themselves — their order and direction — which works far better for mouse
// writing than reading a picture of it. Needs internet; the strokes (not the board) are sent to Google.
// Works in every browser on Windows, Mac and Linux.

import { type P, bbox } from './geometry';

const ENDPOINT = 'https://inputtools.google.com/request?ime=handwriting&app=mobilesearch&cs=1&oe=UTF-8';

/** Up to `max` points per stroke, evenly picked (keeps the request small). */
function thin(stroke: readonly P[], max = 120): P[] {
  if (stroke.length <= max) return stroke.slice();
  const out: P[] = [];
  for (let i = 0; i < max; i++) out.push(stroke[Math.round((i * (stroke.length - 1)) / (max - 1))]);
  return out;
}

/** Strokes in writing order → candidate texts, best first. Throws when offline or refused. */
export async function readHandwriting(strokes: readonly (readonly P[])[], language = 'en', signal?: AbortSignal): Promise<string[]> {
  const all = strokes.flat();
  if (!all.length) return [];
  const b = bbox(all);
  let t = 0;
  const ink = strokes.map((s) => {
    const xs: number[] = [], ys: number[] = [], ts: number[] = [];
    for (const p of thin(s)) {
      xs.push(Math.round(p.x - b.minX));
      ys.push(Math.round(p.y - b.minY));
      ts.push(t);
      t += 12;
    }
    t += 250;
    return [xs, ys, ts];
  });
  const body = {
    options: 'enable_pre_space',
    requests: [{
      writing_guide: { writing_area_width: Math.max(1, Math.round(b.w)), writing_area_height: Math.max(1, Math.round(b.h)) },
      ink,
      language,
    }],
  };
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`The handwriting service answered ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json) || json[0] !== 'SUCCESS') throw new Error('The handwriting service could not read it');
  const candidates = json?.[1]?.[0]?.[1];
  return Array.isArray(candidates) ? candidates.filter((c: unknown) => typeof c === 'string' && c.trim()) : [];
}

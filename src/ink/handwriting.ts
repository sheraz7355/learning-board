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
  return Array.isArray(candidates) ? preferKnownWords(candidates.filter((c: unknown) => typeof c === 'string' && c.trim())) : [];
}

// ── Spelling: prefer a reading made of known words ───────────────────────────
// Google's reader already favours real words. For learning DSA, its alternatives are also checked against
// the subject's vocabulary: when the top reading has an unknown word but a close alternative (at most two
// letters different) is made only of known words, that one is used.
const VOCAB = new Set(`
array arrays list lists linked node nodes next prev previous null head tail pointer pointers index indexes
stack stacks push pop peek top queue queues enqueue dequeue front rear deque priority heap heaps heapify min max
tree trees binary search bst root leaf leaves parent child children left right subtree height depth level
balanced avl red black trie graph graphs vertex vertices edge edges weight weighted directed undirected
cycle path paths visited bfs dfs breadth depth first traversal inorder preorder postorder level order
sort sorted sorting bubble insertion selection merge quick heap counting radix bucket swap pivot partition
hash hashing table map set key keys value values bucket collision chaining probing
recursion recursive base case call return memo memoization dynamic programming dp greedy backtracking
divide conquer two pointers sliding window prefix sum binary search complexity time space big o log n
loop for while if else true false int string char boolean function method class object
start end begin middle mid low high count size length empty full insert delete remove add find update
first second last new old input output result answer step steps example
the a an and or not of to in on at is are was be it this that with from by as up down
`.trim().split(/\s+/));

const known = (w: string) => /^[0-9.+\-*/=<>()[\]{}%^!?,:;'"]+$/.test(w) || VOCAB.has(w.toLowerCase().replace(/[^a-z]/g, ''));

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/** The candidates with the best-spelled reading first. */
export function preferKnownWords(candidates: string[]): string[] {
  if (candidates.length < 2) return candidates;
  const top = candidates[0];
  const allKnown = (c: string) => c.split(/\s+/).filter(Boolean).every(known);
  if (allKnown(top)) return candidates;
  const better = candidates.slice(1, 6).find((c) => allKnown(c) && editDistance(c, top) <= 2);
  return better ? [better, ...candidates.filter((c) => c !== better)] : candidates;
}

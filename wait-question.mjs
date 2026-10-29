#!/usr/bin/env node
// Waits for a question from the whiteboard page that has no answer yet.
//   node /Users/apple/learning-board/wait-question.mjs [--timeout <seconds>]
// Prints the unanswered questions (oldest first) as one JSON line on stdout and exits 0 —
// at once if some are already waiting. With --timeout, prints [] and exits 2 when time runs out.
// Exit 1 = bad arguments. Plain Node, no dependencies; reads files only, needs no server.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const QUESTIONS = path.join(ROOT, 'questions');
const ANSWERS = path.join(QUESTIONS, 'answers');
const QFILE = path.join(QUESTIONS, 'questions.jsonl');
const QID_RE = /^q-\d{8}-\d{6}-[a-z0-9]{4}$/;
const POLL_MS = 2000;

function usage(code) {
  (code ? process.stderr : process.stdout).write('usage: node wait-question.mjs [--timeout <seconds>]\n');
  process.exit(code);
}

let timeoutS = null;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '-h' || a === '--help') usage(0);
  else if (a === '--timeout') timeoutS = Number(args[++i]);
  else if (a.startsWith('--timeout=')) timeoutS = Number(a.slice('--timeout='.length));
  else usage(1);
}
if (timeoutS !== null && !(Number.isFinite(timeoutS) && timeoutS > 0)) {
  process.stderr.write('wait-question: --timeout needs a number of seconds above 0\n');
  process.exit(1);
}

fs.mkdirSync(ANSWERS, { recursive: true });

function unanswered() {
  let text = '';
  try { text = fs.readFileSync(QFILE, 'utf8'); } catch { return []; }
  const seen = new Set();
  const out = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let q;
    try { q = JSON.parse(s); } catch { continue; } // half-written line: the next check sees it whole
    if (!q || typeof q.id !== 'string' || !QID_RE.test(q.id) || seen.has(q.id)) continue;
    seen.add(q.id);
    if (!fs.existsSync(path.join(ANSWERS, q.id + '.json'))) out.push(q);
  }
  return out;
}

let watcher = null;
let poll = null;
let timer = null;
let debounce = null;
let done = false;

function finish(list, code) {
  if (done) return;
  done = true;
  clearInterval(poll);
  clearTimeout(timer);
  clearTimeout(debounce);
  try { watcher && watcher.close(); } catch { /* ignore */ }
  process.stdout.write(JSON.stringify(list) + '\n', () => process.exit(code));
}

function check() {
  if (done) return;
  const list = unanswered();
  if (list.length) finish(list, 0);
}

check();
if (!done) {
  try {
    watcher = fs.watch(QUESTIONS, () => {
      clearTimeout(debounce);
      debounce = setTimeout(check, 100);
    });
    watcher.on('error', () => { /* the poll below still runs */ });
  } catch { /* no watcher: the poll is enough */ }
  poll = setInterval(check, POLL_MS);
  if (timeoutS !== null) timer = setTimeout(() => finish([], 2), timeoutS * 1000);
}

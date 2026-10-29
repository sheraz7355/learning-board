#!/usr/bin/env node
// Writes the answer to a question asked on the whiteboard page; the open page shows it live.
//   node /Users/apple/learning-board/answer.mjs <question id> [--lesson <lesson id>] < answer.txt
// The answer text comes on stdin (plain text, line breaks kept). --lesson adds an "Open lesson"
// button for lessons/<lesson id>.json. Writing again replaces the earlier answer.
// Exit 0 = written, 1 = refused (bad arguments, unknown question id, empty answer).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const LESSONS = path.join(ROOT, 'lessons');
const QUESTIONS = path.join(ROOT, 'questions');
const ANSWERS = path.join(QUESTIONS, 'answers');
const QFILE = path.join(QUESTIONS, 'questions.jsonl');
const QID_RE = /^q-\d{8}-\d{6}-[a-z0-9]{4}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

function fail(msg) {
  process.stderr.write(`answer: ${msg}\n`);
  process.exit(1);
}
const USAGE = 'usage: node answer.mjs <question id> [--lesson <lesson id>] < answer-text';

let id = null;
let lesson = null;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '-h' || a === '--help') { process.stdout.write(USAGE + '\n'); process.exit(0); }
  else if (a === '--lesson') { lesson = args[++i]; if (lesson === undefined) fail('--lesson needs a lesson id\n' + USAGE); }
  else if (a.startsWith('--lesson=')) lesson = a.slice('--lesson='.length);
  else if (a.startsWith('-')) fail(`unknown option ${a}\n${USAGE}`);
  else if (id === null) id = a;
  else fail(`one question id only\n${USAGE}`);
}
if (!id) fail(USAGE);
if (!QID_RE.test(id)) fail(`"${id}" is not a question id (q-yyyymmdd-hhmmss-xxxx)`);
if (lesson !== null && lesson !== '' && !ID_RE.test(lesson)) fail(`"${lesson}" is not a lesson id (file name without .json)`);
if (lesson === '') lesson = null;

// The question must exist.
let known = false;
try {
  for (const line of fs.readFileSync(QFILE, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { if (JSON.parse(s).id === id) { known = true; break; } } catch { /* skip a broken line */ }
  }
} catch { /* no questions file yet */ }
if (!known) fail(`unknown question id ${id} (not in questions/questions.jsonl)`);

if (process.stdin.isTTY) fail('pipe the answer text on stdin, e.g. node answer.mjs ' + id + " <<'EOF' … EOF");
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const text = Buffer.concat(chunks).toString('utf8').replace(/\r\n?/g, '\n').trim();
if (!text) fail('the answer text is empty');

fs.mkdirSync(ANSWERS, { recursive: true });
const final = path.join(ANSWERS, id + '.json');
const replaced = fs.existsSync(final);
const tmp = path.join(ANSWERS, `.${id}.json.tmp-${process.pid}`);
const obj = { text, ...(lesson ? { lesson } : {}), at: new Date().toISOString() };
try {
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, final);
} catch (e) {
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  fail('could not write the answer: ' + (e.message || e));
}
if (lesson && !fs.existsSync(path.join(LESSONS, lesson + '.json'))) {
  process.stderr.write(`answer: note: lessons/${lesson}.json does not exist yet; the page shows "Open lesson" once it does\n`);
}
process.stdout.write(`${replaced ? 'replaced the answer to' : 'answered'} ${id}${lesson ? ` (lesson ${lesson})` : ''}\n`);

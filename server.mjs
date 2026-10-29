// Learning Board's local server. Plain Node (no packages), the same on Windows, Mac and Linux.
//   npm start            builds the app, then runs this and opens the browser
//   node server.mjs      runs it (after `npm run build`)
// Serves: the app (dist/) at /, the lesson player at /player/, the lessons (lessons/*.json) with live
// updates (/events), and the questions channel. Listens on 127.0.0.1 only (this computer).
// Port: WB_PORT (default 4747). NO_OPEN=1 skips opening the browser.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
const PLAYER = path.join(ROOT, 'player');
const LESSONS = path.join(ROOT, 'lessons');
const QUESTIONS = path.join(ROOT, 'questions');
const ANSWERS = path.join(QUESTIONS, 'answers');
const QFILE_NAME = 'questions.jsonl';
const QFILE = path.join(QUESTIONS, QFILE_NAME);
const PORT = Number(process.env.WB_PORT) || 4747;
const HOST = '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

// Only files inside dist/ (the built app) and player/ (the lesson player) are served.

// A lesson id is a plain file name without .json: letters, digits, dot, dash, underscore.
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const isLessonFile = (name) =>
  name.endsWith('.json') && !name.startsWith('.') && !name.startsWith('~') && ID_RE.test(name.slice(0, -5));

// A question id: q-<yyyymmdd-hhmmss>-<4 random chars>. Answer files are answers/<question id>.json.
const QID_RE = /^q-\d{8}-\d{6}-[a-z0-9]{4}$/;
const isAnswerFile = (name) => name.endsWith('.json') && QID_RE.test(name.slice(0, -5));
const MAX_QUESTION_CHARS = 2000;
const MAX_BODY_BYTES = 64 * 1024;

fs.mkdirSync(LESSONS, { recursive: true });
fs.mkdirSync(ANSWERS, { recursive: true });
fs.closeSync(fs.openSync(QFILE, 'a')); // create questions.jsonl if missing, never truncate

function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(body);
}
const sendJson = (res, status, obj, extra) => send(res, status, JSON.stringify(obj), TYPES['.json'], extra);

async function listLessons() {
  const names = (await fsp.readdir(LESSONS)).filter(isLessonFile);
  const rows = await Promise.all(names.map(async (name) => {
    const file = path.join(LESSONS, name);
    try {
      const [stat, text] = await Promise.all([fsp.stat(file), fsp.readFile(file, 'utf8')]);
      let title = null;
      let error = null;
      try {
        const j = JSON.parse(text);
        title = typeof j.title === 'string' && j.title.trim() ? j.title.trim() : null;
      } catch (e) {
        error = 'not valid JSON';
      }
      return { id: name.slice(0, -5), title: title || name.slice(0, -5), mtime: stat.mtimeMs, error };
    } catch {
      return null; // vanished between readdir and stat
    }
  }));
  return rows.filter(Boolean).sort((a, b) => b.mtime - a.mtime || b.id.localeCompare(a.id));
}

// ---- Questions from the page ----
const pad = (n) => String(n).padStart(2, '0');
function newQuestionId(d) {
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const rnd = [...crypto.randomBytes(4)].map((b) => abc[b % abc.length]).join('');
  return `q-${stamp}-${rnd}`;
}

// All questions in file order (oldest first). Lines that do not parse are skipped.
async function readQuestions() {
  let text = '';
  try { text = await fsp.readFile(QFILE, 'utf8'); } catch { return []; }
  const seen = new Set();
  const out = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const q = JSON.parse(s);
      if (!q || typeof q.id !== 'string' || !QID_RE.test(q.id) || seen.has(q.id)) continue;
      seen.add(q.id);
      out.push(q);
    } catch { /* a half-written or hand-broken line */ }
  }
  return out;
}

async function readAnswer(id) {
  try {
    const a = JSON.parse(await fsp.readFile(path.join(ANSWERS, id + '.json'), 'utf8'));
    if (!a || typeof a.text !== 'string') return null;
    return {
      text: a.text,
      lesson: typeof a.lesson === 'string' && ID_RE.test(a.lesson) ? a.lesson : null,
      at: typeof a.at === 'string' ? a.at : null,
    };
  } catch {
    return null;
  }
}

async function listQuestions() {
  const all = await readQuestions();
  const newest = all.map((q, i) => ({ q, i }))
    .sort((a, b) => String(b.q.at).localeCompare(String(a.q.at)) || b.i - a.i)
    .slice(0, 50)
    .map((x) => x.q);
  return Promise.all(newest.map(async (q) => ({ ...q, answer: await readAnswer(q.id) })));
}

// Only the page itself may post: same host names, same origin, JSON body (a cross-site form or
// fetch cannot send that without a preflight this server never approves).
const OK_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const OK_ORIGINS = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);
const LOOPBACK = new Set(['127.0.0.1', '::ffff:127.0.0.1', '::1']);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

let appendChain = Promise.resolve();
const appendLine = (line) => (appendChain = appendChain.then(() => fsp.appendFile(QFILE, line, 'utf8')));

async function postQuestion(req, res) {
  if (!LOOPBACK.has(req.socket.remoteAddress)) return sendJson(res, 403, { error: 'local only' });
  const origin = req.headers.origin;
  if (origin && !OK_ORIGINS.has(origin)) return sendJson(res, 403, { error: 'wrong origin' });
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return sendJson(res, 415, { error: 'send JSON' });

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (e) {
    return sendJson(res, e && e.status === 413 ? 413 : 400, { error: e && e.status === 413 ? 'too large' : 'body is not JSON' });
  }
  if (!body || typeof body !== 'object' || typeof body.text !== 'string') return sendJson(res, 400, { error: 'text is required' });
  const text = body.text.replace(/\r\n?/g, '\n').trim();
  const chars = [...text].length;
  if (chars < 1) return sendJson(res, 400, { error: 'the question is empty' });
  if (chars > MAX_QUESTION_CHARS) return sendJson(res, 400, { error: `the question is longer than ${MAX_QUESTION_CHARS} characters` });
  const lesson = typeof body.lesson === 'string' && ID_RE.test(body.lesson) ? body.lesson : null;
  const step = Number.isInteger(body.step) && body.step >= 1 && body.step <= 1000 ? body.step : null;

  const now = new Date();
  const q = { id: newQuestionId(now), at: now.toISOString(), text, lesson, step };
  try {
    await appendLine(JSON.stringify(q) + '\n');
  } catch (e) {
    return sendJson(res, 500, { error: 'could not save: ' + String(e.message || e) });
  }
  sendJson(res, 201, q);
  broadcast({ type: 'question', id: q.id });
}

// ---- Server-Sent Events ----
const clients = new Set();
function broadcast(obj) {
  const line = `data: ${JSON.stringify(obj)}\n\n`;
  for (const res of clients) res.write(line);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000).unref();

// ---- Watch lessons/ (debounced per file) ----
const timers = new Map();
function debounce(key, fn) {
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => { timers.delete(key); fn(); }, 150));
}
fs.watch(LESSONS, (event, filename) => {
  if (!filename) return;
  const name = String(filename);
  if (!isLessonFile(name)) return;
  debounce('l:' + name, () => {
    const id = name.slice(0, -5);
    fs.stat(path.join(LESSONS, name), (err) => {
      broadcast(err ? { type: 'removed', id } : { type: 'lesson', id });
    });
  });
});

// ---- Watch questions/answers/ (an answer was written, replaced or removed) ----
fs.watch(ANSWERS, (event, filename) => {
  if (!filename) return;
  const name = String(filename);
  if (!isAnswerFile(name)) return; // temp files (.x.json.tmp-123) are ignored
  debounce('a:' + name, () => {
    const id = name.slice(0, -5);
    fs.stat(path.join(ANSWERS, name), (err) => {
      broadcast(err ? { type: 'answer-removed', id } : { type: 'answer', id });
    });
  });
});

// ---- Watch questions.jsonl itself (edited or cleaned up outside the page) ----
fs.watch(QUESTIONS, (event, filename) => {
  if (!filename || String(filename) !== QFILE_NAME) return;
  debounce('q', () => broadcast({ type: 'questions' }));
});

const server = http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }
  if (pathname.includes('\0') || pathname.includes('..')) return send(res, 400, 'Bad path');

  if (pathname === '/api/questions') {
    if (!OK_HOSTS.has(req.headers.host || '')) return sendJson(res, 403, { error: 'wrong host' });
    if (req.method === 'POST') return postQuestion(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method not allowed' }, { Allow: 'GET, HEAD, POST' });
    try {
      return sendJson(res, 200, await listQuestions());
    } catch (e) {
      return sendJson(res, 500, { error: String(e.message || e) });
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');

  if (pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');
    res.write(`data: ${JSON.stringify({ type: 'hello' })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (pathname === '/api/lessons') {
    try {
      return send(res, 200, JSON.stringify(await listLessons()), TYPES['.json']);
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: String(e.message || e) }), TYPES['.json']);
    }
  }

  if (pathname.startsWith('/api/lessons/')) {
    const id = pathname.slice('/api/lessons/'.length);
    if (!ID_RE.test(id)) return send(res, 400, JSON.stringify({ error: 'bad id' }), TYPES['.json']);
    const file = path.join(LESSONS, id + '.json');
    if (path.dirname(file) !== LESSONS) return send(res, 400, JSON.stringify({ error: 'bad id' }), TYPES['.json']);
    try {
      // Sent as text: the page parses it, so a broken file can still show a readable error.
      return send(res, 200, await fsp.readFile(file, 'utf8'), TYPES['.json']);
    } catch {
      return send(res, 404, JSON.stringify({ error: 'not found' }), TYPES['.json']);
    }
  }

  // The lesson player (the original whiteboard page).
  if (pathname === '/player') return send(res, 301, '', 'text/plain', { Location: '/player/' });
  if (pathname.startsWith('/player/')) return serveFile(res, PLAYER, pathname.slice('/player'.length) || '/', false);

  // The app. Unknown paths without a file extension get the app itself (it is one page).
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    return send(res, 503, 'The app is not built yet. Run: npm run build   (or npm start)');
  }
  return serveFile(res, DIST, pathname, true);
});

async function serveFile(res, base, rel, spa) {
  let file = path.join(base, rel === '/' ? 'index.html' : rel);
  if (file !== base && !file.startsWith(base + path.sep)) return send(res, 400, 'Bad path');
  try {
    const st = await fsp.stat(file);
    if (st.isDirectory()) file = path.join(file, 'index.html');
  } catch {
    if (!spa || path.extname(rel)) return send(res, 404, 'Not found');
    file = path.join(base, 'index.html');
  }
  try {
    const body = await fsp.readFile(file);
    // Files under assets/ carry a content hash in their name: they can be kept for a year.
    const immutable = base === DIST && file.startsWith(path.join(DIST, 'assets') + path.sep);
    const fonts = base === DIST && file.startsWith(path.join(DIST, 'fonts') + path.sep);
    const extra = immutable || fonts ? { 'Cache-Control': 'public, max-age=31536000, immutable' } : {};
    return send(res, 200, body, TYPES[path.extname(file)] || 'application/octet-stream', extra);
  } catch {
    return send(res, 404, 'Not found');
  }
}

function openBrowser(url) {
  if (process.env.NO_OPEN) return;
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    const child = spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true, windowsVerbatimArguments: process.platform === 'win32' });
    child.on('error', () => {});
    child.unref();
  } catch { /* no browser to open: the address is printed */ }
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`Learning Board is already running: http://localhost:${PORT}`);
    openBrowser(`http://localhost:${PORT}`);
    process.exit(0);
  }
  throw e;
});

server.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Learning Board: ${url}   (Ctrl+C to stop)`);
  console.log(`  lessons:  ${LESSONS}`);
  console.log(`  player:   ${url}/player/`);
  openBrowser(url);
});

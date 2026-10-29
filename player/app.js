// app.js — lesson list, live updates (SSE), step controls. Drawing lives in board.js.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const board = new WB.Board($('board'));
  WB.current = board; // handy from the console: WB.current.check() lists overlaps
  const state = {
    list: [], currentId: null, step: 0, steps: [], text: null,
    playing: false, timer: 0, fresh: new Set(), seen: new Set(), token: 0, fontsLate: false,
  };

  // ------------------------------------------------------------ fonts first, so text is measured right
  function fontsReady() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    const all = Promise.all([
      document.fonts.load('700 26px Caveat'),
      document.fonts.load('400 15px "Atkinson Hyperlegible"'),
      document.fonts.load('700 23px "Atkinson Hyperlegible"'),
    ]).then(() => true, () => true);
    const timeout = new Promise((r) => setTimeout(() => r(false), 2500));
    return Promise.race([all, timeout]).then((done) => {
      if (!done) {
        state.fontsLate = true;
        all.then(() => { if (state.currentId && state.fontsLate) { state.fontsLate = false; state.text = null; openLesson(state.currentId, { step: state.step }); } });
      }
    });
  }

  // ------------------------------------------------------------ lesson list
  const relTime = (ms) => {
    const s = (Date.now() - ms) / 1000;
    if (s < 45) return 'just now';
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  async function refreshList() {
    try {
      const r = await fetch('/api/lessons', { cache: 'no-store' });
      if (r.ok) state.list = await r.json();
    } catch { /* server away; keep the old list */ }
    renderList();
    renderThread(); // lesson titles and "Open lesson" buttons depend on the list
    return state.list;
  }

  function renderList() {
    const ul = $('lessonList'), sel = $('lessonSelect');
    ul.textContent = ''; sel.textContent = '';
    if (!state.list.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No lessons yet. Put a .json file in lessons/.';
      ul.appendChild(li);
      const o = document.createElement('option');
      o.textContent = 'No lessons yet'; sel.appendChild(o);
      return;
    }
    for (const l of state.list) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.id = l.id;
      if (l.id === state.currentId) b.setAttribute('aria-current', 'true');
      const t = document.createElement('span'); t.className = 't'; t.textContent = l.title;
      const m = document.createElement('span'); m.className = 'm';
      if (state.fresh.has(l.id)) { const n = document.createElement('span'); n.className = 'badge-new'; n.textContent = 'new'; m.appendChild(n); }
      if (l.error) { const e = document.createElement('span'); e.className = 'badge-bad'; e.textContent = 'broken file'; m.appendChild(e); }
      m.appendChild(document.createTextNode(relTime(l.mtime)));
      b.append(t, m);
      b.addEventListener('click', (ev) => { if (ev.detail) b.blur(); manualOpen(l.id); });
      li.appendChild(b); ul.appendChild(li);

      const o = document.createElement('option');
      o.value = l.id;
      o.textContent = (state.fresh.has(l.id) ? '(new) ' : '') + l.title;
      sel.appendChild(o);
    }
    if (state.currentId) sel.value = state.currentId;
  }

  function manualOpen(id, step) {
    if (state.currentId && state.currentId !== id) state.fresh.delete(state.currentId);
    state.fresh.delete(id);
    stopPlay();
    if (id === state.currentId && state.text !== null) { renderList(); goTo(step || 0); return; }
    openLesson(id, { step: step || 0 });
  }
  $('lessonSelect').addEventListener('change', (e) => { if (e.target.value) manualOpen(e.target.value); });

  // ------------------------------------------------------------ opening a lesson
  function showError(id, text, detail) {
    stopPlay();
    board.stopFlows();
    $('title').textContent = id;
    $('oneLine').textContent = '';
    $('errorText').textContent = text;
    $('errorDetail').textContent = detail || '';
    $('errorPanel').hidden = false;
    $('boardWrap').hidden = true;
    $('warnings').hidden = true;
    document.querySelector('.narration').hidden = true;
  }

  async function openLesson(id, opts = {}) {
    const token = ++state.token;
    let text;
    try {
      const r = await fetch('/api/lessons/' + encodeURIComponent(id), { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status === 404 ? 'The file is not there (it may have been renamed or removed).' : 'HTTP ' + r.status);
      text = await r.text();
    } catch (e) {
      if (token !== state.token) return;
      state.currentId = id; renderList();
      showError(id, 'Could not load this lesson.', e.message);
      return;
    }
    if (token !== state.token) return;
    const same = id === state.currentId && text === state.text;
    state.currentId = id;
    state.text = text;
    renderList();
    if (same) return;

    const res = WB.parseLesson(text, id);
    if (!res.ok) {
      showError(id, `The file lessons/${id}.json is not valid JSON, so it cannot be drawn. Fix the file and it will reload here by itself.`, res.error);
      return;
    }
    const { lesson, warnings } = res;
    $('errorPanel').hidden = true;
    $('boardWrap').hidden = false;
    document.querySelector('.narration').hidden = false;
    $('title').textContent = lesson.title;
    $('oneLine').textContent = lesson.oneLine;
    document.title = lesson.title + ' · Whiteboard';

    const w = $('warnings');
    w.hidden = !warnings.length;
    $('warnSummary').textContent = warnings.length === 1 ? '1 note about this lesson file' : `${warnings.length} notes about this lesson file`;
    const wl = $('warnList'); wl.textContent = '';
    for (const msg of warnings) { const li = document.createElement('li'); li.textContent = msg; wl.appendChild(li); }

    board.load(lesson);
    state.steps = lesson.steps;
    state.seen = new Set();
    buildDots();
    goTo(opts.step || 0, { keepPlay: opts.keepPlay });
  }

  // ------------------------------------------------------------ steps
  function buildDots() {
    const box = $('dots'); box.textContent = '';
    state.steps.forEach((_, i) => {
      const d = document.createElement('button');
      d.type = 'button'; d.className = 'dot'; d.setAttribute('aria-label', `Step ${i + 1}`);
      d.addEventListener('click', (ev) => { if (ev.detail) d.blur(); userStep(i); });
      box.appendChild(d);
    });
    box.hidden = state.steps.length < 2;
  }

  function goTo(k, opts = {}) {
    if (!state.steps.length) return;
    k = board.setStep(k);
    state.step = k;
    state.seen.add(k);
    const n = state.steps.length;
    $('say').textContent = state.steps[k].say || '';
    $('stepCount').textContent = `Step ${k + 1} of ${n}`;
    $('backBtn').disabled = k === 0;
    $('nextBtn').disabled = k === n - 1;
    $('playBtn').disabled = n < 2;
    [...$('dots').children].forEach((d, i) => {
      if (i === k) d.setAttribute('aria-current', 'step'); else d.removeAttribute('aria-current');
      d.classList.toggle('seen', state.seen.has(i) && i !== k);
    });
    try { history.replaceState(null, '', `#${encodeURIComponent(state.currentId)}/${k + 1}`); } catch { /* ignore */ }
    if (state.playing && !opts.keepPlay) schedule();
  }

  function userStep(k) {
    if (state.currentId) state.fresh.delete(state.currentId);
    goTo(k);
  }
  const next = () => { if (state.step < state.steps.length - 1) userStep(state.step + 1); };
  const prev = () => { if (state.step > 0) userStep(state.step - 1); };

  // ------------------------------------------------------------ play
  function stepMs(k) {
    const words = (state.steps[k] && state.steps[k].say ? state.steps[k].say.split(/\s+/).length : 0);
    return Math.max(6000, words * 290);
  }
  function schedule() {
    clearTimeout(state.timer);
    const ms = stepMs(state.step);
    const bar = $('timer');
    bar.style.setProperty('--play-ms', ms + 'ms');
    bar.classList.remove('on'); void bar.offsetWidth; bar.classList.add('on');
    state.timer = setTimeout(() => {
      if (!state.playing) return;
      if (state.step >= state.steps.length - 1) { stopPlay(); return; }
      goTo(state.step + 1, { keepPlay: true });
      if (state.step >= state.steps.length - 1) stopPlay(); else schedule();
    }, ms);
  }
  function startPlay() {
    if (state.steps.length < 2) return;
    state.playing = true;
    $('playBtn').textContent = 'Pause'; $('playBtn').setAttribute('aria-pressed', 'true');
    if (state.step >= state.steps.length - 1) goTo(0, { keepPlay: true });
    schedule();
  }
  function stopPlay() {
    state.playing = false;
    clearTimeout(state.timer);
    $('timer').classList.remove('on');
    $('playBtn').textContent = 'Play'; $('playBtn').setAttribute('aria-pressed', 'false');
  }
  const togglePlay = () => (state.playing ? stopPlay() : startPlay());

  $('nextBtn').addEventListener('click', (e) => { if (e.detail) e.currentTarget.blur(); next(); });
  $('backBtn').addEventListener('click', (e) => { if (e.detail) e.currentTarget.blur(); prev(); });
  $('playBtn').addEventListener('click', (e) => { if (e.detail) e.currentTarget.blur(); togglePlay(); });

  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    else if (e.key === ' ' || e.code === 'Space') {
      if (tag === 'BUTTON' || tag === 'SUMMARY') return; // a focused control keeps its own Space
      e.preventDefault(); togglePlay();
    }
  });

  // ------------------------------------------------------------ theme
  const themeBtn = $('themeBtn');
  const themes = ['auto', 'light', 'dark'];
  const curTheme = () => document.documentElement.dataset.theme || 'auto';
  themeBtn.textContent = 'Theme: ' + curTheme();
  themeBtn.addEventListener('click', () => {
    const t = themes[(themes.indexOf(curTheme()) + 1) % themes.length];
    if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
    try { if (t === 'auto') localStorage.removeItem('wb-theme'); else localStorage.setItem('wb-theme', t); } catch { /* ignore */ }
    themeBtn.textContent = 'Theme: ' + t;
  });

  // ------------------------------------------------------------ live updates
  function setStatus(live) {
    const s = $('status');
    s.classList.toggle('live', live);
    s.textContent = live ? 'live' : 'offline';
  }

  async function onLessonEvent(id) {
    const known = state.list.some((l) => l.id === id);
    const list = await refreshList();
    if (id === state.currentId) { await openLesson(id, { step: state.step, keepPlay: true }); return; }
    if (!known || (list[0] && list[0].id === id)) {
      if (state.currentId) state.fresh.delete(state.currentId);
      state.fresh.add(id);
      stopPlay();
      await openLesson(id, { step: 0 });
    }
  }

  async function onRemoved(id) {
    state.fresh.delete(id);
    const list = await refreshList();
    if (id !== state.currentId) return;
    stopPlay();
    state.text = null;
    if (list.length) openLesson(list[0].id, { step: 0 });
    else { state.currentId = null; board.stopFlows(); $('errorPanel').hidden = true; $('warnings').hidden = true; showEmpty(); }
  }

  function connect() {
    let es;
    try { es = new EventSource('/events'); } catch { setStatus(false); return; }
    let opened = false;
    es.onopen = () => { setStatus(true); if (opened) { refreshList(); refreshQuestions(); } opened = true; };
    es.onerror = () => setStatus(false);
    es.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'lesson' && msg.id) onLessonEvent(msg.id);
      else if (msg.type === 'removed') onRemoved(msg.id);
      else if (msg.type === 'answer' && msg.id) onAnswer(msg.id);
      else if (msg.type === 'question' || msg.type === 'questions' || msg.type === 'answer-removed') refreshQuestions();
    };
  }

  // ------------------------------------------------------------ questions from the page
  // Questions go to questions/questions.jsonl through the server; the chat agent answers them into
  // questions/answers/<id>.json and the server's 'answer' event brings the answer here.
  // Question and answer text is always set with textContent, never as HTML.
  const ask = { questions: [], sending: false, busy: null, again: false, flashId: null, flashAt: 0, flashTimer: 0, oldServer: false };
  const DRAFT_KEY = 'wb-ask-draft';
  const askText = $('askText'), askSend = $('askSend'), thread = $('thread');
  const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const lessonTitle = (id) => { const l = state.list.find((x) => x.id === id); return l ? l.title : id; };
  const lessonExists = (id) => state.list.some((l) => l.id === id);

  function fmtWhen(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const t = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return d.toDateString() === new Date().toDateString() ? t : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + t;
  }

  function setAskStatus(text, bad) {
    const s = $('askStatus');
    s.textContent = text || '';
    s.classList.toggle('bad', !!bad);
  }
  function updateSend() { askSend.disabled = ask.sending || !askText.value.trim(); }
  function saveDraft(v) {
    try { if (v) localStorage.setItem(DRAFT_KEY, v); else localStorage.removeItem(DRAFT_KEY); } catch { /* storage blocked: the draft just is not kept */ }
  }

  function renderThread() {
    const active = document.activeElement;
    const focusKey = active && active !== thread && thread.contains(active) ? active.dataset.key : null;
    thread.textContent = '';
    for (const q of ask.questions) {
      const li = document.createElement('li');
      li.className = 'qa'; li.dataset.id = q.id;

      const qt = document.createElement('p'); qt.className = 'q-text'; qt.textContent = q.text;
      const meta = [];
      if (q.lesson) meta.push('on ' + lessonTitle(q.lesson));
      if (q.step) meta.push('step ' + q.step);
      const when = fmtWhen(q.at); if (when) meta.push(when);
      const qm = document.createElement('p'); qm.className = 'q-meta'; qm.textContent = meta.join(' · ');
      li.append(qt, qm);

      const a = document.createElement('div'); a.className = 'a';
      if (q.answer) {
        const at = document.createElement('p'); at.className = 'a-text'; at.textContent = q.answer.text;
        a.appendChild(at);
        const aw = q.answer.at ? fmtWhen(q.answer.at) : '';
        if (aw) { const am = document.createElement('p'); am.className = 'a-meta'; am.textContent = 'Claude · ' + aw; a.appendChild(am); }
        const target = q.answer.lesson;
        if (target && lessonExists(target)) {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'btn small'; b.dataset.key = 'open:' + q.id;
          b.textContent = 'Open lesson: ' + lessonTitle(target);
          b.addEventListener('click', (ev) => openFromAnswer(target, ev));
          a.appendChild(b);
        }
      } else {
        a.classList.add('waiting');
        a.append('Waiting for Claude');
        const dots = document.createElement('span'); dots.className = 'wait-dots'; dots.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < 3; i++) { const s = document.createElement('span'); s.textContent = '.'; dots.appendChild(s); }
        a.appendChild(dots);
      }
      li.appendChild(a);
      if (q.id === ask.flashId) {
        li.classList.add('flash');
        li.style.animationDelay = -(Date.now() - ask.flashAt) + 'ms'; // a re-render continues the highlight, not restarts it
      }
      thread.appendChild(li);
    }
    if (focusKey) {
      const el = [...thread.querySelectorAll('[data-key]')].find((x) => x.dataset.key === focusKey);
      if (el) el.focus({ preventScroll: true });
    }
  }

  function openFromAnswer(id, ev) {
    if (!lessonExists(id)) return;
    manualOpen(id);
    const head = document.querySelector('.lesson-head');
    head.scrollIntoView({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' });
    if (ev && ev.detail === 0) { // keyboard: take focus to the lesson as well
      const t = $('title');
      t.setAttribute('tabindex', '-1');
      t.focus({ preventScroll: true });
    }
  }

  function refreshQuestions() {
    if (ask.busy) { ask.again = true; return ask.busy; }
    ask.busy = (async () => {
      do {
        ask.again = false;
        try {
          const r = await fetch('/api/questions', { cache: 'no-store' });
          if (r.ok) {
            const j = await r.json();
            if (Array.isArray(j)) ask.questions = j;
            ask.oldServer = false;
          } else if (r.status === 404 || r.status === 405) {
            ask.oldServer = true;
          }
        } catch { /* server away; keep the old thread */ }
      } while (ask.again);
      ask.busy = null;
      renderThread();
      if (ask.oldServer) setAskStatus('The whiteboard server is running old code: restart it to ask questions here.', true);
      else if ($('askStatus').textContent.startsWith('The whiteboard server is running old code')) setAskStatus('');
    })();
    return ask.busy;
  }

  function flash(id) {
    ask.flashId = id; ask.flashAt = Date.now();
    clearTimeout(ask.flashTimer);
    ask.flashTimer = setTimeout(() => {
      ask.flashId = null;
      for (const li of thread.querySelectorAll('.qa.flash')) { li.classList.remove('flash'); li.style.animationDelay = ''; }
    }, 2700);
    const li = [...thread.children].find((x) => x.dataset.id === id);
    if (!li) return;
    li.classList.remove('flash'); void li.offsetWidth; li.style.animationDelay = '0ms'; li.classList.add('flash');
    // Bring it into view inside the thread only; never scroll the page away from the board.
    if (li.offsetTop < thread.scrollTop || li.offsetTop + li.offsetHeight > thread.scrollTop + thread.clientHeight) {
      thread.scrollTop = Math.max(0, li.offsetTop - 4);
    }
  }

  async function onAnswer(id) {
    await refreshQuestions();
    const q = ask.questions.find((x) => x.id === id);
    if (!q || !q.answer) return;
    // The answer may name a lesson written a moment ago: make sure the list knows it (re-renders the thread).
    // The board itself is not switched here; the lesson's own event already does that for a new lesson.
    if (q.answer.lesson && !lessonExists(q.answer.lesson)) await refreshList();
    flash(id);
    $('askLive').textContent = 'Claude answered: ' + (q.text.length > 80 ? q.text.slice(0, 80) + '…' : q.text);
  }

  async function sendQuestion() {
    const text = askText.value.trim();
    if (!text || ask.sending) return;
    const hadFocus = $('askForm').contains(document.activeElement);
    const showing = !!state.currentId && !$('boardWrap').hidden && state.steps.length > 0;
    const payload = { text, lesson: state.currentId || null, step: showing ? state.step + 1 : null };
    ask.sending = true; askText.readOnly = true; updateSend();
    setAskStatus('Sending…');
    try {
      let r;
      try {
        r = await fetch('/api/questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      } catch {
        throw new Error('the whiteboard server is not reachable.');
      }
      let body = null;
      try { body = await r.json(); } catch { /* not JSON */ }
      if (r.status === 404 || r.status === 405) { ask.oldServer = true; throw new Error('the server is running old code. Restart it, then send again.'); }
      if (!r.ok) throw new Error(body && body.error ? body.error : 'the server answered ' + r.status + '.');
      askText.value = ''; saveDraft('');
      setAskStatus('');
      if (body && body.id && !ask.questions.some((q) => q.id === body.id)) ask.questions.unshift({ ...body, answer: null });
      renderThread();
      thread.scrollTop = 0;
      refreshQuestions();
    } catch (e) {
      setAskStatus('Not sent: ' + (e.message || 'something went wrong.'), true);
    } finally {
      ask.sending = false; askText.readOnly = false; updateSend();
      if (hadFocus) askText.focus();
    }
  }

  askText.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return; // 229: an input method is composing
    if (e.shiftKey || e.altKey) return; // a new line
    e.preventDefault(); // Enter, Cmd+Enter and Ctrl+Enter all send
    sendQuestion();
  });
  askText.addEventListener('input', () => {
    updateSend();
    saveDraft(askText.value);
    if ($('askStatus').classList.contains('bad') && !ask.oldServer) setAskStatus('');
  });
  $('askForm').addEventListener('submit', (e) => { e.preventDefault(); sendQuestion(); });
  try { const d = localStorage.getItem(DRAFT_KEY); if (d) askText.value = d; } catch { /* no storage */ }
  updateSend();

  // ------------------------------------------------------------ start
  function fromHash(list) {
    const m = location.hash.match(/^#([^/]+)(?:\/(\d+))?$/);
    if (!m) return null;
    let want;
    try { want = decodeURIComponent(m[1]); } catch { return null; }
    return list.some((l) => l.id === want) ? { id: want, step: m[2] ? Number(m[2]) - 1 : 0 } : null;
  }

  window.addEventListener('hashchange', () => {
    const h = fromHash(state.list);
    if (!h) return;
    stopPlay();
    if (h.id === state.currentId) goTo(h.step); else manualOpen(h.id, h.step);
  });

  (async function start() {
    await fontsReady();
    const list = await refreshList();
    const h = fromHash(list);
    let id = h ? h.id : null;
    const step = h ? h.step : 0;
    if (!id && list.length) id = list[0].id;
    refreshQuestions();
    if (id) await openLesson(id, { step });
    else showEmpty();
    connect();
    setInterval(renderList, 60000);
  })();

  function showEmpty() {
    $('title').textContent = 'No lessons yet';
    $('oneLine').textContent = 'Drop a lesson .json file into the lessons/ folder and it appears here.';
    $('boardWrap').hidden = true;
    document.querySelector('.narration').hidden = true;
  }
})();

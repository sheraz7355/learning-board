import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaptureUpdateAction, Excalidraw, getSceneVersion, MainMenu, WelcomeScreen } from '@excalidraw/excalidraw';
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';
import type { El } from './board/elements';
import { perfectStrokes, replaceText, straightenStrokes, strokesToText, type PerfectResult } from './board/inkActions';
import { useSmartInk } from './board/useSmartInk';
import {
  blankBoard, boardFromFile, boardToFile, deleteBoard, download, getBoard, lastBoardId, listBoards, rememberLast, saveBoard,
  type Board, type BoardMeta,
} from './board/storage';
import { fetchLesson, fetchLessons, fontsReady, lessonToBoard, type LessonRow } from './board/lessons';
import { FlowLayer } from './learn/FlowLayer';
import { Player } from './learn/Player';
import { flowsAlways, isCover, maxStep, setLearning, stepOf, withAttached } from './learn/steps';
import { BoardsPanel, HelpPanel, StepsPanel } from './ui/Panels';
import { SmartBar, type Selection } from './ui/SmartBar';

type Panel = 'none' | 'boards' | 'steps' | 'help';

const pref = (k: string, d: boolean) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } };
const setPref = (k: string, v: boolean) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* private mode */ } };

export default function App() {
  const [board, setBoard] = useState<Board | null>(null);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [panel, setPanel] = useState<Panel>('none');
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [sel, setSel] = useState<Selection | null>(null);
  const [dark, setDark] = useState(false);
  const [playing, setPlaying] = useState<{ elements: El[]; files: BinaryFiles; step: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [alts, setAlts] = useState<{ textId: string; options: string[] } | null>(null);
  const [auto, setAuto] = useState(() => pref('lb:auto', false));
  const [hold, setHold] = useState(() => pref('lb:hold', true));
  const [stepInfo, setStepInfo] = useState<{ last: number; counts: number[] }>({ last: 0, counts: [] });

  const boardRef = useRef<Board | null>(null);
  boardRef.current = board;
  const lastVersion = useRef(-1);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selKey = useRef('');

  // ── Load the last board (or make the first one) ────────────────────────────
  useEffect(() => {
    (async () => {
      const id = lastBoardId();
      let b = id ? await getBoard(id) : null;
      if (!b) {
        const all = await listBoards();
        b = all.length ? await getBoard(all[0].id) : null;
      }
      if (!b) {
        b = blankBoard('My first board');
        await saveBoard(b);
      }
      rememberLast(b.id);
      setBoard(b);
      setBoards(await listBoards());
    })();
  }, []);

  // A board bigger than the window opens zoomed out to show all of it (a small one stays at 100%).
  useEffect(() => {
    if (!api) return;
    const t = setTimeout(() => {
      const els = api.getSceneElements();
      if (!els.length) return;
      const st = api.getAppState();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const e of els) {
        minX = Math.min(minX, e.x); minY = Math.min(minY, e.y);
        maxX = Math.max(maxX, e.x + Math.abs(e.width)); maxY = Math.max(maxY, e.y + Math.abs(e.height));
      }
      if ((maxX - minX) * st.zoom.value > st.width * 0.92 || (maxY - minY) * st.zoom.value > st.height * 0.85) {
        api.scrollToContent(els, { fitToViewport: true, viewportZoomFactor: 0.88, animate: false });
      }
    }, 80);
    return () => clearTimeout(t);
  }, [api]);

  // The board's own API on the page (window.lb) — handy from the browser console.
  useEffect(() => { (window as unknown as { lb?: unknown }).lb = api ?? undefined; }, [api]);

  const toast = useCallback((message: string, ms = 1800) => api?.setToast({ message, closable: false, duration: ms }), [api]);

  // ── Saving: a moment after the last change, in this browser ────────────────
  const flushSave = useCallback(async () => {
    const b = boardRef.current;
    if (!api || !b) return;
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    const st = api.getAppState();
    const next: Board = {
      ...b,
      elements: api.getSceneElements() as readonly El[],
      appState: { viewBackgroundColor: st.viewBackgroundColor, gridModeEnabled: st.gridModeEnabled },
      files: api.getFiles(),
      updatedAt: Date.now(),
    };
    boardRef.current = next;
    await saveBoard(next);
  }, [api]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flushSave(); }, 600);
  }, [flushSave]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void flushSave(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onHide); };
  }, [flushSave]);

  // ── Every change on the board: keep this cheap (it runs on every pen move) ──
  const onChange = useCallback((elements: readonly El[], appState: AppState) => {
    const v = getSceneVersion(elements as never) + (appState.viewBackgroundColor === '#ffffff' ? 0 : 1);
    if (lastVersion.current !== -1 && v !== lastVersion.current) scheduleSave();
    if (v !== lastVersion.current) {
      lastVersion.current = v;
      const last = maxStep(elements);
      const counts = Array.from({ length: last + 1 }, () => 0);
      for (const e of elements) if (!(e.type === 'text' && e.containerId)) counts[stepOf(e)]++;
      setStepInfo((s) => (s.last === last && s.counts.join() === counts.join() ? s : { last, counts }));
    }
    const isDark = appState.theme === 'dark';
    setDark((d) => (d === isDark ? d : isDark));
    const ids = Object.keys(appState.selectedElementIds).filter((k) => appState.selectedElementIds[k]);
    const key = ids.join(',') + '|' + v;
    if (key === selKey.current) return;
    selKey.current = key;
    if (!ids.length) { setSel(null); return; }
    const pick = new Set(ids);
    const chosen = elements.filter((e) => pick.has(e.id));
    const steps = new Set(chosen.filter((e) => !(e.type === 'text' && e.containerId)).map(stepOf));
    const arrows = chosen.filter((e) => e.type === 'arrow' || e.type === 'line');
    const shapes = chosen.filter((e) => e.type !== 'arrow' && e.type !== 'line' && e.type !== 'freedraw');
    setSel({
      ids,
      freedraw: chosen.filter((e) => e.type === 'freedraw').length,
      arrows: arrows.length,
      shapes: shapes.length,
      step: steps.size === 1 ? [...steps][0] : steps.size === 0 ? 0 : 'mixed',
      flow: arrows.length > 0 && arrows.every(flowsAlways),
      cover: shapes.length > 0 && shapes.every(isCover),
    });
  }, [scheduleSave]);

  const onPerfected = useCallback((r: PerfectResult) => {
    const k = r.kinds[0];
    toast(r.kinds.length > 1 ? `${r.kinds.length} shapes perfected` : k === 'arrow' ? 'Connected ✓  (Ctrl/⌘+Z to undo)' : `${k[0].toUpperCase()}${k.slice(1)} ✓  (Ctrl/⌘+Z to undo)`);
  }, [toast]);

  const ink = useSmartInk(api, { hold, auto, onPerfected });

  // ── Actions on the selection ────────────────────────────────────────────────
  const selected = useCallback(() => {
    if (!api) return [] as string[];
    const st = api.getAppState();
    return Object.keys(st.selectedElementIds).filter((k) => st.selectedElementIds[k]);
  }, [api]);

  const doPerfect = useCallback(() => {
    if (!api) return;
    const r = perfectStrokes(api, selected(), { select: true });
    if (r.changed) onPerfected(r);
    else toast('No shape found in that ink — try a closed loop or a straight stroke');
  }, [api, selected, onPerfected, toast]);

  const doText = useCallback(async () => {
    if (!api || busy) return;
    setBusy('text');
    try {
      const r = await strokesToText(api, selected());
      if (r) { setAlts(r.alternatives.length ? { textId: r.textId, options: r.alternatives } : null); toast(`“${r.text}”`); }
    } catch (e) {
      toast(navigator.onLine ? (e instanceof Error ? e.message : 'Could not read it') : 'To text needs internet', 2600);
    } finally {
      setBusy(null);
    }
  }, [api, busy, selected, toast]);

  const doStraighten = useCallback(() => { if (api && straightenStrokes(api, selected())) toast('Straightened'); }, [api, selected, toast]);

  const doFlow = useCallback(() => {
    if (!api) return;
    const ids = selected();
    const els = api.getSceneElements().filter((e) => ids.includes(e.id) && (e.type === 'arrow' || e.type === 'line'));
    if (!els.length) return toast('Select an arrow first');
    const on = !els.every(flowsAlways);
    setLearning(api, els.map((e) => e.id), { flow: on ? true : undefined });
    toast(on ? 'Flowing ● ● →' : 'Flow off');
  }, [api, selected, toast]);

  const doCover = useCallback(() => {
    if (!api) return;
    const ids = selected();
    const els = api.getSceneElements().filter((e) => ids.includes(e.id) && !(e.type === 'text' && e.containerId) && e.type !== 'arrow');
    if (!els.length) return;
    const on = !els.every(isCover);
    setLearning(api, els.map((e) => e.id), { cover: on ? true : undefined });
    toast(on ? 'Hidden under a quiz card in Play' : 'Quiz card removed');
  }, [api, selected, toast]);

  const doStep = useCallback((d: number | 'next' | 'clear') => {
    if (!api) return;
    const scene = api.getSceneElements() as readonly El[];
    const ids = withAttached(scene, selected());
    if (!ids.size) return;
    const chosen = scene.filter((e) => ids.has(e.id));
    const cur = Math.max(0, ...chosen.map(stepOf));
    const target = d === 'clear' ? 0 : d === 'next' ? maxStep(scene) + 1 : Math.max(0, cur + d);
    setLearning(api, ids, { step: target || undefined });
    toast(target ? `Appears at step ${target}` : 'Always visible');
  }, [api, selected, toast]);

  const doMark = useCallback((mark: 'ok' | 'cross') => {
    if (!api) return;
    const ids = selected();
    const els = api.getSceneElements().filter((e) => ids.includes(e.id));
    for (const e of els) {
      const s = stepOf(e);
      if (!s) continue;
      const markAt = { ...(e.customData?.markAt ?? {}) };
      markAt[s] = markAt[s] === mark ? undefined : mark;
      setLearning(api, [e.id], { markAt });
    }
  }, [api, selected]);

  const play = useCallback(async (step?: number) => {
    if (!api) return;
    await flushSave();
    setPanel('none');
    api.setToast(null);
    setPlaying({ elements: api.getSceneElements() as El[], files: api.getFiles(), step: step ?? 0 });
  }, [api, flushSave]);

  // ── Keyboard: Alt + letter (by key position, so ⌥ on a Mac works too) ───────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || playing) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const run: Record<string, () => void> = {
        KeyP: doPerfect, KeyW: () => void doText(), KeyL: doStraighten, KeyF: doFlow, KeyQ: doCover,
        KeyN: () => doStep('next'), Enter: () => void play(), KeyB: () => setPanel((p) => (p === 'boards' ? 'none' : 'boards')),
      };
      const f = run[e.code];
      if (f) { e.preventDefault(); e.stopPropagation(); f(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [doPerfect, doText, doStraighten, doFlow, doCover, doStep, play, playing]);

  // ── Boards ──────────────────────────────────────────────────────────────────
  const refreshLists = useCallback(async () => {
    setBoards(await listBoards());
    setLessons(await fetchLessons());
  }, []);

  useEffect(() => { if (panel === 'boards') void refreshLists(); }, [panel, refreshLists]);

  // New lessons appear in the list while the panel is open (local server only).
  useEffect(() => {
    let es: EventSource | null = null;
    try { es = new EventSource('/events'); } catch { return; }
    es.onmessage = (m) => { try { const d = JSON.parse(m.data); if (d.type === 'lessons' || d.type === 'lesson') void fetchLessons().then(setLessons); } catch { /* ignore */ } };
    es.onerror = () => { es?.close(); };
    return () => es?.close();
  }, []);

  const open = useCallback(async (b: Board) => {
    await flushSave();
    lastVersion.current = -1;
    selKey.current = '';
    setSel(null);
    setAlts(null);
    rememberLast(b.id);
    setBoard(b);
    setBoards(await listBoards());
  }, [flushSave]);

  const openById = useCallback(async (id: string) => { const b = await getBoard(id); if (b) await open(b); }, [open]);
  const newBoard = useCallback(async () => { const b = blankBoard(); await saveBoard(b); await open(b); setPanel('none'); }, [open]);
  const rename = useCallback(async (name: string) => {
    if (!boardRef.current) return;
    const b = { ...boardRef.current, name };
    boardRef.current = b;
    setBoard(b);
    await flushSave();
    setBoards(await listBoards());
  }, [flushSave]);
  const remove = useCallback(async (id: string) => {
    await deleteBoard(id);
    const rest = await listBoards();
    setBoards(rest);
    if (id === boardRef.current?.id) {
      const next = rest.length ? await getBoard(rest[0].id) : null;
      const b = next ?? blankBoard();
      if (!next) await saveBoard(b);
      lastVersion.current = -1;
      rememberLast(b.id);
      setBoard(b);
    }
  }, []);
  const downloadBoard = useCallback(async () => {
    await flushSave();
    const b = boardRef.current;
    if (b) download(boardToFile(b), `${b.name.replace(/[\\/:*?"<>|]+/g, '-')}.excalidraw`);
  }, [flushSave]);
  const importFile = useCallback(async (f: File) => {
    try { const b = await boardFromFile(f); await saveBoard(b); await open(b); setPanel('none'); }
    catch { toast('That file is not a board'); }
  }, [open, toast]);
  const openLesson = useCallback(async (id: string) => {
    try {
      // A lesson opened before keeps your edits: open that board again.
      const existing = (await listBoards()).find((b) => b.lessonId === id);
      const saved = existing ? await getBoard(existing.id) : null;
      if (saved) { await open(saved); setPanel('none'); return; }
      const lesson = await fetchLesson(id);
      await fontsReady();
      const { elements, notes } = lessonToBoard(lesson);
      const b: Board = { ...blankBoard(lesson.title || id), elements, notes, lessonId: id };
      await saveBoard(b);
      await open(b);
      setPanel('none');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not open that lesson');
    }
  }, [open, toast]);

  const setNote = useCallback((step: number, text: string) => {
    if (!boardRef.current) return;
    const notes = boardRef.current.notes.slice();
    while (notes.length <= step) notes.push('');
    notes[step] = text;
    const b = { ...boardRef.current, notes };
    boardRef.current = b;
    setBoard(b);
    scheduleSave();
  }, [scheduleSave]);

  const selectStep = useCallback((step: number) => {
    if (!api) return;
    const ids = api.getSceneElements().filter((e) => stepOf(e) === step).map((e) => e.id);
    api.updateScene({ appState: { selectedElementIds: Object.fromEntries(ids.map((i) => [i, true])) as never }, captureUpdate: CaptureUpdateAction.NEVER });
  }, [api]);

  const initialData = useMemo(() => board && ({
    elements: board.elements,
    appState: { ...board.appState, currentItemRoughness: 0, currentItemFontFamily: 5, name: board.name },
    files: board.files,
    scrollToContent: true,
  }), [board?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!board || !initialData) return <div className="lb-loading">Learning Board</div>;

  return (
    <div className="lb-app">
      <div className="lb-editor">
        <Excalidraw
          key={board.id}
          excalidrawAPI={setApi}
          initialData={initialData as never}
          onChange={onChange as never}
          onPointerUpdate={ink.onPointerUpdate as never}
          renderTopRightUI={() => (
            <div className="lb-top">
              <button type="button" className="lb-btn" onClick={() => setPanel((p) => (p === 'boards' ? 'none' : 'boards'))} title="Your boards and lessons (Alt+B)">☰ {board.name}</button>
              <button type="button" className="lb-btn" onClick={() => setPanel((p) => (p === 'steps' ? 'none' : 'steps'))} title="Steps and what to say">Steps{stepInfo.last ? ` (${stepInfo.last})` : ''}</button>
              <button type="button" className="lb-btn primary" onClick={() => void play()} title="Play step by step (Alt+Enter)">▶ Play</button>
              <button type="button" className="lb-btn" onClick={() => setPanel((p) => (p === 'help' ? 'none' : 'help'))} aria-label="Help">?</button>
            </div>
          )}
        >
          <MainMenu>
            <MainMenu.Item onSelect={() => void newBoard()}>New board</MainMenu.Item>
            <MainMenu.Item onSelect={() => setPanel('boards')}>Boards and lessons…</MainMenu.Item>
            <MainMenu.Item onSelect={() => void downloadBoard()}>Download this board</MainMenu.Item>
            <MainMenu.Separator />
            <MainMenu.DefaultItems.SaveAsImage />
            <MainMenu.DefaultItems.SearchMenu />
            <MainMenu.DefaultItems.ToggleTheme />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
            <MainMenu.DefaultItems.ClearCanvas />
          </MainMenu>
          <WelcomeScreen>
            <WelcomeScreen.Center>
              <WelcomeScreen.Center.Heading>Learning Board</WelcomeScreen.Center.Heading>
              <div className="lb-welcome">
                <p><b>Draw a shape with the pen (P) and hold still for a moment</b> — it becomes perfect.</p>
                <p><b>Draw a line from one shape to another</b> — they get connected.</p>
                <p><b>Select things → Next step</b>, then <b>▶ Play</b> to explain it step by step.</p>
              </div>
            </WelcomeScreen.Center>
            <WelcomeScreen.Hints.ToolbarHint />
            <WelcomeScreen.Hints.HelpHint />
          </WelcomeScreen>
        </Excalidraw>
        <FlowLayer api={api} mode="edit" showBadges={stepInfo.last > 0} dark={dark} />
        {ink.ring && <div className="lb-ring" style={{ left: ink.ring.x, top: ink.ring.y }} aria-hidden="true" />}
        {sel && !playing && (
          <SmartBar
            sel={sel}
            busy={busy}
            alternatives={alts?.options ?? []}
            onPerfect={doPerfect}
            onText={() => void doText()}
            onStraighten={doStraighten}
            onFlow={doFlow}
            onCover={doCover}
            onStep={doStep}
            onMark={doMark}
            onAlternative={(v) => { if (api && alts) { replaceText(api, alts.textId, v); setAlts(null); } }}
          />
        )}
      </div>
      {panel === 'boards' && (
        <BoardsPanel
          current={board}
          boards={boards}
          lessons={lessons}
          onRename={(n) => void rename(n)}
          onOpen={(id) => void openById(id)}
          onNew={() => void newBoard()}
          onDelete={(id) => void remove(id)}
          onDownload={() => void downloadBoard()}
          onImport={(f) => void importFile(f)}
          onOpenLesson={(id) => void openLesson(id)}
          onClose={() => setPanel('none')}
        />
      )}
      {panel === 'steps' && (
        <StepsPanel
          last={stepInfo.last}
          counts={stepInfo.counts}
          notes={board.notes}
          onNote={setNote}
          onPlay={(s) => void play(s)}
          onSelect={selectStep}
          onClose={() => setPanel('none')}
        />
      )}
      {panel === 'help' && (
        <HelpPanel
          onClose={() => setPanel('none')}
          auto={auto}
          hold={hold}
          onAuto={(v) => { setAuto(v); setPref('lb:auto', v); }}
          onHold={(v) => { setHold(v); setPref('lb:hold', v); }}
        />
      )}
      {playing && (
        <Player
          elements={playing.elements}
          files={playing.files}
          notes={board.notes}
          background={board.appState.viewBackgroundColor ?? '#ffffff'}
          dark={dark}
          startStep={playing.step}
          onClose={() => setPlaying(null)}
        />
      )}
    </div>
  );
}

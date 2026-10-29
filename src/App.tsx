import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaptureUpdateAction, Excalidraw, getSceneVersion, MainMenu, WelcomeScreen } from '@excalidraw/excalidraw';
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';
import type { El } from './board/elements';
import { cleanUpBoard, perfectStrokes, replaceText, straightenStrokes, strokesToText, writingNear, type PerfectResult } from './board/inkActions';
import { tidy } from './board/tidy';
import { buildBlock, layoutFor } from './learn/blocks';
import { CommandBar } from './ui/CommandBar';
import { useSmartInk } from './board/useSmartInk';
import {
  blankBoard, boardFromFile, boardToFile, deleteBoard, download, getBoard, lastBoardId, listBoards, rememberLast, saveBoard,
  type Board, type BoardMeta,
} from './board/storage';
import { fetchLesson, fetchLessons, fontsReady, LESSON_PAPER, LESSON_STYLE, lessonToBoard, type LessonRow } from './board/lessons';
import { FlowLayer, flowKindOf, type FlowKind } from './learn/FlowLayer';
import { applyStyle, styleById } from './learn/styles';
import { Player } from './learn/Player';
import { flowsAlways, isCover, lastStep, maxStep, setLearning, stepOf, withAttached } from './learn/steps';
import { BoardsPanel, HelpPanel, StepsPanel, StylePanel } from './ui/Panels';
import { SmartBar, type Selection } from './ui/SmartBar';

type Panel = 'none' | 'boards' | 'steps' | 'help' | 'style';
type Snap = { key: number; x: number; y: number; w: number; h: number };

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
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cHold, setCHold] = useState<{ x: number; y: number; p: number } | null>(null);
  const highlighter = useRef<{ color: string; opacity: number; width: number } | null>(null);
  const [styling, setStyling] = useState(false);

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
        b = { ...blankBoard('My first board'), style: LESSON_STYLE, appState: { viewBackgroundColor: LESSON_PAPER } };
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
      const last = lastStep(elements, boardRef.current?.notes ?? []);
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
      flowKind: arrows.length ? (new Set(arrows.map(flowKindOf)).size === 1 ? flowKindOf(arrows[0]) : null) : null,
      flowColour: arrows.length && new Set(arrows.map((e) => e.customData?.flowColor ?? '')).size === 1 ? (arrows[0].customData?.flowColor ?? null) : null,
      cover: shapes.length > 0 && shapes.every(isCover),
    });
  }, [scheduleSave]);

  const onPerfected = useCallback((r: PerfectResult) => {
    if (api && r.newIds.length) {
      const st = api.getAppState();
      const z = st.zoom.value;
      const ids = new Set(r.newIds);
      const fresh: Snap[] = api.getSceneElements().filter((e) => ids.has(e.id) && e.type !== 'arrow').map((e) => ({
        key: Math.random(),
        x: (e.x + st.scrollX) * z + st.offsetLeft - 6,
        y: (e.y + st.scrollY) * z + st.offsetTop - 6,
        w: Math.abs(e.width) * z + 12,
        h: Math.abs(e.height) * z + 12,
      }));
      if (fresh.length) {
        setSnaps((s) => [...s, ...fresh]);
        setTimeout(() => setSnaps((s) => s.filter((x) => !fresh.includes(x))), 600);
      }
      try { navigator.vibrate?.([14, 40, 10]); } catch { /* no vibration on this device */ }
    }
    const k = r.kinds[0];
    toast(r.kinds.length > 1 ? `${r.kinds.length} shapes perfected` : k === 'arrow' ? 'Connected ✓  (Ctrl/⌘+Z to undo)' : `${k[0].toUpperCase()}${k.slice(1)} ✓  (Ctrl/⌘+Z to undo)`);
  }, [toast, api]);

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

  const doText = useCallback(async (ids?: string[]) => {
    if (!api || busy) return;
    setBusy('text');
    try {
      const r = await strokesToText(api, ids ?? selected());
      if (r) { setAlts(r.alternatives.length ? { textId: r.textId, options: r.alternatives } : null); toast(`“${r.text}”`); }
    } catch (e) {
      toast(navigator.onLine ? (e instanceof Error ? e.message : 'Could not read it') : 'To text needs internet', 2600);
    } finally {
      setBusy(null);
    }
  }, [api, busy, selected, toast]);

  // Hold C: the selected handwriting, or the word / line under (or nearest) the mouse, becomes neat text.
  const correctWriting = useCallback(async () => {
    if (!api) return;
    const st = api.getAppState();
    const chosen = Object.keys(st.selectedElementIds).filter((k) => st.selectedElementIds[k]);
    const scene = api.getSceneElements();
    let ids = scene.filter((e) => chosen.includes(e.id) && e.type === 'freedraw').map((e) => e.id);
    if (!ids.length) {
      const ptr = ink.pointer.current;
      ids = writingNear(api, ptr && Date.now() - ptr.at < 60_000 ? ptr : null);
    }
    if (!ids.length) { toast('Write something with the pen first'); return; }
    await doText(ids);
  }, [api, doText, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const doTidy = useCallback(() => {
    if (!api) return;
    const n = tidy(api, selected());
    toast(n ? `Tidied ${n}  (Ctrl/⌘+Z to undo)` : 'Select two or more boxes to tidy');
  }, [api, selected, toast]);

  const doCleanUp = useCallback(() => {
    if (!api) return;
    const r = cleanUpBoard(api);
    if (r.changed) onPerfected(r);
    toast(r.changed ? `Cleaned up ${r.changed} shape${r.changed === 1 ? '' : 's'}  (Ctrl/⌘+Z to undo)` : 'Nothing rough to clean up');
  }, [api, onPerfected, toast]);

  // Highlighter: a wide, see-through yellow pen; the same key switches back to the pen you had.
  const toggleHighlighter = useCallback(() => {
    if (!api) return;
    const st = api.getAppState();
    if (highlighter.current) {
      const prev = highlighter.current;
      highlighter.current = null;
      api.updateScene({ appState: { currentItemStrokeColor: prev.color, currentItemOpacity: prev.opacity, currentItemStrokeWidth: prev.width } as never });
      toast('Pen');
    } else {
      highlighter.current = { color: st.currentItemStrokeColor, opacity: st.currentItemOpacity, width: st.currentItemStrokeWidth };
      api.updateScene({ appState: { currentItemStrokeColor: '#fab005', currentItemOpacity: 40, currentItemStrokeWidth: 4 } as never });
      toast('Highlighter (Alt+H again for the pen)');
    }
    api.setActiveTool({ type: 'freedraw' });
  }, [api, toast]);

  // "/" bar: a block (array, list, tree, …) or a command (tidy, clean).
  const runCommand = useCallback((cmd: string): string | null => {
    if (!api) return 'Not ready yet';
    const word = cmd.split(/\s+/)[0].toLowerCase();
    if (word === 'tidy') { doTidy(); return null; }
    if (word === 'clean' || word === 'cleanup') { doCleanUp(); return null; }
    if (word === 'highlight' || word === 'highlighter') { toggleHighlighter(); return null; }
    const layout = layoutFor(cmd);
    if (!layout) return `"${word}" is not a block. Try array, list, tree, heap, stack, queue, graph, matrix, grid or hash.`;
    const st = api.getAppState();
    const z = st.zoom.value;
    const at = { x: -st.scrollX + st.width / 2 / z, y: -st.scrollY + st.height / 2 / z };
    const style = styleById(boardRef.current?.style);
    const els = buildBlock(layout, at, {
      stroke: st.currentItemStrokeColor === '#1e1e1e' ? style.ink : st.currentItemStrokeColor,
      roughness: st.currentItemRoughness, strokeWidth: Math.max(1, Math.min(4, st.currentItemStrokeWidth)),
      font: st.currentItemFontFamily, fill: style.fill === 'solid' ? 'solid' : st.currentItemFillStyle, style,
    });
    api.updateScene({
      elements: [...api.getSceneElementsIncludingDeleted(), ...els],
      appState: { selectedElementIds: Object.fromEntries(els.filter((e) => !(e.type === 'text' && e.containerId)).map((e) => [e.id, true])) as never },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    api.setActiveTool({ type: 'selection' });
    toast(`${word} added  (Ctrl/⌘+Z to undo)`);
    return null;
  }, [api, doTidy, doCleanUp, toggleHighlighter, toast]);

  const doStraighten = useCallback(() => { if (api && straightenStrokes(api, selected())) toast('Straightened'); }, [api, selected, toast]);

  const doFlow = useCallback(() => {
    if (!api) return;
    const ids = selected();
    const els = api.getSceneElements().filter((e) => ids.includes(e.id) && (e.type === 'arrow' || e.type === 'line'));
    if (!els.length) return toast('Select an arrow first');
    const on = !els.every(flowsAlways);
    setLearning(api, els.map((e) => e.id), on ? { flow: true } : { flow: undefined });
    toast(on ? 'Flowing ● →  (pick a kind and colour in the bar)' : 'Flow off');
  }, [api, selected, toast]);

  const doFlowKind = useCallback((k: FlowKind) => {
    if (!api) return;
    const ids = selected();
    const arrows = api.getSceneElements().filter((e) => ids.includes(e.id) && (e.type === 'arrow' || e.type === 'line')).map((e) => e.id);
    setLearning(api, arrows, { flow: true, flowStyle: k });
  }, [api, selected]);

  const doFlowColour = useCallback((c: string) => {
    if (!api) return;
    const ids = selected();
    const arrows = api.getSceneElements().filter((e) => ids.includes(e.id) && (e.type === 'arrow' || e.type === 'line')).map((e) => e.id);
    setLearning(api, arrows, { flow: true, flowColor: c });
  }, [api, selected]);

  const pickStyle = useCallback(async (id: string) => {
    if (!api || !boardRef.current || styling) return;
    setStyling(true);
    try {
      const st = styleById(id);
      await applyStyle(api, st);
      const b = { ...boardRef.current, style: st.id };
      boardRef.current = b;
      setBoard(b);
      await flushSave();
      toast(`${st.name} style  (Ctrl/⌘+Z to undo)`);
    } finally {
      setStyling(false);
    }
  }, [api, styling, flushSave, toast]);

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
        KeyT: doTidy, KeyC: doCleanUp, KeyH: toggleHighlighter,
      };
      const f = run[e.code];
      if (f) { e.preventDefault(); e.stopPropagation(); f(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [doPerfect, doText, doStraighten, doFlow, doCover, doStep, play, playing, doTidy, doCleanUp, toggleHighlighter]);

  // "/" opens the block bar; holding C (about a second) turns writing into neat text.
  useEffect(() => {
    const HOLD_C_MS = 1000;
    let t0 = 0, raf = 0, holding = false;
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };
    const stop = () => { holding = false; cancelAnimationFrame(raf); setCHold(null); };
    const down = (e: KeyboardEvent) => {
      if (playing || cmdOpen || !api || typing(e) || e.altKey || e.ctrlKey || e.metaKey) return;
      if ((api.getAppState() as unknown as { editingTextElement?: unknown }).editingTextElement) return;
      if (e.key === '/') { e.preventDefault(); e.stopPropagation(); setCmdOpen(true); return; }
      if (e.code !== 'KeyC' || e.shiftKey) return;
      e.preventDefault(); e.stopPropagation();
      if (holding) return; // key repeat
      holding = true;
      t0 = performance.now();
      const st = api.getAppState();
      const ptr = ink.pointer.current;
      const pos = ptr
        ? { x: (ptr.x + st.scrollX) * st.zoom.value + st.offsetLeft, y: (ptr.y + st.scrollY) * st.zoom.value + st.offsetTop }
        : { x: st.offsetLeft + st.width / 2, y: st.offsetTop + st.height / 2 };
      const tick = () => {
        if (!holding) return;
        const p = Math.min(1, (performance.now() - t0) / HOLD_C_MS);
        setCHold({ ...pos, p });
        if (p >= 1) { stop(); try { navigator.vibrate?.(12); } catch { /* none */ } void correctWriting(); return; }
        raf = requestAnimationFrame(tick);
      };
      tick();
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'KeyC' && holding) { e.preventDefault(); e.stopPropagation(); stop(); } };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); stop(); };
  }, [api, playing, cmdOpen, correctWriting]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const openLesson = useCallback(async (id: string, rebuild = false) => {
    try {
      if (rebuild) {
        for (const b of (await listBoards()).filter((x) => x.lessonId === id)) await deleteBoard(b.id);
      }
      // A lesson opened before keeps your edits: open that board again.
      const existing = (await listBoards()).find((b) => b.lessonId === id);
      const saved = existing ? await getBoard(existing.id) : null;
      if (saved) { await open(saved); setPanel('none'); return; }
      const lesson = await fetchLesson(id);
      await fontsReady();
      const { elements, notes } = lessonToBoard(lesson);
      const b: Board = { ...blankBoard(lesson.title || id), elements, notes, lessonId: id, style: LESSON_STYLE, appState: { viewBackgroundColor: LESSON_PAPER } };
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
    appState: (() => {
      const st = styleById(board.style);
      return {
        ...board.appState,
        currentItemRoughness: st.roughness, currentItemFontFamily: st.font, currentItemStrokeWidth: st.strokeWidth,
        currentItemStrokeColor: st.ink, currentItemFillStyle: st.fill, name: board.name,
      };
    })(),
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
              <button type="button" className="lb-btn" onClick={() => setCmdOpen(true)} title="Add an array, list, tree, stack, queue, graph… (/)">＋ Blocks</button>
              <button type="button" className="lb-btn" onClick={() => setPanel((p) => (p === 'style' ? 'none' : 'style'))} title="Art style for the whole board">🎨 Style</button>
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
                <p><b>Draw a shape with the pen (P) and pause a moment before letting go</b> — it snaps into a perfect shape.</p>
                <p><b>Draw a line from one shape to another</b> — they get connected.</p>
                <p><b>Select things → Next step</b>, then <b>▶ Play</b> to explain it step by step.</p>
              </div>
            </WelcomeScreen.Center>
            <WelcomeScreen.Hints.ToolbarHint />
            <WelcomeScreen.Hints.HelpHint />
          </WelcomeScreen>
        </Excalidraw>
        <FlowLayer api={api} mode="edit" showBadges={stepInfo.last > 0} flowColour={styleById(board.style).flow} />
        {snaps.map((s) => <div key={s.key} className="lb-snap" style={{ left: s.x, top: s.y, width: s.w, height: s.h }} aria-hidden="true" />)}
        {cHold && (
          <>
            <div className="lb-hold" style={{ left: cHold.x, top: cHold.y, ['--p' as string]: cHold.p }} aria-hidden="true" />
            <div className="lb-hold-label" style={{ left: cHold.x, top: cHold.y }}>keep holding C — correcting</div>
          </>
        )}
        {busy === 'text' && !cHold && <div className="lb-hold-label" style={{ left: '50%', top: 70 }}>Reading your writing…</div>}
        {cmdOpen && <CommandBar onRun={runCommand} onClose={() => setCmdOpen(false)} />}
        {ink.ring && <div className="lb-ring" style={{ left: ink.ring.x, top: ink.ring.y }} aria-hidden="true" />}
        {sel && !playing && (
          <SmartBar
            sel={sel}
            busy={busy}
            alternatives={alts?.options ?? []}
            onPerfect={doPerfect}
            onText={() => void doText()}
            onTidy={doTidy}
            onStraighten={doStraighten}
            onFlow={doFlow}
            onFlowKind={doFlowKind}
            onFlowColour={doFlowColour}
            defaultFlowColour={styleById(board.style).flow}
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
          onRebuildLesson={(id) => void openLesson(id, true)}
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
          onAdd={() => { const n = Math.max(stepInfo.last, board.notes.length - 1) + 1; setNote(n, ''); setStepInfo((s) => ({ last: n, counts: [...s.counts, 0] })); }}
          onClose={() => setPanel('none')}
        />
      )}
      {panel === 'style' && (
        <StylePanel current={styleById(board.style).id} busy={styling} onPick={(id) => void pickStyle(id)} onClose={() => setPanel('none')} />
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
          flowColour={styleById(board.style).flow}
          startStep={playing.step}
          onClose={() => setPlaying(null)}
        />
      )}
    </div>
  );
}

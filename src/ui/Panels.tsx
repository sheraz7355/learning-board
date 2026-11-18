import { useEffect, useRef, useState } from 'react';
import type { BoardMeta } from '../board/storage';
import type { LessonRow } from '../board/lessons';
import { STYLES } from '../learn/styles';

type BoardsProps = {
  current: { id: string; name: string };
  boards: BoardMeta[];
  lessons: LessonRow[];
  onRename: (name: string) => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onDownload: () => void;
  onImport: (files: File[]) => void;
  onDownloadZip: (boardIds: string[], lessonIds: string[]) => void;
  packing: boolean;
  onOpenLesson: (id: string) => void;
  onRebuildLesson: (id: string) => void;
  onClose: () => void;
};

export function BoardsPanel(p: BoardsProps) {
  const [name, setName] = useState(p.current.name);
  const [confirming, setConfirming] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  // Ticked boards and lessons, for downloading many at once as one .zip.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => setName(p.current.name), [p.current.name]);
  const usable = p.lessons.filter((l) => !l.error);
  const allKeys = [...p.boards.map((b) => `b:${b.id}`), ...usable.map((l) => `l:${l.id}`)];
  const ticked = allKeys.filter((k) => picked.has(k));
  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const setMany = (keys: string[], on: boolean) => setPicked((s) => { const n = new Set(s); for (const k of keys) { if (on) n.add(k); else n.delete(k); } return n; });
  const boardKeys = p.boards.map((b) => `b:${b.id}`);
  const lessonKeys = usable.map((l) => `l:${l.id}`);
  const allOn = (keys: string[]) => keys.length > 0 && keys.every((k) => picked.has(k));
  const downloadPicked = () => p.onDownloadZip(
    ticked.filter((k) => k.startsWith('b:')).map((k) => k.slice(2)),
    ticked.filter((k) => k.startsWith('l:')).map((k) => k.slice(2)),
  );
  const when = (t: number) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  return (
    <aside className="lb-panel left" aria-label="Boards">
      <header>
        <h2>Boards</h2>
        <button type="button" className="lb-x" onClick={p.onClose} aria-label="Close">×</button>
      </header>
      <label className="lb-field">
        <span>This board</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== p.current.name && p.onRename(name.trim())}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
      </label>
      <div className="lb-row">
        <button type="button" className="lb-btn primary" onClick={p.onNew}>New board</button>
        <button type="button" className="lb-btn" onClick={p.onDownload} title="Save this board as a file to share or keep">Download</button>
        <button type="button" className="lb-btn" onClick={() => file.current?.click()} title="Open board files, or a .zip of boards">Open file…</button>
        <input ref={file} type="file" accept=".excalidraw,.json,.zip,application/json,application/zip" multiple hidden
          onChange={(e) => { const f = Array.from(e.target.files ?? []); if (f.length) p.onImport(f); e.target.value = ''; }} />
      </div>
      <div className="lb-zipbar">
        <label className="lb-check" title="Tick every board and lesson">
          <input type="checkbox" checked={allOn(allKeys)} onChange={(e) => setMany(allKeys, e.target.checked)} /> Select all
        </label>
        <span className="lb-grow" />
        {ticked.length > 0 && <button type="button" className="lb-link" onClick={() => setPicked(new Set())}>clear</button>}
        <button type="button" className="lb-btn primary" disabled={!ticked.length || p.packing} onClick={downloadPicked}
          title="One .zip file with every ticked board. On the other computer: Boards → Open file… and pick the zip.">
          {p.packing ? 'Packing…' : `⬇ Download ${ticked.length || ''} as .zip`}
        </button>
      </div>
      <h3 className="lb-listhead">
        <label className="lb-check"><input type="checkbox" checked={allOn(boardKeys)} onChange={(e) => setMany(boardKeys, e.target.checked)} aria-label="Select all boards" /> My boards</label>
      </h3>
      <ul className="lb-list">
        {p.boards.map((b) => (
          <li key={b.id} className={b.id === p.current.id ? 'on' : ''}>
            <input type="checkbox" className="lb-tick" checked={picked.has(`b:${b.id}`)} onChange={() => toggle(`b:${b.id}`)} aria-label={`Select ${b.name}`} />
            <button type="button" className="lb-item" onClick={() => p.onOpen(b.id)}>
              <strong>{b.name}</strong>
              <small>{when(b.updatedAt)}</small>
            </button>
            {confirming === b.id ? (
              <span className="lb-confirm">
                <button type="button" className="lb-btn danger" onClick={() => { setConfirming(null); p.onDelete(b.id); }}>Delete</button>
                <button type="button" className="lb-btn" onClick={() => setConfirming(null)}>Keep</button>
              </span>
            ) : (
              <button type="button" className="lb-icon" onClick={() => setConfirming(b.id)} aria-label={`Delete ${b.name}`} title="Delete">🗑</button>
            )}
          </li>
        ))}
      </ul>
      {p.lessons.length > 0 && (
        <>
          <h3 className="lb-listhead">
            <label className="lb-check"><input type="checkbox" checked={allOn(lessonKeys)} onChange={(e) => setMany(lessonKeys, e.target.checked)} aria-label="Select all lessons" /> Lessons</label>
          </h3>
          <p className="lb-hint">Explanations written for you. Opening one makes an editable board with its steps.</p>
          <ul className="lb-list">
            {p.lessons.map((l) => (
              <li key={l.id}>
                <input type="checkbox" className="lb-tick" disabled={!!l.error} checked={picked.has(`l:${l.id}`)} onChange={() => toggle(`l:${l.id}`)} aria-label={`Select ${l.title || l.id}`} />
                <button type="button" className="lb-item" onClick={() => p.onOpenLesson(l.id)} disabled={!!l.error}>
                  <strong>{l.title || l.id}</strong>
                  <small>{l.error ? 'has an error' : l.id}</small>
                </button>
                {p.boards.some((b) => b.lessonId === l.id) && (
                  <button type="button" className="lb-icon" onClick={() => p.onRebuildLesson(l.id)} title="Rebuild this board from the lesson file (your edits to it are replaced)">↻</button>
                )}
                <a className="lb-icon" href={`/player/#${encodeURIComponent(l.id)}`} target="_blank" rel="noreferrer" title="Open in the lesson player">▶</a>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}

type StepsProps = {
  last: number;
  counts: number[];
  notes: string[];
  onNote: (step: number, text: string) => void;
  onPlay: (step: number) => void;
  onSelect: (step: number) => void;
  onAdd: () => void;
  onClose: () => void;
};

export function StepsPanel(p: StepsProps) {
  const steps = Array.from({ length: p.last + 1 }, (_, i) => i);
  return (
    <aside className="lb-panel right" aria-label="Steps">
      <header>
        <h2>Steps</h2>
        <button type="button" className="lb-x" onClick={p.onClose} aria-label="Close">×</button>
      </header>
      <p className="lb-hint">Select things on the board and press <b>Next step</b> (Alt+N) to make them appear one step later. Write what to say for each step here. Then press <b>Play</b>.</p>
      <ol className="lb-steps">
        {steps.map((s) => (
          <li key={s}>
            <div className="lb-step-head">
              <strong>{s === 0 ? 'Start' : `Step ${s}`}</strong>
              <small>{p.counts[s] ?? 0} item{(p.counts[s] ?? 0) === 1 ? '' : 's'}</small>
              <span className="lb-grow" />
              {s > 0 && <button type="button" className="lb-link" onClick={() => p.onSelect(s)}>select</button>}
              <button type="button" className="lb-link" onClick={() => p.onPlay(s)}>play from here</button>
            </div>
            <textarea
              rows={2}
              placeholder={s === 0 ? 'The big idea in one sentence…' : 'What to say at this step…'}
              defaultValue={p.notes[s] ?? ''}
              onBlur={(e) => e.target.value !== (p.notes[s] ?? '') && p.onNote(s, e.target.value)}
            />
          </li>
        ))}
      </ol>
      <button type="button" className="lb-btn" style={{ marginTop: 12 }} onClick={p.onAdd} title="A step that only says something (or only ticks, crosses or flows)">+ Add a step</button>
    </aside>
  );
}

export function HelpPanel({ onClose, auto, hold, onAuto, onHold }: { onClose: () => void; auto: boolean; hold: boolean; onAuto: (v: boolean) => void; onHold: (v: boolean) => void }) {
  const alt = navigator.platform.toLowerCase().includes('mac') ? '⌥' : 'Alt';
  const rows: [string, string][] = [
    ['Draw with the pen (P), then pause a moment before letting go', 'a ring buzzes, and the stroke snaps into a perfect circle, ellipse, rectangle, square, triangle, diamond or line'],
    ['Double-click a stroke', 'perfect it afterwards'],
    ['Draw a line from one shape to another', 'they get an arrow that stays attached when you move them'],
    ['Hold C for a second', 'the word or line you just wrote (or the writing under the mouse) becomes neat, correctly spelled text (needs internet)'],
    [`Select handwriting → Aa To text (${alt}+W)`, 'the same for exactly what you selected; other readings are offered in the bar'],
    ['/ (or ＋ Blocks)', 'type array 3 1 4, list 1 2 3, tree 8 3 10 1 6, heap, stack, queue, graph A-B B->C, matrix, grid 3x4, hash 7'],
    [`Select boxes → ⊞ Tidy (${alt}+T)`, 'lines them up in rows and columns, evenly spaced; their arrows follow'],
    [`${alt}+C`, 'clean up: every rough shape on the board becomes perfect at once (letters are left alone)'],
    [`${alt}+H`, 'highlighter: a wide see-through marker; again for the pen'],
    [`Select handwriting → Straighten (${alt}+L)`, 'keeps your handwriting, lines it up level and smooths it'],
    [`Select an arrow → Flow (${alt}+F)`, 'a glowing dot travels along it (and on through connected arrows); pick Dot, Stream, Comet, Ants or Wave and a colour'],
    ['🎨 Style', 'restyle the whole board: Sketch, Chalkboard, Clean, Marker, Blueprint or Notebook'],
    [`Select things → Next step (${alt}+N)`, 'they appear one step later in Play'],
    [`Select a box → Quiz (${alt}+Q)`, 'in Play it is hidden under a card until clicked'],
    [`Play (${alt}+Enter)`, '→ / Space next, ← back, S spotlight, Esc close'],
    ['K', 'laser pointer — point at things while explaining'],
    ['Ctrl/⌘ + Z', 'undo (a perfected shape goes back to your ink)'],
    ['Scroll / pinch, or Ctrl/⌘ + scroll', 'move around and zoom; Space + drag pans'],
  ];
  return (
    <aside className="lb-panel right" aria-label="Help">
      <header>
        <h2>How it works</h2>
        <button type="button" className="lb-x" onClick={onClose} aria-label="Close">×</button>
      </header>
      <dl className="lb-help">
        {rows.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
      </dl>
      <h3>Smart ink</h3>
      <label className="lb-check"><input type="checkbox" checked={hold} onChange={(e) => onHold(e.target.checked)} /> Hold still to perfect a shape</label>
      <label className="lb-check"><input type="checkbox" checked={auto} onChange={(e) => onAuto(e.target.checked)} /> Perfect every shape automatically (off keeps letters like O and l as you wrote them)</label>
      <p className="lb-hint">Boards are saved in this browser on this computer. Use Boards → Download to keep a copy or share one.</p>
    </aside>
  );
}

export function StylePanel({ current, onPick, onClose, busy }: {
  current: string;
  onPick: (id: string) => void;
  onClose: () => void;
  busy: boolean;
}) {
  return (
    <aside className="lb-panel right" aria-label="Art style">
      <header>
        <h2>Art style</h2>
        <button type="button" className="lb-x" onClick={onClose} aria-label="Close">×</button>
      </header>
      <p className="lb-hint">Restyles the whole board — lines, fills, font, paper and the flowing dots. New drawing follows it. Ctrl/⌘+Z undoes it.</p>
      <div className="lb-styles">
        {STYLES.map((s) => (
          <button key={s.id} type="button" className={`lb-style${s.id === current ? ' on' : ''}`} onClick={() => onPick(s.id)} disabled={busy}>
            <span className="lb-style-preview" style={{ background: s.paper }}>
              <StylePreview s={s} />
            </span>
            <span className="lb-style-name"><strong>{s.name}</strong><small>{s.hint}</small></span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function StylePreview({ s }: { s: (typeof STYLES)[number] }) {
  const id = `rough-${s.id}`;
  const fill = s.dark ? 'rgba(255,255,255,0.10)' : '#eef3fb';
  const pattern = s.fill === 'solid' ? fill : `url(#hatch-${s.id})`;
  return (
    <svg viewBox="0 0 160 74" aria-hidden="true">
      <defs>
        <filter id={id}>
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="3" />
          <feDisplacementMap in="SourceGraphic" scale={s.roughness * 2.2} />
        </filter>
        <pattern id={`hatch-${s.id}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke={s.ink} strokeOpacity="0.35" strokeWidth="1.2" />
          {s.fill === 'cross-hatch' && <line x1="0" y1="0" x2="6" y2="0" stroke={s.ink} strokeOpacity="0.35" strokeWidth="1.2" />}
        </pattern>
        {s.grid && (
          <pattern id={`grid-${s.id}`} width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M10 0 L0 0 0 10" fill="none" stroke={s.ink} strokeOpacity="0.12" strokeWidth="0.6" />
          </pattern>
        )}
      </defs>
      {s.grid && <rect width="160" height="74" fill={`url(#grid-${s.id})`} />}
      <g filter={s.roughness ? `url(#${id})` : undefined} stroke={s.ink} strokeWidth={Math.max(1.2, s.strokeWidth * 0.8)} fill="none" strokeLinecap="round">
        <circle cx="34" cy="37" r="20" fill={pattern} />
        <rect x="96" y="18" width="50" height="38" rx="8" fill={pattern} />
        <path d="M56 37 L92 37 M85 31 L93 37 L85 43" />
      </g>
      <circle cx="74" cy="37" r="4.5" fill={s.flow} />
      <circle cx="74" cy="37" r="8" fill={s.flow} opacity="0.3" />
      <text x="121" y="41" textAnchor="middle" fontSize="13" fill={s.ink} style={{ fontFamily: `"${s.fontName}", cursive` }}>Aa</text>
    </svg>
  );
}

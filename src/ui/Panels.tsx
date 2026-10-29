import { useEffect, useRef, useState } from 'react';
import type { BoardMeta } from '../board/storage';
import type { LessonRow } from '../board/lessons';

type BoardsProps = {
  current: { id: string; name: string };
  boards: BoardMeta[];
  lessons: LessonRow[];
  onRename: (name: string) => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onDownload: () => void;
  onImport: (file: File) => void;
  onOpenLesson: (id: string) => void;
  onClose: () => void;
};

export function BoardsPanel(p: BoardsProps) {
  const [name, setName] = useState(p.current.name);
  const [confirming, setConfirming] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => setName(p.current.name), [p.current.name]);
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
        <button type="button" className="lb-btn" onClick={() => file.current?.click()} title="Open a .excalidraw board file">Open file…</button>
        <input ref={file} type="file" accept=".excalidraw,.json,application/json" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onImport(f); e.target.value = ''; }} />
      </div>
      <ul className="lb-list">
        {p.boards.map((b) => (
          <li key={b.id} className={b.id === p.current.id ? 'on' : ''}>
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
          <h3>Lessons</h3>
          <p className="lb-hint">Explanations written for you. Opening one makes an editable board with its steps.</p>
          <ul className="lb-list">
            {p.lessons.map((l) => (
              <li key={l.id}>
                <button type="button" className="lb-item" onClick={() => p.onOpenLesson(l.id)} disabled={!!l.error}>
                  <strong>{l.title || l.id}</strong>
                  <small>{l.error ? 'has an error' : l.id}</small>
                </button>
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
    </aside>
  );
}

export function HelpPanel({ onClose, auto, hold, onAuto, onHold }: { onClose: () => void; auto: boolean; hold: boolean; onAuto: (v: boolean) => void; onHold: (v: boolean) => void }) {
  const alt = navigator.platform.toLowerCase().includes('mac') ? '⌥' : 'Alt';
  const rows: [string, string][] = [
    ['Draw with the pen (P), then hold still ½ s before letting go', 'the stroke becomes a perfect circle, ellipse, rectangle, square, triangle, diamond or line'],
    ['Double-click a stroke', 'perfect it afterwards'],
    ['Draw a line from one shape to another', 'they get an arrow that stays attached when you move them'],
    [`Select handwriting → Aa To text (${alt}+W)`, 'your writing becomes neat text (needs internet)'],
    [`Select handwriting → Straighten (${alt}+L)`, 'keeps your handwriting, lines it up level and smooths it'],
    [`Select an arrow → Flow (${alt}+F)`, 'dots flow along it, showing the direction things move'],
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

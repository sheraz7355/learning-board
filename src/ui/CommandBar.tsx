// The "/" bar: type a block (array, list, tree, …) or a command, press Enter.

import { useEffect, useRef, useState } from 'react';
import { BLOCK_HELP } from '../learn/blocks';

const HISTORY_KEY = 'lb:commands';
const loadHistory = (): string[] => { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; } };

export function CommandBar({ onRun, onClose }: { onRun: (cmd: string) => string | null; onClose: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [history] = useState(loadHistory);
  const [hIndex, setHIndex] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  const run = (cmd: string) => {
    const err = onRun(cmd);
    if (err) { setError(err); return; }
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify([cmd, ...history.filter((h) => h !== cmd)].slice(0, 30))); } catch { /* private mode */ }
    onClose();
  };

  return (
    <div className="lb-cmd" role="dialog" aria-label="Add a block">
      <input
        ref={input}
        value={value}
        placeholder="array 3 1 4 · tree 8 3 10 1 6 · graph A-B B->C · clean · tidy"
        onChange={(e) => { setValue(e.target.value); setError(null); }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          else if (e.key === 'Enter' && value.trim()) { e.preventDefault(); run(value.trim()); }
          else if (e.key === 'ArrowUp' && history.length) {
            e.preventDefault();
            const i = Math.min(history.length - 1, hIndex + 1);
            setHIndex(i); setValue(history[i]);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            const i = Math.max(-1, hIndex - 1);
            setHIndex(i); setValue(i < 0 ? '' : history[i]);
          }
        }}
        aria-label="Block or command"
      />
      {error && <p className="lb-cmd-error">{error}</p>}
      <ul className="lb-cmd-help">
        {BLOCK_HELP.map(([ex, what]) => (
          <li key={ex}>
            <button type="button" onClick={() => { setValue(ex); input.current?.focus(); }}><code>{ex}</code></button>
            <span>{what}</span>
          </li>
        ))}
        <li><button type="button" onClick={() => run('tidy')}><code>tidy</code></button><span>line up the selected boxes (Alt+T)</span></li>
        <li><button type="button" onClick={() => run('clean')}><code>clean</code></button><span>perfect every rough shape (Alt+C)</span></li>
      </ul>
      <p className="lb-hint">Enter adds it in the middle of the screen · ↑ earlier commands · Esc closes</p>
    </div>
  );
}

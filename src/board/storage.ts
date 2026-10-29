// Boards are kept in the browser's own database (IndexedDB) on this computer: fast, offline, private.
// A list of names is kept separately so the board list opens instantly however big the boards are.
// To share a board, download it as a file (it opens in Learning Board and in excalidraw.com too).

import { loadFromBlob, serializeAsJSON } from '@excalidraw/excalidraw';
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types';
import type { El } from './elements';

export type BoardMeta = { id: string; name: string; createdAt: number; updatedAt: number; lessonId?: string };
export type Board = BoardMeta & {
  elements: readonly El[];
  appState: { viewBackgroundColor?: string; gridModeEnabled?: boolean };
  files: BinaryFiles;
  /** The note for each step: [0] = the introduction, [n] = step n. */
  notes: string[];
};

const DB = 'learning-board';
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('boards')) d.createObjectStore('boards', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function req<T>(r: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function listBoards(): Promise<BoardMeta[]> {
  const d = await db();
  const all = await req(d.transaction('meta').objectStore('meta').getAll()) as BoardMeta[];
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getBoard(id: string): Promise<Board | null> {
  const d = await db();
  return ((await req(d.transaction('boards').objectStore('boards').get(id))) as Board) ?? null;
}

export async function saveBoard(board: Board): Promise<void> {
  const d = await db();
  const tx = d.transaction(['meta', 'boards'], 'readwrite');
  const meta: BoardMeta = { id: board.id, name: board.name, createdAt: board.createdAt, updatedAt: board.updatedAt, lessonId: board.lessonId };
  tx.objectStore('meta').put(meta);
  tx.objectStore('boards').put(board);
  await done(tx);
}

export async function deleteBoard(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['meta', 'boards'], 'readwrite');
  tx.objectStore('meta').delete(id);
  tx.objectStore('boards').delete(id);
  await done(tx);
}

export const newBoardId = () => `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function blankBoard(name = 'Untitled board'): Board {
  const now = Date.now();
  return { id: newBoardId(), name, createdAt: now, updatedAt: now, elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {}, notes: [] };
}

/** A board as a .excalidraw file, with the learning notes alongside (other apps simply ignore them). */
export function boardToFile(board: Board): Blob {
  const base = JSON.parse(serializeAsJSON(board.elements as never, board.appState as Partial<AppState> as never, board.files, 'local'));
  base.learningBoard = { name: board.name, notes: board.notes };
  return new Blob([JSON.stringify(base, null, 2)], { type: 'application/json' });
}

export async function boardFromFile(file: File): Promise<Board> {
  const text = await file.text();
  let extra: { name?: string; notes?: string[] } = {};
  try { extra = JSON.parse(text)?.learningBoard ?? {}; } catch { /* not ours: fine */ }
  const scene = await loadFromBlob(new Blob([text], { type: 'application/json' }), null, null);
  const b = blankBoard(extra.name || file.name.replace(/\.(excalidraw|json)$/i, '') || 'Imported board');
  return {
    ...b,
    elements: scene.elements as readonly El[],
    appState: { viewBackgroundColor: scene.appState.viewBackgroundColor, gridModeEnabled: scene.appState.gridModeEnabled },
    files: scene.files ?? {},
    notes: Array.isArray(extra.notes) ? extra.notes.map(String) : [],
  };
}

export function download(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const LAST = 'lb:lastBoard';
export const rememberLast = (id: string) => { try { localStorage.setItem(LAST, id); } catch { /* private mode */ } };
export const lastBoardId = () => { try { return localStorage.getItem(LAST); } catch { return null; } };

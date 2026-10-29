# Learning Board

A drawing board for learning and explaining things. Draw roughly with the mouse; it tidies up for you.
- A wobbly circle becomes a perfect circle.
- A line between two shapes becomes an arrow that stays attached when you move them.
- Your handwriting becomes neat text.

Then make it move:
- dots flow along arrows;
- things appear one step at a time, with what to say at each step;
- answers hide under quiz cards until you click them.

Works on **Windows, Mac and Linux**, in Chrome, Edge, Firefox or Safari. Boards are saved on your own computer.

## Install (once)

You need **Node.js 20.19 or newer** ([nodejs.org](https://nodejs.org), the LTS version) and **git**.

```
git clone <this repository's address> learning-board
cd learning-board
npm install
npm start
```

`npm start` builds the app and opens it at **http://localhost:4747**. Keep that window open while you use it
(Ctrl+C stops it). Next time, just run `npm start` in that folder.

**Make it an app:** in Chrome or Edge, click the install icon at the right of the address bar (or menu →
"Install Learning Board"). It then opens in its own window from the Start menu, Dock or desktop. Run
`npm start` first.

## How to use it

| Do this | What happens |
|---|---|
| Pen (**P** or 7): draw a shape, then **pause a moment** before letting go | A ring buzzes, and on release the stroke snaps (with a little shake) into a perfect circle, ellipse, rectangle, square, triangle, diamond or straight line |
| **Double-click** a stroke | Perfects it afterwards |
| Draw a line **from one shape to another** (and hold) | They get an arrow that follows them when they move |
| Select handwriting → **Aa To text** (Alt+W) | Becomes neat text; other readings are offered next to it. Needs internet |
| Select handwriting → **Straighten** (Alt+L) | Keeps your handwriting, lines it up level and smooths it |
| Select an arrow → **Flow** (Alt+F) | A glowing dot travels along it, and on through arrows that continue one another. Pick a kind (**Dot**, **Stream**, **Comet**, **Ants**, **Wave**) and a colour |
| **🎨 Style** (top right) | Restyles the whole board: **Sketch** (hand-drawn, the lessons' look), **Chalkboard**, **Clean**, **Marker**, **Blueprint**, **Notebook** |
| Select things → **Next step** (Alt+N) | They appear one step later in Play |
| Select a box → **? Quiz** (Alt+Q) | In Play it hides under a card until clicked |
| **Steps** (top right) | Write what to say at each step; **+ Add a step** for a step that only says something |
| **▶ Play** (Alt+Enter) | Step by step: → or Space next, ← back, **S** spotlight (dims earlier steps), Esc to close |
| **K** | Laser pointer, for pointing while you explain |
| Ctrl/⌘ + Z | Undo. A perfected shape goes back to your original ink |
| Scroll, pinch, Ctrl/⌘ + scroll | Move around and zoom; Space + drag pans |

**☰ Boards** (top right) has your boards: new, rename, delete, **Download** (a `.excalidraw` file to keep or
share; it also opens on excalidraw.com) and **Open file**. **?** shows all of this, plus two switches:
- **Hold to perfect:** on by default.
- **Perfect every shape automatically:** off by default, so letters like O and l stay as you wrote them.

## Privacy

- **Boards** stay in your browser on your computer (IndexedDB). Nothing is uploaded.
- **Aa To text** sends only the pen strokes you selected to Google's handwriting service, which reads them. If
  you never press it, nothing leaves your computer.
- **The server** (`npm start`) listens on this computer only (127.0.0.1).

## Lessons

Lessons are explanation files (`lessons/*.json`) that open as boards with their steps already made.
`lessons/00-welcome.json` is an example; open it from ☰ Boards → Lessons. The format, and how a new lesson
appears live, are in [docs/LESSONS.md](docs/LESSONS.md).

## For developers

| Command | What it does |
|---|---|
| `npm start` | Build, then serve on http://localhost:4747 (`WB_PORT` to change; `NO_OPEN=1` to not open a browser) |
| `npm run dev` | Live-reloading development server on http://localhost:5173 (run `npm run serve` too, for lessons) |
| `npm test` | Shape-recognition tests, including the accuracy check (at least 95% of 200 wobbly drawings of each shape) |
| `npm run typecheck` | TypeScript check |

The board is [Excalidraw](https://github.com/excalidraw/excalidraw) (MIT), which draws on the graphics card.
What this project adds:
- `src/ink/`: shape recognition (`recognize.ts`, geometry only, under a millisecond a stroke) and handwriting
  (`handwriting.ts`).
- `src/board/`: the gestures (`useSmartInk.ts`), what they do to the board (`inkActions.ts`), saving
  (`storage.ts`) and lessons (`lessons.ts`).
- `src/learn/`: flowing dots, pulses, ticks and crosses (`FlowLayer.tsx`), Play (`Player.tsx`), and step data
  (`steps.ts`).
- `server.mjs`: the local server, plain Node with no packages.
- `player/`: the original lesson player.

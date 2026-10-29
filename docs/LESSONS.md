# Lessons and questions

Lessons are explanation files the board plays step by step (and opens as editable boards). They live in
`lessons/` next to the app; `npm start` serves them, and the page picks up a new or changed file within a
second. Lessons in `lessons/` are personal and not in git, except `00-welcome.json`.

- In the app: **☰ Boards → Lessons** opens a lesson as an editable board (steps, notes, flowing dots, ticks
  and crosses come with it).
- The original lesson player is at **/player/** (for example http://localhost:4747/player/#00-welcome/2).

## How a new lesson appears

1. Write `lessons/<id>.json` (UTF-8). The id is the file name without `.json`: letters, digits,
   `.`, `-`, `_` only, starting with a letter or digit. Number the files so the list reads well,
   e.g. `07-short-topic.json`.
2. Write the file in one go (or write `<id>.json.tmp` and rename it). Temp and non-`.json` files
   are ignored.
3. The server sees the change, tells the page, and the page opens the new lesson at step 1 with a
   "new" marker. Editing the lesson that is already open reloads it in place and keeps the step.
4. A file that is not valid JSON shows a readable error panel instead of the board (with the parser
   message); the list keeps working. Fix the file and it reloads by itself.
5. Smaller mistakes (unknown ids, a taken cell, a bad kind) do not stop the drawing; they are listed
   under the board as "notes about this lesson file". Read them after writing a lesson.

## Lesson format

```json
{
  "title": "short title",
  "oneLine": "one-sentence answer in plain words",
  "nodes": [
    { "id": "netlify", "label": "Netlify", "sub": "website + functions", "col": 2, "row": 0, "kind": "server" }
  ],
  "arrows": [
    { "id": "a1", "from": "staff", "to": "domain", "label": "opens", "dashed": false }
  ],
  "steps": [
    {
      "say": "1–3 short plain sentences",
      "show": ["staff", "domain", "a1"],
      "flow": ["a1"],
      "cross": ["netlify"],
      "ok": ["backup"],
      "labels": { "setting": "jobsSide = backup" }
    }
  ]
}
```

### Top level

| Field | Required | Meaning |
|---|---|---|
| `title` | yes | Shown as the heading and in the lesson list. Keep it short (under ~45 characters). |
| `oneLine` | no | The answer in one plain sentence, shown under the title. |
| `nodes` | yes | Boxes on the board. At most **12**; extra ones are dropped. |
| `arrows` | no | Lines between nodes. At most **16**. |
| `steps` | no | The story, one screen at a time. At most **10**. With no steps, everything shows at once and `oneLine` is the narration. |

### Nodes

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique within the lesson, shared namespace with arrow ids. Use short lowercase words. |
| `label` | no (defaults to id) | The big handwritten name. 1–3 words fit best; it shrinks and wraps to 2 lines when longer. |
| `sub` | no | Small explanation under the label. Up to ~40 characters reads well (notes take up to ~90). |
| `col` | no | Column **0–4** (left to right). |
| `row` | no | Row **0–3** (top to bottom). |
| `kind` | no (defaults to `server`) | The shape, see below. |

Grid: node centre x = 110 + col × 195, y = 80 + row × 145 on a 1000 × 600 board; a box is about
170 × 78. Out-of-range values are clamped. If two nodes share a cell, the later one moves to the
nearest free cell (and a note says so). A missing col/row also goes to the nearest free cell.

Kinds:

| kind | Drawn as | Use for |
|---|---|---|
| `server` | rectangle | a program, a service, a website host |
| `database` | cylinder | a database |
| `phone` | tall rounded rectangle with a speaker and home button | the phone app, a device |
| `person` | stick figure with the label below | staff, a driver, "You" |
| `cloud` | cloud | the internet, a domain, an outside provider |
| `note` | yellow sticky note | a fact, a list, a rule (long `sub` is fine here) |
| `switch` | rectangle with a toggle mark | a setting, a flag, a choice that can flip |

Layout tips: adjacent columns leave only a short arrow between boxes (fine for "goes into"); leave a
column empty between nodes when the arrow needs a label. Long diagonals that pass through a third
box are the usual problem: move a node or bend the arrow (`bend`, below). Labels place themselves to
avoid boxes, other labels and other lines.

### Arrows

| Field | Required | Meaning |
|---|---|---|
| `id` | no (defaults to `arrow1`, `arrow2`, …) | Needed if a step refers to it. Must not equal a node id. |
| `from`, `to` | yes | Node ids. An arrow with an unknown end, or from a node to itself, is skipped. |
| `label` | no | Short text (1–5 words) shown at the middle on a small background patch. |
| `dashed` | no | `true` draws a dashed line ("only after a switch", "not yet", "optional"). |
| `bend` | no (extra) | Curve the arrow sideways by this many board units (−220…220). Positive bulges to the right of the direction of travel as seen on screen (a left-to-right arrow bulges down, a top-to-bottom arrow bulges left); negative bulges the other way. Use 60–120 to steer around a box. |
| `labelAt` | no (extra) | Where the label sits along the arrow, 0.15–0.85 (default: automatic near the middle). |

The arrow runs from the edge of one box to the edge of the other, with the head at `to`.

### Steps

| Field | Meaning |
|---|---|
| `say` | The narration under the board: 1–3 short plain sentences. |
| `show` | Ids (nodes or arrows) that appear at this step. |
| `flow` | Arrow ids that get a moving dot from `from` to `to` during this step only. Arrows listed so that one ends where the next starts (a→b, b→c) play as one journey, in order. |
| `cross` | Node ids that get a big red X during this step only (down, stopped, blocked). The node is dimmed. |
| `ok` | Node ids that get a green tick during this step only (working, chosen, allowed). |
| `labels` | `{ "id": "new label" }` for nodes or arrows. Applies from this step onward until another step changes it again; going back restores the earlier text. |

Rules:

- Steps are cumulative. An element appears from the first step whose `show` lists it and stays.
  Elements never listed in any `show` are visible from step 1. If no step has a `show`, everything
  is visible from step 1. An arrow never appears before both of its nodes.
- What the current step's `show` lists is highlighted (accent colour, thicker line); elements from
  earlier steps return to normal ink. A node or arrow whose label changes in this step is also
  highlighted. A step with no `show` highlights nothing new (good for "so the result is…" steps).
- `flow`, `cross` and `ok` only affect elements that are already visible.
- Unknown ids anywhere are ignored (and listed in the notes).

### Writing good lessons

- One idea per step; 4–7 steps is the sweet spot. The first step shows the normal situation.
- Labels are names, `sub` is a 2–6 word explanation, `say` is the full sentence. Do not repeat the
  same words in all three.
- Plain words. Explain any technical term the first time it appears in `say`.
- Use `cross` for "what breaks", `ok` for "what still works", `dashed` for "only after the switch".
- Keep the drawing readable at phone width: at most ~8 nodes and ~10 arrows is comfortable.

## Questions from the page

Under the narration there is an "Ask about this lesson" box. Enter (or Cmd/Ctrl+Enter) sends,
Shift+Enter starts a new line; an unsent draft survives a reload. The question is saved with the
lesson and step that were open. The thread below it (newest first) shows "Waiting for Claude…"
until an answer file appears, then the answer, with an "Open lesson" button when the answer names
a lesson that exists. The page never switches lessons by itself for an answer (a new lesson file
still opens itself, as always).

Files (in `questions/`, created by the server):

| File | Content |
|---|---|
| `questions/questions.jsonl` | One question per line, oldest first: `{"id":"q-20261021-143005-k3x9","at":"2026-10-21T18:30:05.120Z","text":"…","lesson":"07-backup-where-we-stand","step":3}`. `lesson` and `step` (1-based) are `null` when no lesson was open. Only the server appends here. |
| `questions/answers/<question id>.json` | The answer: `{"text":"plain text, line breaks kept","lesson":"optional lesson id","at":"ISO time"}`. Written by `answer.mjs`. A question with no file here is unanswered. |

Server endpoints: `POST /api/questions` (JSON `{text, lesson, step}`, text 1–2000 characters after
trimming; accepted only from this machine, from the page's own origin, as `application/json`),
`GET /api/questions` (newest 50, each with `answer`: the answer object or `null`). Server-Sent Events
gain `{"type":"question","id":…}` (a question was posted), `{"type":"answer","id":…}` (an answer
file was written or replaced), `{"type":"answer-removed","id":…}` and `{"type":"questions"}`
(`questions.jsonl` changed on disk).

Two commands for the chat agent (they read and write files only and work without the server):

```
node wait-question.mjs [--timeout <seconds>]
node answer.mjs <question id> [--lesson <lesson id>] < answer-text
```

- `wait-question.mjs` blocks until at least one question has no answer file, then prints all
  unanswered questions (oldest first) as one JSON array line and exits 0. If some are already
  unanswered it prints them at once. It watches the folder (plus a 2-second check as a fallback),
  so it uses no CPU while waiting. With `--timeout`, it prints `[]` and exits 2 when the time runs
  out. Exit 1 = bad arguments.
- `answer.mjs` reads the answer text from stdin and writes `questions/answers/<id>.json` atomically
  (temp file + rename), so the page never sees half an answer. It refuses an unknown question id or
  an empty text (exit 1). Running it again replaces the answer. `--lesson` adds the "Open lesson"
  button; if that lesson file does not exist yet it says so, and the button appears once it does.

The agent loop:

1. Start `node wait-question.mjs` **in the background** (in Claude
   Code: Bash with `run_in_background`). Its exit is what wakes the agent up.
2. When it exits, read the JSON array it printed. Each item has `id`, `text`, and the `lesson` /
   `step` Umer was looking at (read `lessons/<lesson>.json` for context).
3. Answer each question. If a drawing helps, first write a new lesson file into `lessons/` (the
   page opens it by itself), then pass its id with `--lesson`. Write the answer with a heredoc:

   ```
   node answer.mjs q-20261021-143005-k3x9 --lesson 13-new-topic <<'EOF'
   Plain answer in a few short sentences.
   A line break is kept.
   EOF
   ```
4. Start `wait-question.mjs` in the background again. Answered questions are never printed again,
   so a question asked while the agent was busy is picked up at once.


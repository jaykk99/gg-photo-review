Live: https://jaykk99.github.io/gg-photo-review/

# gg-photo-review

Live: https://jaykk99.github.io/gg-photo-review/

Gutter Genie job photo review tool: review before/after photo pairs side by
side, rate and approve the best shots (for quotes, marketing, customer
follow-ups), and export your picks as JSON or CSV.

## Run

Pure static: no build step, no keys, nothing to install. Serve the folder:

```bash
python3 -m http.server 8080
```

Then visit http://localhost:8080/ (or just open `index.html` in a browser).

## Features

- **Before/after pairing**: photos are auto-paired by filename heuristics:
  `*_before` / `*_after` keywords, embedded timestamps (`IMG_20260930_120000`),
  or numeric sequences (`sheet_00` + `sheet_01`). Unpaired photos show solo.
- **Review view**: side-by-side pair viewer with Before/After tags, click a
  photo to focus it (green ring), double-click to zoom. The caption under the
  pair position says how the pair was formed (manual / filename keywords /
  timestamps / sequence).
- **Manual pairing**: in Grid view, select exactly 2 photos and hit
  **🔗 Pair selected** to pin them as a before/after pair (first selected =
  before). Manual pairs win over auto-pairing, persist in localStorage, and
  can be removed with the **Unpair** button in the review view.
- **Swap before/after** (`S`): when auto-pairing gets the roles backwards,
  flip the pair's roles with one click. The swap is pinned, survives rebuilds,
  shows a "swapped by hand" caption, and is itself undoable (Ctrl+Z).
- **Next unreviewed** button jumps to the next pair with unreviewed photos.
- **Approve/Reject all shown** applies a status to every photo in the current
  filter at once (with a confirm step).
- **Grid performance**: large photo sets render in chunks of 120 with a
  "Load more" button instead of dumping everything into the DOM at once.
- **Keyboard shortcuts**: `←`/`→` navigate pairs, `1`–`5` star rating,
  `A` approve, `R` reject, `X` flag, `0` clear rating, hold `Shift` to apply to
  the whole pair, `F` fullscreen, `Ctrl+Z` undo, `?` help.
- **Mobile**: swipe left/right to move between pairs; responsive layout.
- **Zoom**: double-click a photo for the fullscreen lightbox; ←/→ move
  between the pair's photos while zoomed.
- **Accessibility**: skip link to the viewer, aria-live toast announcements,
  dialog roles with focus moved in and restored on close, labeled controls.
- **Grid view**: all photos with status badges and ratings, multi-select for
  batch approve/reject/flag/rate, status filters, filename + note search,
  sort by filename / status / rating, Select-all button.
- **Persistence**: marks, ratings and notes live in the browser's
  localStorage (per device). Old v1 reviewed/flagged marks migrate
  automatically. Undo stack (50 steps) covers every change.
- **Session save/load**: 💾 Save session downloads the full review state
  (marks, ratings, notes, manual pairs) as JSON; 📂 Load session restores it
  on another device, with validation that ignores malformed entries.
- **Export**: download picks as JSON (`gg-picks-<timestamp>.json`), CSV,
  **Markdown report** (`gg-report-<timestamp>.md`, one section per pair with
  status/rating/notes), or a **printable HTML contact sheet**
  (`gg-contact-sheet-<timestamp>.html`, approved picks in a grid).
- **Add photos**: drag & drop image files (or ＋ Add photos) to review ad-hoc
  shots; they're auto-paired too. Uploads are session-only: export before
  closing the tab.

## Adding new contact sheets

Drop the new contact-sheet JPG into the repo. Sheets named `sheet_NN.jpg`
are auto-detected (the app probes for them), so in most cases you don't need
to edit anything. For differently-named files, add the filename to the
`SHEETS` array near the top of `app.js`.

## Tests

- Logic unit tests (pairing heuristics, manual pairs, state, undo, all four
  exports): `node --test test/logic.test.js`
- UI smoke tests (jsdom, drives the real app: keyboard, undo, batch, manual
  pairing, exports, chunked grid, focus management):
  `node test/ui.smoke.js` — needs jsdom installed locally first:

```bash
# one-time, in a scratch dir OUTSIDE the repo (node_modules must not ship
# with the static Pages deploy)
mkdir -p /tmp/jsdom-run && cd /tmp/jsdom-run && npm init -y >/dev/null && npm i jsdom
JSDOM_DIR=/tmp/jsdom-run node test/ui.smoke.js   # run from the repo root
```

The smoke script resolves jsdom from `./node_modules` first, then from
`$JSDOM_DIR/node_modules`, and errors out with install instructions if both
are missing.

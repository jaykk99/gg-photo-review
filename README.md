# gg-photo-review

Gutter Genie job photo review tool — review before/after photo pairs side by
side, rate and approve the best shots (for quotes, marketing, customer
follow-ups), and export your picks as JSON or CSV.

## Run

Pure static — no build step, no keys, nothing to install. Serve the folder:

```bash
python3 -m http.server 8080
```

Then visit http://localhost:8080/ (or just open `index.html` in a browser).

## Features

- **Before/after pairing** — photos are auto-paired by filename heuristics:
  `*_before` / `*_after` keywords, embedded timestamps (`IMG_20260930_120000`),
  or numeric sequences (`sheet_00` + `sheet_01`). Unpaired photos show solo.
- **Review view** — side-by-side pair viewer with Before/After tags, click a
  photo to focus it (green ring), double-click to zoom.
- **Keyboard shortcuts** — `←`/`→` navigate pairs, `1`–`5` star rating,
  `A` approve, `R` reject, `X` flag, `0` clear rating, hold `Shift` to apply to
  the whole pair, `F` fullscreen, `Ctrl+Z` undo, `?` help.
- **Mobile** — swipe left/right to move between pairs; responsive layout.
- **Grid view** — all photos with status badges and ratings, multi-select for
  batch approve/reject/flag/rate, status filters, filename search.
- **Persistence** — marks, ratings and notes live in the browser's
  localStorage (per device). Old v1 reviewed/flagged marks migrate
  automatically. Undo stack (50 steps) covers every change.
- **Export** — download picks as JSON (`gg-picks-<timestamp>.json`) or CSV
  for follow-ups and marketing.
- **Add photos** — drag & drop image files (or ＋ Add photos) to review ad-hoc
  shots; they're auto-paired too. Uploads are session-only — export before
  closing the tab.

## Adding new contact sheets

Drop the new contact-sheet JPG into the repo. Sheets named `sheet_NN.jpg`
are auto-detected (the app probes for them), so in most cases you don't need
to edit anything. For differently-named files, add the filename to the
`SHEETS` array near the top of `app.js`.

## Tests

- Logic unit tests (pairing heuristics, state, undo, export): `node --test test/logic.test.js`
- UI smoke tests (jsdom, drives the real app: keyboard, undo, batch, upload pairing, export): see `/tmp/jsdomtest/smoke.js` (dev-only, not committed)

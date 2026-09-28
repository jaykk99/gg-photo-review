# gg-photo-review

Gutter Genie job photo review tool — browse contact sheets of job photos and
mark each sheet reviewed or flagged for follow-up.

## Run

Pure static HTML — no build step, no keys, nothing to install. Open
`index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8080
```

Then visit http://localhost:8080/

## How it works

- The repo holds contact sheets (`sheet_00.jpg`, `sheet_01.jpg`, …) of job
  photos.
- `index.html` shows them in a grid; click a sheet to view it full-size.
- Mark a sheet **reviewed** or **flagged** — review state is kept in the
  browser's localStorage on that device.

## Adding new sheets

Drop the new contact-sheet JPG into the repo and add its filename to the
`SHEETS` array near the top of `index.html`'s script.


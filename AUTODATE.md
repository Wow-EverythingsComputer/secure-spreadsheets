# Auto-date addition

This is a fork of [standardnotes/secure-spreadsheets](https://github.com/standardnotes/secure-spreadsheets)
with one added feature: **today's date is auto-filled in column A when you start a new row**
(it never overwrites a date you type yourself).

## What was changed
The original editor bundle was **not** modified. The feature is layered on top:

- A published copy of the prebuilt editor lives in [`/docs`](./docs) (served by GitHub Pages).
- [`docs/autodate.js`](./docs/autodate.js) is a small script that hooks into the live Kendo
  spreadsheet (through the global jQuery the editor already loads) and fills the date cell.
- [`docs/index.html`](./docs/index.html) loads that script right after the editor's `dist.js`.

## Settings
Edit the top of [`docs/autodate.js`](./docs/autodate.js):

| Setting | Meaning | Default |
| --- | --- | --- |
| `DATE_COLUMN` | column that auto-fills | `"A"` |
| `START_ROW` | first data row (skips a header) | `2` |
| `DATE_FORMAT` | how the date looks | `"yyyy-mm-dd"` |

Commit and push; GitHub Pages redeploys automatically.

## Install
GitHub Pages serves `/docs`. Paste this into **Standard Notes → Preferences → Install Custom Plugin**:

```
https://wow-everythingscomputer.github.io/secure-spreadsheets/ext.json
```

## Rebuilding from source
The served editor uses the prebuilt files in `/docs`, so no build step is required. If you ever
rebuild from `app/` (webpack — needs Node), port the logic from `docs/autodate.js` into
`app/components/Home.js` so it ends up in the bundle.

# Spreadsheet Enhanced

A fork of [standardnotes/secure-spreadsheets](https://github.com/standardnotes/secure-spreadsheets)
that adds features on top of the official editor, without modifying its bundle.

## Features
- **Auto-date** — when you add a *brand-new* line-item row, the date column is stamped with
  today's date as a real, frozen value (never overwrites a date you type). Rows that already
  existed when the sheet was opened are baselined and left untouched, so switching an existing
  spreadsheet to this editor does **not** back-fill dates onto old rows.
- **Configurable layout** — pick which column gets the date and how many header rows to skip
  from the ⚙ panel. Defaults to column A / 1 header row (so blank sheets work out of the box),
  but existing sheets that keep their data in column A can point the date at any empty column.
- **Per-sheet toggle** — turn auto-date on/off per sheet from the ⚙ panel. Sheets that already
  contain data when first opened default to **off**, so nothing changes until you opt in.
- **Date format** — pick how the date displays (presets, or a custom format). Changing the
  format only restyles cells that are already dates — it never reinterprets your own numbers.

Settings are stored inside the note (a hidden `__enhanced__` key in the saved JSON — the same
trick the editor uses for `rows`/`columns`), so they sync across devices. No extra sheet/tab.

## How it's built
The original bundle is untouched; the feature is layered on:
- A published copy of the prebuilt editor lives in [`/docs`](./docs) (served by GitHub Pages).
- [`docs/enhanced.js`](./docs/enhanced.js) hooks the live Kendo spreadsheet via global jQuery.
- [`docs/index.html`](./docs/index.html) loads it after the editor's `dist.js`.

## Install
Paste into **Standard Notes → Preferences → Install Custom Plugin**:

```
https://wow-everythingscomputer.github.io/secure-spreadsheets/ext.json
```

## Tuning
Most options live in the ⚙ panel. Code-level constants are at the top of `docs/enhanced.js`
(`START_ROW`, column-A index, format presets). Commit + push to redeploy.

## Rebuilding from source
The served editor uses the prebuilt `/docs` files, so no build step is needed. If you ever
rebuild from `app/` (webpack — needs Node), port `docs/enhanced.js` into `app/components/Home.js`.

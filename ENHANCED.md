# Spreadsheet Enhanced

A fork of [standardnotes/secure-spreadsheets](https://github.com/standardnotes/secure-spreadsheets)
that adds features on top of the official editor, without modifying its bundle.

## Features
- **Auto-date** — when you add a *brand-new* line-item row, the date column is stamped with
  today's date as a real, frozen value (never overwrites a date you type). Rows that already
  existed when the sheet was opened are baselined and left untouched, so switching an existing
  spreadsheet to this editor does **not** back-fill dates onto old rows.
- **Configurable layout** — from the ⚙ panel pick which column gets the date, how many header
  rows to skip, and which **data columns** count as a line item. Defaults: column A / 1 header /
  all columns (so blank sheets work out of the box). Set *data columns* (e.g. `B-D`) when the
  sheet has a summary or legend block in other columns, so that block never triggers a date.
- **Per-sheet toggle** — turn auto-date on/off per sheet from the ⚙ panel. Sheets that already
  contain data when first opened default to **off**, so nothing changes until you opt in.
- **Date format** — pick how the date displays (presets, or a custom format). Changing the
  format only restyles cells that are already dates — it never reinterprets your own numbers.
- **Version badge** — the ⚙ panel (and the browser console) shows exactly which build is
  running, e.g. `v1.6.6`. If Standard Notes' webview is serving a stale cached copy of one of
  the two script files, the panel shows a red warning naming both versions — reinstall the
  plugin to resync.
- **Import** — from the ⚙ panel, import files into the editor:
  - **`.xlsx`** — uses the editor's own built-in Excel importer (Standard Notes shipped it but
    hid the button). Replaces the whole spreadsheet; the editor's stock warnings ask first.
  - **`.csv` / `.tsv`** — parsed (quoted fields, escaped quotes, numbers become real numbers,
    leading-zero codes stay text) and added as a **new sheet** — nothing existing is touched.
    Capped at 2000 rows (the status line says if a file was truncated).
  - **backup `.txt`/`.json`** — a note's own saved JSON (like an export). Replaces the whole
    spreadsheet and restores the ⚙ settings stored inside it, after a confirmation.
  Imported rows are baselined — auto-date never stamps them — and imported sheets start with
  auto-date **off**.

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
(defaults, format presets, `MAX_ROWS` safety cap).

## Releasing a change
The version lives in **six places** (ext.json, both JS files, and the `?v=` cache-busters in
both index.html files) and Standard Notes caches aggressively — never bump by hand. Instead:

```
node bump-version.js 1.6.7
git commit -am "..." && git push
```

The script updates every location, keeps `docs/` and the deployed `docs/v2/` copies identical,
and the new `?v=` forces SN's webview to fetch the fresh scripts. The ⚙ panel badge then tells
you (and anyone debugging) exactly which build a device is running.

## Rebuilding from source
The served editor uses the prebuilt `/docs` files, so no build step is needed. If you ever
rebuild from `app/` (webpack — needs Node), port `docs/enhanced.js` into `app/components/Home.js`.

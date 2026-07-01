/*
 * Spreadsheet Enhanced — UI + auto-date layer for the Secure Spreadsheets editor.
 * Loaded AFTER dist.js (needs the live Kendo widget). Settings persistence is handled by
 * enhanced-preinit.js (loaded BEFORE dist.js); both share window.__seConfig.
 *
 * Features:
 *   • Auto-date: when a *brand-new* line-item row gets content, the date column is stamped with
 *     today's date (frozen, editable, never overwrites a typed date). Rows that already existed
 *     when the sheet was opened are baselined and left untouched — switching an existing sheet
 *     to this editor does NOT back-fill dates.
 *   • Configurable layout: date column, how many header rows to skip, and which columns count as
 *     a line item ("data columns") — so a summary/legend block in other columns is ignored.
 *   • Per-sheet toggle. Sheets that already contain data when first opened default to OFF.
 *   • Whitespace-only cells count as empty (so a " " placeholder neither blocks nor triggers).
 *   • Reformat only touches cells that are already dates — never reinterprets your numbers.
 *   • Mobile render safety net (re-applies content if a slow webview fails to paint it).
 */
(function () {
  "use strict";

  // Single source of truth for what build the user is running — shown in the ⚙ panel and the
  // console. Bump with `node bump-version.js <x.y.z>` (keeps ext.json, preinit, and the
  // index.html cache-busters in lockstep).
  var VERSION = "1.6.6";

  var DEFAULT_FMT         = "yyyy-mm-dd";
  var DEFAULT_DATE_COL    = 0;     // column A
  var DEFAULT_HEADER_ROWS = 1;     // row 1 is a header
  var MAX_ROWS            = 4096;   // safety cap; real iteration is bounded by the sheet's row count

  var PRESETS = [
    { label: "2026-06-18",   fmt: "yyyy-mm-dd" },
    { label: "06/18/2026",   fmt: "mm/dd/yyyy" },
    { label: "18/06/2026",   fmt: "dd/mm/yyyy" },
    { label: "06/18",        fmt: "mm/dd" },
    { label: "June 18",      fmt: "mmmm d" },
    { label: "Jun 18, 2026", fmt: "mmm d, yyyy" }
  ];

  // Shared settings (captured/injected by enhanced-preinit.js). Defensive init in case pre-init didn't run.
  window.__seConfig = window.__seConfig || {
    v: 1, dateFormat: DEFAULT_FMT, dateColumn: DEFAULT_DATE_COL, headerRows: DEFAULT_HEADER_ROWS, dataCols: "", autodate: {}
  };
  function cfg() { return window.__seConfig; }
  function dateCol()    { var c = cfg().dateColumn; return (typeof c === "number" && c >= 0) ? c : DEFAULT_DATE_COL; }
  function headerRows() { var h = cfg().headerRows; return (typeof h === "number" && h >= 0) ? h : DEFAULT_HEADER_ROWS; }

  var ss = null;
  var applying = false;
  var els = null;

  // Per-sheet memory of which rows are known "line items", so we only date *new* rows.
  var seen = {};       // sheetName -> { rowIndex: true }
  var hadData = {};    // sheetName -> bool: did the sheet have data when first baselined

  function todayAtMidnight() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  // Whitespace-only strings count as empty (templates often pre-fill cells with " ").
  function isEmpty(v) { return v === null || v === undefined || (typeof v === "string" && v.trim() === ""); }
  // A format counts as a date format if it carries a year or day token (number/currency/text never do).
  function isDateFormat(f) { return typeof f === "string" && /[yd]/i.test(f); }

  // "A" -> 0, "B" -> 1, ... "AA" -> 26. A plain number is treated as a 1-based column. null if unparseable.
  function colToIdx(s) {
    s = (s || "").trim();
    if (!s) return null;
    if (/^\d+$/.test(s)) { var n = parseInt(s, 10); return n >= 1 ? n - 1 : 0; }
    s = s.toUpperCase();
    var v = 0;
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i) - 64; if (c < 1 || c > 26) return null; v = v * 26 + c; }
    return v - 1;
  }
  // Parse a column spec like "B,C,D" or "B-D" into { idx: true }. Empty/blank -> null (= all non-date columns).
  function parseCols(spec) {
    if (!spec || !spec.trim()) return null;
    var set = {}, any = false;
    spec.split(",").forEach(function (part) {
      part = part.trim(); if (!part) return;
      var dash = part.split("-");
      if (dash.length === 2) {
        var a = colToIdx(dash[0]), b = colToIdx(dash[1]);
        if (a != null && b != null) { if (a > b) { var t = a; a = b; b = t; } for (var i = a; i <= b; i++) { set[i] = true; any = true; } }
      } else {
        var x = colToIdx(part); if (x != null) { set[x] = true; any = true; }
      }
    });
    return any ? set : null;
  }
  function dataColSet() { return parseCols(cfg().dataCols); }   // null = watch all non-date columns

  // Default ON for sheets that were empty at open; default OFF for sheets that already had data.
  function sheetEnabled(name) {
    var v = cfg().autodate[name];
    if (v === true) return true;
    if (v === false) return false;
    return !hadData[name];
  }

  // Saving goes through the editor's own save (it saves on "change"); pre-init's toJSON injects settings.
  function persist() { try { ss.trigger("change"); } catch (e) {} }

  // The webview caches enhanced.js and enhanced-preinit.js separately, so one can go stale while
  // the other updates. Compare our version against the one preinit stamped; "" = all good.
  function versionStatus() {
    var pre = window.__sePreinitVersion;
    if (!pre) return "⚠ settings hook not loaded — settings won't save. Reinstall the plugin (or it's a pre-1.6.6 cached copy).";
    if (pre !== VERSION) return "⚠ mixed cache: core v" + pre + " / UI v" + VERSION + ". Reinstall the plugin to resync.";
    return "";
  }

  function detectWidth(sheet) {
    for (var w = 26; w >= 1; w--) {
      try { sheet.range(0, 0, 1, w).values(); return w; } catch (e) {}
    }
    return 1;
  }

  // Real row count of a sheet. Reading past it does NOT throw — Kendo wraps and returns earlier rows —
  // so every scan must be bounded by this, or we'd read (and worse, write) phantom wrapped rows.
  function rowCountOf(sheet) {
    try { if (sheet._grid && sheet._grid.rowCount) return sheet._grid.rowCount; } catch (e) {}
    try { if (sheet._rows && sheet._rows._count) return sheet._rows._count; } catch (e) {}
    return MAX_ROWS;
  }

  // A row is a line item if a watched data column (default: any column other than the date column)
  // holds non-empty content.
  function rowIsItem(vals, dc, cols) {
    for (var c = 0; c < vals.length; c++) {
      if (c === dc) continue;
      if (cols && !cols[c]) continue;
      if (!isEmpty(vals[c])) return true;
    }
    return false;
  }

  // Record which rows are currently populated line-items (the baseline we never back-fill).
  function snapshot(sheet) {
    var out = {}, dc = dateCol(), cols = dataColSet(), width = detectWidth(sheet), start = headerRows();
    var rc = Math.min(rowCountOf(sheet), MAX_ROWS);
    if (rc <= start) return out;
    var rows;
    try { rows = sheet.range(start, 0, rc - start, width).values(); } catch (e) { rows = null; }
    if (!rows) return out;
    for (var i = 0; i < rows.length; i++) {
      if (rowIsItem(rows[i], dc, cols)) out[start + i] = true;
    }
    return out;
  }

  // Baseline every sheet to its current populated rows, so pre-existing rows are never dated.
  // Called at startup AND after every data load (see window.__seAfterLoad), so it works even for
  // notes with no saved settings (the editor loads the note after the widget is created).
  function baselineAll() {
    var sheets = [];
    try { sheets = ss.sheets() || []; } catch (e) {}
    seen = {}; hadData = {};
    sheets.forEach(function (s) {
      var nm; try { nm = s.name(); } catch (e) { return; }
      var snap = snapshot(s);
      seen[nm] = snap;
      var n = 0; for (var k in snap) { if (snap.hasOwnProperty(k)) n++; }
      hadData[nm] = n > 0;
    });
  }

  // ---------- the core feature ----------
  function fillDates() {
    if (applying || !ss) return;
    var sheet, name;
    try { sheet = ss.activeSheet(); name = sheet.name(); } catch (e) { return; }
    if (!sheetEnabled(name)) return;

    if (!seen[name]) { seen[name] = snapshot(sheet); }   // sheet created after load (empty) -> {}
    var known = seen[name];

    var fmt = cfg().dateFormat || DEFAULT_FMT;
    var dc = dateCol();
    var cols = dataColSet();
    var width = detectWidth(sheet);
    var start = headerRows();
    var rc = Math.min(rowCountOf(sheet), MAX_ROWS);
    var changed = false;
    applying = true;
    try {
      var rows = null;
      if (rc > start) { try { rows = sheet.range(start, 0, rc - start, width).values(); } catch (e) { rows = null; } }
      for (var i = 0; rows && i < rows.length; i++) {
        var r = start + i, vals = rows[i];
        var item = rowIsItem(vals, dc, cols);
        if (item && !known[r]) {
          known[r] = true;                          // a brand-new line item
          if (isEmpty(vals[dc])) {                  // ...with an empty date cell -> stamp it
            var cell = sheet.range(r, dc);
            cell.value(todayAtMidnight());
            cell.format(fmt);
            changed = true;
          }
        } else if (!item && known[r]) {
          delete known[r];                          // row was cleared out
        }
      }
      if (changed) ss.trigger("change");
    } finally { applying = false; }
  }

  // Reformat only cells that are ALREADY dates — never convert a plain number into a date.
  function reformatActive(fmt) {
    if (!ss) return;
    var dc = dateCol(), start = headerRows();
    applying = true;
    try {
      var sheet = ss.activeSheet();
      var rc = Math.min(rowCountOf(sheet), MAX_ROWS);
      for (var r = start; r < rc; r++) {
        var cell, v, f;
        try { cell = sheet.range(r, dc); v = cell.value(); } catch (e) { continue; }
        if (isEmpty(v)) continue;
        try { f = cell.format(); } catch (e) { f = null; }
        if (isDateFormat(f)) { try { cell.format(fmt); } catch (e) {} }
      }
    } finally { applying = false; }
  }

  // Mobile render safety net: if the grid didn't paint the loaded sheets, re-apply once.
  function ensureRendered() {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      try {
        var ld = window.__seLastData;
        var expected = (ld && ld.sheets) ? ld.sheets.map(function (s) { return s.name; }) : null;
        if (expected && expected.length) {
          var live = [];
          try { live = (ss.sheets() || []).map(function (s) { try { return s.name(); } catch (e) { return ""; } }); } catch (e) {}
          var match = live.length === expected.length && expected.every(function (n) { return live.indexOf(n) >= 0; });
          if (match) { clearInterval(timer); return; }
          if (typeof window.__seReapply === "function") window.__seReapply(ss);
          try { ss.refresh(); } catch (e) {}
          try { baselineAll(); } catch (e) {}
          if (els) refreshPanel();
        }
      } catch (e) {}
      if (tries > 20) clearInterval(timer);
    }, 300);
  }

  // ---------- settings panel ----------
  function injectUI() {
    var style = document.createElement("style");
    style.textContent =
      ".se-fab{position:fixed;right:14px;bottom:14px;z-index:99999;width:38px;height:38px;border-radius:50%;" +
      "border:1px solid rgba(0,0,0,.15);background:#fff;color:#333;font-size:18px;line-height:36px;text-align:center;" +
      "cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.2)}" +
      ".se-fab:hover{background:#f3f3f3}" +
      ".se-panel{position:fixed;right:14px;bottom:60px;z-index:99999;width:268px;background:#fff;color:#222;" +
      "border:1px solid rgba(0,0,0,.15);border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.25);" +
      "font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:12px 14px;display:none}" +
      ".se-panel.open{display:block}" +
      ".se-panel h4{margin:0 0 8px;font-size:13px}" +
      ".se-panel label.se-row{display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer}" +
      ".se-sec{margin-top:10px;border-top:1px solid #eee;padding-top:8px}" +
      ".se-muted{color:#888;font-size:11px;margin-top:2px}" +
      ".se-panel select,.se-panel input[type=text]{width:100%;margin-top:4px;padding:5px;border:1px solid #ccc;" +
      "border-radius:6px;font:inherit;box-sizing:border-box}" +
      ".se-panel .se-row select,.se-panel .se-row input{width:74px;margin-top:0}" +
      ".se-sheets{max-height:160px;overflow:auto}";
    document.head.appendChild(style);

    var fab = document.createElement("button");
    fab.className = "se-fab"; fab.textContent = "⚙"; fab.title = "Spreadsheet Enhanced v" + VERSION + " — settings";

    var panel = document.createElement("div");
    panel.className = "se-panel";

    var title = document.createElement("h4"); title.textContent = "Spreadsheet Enhanced";
    var verBadge = document.createElement("span");
    verBadge.textContent = "v" + VERSION;
    verBadge.style.cssText = "float:right;color:#888;font-weight:normal;font-size:11px";
    title.appendChild(verBadge);
    var verWarn = document.createElement("div");
    verWarn.className = "se-muted"; verWarn.style.color = "#b00020"; verWarn.style.display = "none";

    var fmtSec = document.createElement("div"); fmtSec.className = "se-sec";
    var fmtLbl = document.createElement("div"); fmtLbl.textContent = "Date format";
    var fmtSel = document.createElement("select");
    PRESETS.forEach(function (p) {
      var o = document.createElement("option"); o.value = p.fmt; o.textContent = p.label; fmtSel.appendChild(o);
    });
    var optC = document.createElement("option"); optC.value = "__custom__"; optC.textContent = "Custom…"; fmtSel.appendChild(optC);
    var fmtCustom = document.createElement("input"); fmtCustom.type = "text"; fmtCustom.placeholder = "e.g. yyyy/mm/dd"; fmtCustom.style.display = "none";
    var fmtHint = document.createElement("div"); fmtHint.className = "se-muted"; fmtHint.textContent = "tokens: yyyy mm dd  •  mmm/mmmm = Jun/June  •  d = no leading zero";
    fmtSec.appendChild(fmtLbl); fmtSec.appendChild(fmtSel); fmtSec.appendChild(fmtCustom); fmtSec.appendChild(fmtHint);

    var laySec = document.createElement("div"); laySec.className = "se-sec";
    var layLbl = document.createElement("div"); layLbl.textContent = "Sheet layout";
    var colRow = document.createElement("label"); colRow.className = "se-row";
    var colTxt = document.createElement("span"); colTxt.textContent = "Date column"; colTxt.style.flex = "1";
    var colSel = document.createElement("select");
    for (var ci = 0; ci < 26; ci++) { var co = document.createElement("option"); co.value = String(ci); co.textContent = String.fromCharCode(65 + ci); colSel.appendChild(co); }
    colRow.appendChild(colTxt); colRow.appendChild(colSel);
    var hdrRow = document.createElement("label"); hdrRow.className = "se-row";
    var hdrTxt = document.createElement("span"); hdrTxt.textContent = "Header rows"; hdrTxt.style.flex = "1";
    var hdrInp = document.createElement("input"); hdrInp.type = "number"; hdrInp.min = "0"; hdrInp.max = "10";
    hdrRow.appendChild(hdrTxt); hdrRow.appendChild(hdrInp);
    var dcRow = document.createElement("div");
    var dcLbl = document.createElement("div"); dcLbl.textContent = "Data columns";
    var dcInp = document.createElement("input"); dcInp.type = "text"; dcInp.placeholder = "all (e.g. B-D)";
    dcRow.appendChild(dcLbl); dcRow.appendChild(dcInp);
    var layHint = document.createElement("div"); layHint.className = "se-muted";
    layHint.textContent = "Date goes in the date column when a NEW row gets content in a data column. Leave data columns blank to watch every column; set e.g. B-D to ignore a summary block.";
    laySec.appendChild(layLbl); laySec.appendChild(colRow); laySec.appendChild(hdrRow); laySec.appendChild(dcRow); laySec.appendChild(layHint);

    var shSec = document.createElement("div"); shSec.className = "se-sec";
    var shLbl = document.createElement("div"); shLbl.textContent = "Auto-date these sheets";
    var shList = document.createElement("div"); shList.className = "se-sheets";
    var shHint = document.createElement("div"); shHint.className = "se-muted"; shHint.textContent = "Off by default for sheets that already had data — tick to enable.";
    shSec.appendChild(shLbl); shSec.appendChild(shList); shSec.appendChild(shHint);

    panel.appendChild(title); panel.appendChild(verWarn); panel.appendChild(fmtSec); panel.appendChild(laySec); panel.appendChild(shSec);
    document.body.appendChild(fab); document.body.appendChild(panel);

    els = { fab: fab, panel: panel, format: fmtSel, custom: fmtCustom, dateCol: colSel, header: hdrInp, dataCols: dcInp, sheets: shList, verWarn: verWarn };

    fab.addEventListener("click", function () { if (panel.classList.toggle("open")) refreshPanel(); });
    fmtSel.addEventListener("change", function () {
      if (fmtSel.value === "__custom__") { fmtCustom.style.display = "block"; fmtCustom.focus(); return; }
      fmtCustom.style.display = "none";
      cfg().dateFormat = fmtSel.value; reformatActive(cfg().dateFormat); persist();
    });
    fmtCustom.addEventListener("change", function () {
      cfg().dateFormat = fmtCustom.value.trim() || DEFAULT_FMT; reformatActive(cfg().dateFormat); persist();
    });
    colSel.addEventListener("change", function () {
      var n = parseInt(colSel.value, 10); cfg().dateColumn = (isNaN(n) || n < 0) ? DEFAULT_DATE_COL : n;
      baselineAll(); persist();
    });
    hdrInp.addEventListener("change", function () {
      var n = parseInt(hdrInp.value, 10); cfg().headerRows = (isNaN(n) || n < 0) ? DEFAULT_HEADER_ROWS : n;
      baselineAll(); persist();
    });
    dcInp.addEventListener("change", function () {
      cfg().dataCols = dcInp.value.trim();
      baselineAll(); persist();
    });
  }

  function buildSheetList() {
    var box = els.sheets; box.innerHTML = "";
    var sheets = [];
    try { sheets = ss.sheets() || []; } catch (e) {}
    if (!sheets.length) { box.textContent = "(no sheets found)"; return; }
    sheets.forEach(function (s) {
      var nm; try { nm = s.name(); } catch (e) { nm = "?"; }
      var row = document.createElement("label"); row.className = "se-row";
      var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = sheetEnabled(nm);
      cb.addEventListener("change", function () { cfg().autodate[nm] = cb.checked; persist(); });
      var span = document.createElement("span"); span.textContent = nm;
      row.appendChild(cb); row.appendChild(span); box.appendChild(row);
    });
  }

  function refreshPanel() {
    if (!els) return;
    var vs = versionStatus();
    els.verWarn.textContent = vs;
    els.verWarn.style.display = vs ? "block" : "none";
    var fmt = cfg().dateFormat || DEFAULT_FMT;
    var isPreset = PRESETS.some(function (p) { return p.fmt === fmt; });
    els.format.value = isPreset ? fmt : "__custom__";
    els.custom.style.display = isPreset ? "none" : "block";
    els.custom.value = isPreset ? "" : fmt;
    els.dateCol.value = String(dateCol());
    els.header.value = String(headerRows());
    els.dataCols.value = cfg().dataCols || "";
    buildSheetList();
  }

  // ---------- startup ----------
  function start(sp) {
    ss = sp;
    // The editor creates the widget, THEN loads the note (async). Re-baseline after every data load
    // so pre-existing rows are captured even when the note has no saved settings.
    window.__seAfterLoad = function () {
      setTimeout(function () { try { baselineAll(); refreshPanel(); } catch (e) {} }, 0);
    };
    window.__seOnConfigLoaded = window.__seAfterLoad;   // back-compat alias
    baselineAll();
    ss.bind("change", function () { fillDates(); });
    try { injectUI(); refreshPanel(); } catch (e) { console.warn("[Enhanced] UI failed", e); }
    try { ensureRendered(); } catch (e) {}
    var vs = versionStatus();
    console.log("[Spreadsheet Enhanced] v" + VERSION + " ready" + (vs ? " — " + vs : ""));
  }

  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    var jq = window.jQuery || window.$;
    if (typeof jq === "function") {
      var sp = jq("#spreadsheet").data("kendoSpreadsheet");
      if (sp) { clearInterval(timer); start(sp); return; }
    }
    if (tries > 200) { clearInterval(timer); console.warn("[Spreadsheet Enhanced] spreadsheet not found"); }
  }, 40);
})();

/*
 * Spreadsheet Enhanced — UI + auto-date layer for the Secure Spreadsheets editor.
 * Loaded AFTER dist.js (needs the live Kendo widget). Settings persistence is handled by
 * enhanced-preinit.js (loaded BEFORE dist.js); both share window.__seConfig.
 *
 * Features:
 *   • Auto-date: when a new row (row 2 down) gets content but column A is empty, column A is
 *     stamped with today's date (frozen, editable, never overwrites a typed date).
 *   • Per-sheet toggle + selectable date format, via the ⚙ panel; settings persist in-note.
 *   • Mobile render safety net (re-applies content if a slow webview fails to paint it).
 */
(function () {
  "use strict";

  var START_ROW    = 2;            // first data row (row 1 is treated as a header)
  var DATE_COL_IDX = 0;            // column A
  var DEFAULT_FMT  = "yyyy-mm-dd";
  var MAX_ROWS     = 600;

  var PRESETS = [
    { label: "2026-06-18",   fmt: "yyyy-mm-dd" },
    { label: "06/18/2026",   fmt: "mm/dd/yyyy" },
    { label: "18/06/2026",   fmt: "dd/mm/yyyy" },
    { label: "06/18",        fmt: "mm/dd" },
    { label: "June 18",      fmt: "mmmm d" },
    { label: "Jun 18, 2026", fmt: "mmm d, yyyy" }
  ];

  // Shared settings (captured/injected by enhanced-preinit.js). Defensive init in case pre-init didn't run.
  window.__seConfig = window.__seConfig || { v: 1, dateFormat: DEFAULT_FMT, autodate: {} };
  function cfg() { return window.__seConfig; }

  var ss = null;
  var applying = false;
  var els = null;

  function todayAtMidnight() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function isEmpty(v) { return v === null || v === undefined || v === ""; }
  function sheetEnabled(name) { return cfg().autodate[name] !== false; }   // default ON

  // Saving goes through the editor's own save (it saves on "change"); pre-init's toJSON injects settings.
  function persist() { try { ss.trigger("change"); } catch (e) {} }

  function detectWidth(sheet) {
    for (var w = 26; w >= 1; w--) {
      try { sheet.range(START_ROW - 1, 0, 1, w).values(); return w; } catch (e) {}
    }
    return 1;
  }

  // ---------- the core feature ----------
  function fillDates() {
    if (applying || !ss) return;
    var sheet, name;
    try { sheet = ss.activeSheet(); name = sheet.name(); } catch (e) { return; }
    if (!sheetEnabled(name)) return;

    var fmt = cfg().dateFormat || DEFAULT_FMT;
    var width = detectWidth(sheet);
    var changed = false;
    applying = true;
    try {
      for (var i = 0; i < MAX_ROWS; i++) {
        var r = (START_ROW - 1) + i, vals;
        try { vals = sheet.range(r, 0, 1, width).values()[0]; } catch (edge) { break; }
        if (!vals) break;
        if (!isEmpty(vals[DATE_COL_IDX])) continue;       // already dated -> leave it
        var started = false;
        for (var c = 0; c < vals.length; c++) {
          if (c !== DATE_COL_IDX && !isEmpty(vals[c])) { started = true; break; }
        }
        if (started) {
          var cell = sheet.range(r, DATE_COL_IDX);
          cell.value(todayAtMidnight());
          cell.format(fmt);
          changed = true;
        }
      }
      if (changed) ss.trigger("change");
    } finally { applying = false; }
  }

  function reformatActive(fmt) {
    if (!ss) return;
    applying = true;
    try {
      var sheet = ss.activeSheet();
      for (var i = 0; i < MAX_ROWS; i++) {
        var r = (START_ROW - 1) + i, v;
        try { v = sheet.range(r, 0, 1, 1).values()[0][0]; } catch (e) { break; }
        if (!isEmpty(v)) { try { sheet.range(r, 0).format(fmt); } catch (e) {} }
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
      ".se-sheets{max-height:160px;overflow:auto}";
    document.head.appendChild(style);

    var fab = document.createElement("button");
    fab.className = "se-fab"; fab.textContent = "⚙"; fab.title = "Spreadsheet Enhanced settings";

    var panel = document.createElement("div");
    panel.className = "se-panel";

    var title = document.createElement("h4"); title.textContent = "Spreadsheet Enhanced";

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

    var shSec = document.createElement("div"); shSec.className = "se-sec";
    var shLbl = document.createElement("div"); shLbl.textContent = "Auto-date these sheets";
    var shList = document.createElement("div"); shList.className = "se-sheets";
    var shHint = document.createElement("div"); shHint.className = "se-muted"; shHint.textContent = "Column A gets today's date on new rows (row 2 down).";
    shSec.appendChild(shLbl); shSec.appendChild(shList); shSec.appendChild(shHint);

    panel.appendChild(title); panel.appendChild(fmtSec); panel.appendChild(shSec);
    document.body.appendChild(fab); document.body.appendChild(panel);

    els = { fab: fab, panel: panel, format: fmtSel, custom: fmtCustom, sheets: shList };

    fab.addEventListener("click", function () { if (panel.classList.toggle("open")) refreshPanel(); });
    fmtSel.addEventListener("change", function () {
      if (fmtSel.value === "__custom__") { fmtCustom.style.display = "block"; fmtCustom.focus(); return; }
      fmtCustom.style.display = "none";
      cfg().dateFormat = fmtSel.value; reformatActive(cfg().dateFormat); persist();
    });
    fmtCustom.addEventListener("change", function () {
      cfg().dateFormat = fmtCustom.value.trim() || DEFAULT_FMT; reformatActive(cfg().dateFormat); persist();
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
    var fmt = cfg().dateFormat || DEFAULT_FMT;
    var isPreset = PRESETS.some(function (p) { return p.fmt === fmt; });
    els.format.value = isPreset ? fmt : "__custom__";
    els.custom.style.display = isPreset ? "none" : "block";
    els.custom.value = isPreset ? "" : fmt;
    buildSheetList();
  }

  // ---------- startup ----------
  function start(sp) {
    ss = sp;
    window.__seOnConfigLoaded = function () { try { refreshPanel(); } catch (e) {} };   // refresh UI if note settings arrive after panel built
    ss.bind("change", function () { fillDates(); });
    try { injectUI(); refreshPanel(); } catch (e) { console.warn("[Enhanced] UI failed", e); }
    try { ensureRendered(); } catch (e) {}
    console.log("[Spreadsheet Enhanced] ready");
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

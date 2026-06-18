/*
 * Spreadsheet Enhanced — add-on layered on the prebuilt Secure Spreadsheets editor.
 *
 * Loaded via a <script> tag in index.html (after dist.js). It does NOT modify the editor
 * bundle; it talks to the live Kendo Spreadsheet widget through the global jQuery the editor
 * already loads.
 *
 * Features:
 *   • Auto-date: when a new row (row 2 down) gets content but column A is empty, column A is
 *     stamped with today's date as a real value (frozen, editable, never overwrites a typed date).
 *   • Per-sheet toggle: auto-date can be turned on/off per sheet.
 *   • Date format: choose how the stamped date is displayed.
 *
 * Settings persist INSIDE the note (as a hidden "__enhanced__" key in the saved JSON, the same
 * trick the editor uses for rows/columns), so they sync across devices. No extra sheet/tab.
 */
(function () {
  "use strict";

  // ---------- constants ----------
  var START_ROW    = 2;            // first data row (row 1 is treated as a header)
  var DATE_COL_IDX = 0;            // column A
  var DEFAULT_FMT  = "yyyy-mm-dd";
  var MAX_ROWS     = 600;          // safety cap on rows scanned
  var KEY          = "__enhanced__";

  var PRESETS = [
    { label: "2026-06-18",   fmt: "yyyy-mm-dd" },
    { label: "06/18/2026",   fmt: "mm/dd/yyyy" },
    { label: "18/06/2026",   fmt: "dd/mm/yyyy" },
    { label: "06/18",        fmt: "mm/dd" },
    { label: "June 18",      fmt: "mmmm d" },
    { label: "Jun 18, 2026", fmt: "mmm d, yyyy" }
  ];

  // ---------- state ----------
  // config.autodate maps sheetName -> boolean. A sheet not listed defaults to ON.
  var config  = { v: 1, dateFormat: DEFAULT_FMT, autodate: {} };
  var ss      = null;     // the Kendo Spreadsheet widget
  var applying = false;   // guard so our own edits don't recurse
  var els      = null;    // settings-panel DOM refs

  // ---------- helpers ----------
  function todayAtMidnight() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function isEmpty(v) { return v === null || v === undefined || v === ""; }
  function sheetEnabled(name) { return config.autodate[name] !== false; }   // default ON

  // ---------- persistence: piggyback on the note's saved JSON ----------
  function installPersistence(sp) {
    var origTo   = sp.toJSON.bind(sp);
    var origFrom = sp.fromJSON.bind(sp);
    sp.toJSON = function () {
      var j = origTo();
      try { j[KEY] = config; } catch (e) {}
      return j;
    };
    sp.fromJSON = function (data) {
      try {
        var loaded = data && data[KEY];
        if (loaded && typeof loaded === "object") {
          config = {
            v: 1,
            dateFormat: loaded.dateFormat || DEFAULT_FMT,
            autodate: (loaded.autodate && typeof loaded.autodate === "object") ? loaded.autodate : {}
          };
          if (els) refreshPanel();
        }
      } catch (e) {}
      return origFrom(data);
    };
  }

  // Save by letting the editor's own save run (it saves on the "change" event).
  function persist() { try { ss.trigger("change"); } catch (e) {} }

  // Find a row width the sheet accepts (handles sheets with fewer than 26 columns).
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

    var fmt = config.dateFormat || DEFAULT_FMT;
    var width = detectWidth(sheet);
    var changed = false;
    applying = true;
    try {
      for (var i = 0; i < MAX_ROWS; i++) {
        var r = (START_ROW - 1) + i;
        var vals;
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
      if (changed) ss.trigger("change");                  // persist via the editor's own save
    } finally {
      applying = false;
    }
  }

  // Re-apply a new format to existing date cells in column A of the active sheet.
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

  // ---------- settings panel (plain DOM, no framework) ----------
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

    fab.addEventListener("click", function () {
      var open = panel.classList.toggle("open");
      if (open) refreshPanel();
    });
    fmtSel.addEventListener("change", function () {
      if (fmtSel.value === "__custom__") { fmtCustom.style.display = "block"; fmtCustom.focus(); return; }
      fmtCustom.style.display = "none";
      config.dateFormat = fmtSel.value; reformatActive(config.dateFormat); persist();
    });
    fmtCustom.addEventListener("change", function () {
      config.dateFormat = fmtCustom.value.trim() || DEFAULT_FMT; reformatActive(config.dateFormat); persist();
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
      cb.addEventListener("change", function () { config.autodate[nm] = cb.checked; persist(); });
      var span = document.createElement("span"); span.textContent = nm;
      row.appendChild(cb); row.appendChild(span); box.appendChild(row);
    });
  }

  function refreshPanel() {
    if (!els) return;
    var fmt = config.dateFormat || DEFAULT_FMT;
    var isPreset = PRESETS.some(function (p) { return p.fmt === fmt; });
    els.format.value = isPreset ? fmt : "__custom__";
    els.custom.style.display = isPreset ? "none" : "block";
    els.custom.value = isPreset ? "" : fmt;
    buildSheetList();
  }

  // ---------- startup ----------
  function start(sp) {
    ss = sp;
    try { installPersistence(ss); } catch (e) { console.warn("[Enhanced] persistence hook failed", e); }
    ss.bind("change", function () { fillDates(); });   // core auto-date (works even if UI fails)
    try { injectUI(); refreshPanel(); } catch (e) { console.warn("[Enhanced] UI failed", e); }
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

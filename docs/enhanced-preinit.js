/*
 * Spreadsheet Enhanced — pre-init hook. MUST load AFTER kendo.spreadsheet.min.js and
 * BEFORE dist.js, so the settings wrap is installed before the editor loads the note
 * (fixes a mobile timing race where the note loaded before the per-instance wrap existed).
 *
 * It patches Kendo's Spreadsheet prototype to:
 *   - toJSON():   inject our settings under the hidden "__enhanced__" key (so they save in-note)
 *   - fromJSON(): capture those settings into window.__seConfig (so the UI/auto-date can read them)
 * Settings are shared with enhanced.js via window.__seConfig / window.__seLastData / window.__seReapply.
 */
(function () {
  "use strict";
  var KEY = "__enhanced__";
  var DEFAULT_FMT = "yyyy-mm-dd";

  // Version stamp read by enhanced.js — if it differs from enhanced.js's VERSION, the webview is
  // serving a stale cached copy of one of the two files and the ⚙ panel shows a warning.
  window.__sePreinitVersion = "1.8.0";

  window.__seConfig = window.__seConfig || { v: 1, dateFormat: DEFAULT_FMT, dateColumn: 0, headerRows: 1, dataCols: "", autodate: {} };
  window.__seLastData = null;

  // ---------- focus guard ----------
  // Kendo focuses its hidden contenteditable clipboard on nearly every grid render
  // (View.renderClipboardContents -> selectClipboardContents), and again whenever a cell editor
  // blurs. When the user isn't working in the grid, that focus() yanks the caret out of the note's
  // title field (keystrokes then land in a cell) and pops the mobile keyboard back up the instant
  // it's dismissed. Only let the grid take focus while the user is actually interacting with it.
  var engaged = false;   // user is working in the spreadsheet frame
  var lastPointer = 0;
  function now() { return Date.now ? Date.now() : +new Date(); }
  function inOwnUI(t) { try { return !!(t && t.closest && t.closest(".se-panel, .se-fab")); } catch (e) { return false; } }
  function inGrid(t) { try { return !!(t && t.closest && t.closest(".k-spreadsheet")); } catch (e) { return false; } }

  function mayFocus() {
    if (engaged) return true;
    // Already focused inside the grid and the frame has focus -> re-focusing steals nothing.
    try { return document.hasFocus() && inGrid(document.activeElement); } catch (e) { return false; }
  }
  window.__seMayFocus = mayFocus;

  function installFocusGuard() {
    if (window.__seFocusGuard) return;
    window.__seFocusGuard = true;
    function onPointer(e) { lastPointer = now(); engaged = !inOwnUI(e.target); }
    ["pointerdown", "mousedown", "touchstart"].forEach(function (ev) { document.addEventListener(ev, onPointer, true); });
    document.addEventListener("keydown", function (e) { if (!inOwnUI(e.target)) engaged = true; }, true);
    // Focus left the frame (title field, another note, the parent app) -> disengage.
    window.addEventListener("blur", function () { engaged = false; });
    // Something in the frame lost focus to nothing (iOS keyboard "Done", or the parent took focus).
    // Capture phase, so this runs BEFORE Kendo's own blur handler tries to refocus the clipboard.
    // A blur caused by a tap/click inside the frame keeps us engaged.
    function onBlur(e) { if (!e.relatedTarget && now() - lastPointer > 400) engaged = false; }
    document.addEventListener("blur", onBlur, true);
    document.addEventListener("focusout", onBlur, true);

    var V = window.kendo && kendo.spreadsheet && kendo.spreadsheet.View;
    if (V && V.prototype && typeof V.prototype.selectClipboardContents === "function") {
      var origSel = V.prototype.selectClipboardContents;
      V.prototype.selectClipboardContents = function () {
        if (!mayFocus()) return;
        return origSel.apply(this, arguments);
      };
    }
  }

  // Gate direct .focus() calls on the clipboard node too (Kendo calls them after editor blur,
  // Esc, sheet rename...). Called by enhanced.js once the widget exists.
  window.__seGuardElement = function (el) {
    if (!el || el.__seGuarded) return;
    var nativeFocus = el.focus;
    el.focus = function () { if (mayFocus()) return nativeFocus.apply(this, arguments); };
    el.__seGuarded = true;
  };

  function patch() {
    // The widget class is kendo.ui.Spreadsheet — NOT kendo.spreadsheet.Spreadsheet (which doesn't
    // exist; the old target meant this hook never installed, so settings never saved and the
    // auto-date baseline never re-ran after a note loaded).
    var S = window.kendo && kendo.ui && kendo.ui.Spreadsheet;
    if (!S || !S.prototype || typeof S.prototype.toJSON !== "function" || typeof S.prototype.fromJSON !== "function") return false;
    if (S.prototype.__sePatched) return true;

    var proto = S.prototype;
    var origTo = proto.toJSON;
    var origFrom = proto.fromJSON;
    var origRefresh = proto.refresh;

    installFocusGuard();

    // States this widget produced recently (toJSON results — i.e. what got saved). Home.js adds
    // rows/columns onto the same object afterwards; sig() strips those, so the references are fine.
    var recent = [];
    var lastDims = null;          // rows/columns of the last data actually applied
    var skipRefresh = false;

    proto.toJSON = function () {
      var j = origTo.apply(this, arguments);
      try { recent.push(j); if (recent.length > 8) recent.shift(); } catch (e) {}
      try { j[KEY] = window.__seConfig; } catch (e) {}
      return j;
    };

    // Comparable signature of a workbook JSON: everything except the editor's rows/columns and our key.
    function sig(o) {
      if (!o || typeof o !== "object") return "";
      var c = {};
      for (var k in o) { if (o.hasOwnProperty(k) && k !== "rows" && k !== "columns" && k !== KEY) c[k] = o[k]; }
      try { return JSON.stringify(c); } catch (e) { return ""; }
    }

    // The base editor calls fromJSON()+refresh() on EVERY non-metadata note update — including a
    // plain title rename, or the echo of its own save. That full rebuild re-renders the grid, which
    // grabs focus (stealing keystrokes from the title field / popping the mobile keyboard), resets
    // the selection, and can revert cells typed since that save. If the incoming data is what the
    // widget already shows (or an echo of something it saved moments ago), skip the reload.
    function isNoop(ss, data) {
      if (!data || !data.sheets || !lastDims) return false;
      if (data.rows !== lastDims.rows || data.columns !== lastDims.columns) return false;  // row/col insert rebuild
      var s = sig(data);
      if (!s) return false;
      for (var i = recent.length - 1; i >= 0; i--) { if (sig(recent[i]) === s) return true; }
      var cur;
      try { cur = origTo.call(ss); } catch (e) { return false; }
      return sig(cur) === s;
    }

    proto.refresh = function () {
      if (skipRefresh) { skipRefresh = false; return this; }
      return origRefresh.apply(this, arguments);
    };

    proto.fromJSON = function (data) {
      if (isNoop(this, data)) {
        window.__seLastData = data;
        skipRefresh = true;                                   // ...and the refresh() that follows it
        setTimeout(function () { skipRefresh = false; }, 0);
        return this;
      }
      try { lastDims = { rows: data && data.rows, columns: data && data.columns }; } catch (e) {}
      try {
        window.__seLastData = data;
        var loaded = data && data[KEY];
        if (loaded && typeof loaded === "object") {
          window.__seConfig = {
            v: 1,
            dateFormat: loaded.dateFormat || DEFAULT_FMT,
            dateColumn: (typeof loaded.dateColumn === "number" && loaded.dateColumn >= 0) ? loaded.dateColumn : 0,
            headerRows: (typeof loaded.headerRows === "number" && loaded.headerRows >= 0) ? loaded.headerRows : 1,
            dataCols: (typeof loaded.dataCols === "string") ? loaded.dataCols : "",
            autodate: (loaded.autodate && typeof loaded.autodate === "object") ? loaded.autodate : {}
          };
        }
      } catch (e) {}
      var ret = origFrom.apply(this, arguments);   // load the data into the widget FIRST...
      // ...then notify enhanced.js so it can re-baseline against the freshly-loaded rows. This fires
      // for EVERY load (even notes with no saved settings), fixing the "baseline ran on the empty
      // default sheet before the note arrived" race that let pre-existing rows get dated.
      try { if (typeof window.__seAfterLoad === "function") window.__seAfterLoad(); } catch (e) {}
      return ret;
    };

    // Re-apply the last loaded data to a widget (used by enhanced.js's mobile render safety net).
    window.__seReapply = function (ss) {
      try { if (window.__seLastData) origFrom.call(ss, window.__seLastData); } catch (e) {}
    };

    proto.__sePatched = true;
    console.log("[Spreadsheet Enhanced] settings hook installed (pre-init)");
    return true;
  }

  // kendo.spreadsheet.min.js loads before this script, so this normally succeeds immediately.
  if (!patch()) {
    var n = 0;
    var t = setInterval(function () { if (patch() || ++n > 100) clearInterval(t); }, 10);
  }
})();

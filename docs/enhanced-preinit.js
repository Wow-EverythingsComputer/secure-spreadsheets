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
  window.__sePreinitVersion = "1.7.0";

  window.__seConfig = window.__seConfig || { v: 1, dateFormat: DEFAULT_FMT, dateColumn: 0, headerRows: 1, dataCols: "", autodate: {} };
  window.__seLastData = null;

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

    proto.toJSON = function () {
      var j = origTo.apply(this, arguments);
      try { j[KEY] = window.__seConfig; } catch (e) {}
      return j;
    };

    proto.fromJSON = function (data) {
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

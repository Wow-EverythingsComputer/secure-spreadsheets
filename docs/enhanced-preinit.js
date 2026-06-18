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

  window.__seConfig = window.__seConfig || { v: 1, dateFormat: DEFAULT_FMT, autodate: {} };
  window.__seLastData = null;

  function patch() {
    var S = window.kendo && kendo.spreadsheet && kendo.spreadsheet.Spreadsheet;
    if (!S || !S.prototype) return false;
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
            autodate: (loaded.autodate && typeof loaded.autodate === "object") ? loaded.autodate : {}
          };
          if (typeof window.__seOnConfigLoaded === "function") { try { window.__seOnConfigLoaded(); } catch (e) {} }
        }
      } catch (e) {}
      return origFrom.apply(this, arguments);
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

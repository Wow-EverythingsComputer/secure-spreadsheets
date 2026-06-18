/*
 * autodate.js — auto-fill today's date in a designated column when a new row is started.
 *
 * Layered on top of the prebuilt Secure Spreadsheets editor (dist.js) via a <script> tag in
 * index.html. It does NOT modify the editor bundle; it talks to the live Kendo Spreadsheet
 * widget through the global jQuery that the editor already loads.
 *
 * Rule: for each row from START_ROW down, if the row has any content but its DATE_COLUMN cell
 * is empty, that cell is set to today's date. A date you type yourself is never overwritten.
 */
(function () {
  "use strict";

  // ---------- settings (safe to edit) ----------
  var DATE_COLUMN = "A";          // column that auto-fills with the date
  var START_ROW   = 2;            // first data row (2 = skip a header in row 1)
  var DATE_FORMAT = "yyyy-mm-dd"; // how the date is displayed/stored
  var MAX_ROWS    = 600;          // how far down we scan (safety cap)

  // ---------- helpers ----------
  function todayAtMidnight() {
    var d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()); // real date => sorts correctly
  }
  function isEmpty(v) { return v === null || v === undefined || v === ""; }
  function columnToIndex(letter) {           // "A" -> 0, "B" -> 1, ...
    var idx = 0, s = String(letter).toUpperCase();
    for (var i = 0; i < s.length; i++) idx = idx * 26 + (s.charCodeAt(i) - 64);
    return idx - 1;
  }

  var DATE_COL_IDX = columnToIndex(DATE_COLUMN);
  var applying = false;                       // prevents our own edits from re-triggering us

  // Find a row width the sheet accepts (handles sheets with fewer than 26 columns).
  function detectWidth(sheet) {
    for (var w = 26; w >= 1; w--) {
      try { sheet.range(START_ROW - 1, 0, 1, w).values(); return w; }
      catch (e) { /* too wide — try narrower */ }
    }
    return 1;
  }

  function fillDates(ss) {
    if (applying) return;
    var sheet = ss.activeSheet();
    var width = detectWidth(sheet);
    var changed = false;
    applying = true;
    try {
      for (var i = 0; i < MAX_ROWS; i++) {
        var rowIndex = (START_ROW - 1) + i;     // 0-based row index
        var rowValues;
        try { rowValues = sheet.range(rowIndex, 0, 1, width).values()[0]; }
        catch (edge) { break; }                  // past the bottom of the sheet
        if (!rowValues) break;

        if (!isEmpty(rowValues[DATE_COL_IDX])) continue;   // already dated -> leave it

        var started = false;                      // did the user put anything else in this row?
        for (var c = 0; c < rowValues.length; c++) {
          if (c !== DATE_COL_IDX && !isEmpty(rowValues[c])) { started = true; break; }
        }
        if (started) {
          var cell = sheet.range(rowIndex, DATE_COL_IDX);
          cell.value(todayAtMidnight());
          cell.format(DATE_FORMAT);
          changed = true;
        }
      }
      // persist through the editor's own save (it saves on "change"); we're guarded above
      if (changed) ss.trigger("change");
    } finally {
      applying = false;
    }
  }

  function attach(ss) {
    ss.bind("change", function () { fillDates(ss); });
    console.log("[autodate] active — column " + DATE_COLUMN + ", from row " + START_ROW);
  }

  // The editor builds the Kendo widget asynchronously, so wait until it exists.
  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    var jq = window.jQuery || window.$;
    if (typeof jq === "function") {
      var ss = jq("#spreadsheet").data("kendoSpreadsheet");
      if (ss) { clearInterval(timer); attach(ss); return; }
    }
    if (tries > 150) { clearInterval(timer); console.warn("[autodate] spreadsheet not found"); }
  }, 100);
})();

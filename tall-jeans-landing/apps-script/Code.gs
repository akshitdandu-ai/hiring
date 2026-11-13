/**
 * Receives form submissions and events from the landing page and writes them to a Google Sheet.
 *
 * Setup: see ../README.md ("Google Sheet").
 * Tabs are created automatically on first use:
 *   - "Submissions": one row per form submit (deposit click-through or waitlist)
 *   - "Events":      fit-card clicks and paid-callback events
 */

var TZ = 'Asia/Kolkata';

var SUBMISSION_COLS = [
  'timestamp', 'submission_id', 'choice', 'name', 'whatsapp', 'email', 'city',
  'height', 'waist', 'inseam', 'fit', 'problem',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'gclid', 'fbclid', 'referrer', 'landing_url', 'client_time'
];

var EVENT_COLS = [
  'timestamp', 'event', 'fit', 'submission_id',
  'utm_source', 'utm_medium', 'utm_campaign', 'landing_url'
];

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (data.type === 'event') {
      append_('Events', EVENT_COLS, data);
    } else if (data.type === 'submission') {
      append_('Submissions', SUBMISSION_COLS, data);
    } else {
      return json_({ ok: false, error: 'unknown type' });
    }
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

// Visiting the web-app URL in a browser should just say it's alive.
function doGet() {
  return json_({ ok: true, service: 'landing-page-collector' });
}

function append_(sheetName, cols, data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(cols);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, cols.length).setFontWeight('bold');
  }
  data.timestamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
  var row = cols.map(function (c) {
    var v = data[c];
    return v === undefined || v === null ? '' : String(v).slice(0, 1000);
  });
  var r = sheet.getLastRow() + 1;
  // Plain-text format: stops "=...", "+91..." etc. being evaluated as formulas or numbers.
  sheet.getRange(r, 1, 1, cols.length).setNumberFormat('@').setValues([row]);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

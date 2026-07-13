// Google Apps Script — deployed as a Web App, URL set in GOOGLE_APPS_SCRIPT_URL.
// Handles cell updates on the Connections tab and appends to the Activity log tab.
//
// Activity tab columns: A Date | B Row | C Name | D Company | E Action | F Template | G Detail
//
// To update an existing deployment WITHOUT changing the URL:
// Deploy → Manage deployments → edit (pencil) → Version: New version → Deploy

function doPost(e) {
  var body = JSON.parse(e.postData.contents);
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  if (body.rowIndex && body.cells && body.cells.length > 0) {
    var sheet = ss.getSheetByName('Connections');
    body.cells.forEach(function (c) {
      sheet.getRange(c.col + body.rowIndex).setValue(c.value);
    });
  }

  if (body.log) {
    var logSheet = ss.getSheetByName('Activity');
    if (logSheet) {
      logSheet.appendRow([
        body.log.date || '',
        body.log.rowIndex || '',
        body.log.name || '',
        body.log.company || '',
        body.log.action || '',
        body.log.template || '',
        body.log.detail || '',
      ]);
    }
  }

  if (body.campaign) {
    var campSheet = ss.getSheetByName('Campaigns');
    if (campSheet) {
      var rows = campSheet.getDataRange().getValues();
      var target = String(body.campaign.company).trim().toLowerCase();
      var found = false;
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][0]).trim().toLowerCase() === target) {
          if (body.campaign.status !== undefined) campSheet.getRange(i + 1, 2).setValue(body.campaign.status);
          if (body.campaign.notes !== undefined) campSheet.getRange(i + 1, 4).setValue(body.campaign.notes);
          found = true;
          break;
        }
      }
      if (!found) {
        campSheet.appendRow([body.campaign.company, body.campaign.status || '', '', body.campaign.notes || '']);
      }
    }
  }

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

// One-time data hygiene setup — run manually from the editor (Run > setupDataHygiene).
// Safe to re-run; every step is idempotent. Does NOT require redeploying the web app.
function setupDataHygiene() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var conn = ss.getSheetByName('Connections');
  var messages = ss.getSheetByName('Messages');

  // 1. Call booked date column (appended at R — never insert mid-sheet, the app maps columns by position)
  if (!String(conn.getRange('R1').getValue()).trim()) {
    conn.getRange('R1').setValue('Call booked');
  }

  // 2. Template dropdowns on Message / Follow Up 1 / Follow Up 2, fed live from the Messages tab.
  //    WARNING mode, not reject — a strict reject would make the web app's writes throw.
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(messages.getRange('C2:C'), true)
    .setAllowInvalid(true)
    .build();
  ['I', 'L', 'M'].forEach(function (col) {
    conn.getRange(col + '2:' + col).setDataValidation(rule);
  });

  // 3. Date formats — display MUST stay DD/MM/YYYY (the app parses what the sheet displays)
  conn.getRange('H2:H').setNumberFormat('dd/mm/yyyy');
  conn.getRange('N2:N').setNumberFormat('dd/mm/yyyy');
  conn.getRange('R2:R').setNumberFormat('dd/mm/yyyy');
  var activity = ss.getSheetByName('Activity');
  if (activity) activity.getRange('A2:A').setNumberFormat('dd/mm/yyyy');
  var campaigns = ss.getSheetByName('Campaigns');
  if (campaigns) campaigns.getRange('C2:C').setNumberFormat('dd/mm/yyyy');

  // 4. Canonicalize template-name spelling variants ("one-off" -> "One-off") so they
  //    stop tripping the new validation. The app already treats them as identical.
  var canonicalByNorm = {};
  messages.getRange('C2:C' + messages.getLastRow()).getValues().forEach(function (r) {
    var abbr = String(r[0] || '').trim();
    if (abbr) canonicalByNorm[normAbbr_(abbr)] = abbr;
  });
  var fixes = 0;
  [9, 12, 13].forEach(function (colNum) { // I, L, M
    var numRows = conn.getLastRow() - 1;
    if (numRows < 1) return;
    var range = conn.getRange(2, colNum, numRows, 1);
    var values = range.getValues();
    var changed = false;
    values.forEach(function (row) {
      var v = String(row[0] || '').trim();
      if (!v) return;
      var canonical = canonicalByNorm[normAbbr_(v)];
      if (canonical && canonical !== v) {
        row[0] = canonical;
        changed = true;
        fixes++;
      }
    });
    if (changed) range.setValues(values);
  });

  // 5. Known orphan: row 153 used a template name that matches nothing in Messages.
  //    Kaz Hind @ Cloudflare is Account Management (sales-side), so credit the Acquisition variant.
  if (String(conn.getRange('I153').getValue()).trim() === 'Icing up the wrong cake') {
    conn.getRange('I153').setValue('Icing up the wrong cake Acquisition');
    fixes++;
  }

  Logger.log('Done. ' + fixes + ' template values canonicalized.');
}

function normAbbr_(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

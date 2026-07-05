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

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

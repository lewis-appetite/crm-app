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

  if (body.draft && body.draft.to) {
    GmailApp.createDraft(body.draft.to, body.draft.subject || '', body.draft.body || '');
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

// One-time repair — run manually from the editor (Run > repairEmailPhoneColumns).
// Cols P/Q sat outside the sorted table range, so a sort scrambled which contact
// each email belonged to. This clears P and Q entirely and rewrites every known
// email against the correct contact, matched by name + company (sort-proof).
function repairEmailPhoneColumns() {
  var EMAILS = [
    { name: "Rory Sadler", company: "Trumpet", email: "rory@sendtrumpet.com" },
    { name: "Lorna Wright", company: "Trumpet", email: "lorna@sendtrumpet.com" },
    { name: "Luke Matthews", company: "Trumpet", email: "luke@sendtrumpet.com" },
    { name: "Javier Mois\u00e9s Quir\u00f3s", company: "Ledgy", email: "javier.moises.quiros@ledgy.com" },
    { name: "Meg Westrope", company: "Ledgy", email: "meg.westrope@ledgy.com" },
    { name: "Gregory Hartley", company: "Ledgy", email: "gregory.hartley@ledgy.com" },
    { name: "Tobie Morgan Hitchcock", company: "SurrealDB", email: "tobie@surrealdb.com" },
    { name: "Ignacio Paz", company: "SurrealDB", email: "ignacio@surrealdb.com" },
    { name: "Ned Rudkins-Stow", company: "SurrealDB", email: "ned.rudkins-stow@surrealdb.com" },
    { name: "Mark Gyles", company: "SurrealDB", email: "mark.gyles@surrealdb.com" },
    { name: "Ross McDermott", company: "Gradient Labs", email: "ross@gradient-labs.ai" },
    { name: "Dimitri Masin", company: "Gradient Labs", email: "dimitri@gradient-labs.ai" },
    { name: "Max Schemuth", company: "Gradient Labs", email: "max@gradient-labs.ai" },
    { name: "Zan Faruqui", company: "Gradient Labs", email: "zan@gradient-labs.ai" },
    { name: "Miguel Rebelo", company: "Omnea", email: "miguel.r@omnea.co" },
    { name: "Nick Barker", company: "Omnea", email: "nick.b@omnea.co" },
    { name: "Patrick Penzo", company: "Omnea", email: "patrick.p@omnea.co" },
    { name: "Jasmin Heimann", company: "Omnea", email: "jasmin.heimann@omnea.co" },
    { name: "Dan Yeates", company: "Metaview", email: "dan@metaview.ai" },
    { name: "Stephanie Tsimis", company: "Metaview", email: "stephanie@metaview.ai" },
    { name: "Piyush Raj", company: "Metaview", email: "piyush@metaview.ai" },
    { name: "Aswathy Reji", company: "Wordsmith AI", email: "aswathy@wordsmith.ai" },
    { name: "Kane Greggain", company: "Wordsmith AI", email: "kane@wordsmith.ai" },
    { name: "Euan Dobbie", company: "Wordsmith AI", email: "euan@wordsmith.ai" },
    { name: "Veronika Targos", company: "Adfin", email: "veronika.targos@adfin.com" },
    { name: "Karol Jozwik", company: "Adfin", email: "karol.jozwik@adfin.com" },
    { name: "Georgia Feldmanis", company: "Adfin", email: "georgia.feldmanis@adfin.com" },
    { name: "Carlos Rey", company: "Adfin", email: "carlos@adfin.com" },
    { name: "Tash Laybourne", company: "Hook", email: "tasha@hook.co" },
    { name: "Amaris Bourgeois", company: "Hook", email: "amaris@hook.co" },
    { name: "Firaas Rashid", company: "Hook", email: "firaas@hook.co" },
    { name: "Oliver Pickett", company: "Hook", email: "oliver@hook.co" },
    { name: "Luke Morris", company: "Encord", email: "luke.morris@encord.com" },
    { name: "Sara Schein", company: "Encord", email: "sara@encord.com" },
    { name: "Otto Szoke", company: "Encord", email: "otto@encord.com" },
    { name: "Annabel Benjamin", company: "Encord", email: "annabel@encord.com" },
    { name: "Nicolaj Peters", company: "Encord", email: "nicolaj.peters@encord.com" },
    { name: "Ronal Karia", company: "Trumpet", email: "ronal@sendtrumpet.com" },
    { name: "Charlotte Platts", company: "Trumpet", email: "charlotte@sendtrumpet.com" },
    { name: "Tamara Sammakia", company: "Adfin", email: "tamara.sammakia@adfin.com" },
    { name: "Flora Faulk", company: "Adfin", email: "flora.faulk@adfin.com" },
    { name: "Corey Haigney", company: "Adfin", email: "corey.haigney@adfin.com" },
  ];

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var conn = ss.getSheetByName('Connections');
  var lastRow = conn.getLastRow();

  var rowByKey = {};
  var names = conn.getRange(2, 1, lastRow - 1, 4).getValues(); // A:D
  names.forEach(function (r, i) {
    var key = normAbbr_(String(r[0]) + String(r[1])) + '|' + normAbbr_(String(r[3]));
    if (!(key in rowByKey)) rowByKey[key] = i + 2;
  });

  // wipe both columns (this removes ALL current values - they are scrambled and unsalvageable in place)
  conn.getRange(2, 16, lastRow - 1, 2).clearContent(); // P:Q

  var placed = 0;
  var missing = [];
  EMAILS.forEach(function (e) {
    var key = normAbbr_(e.name) + '|' + normAbbr_(e.company);
    var row = rowByKey[key];
    if (row) {
      conn.getRange(row, 16).setValue(e.email); // P
      placed++;
    } else {
      missing.push(e.name + ' @ ' + e.company);
    }
  });

  Logger.log('Placed ' + placed + ' of ' + EMAILS.length + ' emails.');
  if (missing.length) Logger.log('NO MATCHING ROW FOUND for: ' + missing.join('; '));
}

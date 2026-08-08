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

  // Read-only request — short-circuits before any of the write branches below
  if (body.gmailSearch) {
    var threads = searchGmailContext_(body.gmailSearch.targetEmail, body.gmailSearch.companyDomain);
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, threads: threads }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (body.rowIndex && body.cells && body.cells.length > 0) {
    var sheet = ss.getSheetByName('Connections');
    body.cells.forEach(function (c) {
      sheet.getRange(c.col + body.rowIndex).setValue(c.value);
    });
  }

  // Batch cell writes across multiple rows in one request — used for
  // company-wide Priority column syncs so N contacts don't need N round trips
  if (body.batch && body.batch.length > 0) {
    var batchSheet = ss.getSheetByName('Connections');
    body.batch.forEach(function (item) {
      if (!item.rowIndex || !item.cells) return;
      item.cells.forEach(function (c) {
        batchSheet.getRange(c.col + item.rowIndex).setValue(c.value);
      });
    });
  }

  // Deletes specific Connections rows — used for one-off duplicate cleanup.
  // Each entry carries the expected First/Last Name as a safety check, so a
  // stale rowIndex (row shifted since the caller last read the sheet) skips
  // instead of silently deleting the wrong person. Rows are deleted in
  // descending order so earlier indices in the same batch stay valid as
  // later ones are removed.
  var deleteResults = [];
  if (body.deleteRows && body.deleteRows.length > 0) {
    var delSheet = ss.getSheetByName('Connections');
    if (delSheet) {
      var firstNameCol = connectionsHeaderIndex_('First Name');
      var lastNameCol = connectionsHeaderIndex_('Last Name');
      var toDelete = body.deleteRows.slice().sort(function (a, b) { return b.rowIndex - a.rowIndex; });
      toDelete.forEach(function (item) {
        var row = delSheet.getRange(item.rowIndex, 1, 1, delSheet.getLastColumn()).getValues()[0];
        var actualFirst = firstNameCol ? String(row[firstNameCol - 1]).trim().toLowerCase() : '';
        var actualLast = lastNameCol ? String(row[lastNameCol - 1]).trim().toLowerCase() : '';
        var expectedFirst = String(item.firstName || '').trim().toLowerCase();
        var expectedLast = String(item.lastName || '').trim().toLowerCase();
        if (actualFirst !== expectedFirst || actualLast !== expectedLast) {
          deleteResults.push({ rowIndex: item.rowIndex, deleted: false, reason: 'name mismatch: found "' + row[firstNameCol - 1] + ' ' + row[lastNameCol - 1] + '"' });
          return;
        }
        delSheet.deleteRow(item.rowIndex);
        deleteResults.push({ rowIndex: item.rowIndex, deleted: true });
      });
    }
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
      // Header-driven like Connections (see sheetHeaderIndex_) - the sheet
      // can be reorganized, and new firmographic/ICP columns added, without
      // this needing to change.
      var companyColIdx = campaignsHeaderIndex_('Company') || 1;
      var statusColIdx = campaignsHeaderIndex_('Status') || 2;
      var cakeSentColIdx = campaignsHeaderIndex_('Cake sent') || 3;
      var notesColIdx = campaignsHeaderIndex_('Notes') || 4;
      var focusColIdx = campaignsHeaderIndexOrAppend_('Focus');

      var isDelivered = String(body.campaign.status || '').toLowerCase() === 'delivered';
      var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy');
      var rows = campSheet.getDataRange().getValues();
      var target = String(body.campaign.company).trim().toLowerCase();
      var found = false;
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][companyColIdx - 1]).trim().toLowerCase() === target) {
          if (body.campaign.status !== undefined) {
            campSheet.getRange(i + 1, statusColIdx).setValue(body.campaign.status);
            // first transition to Delivered stamps the cake-sent date
            if (isDelivered && !String(rows[i][cakeSentColIdx - 1] || '').trim()) {
              campSheet.getRange(i + 1, cakeSentColIdx).setValue(todayStr);
            }
          }
          if (body.campaign.notes !== undefined) campSheet.getRange(i + 1, notesColIdx).setValue(body.campaign.notes);
          if (body.campaign.focus !== undefined) campSheet.getRange(i + 1, focusColIdx).setValue(body.campaign.focus ? 'TRUE' : '');
          found = true;
          break;
        }
      }
      if (!found) {
        var newRow = campSheet.getLastRow() + 1;
        campSheet.getRange(newRow, companyColIdx).setValue(body.campaign.company);
        if (body.campaign.status !== undefined) campSheet.getRange(newRow, statusColIdx).setValue(body.campaign.status);
        if (isDelivered) campSheet.getRange(newRow, cakeSentColIdx).setValue(todayStr);
        if (body.campaign.notes !== undefined) campSheet.getRange(newRow, notesColIdx).setValue(body.campaign.notes);
        if (body.campaign.focus !== undefined) campSheet.getRange(newRow, focusColIdx).setValue(body.campaign.focus ? 'TRUE' : '');
      }
    }
  }

  // Appends new prospect rows (one per contact) - used by the ICP research
  // task. Dedup/ICP-matching happens in the research step itself, before
  // this ever gets called; this just writes what it's given. Status
  // defaults to Pending, Date Added to today if not supplied.
  var addProspectResults = [];
  if (body.addProspects && body.addProspects.length > 0) {
    var newProspectSheet = ss.getSheetByName('Prospects');
    if (newProspectSheet) {
      var prospectHeaders = [
        'Company', 'Website URL', 'Company LinkedIn URL', 'Industry', 'Company Size', 'Funding Stage', 'Location',
        'Outbound Evidence', 'Recent News', 'Fit Rating', 'Reasoning',
        'Contact Name', 'Position', 'LinkedIn URL', 'Status', 'Date Added',
      ];
      var prospectColIdx = {};
      prospectHeaders.forEach(function (h) {
        prospectColIdx[h] = sheetHeaderIndexOrAppend_('Prospects', h);
      });
      var todayForProspects = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy');
      var lastCol = newProspectSheet.getLastColumn();

      body.addProspects.forEach(function (item) {
        var newRow = newProspectSheet.getLastRow() + 1;
        var rowValues = new Array(lastCol).fill('');
        function setField(header, value) {
          if (value === undefined || value === null || value === '') return;
          rowValues[prospectColIdx[header] - 1] = value;
        }
        setField('Company', item.company);
        setField('Website URL', item.websiteUrl);
        setField('Company LinkedIn URL', item.companyLinkedinUrl);
        setField('Industry', item.industry);
        setField('Company Size', item.companySize);
        setField('Funding Stage', item.fundingStage);
        setField('Location', item.location);
        setField('Outbound Evidence', item.outboundEvidence);
        setField('Recent News', item.recentNews);
        setField('Fit Rating', item.fitRating);
        setField('Reasoning', item.reasoning);
        setField('Contact Name', item.contactName);
        setField('Position', item.position);
        setField('LinkedIn URL', item.url);
        rowValues[prospectColIdx['Status'] - 1] = item.status || 'Pending';
        rowValues[prospectColIdx['Date Added'] - 1] = item.dateAdded || todayForProspects;
        newProspectSheet.getRange(newRow, 1, 1, lastCol).setValues([rowValues]);
        addProspectResults.push({ row: newRow, company: item.company, contactName: item.contactName });
      });
    }
  }

  // Prospects are stored one row per CONTACT with company fields repeated,
  // but approve/reject is a company-level call - so this updates EVERY row
  // matching the company, not just one. Header-driven like the others.
  if (body.prospect) {
    var prospectSheet = ss.getSheetByName('Prospects');
    if (prospectSheet) {
      var pCompanyCol = sheetHeaderIndex_('Prospects', 'Company') || 1;
      var pRows = prospectSheet.getDataRange().getValues();
      var pTarget = String(body.prospect.company).trim().toLowerCase();

      var pFields = [
        ['status', 'Status'],
        ['rejectionReason', 'Rejection Reason'],
        ['channel', 'Channel'],
        ['address', 'Address'],
        ['addressConfirmedBy', 'Address Confirmed By'],
        ['dateReviewed', 'Date Reviewed'],
      ];

      for (var p = 1; p < pRows.length; p++) {
        if (String(pRows[p][pCompanyCol - 1]).trim().toLowerCase() !== pTarget) continue;
        for (var f = 0; f < pFields.length; f++) {
          var key = pFields[f][0];
          if (body.prospect[key] === undefined) continue;
          var colIdx = sheetHeaderIndexOrAppend_('Prospects', pFields[f][1]);
          prospectSheet.getRange(p + 1, colIdx).setValue(body.prospect[key]);
        }
      }
    }
  }

  // Upsert-by-Test-ID, same pattern as the campaign block above. The client
  // generates testId (create) or passes an existing one (update/end) -
  // header-driven so the Experiments tab can be reorganized freely.
  if (body.experiment) {
    var expSheet = ss.getSheetByName('Experiments');
    if (expSheet) {
      var testIdColIdx = sheetHeaderIndexOrAppend_('Experiments', 'Test ID');
      var nameColIdx = sheetHeaderIndexOrAppend_('Experiments', 'Name');
      var stageColIdx = sheetHeaderIndexOrAppend_('Experiments', 'Stage');
      var variantAColIdx = sheetHeaderIndexOrAppend_('Experiments', 'Variant A');
      var variantBColIdx = sheetHeaderIndexOrAppend_('Experiments', 'Variant B');
      var expStatusColIdx = sheetHeaderIndexOrAppend_('Experiments', 'Status');
      var startedColIdx = sheetHeaderIndexOrAppend_('Experiments', 'Started');
      var endedColIdx = sheetHeaderIndexOrAppend_('Experiments', 'Ended');
      var winnerColIdx = sheetHeaderIndexOrAppend_('Experiments', 'Winner');
      var expNotesColIdx = sheetHeaderIndexOrAppend_('Experiments', 'Notes');

      var expRows = expSheet.getDataRange().getValues();
      var expTarget = String(body.experiment.testId).trim().toLowerCase();
      var expFound = false;
      for (var j = 1; j < expRows.length; j++) {
        if (String(expRows[j][testIdColIdx - 1]).trim().toLowerCase() === expTarget) {
          if (body.experiment.name !== undefined) expSheet.getRange(j + 1, nameColIdx).setValue(body.experiment.name);
          if (body.experiment.stage !== undefined) expSheet.getRange(j + 1, stageColIdx).setValue(body.experiment.stage);
          if (body.experiment.variantA !== undefined) expSheet.getRange(j + 1, variantAColIdx).setValue(body.experiment.variantA);
          if (body.experiment.variantB !== undefined) expSheet.getRange(j + 1, variantBColIdx).setValue(body.experiment.variantB);
          if (body.experiment.status !== undefined) expSheet.getRange(j + 1, expStatusColIdx).setValue(body.experiment.status);
          if (body.experiment.started !== undefined) expSheet.getRange(j + 1, startedColIdx).setValue(body.experiment.started);
          if (body.experiment.ended !== undefined) expSheet.getRange(j + 1, endedColIdx).setValue(body.experiment.ended);
          if (body.experiment.winner !== undefined) expSheet.getRange(j + 1, winnerColIdx).setValue(body.experiment.winner);
          if (body.experiment.notes !== undefined) expSheet.getRange(j + 1, expNotesColIdx).setValue(body.experiment.notes);
          expFound = true;
          break;
        }
      }
      if (!expFound) {
        var expNewRow = expSheet.getLastRow() + 1;
        expSheet.getRange(expNewRow, testIdColIdx).setValue(body.experiment.testId);
        if (body.experiment.name !== undefined) expSheet.getRange(expNewRow, nameColIdx).setValue(body.experiment.name);
        if (body.experiment.stage !== undefined) expSheet.getRange(expNewRow, stageColIdx).setValue(body.experiment.stage);
        if (body.experiment.variantA !== undefined) expSheet.getRange(expNewRow, variantAColIdx).setValue(body.experiment.variantA);
        if (body.experiment.variantB !== undefined) expSheet.getRange(expNewRow, variantBColIdx).setValue(body.experiment.variantB);
        if (body.experiment.status !== undefined) expSheet.getRange(expNewRow, expStatusColIdx).setValue(body.experiment.status);
        if (body.experiment.started !== undefined) expSheet.getRange(expNewRow, startedColIdx).setValue(body.experiment.started);
        if (body.experiment.ended !== undefined) expSheet.getRange(expNewRow, endedColIdx).setValue(body.experiment.ended);
        if (body.experiment.winner !== undefined) expSheet.getRange(expNewRow, winnerColIdx).setValue(body.experiment.winner);
        if (body.experiment.notes !== undefined) expSheet.getRange(expNewRow, expNotesColIdx).setValue(body.experiment.notes);
      }
    }
  }

  var draftMode = null;
  var draftReplyError = null;
  if (body.draft && body.draft.to) {
    draftMode = 'new';
    if (body.draft.threadId) {
      try {
        GmailApp.getThreadById(body.draft.threadId).createDraftReply(body.draft.body || '');
        draftMode = 'reply';
      } catch (err) {
        // thread may have been deleted/inaccessible since we found it — fall through to a new email,
        // but report why so it's visible instead of silently degrading every time
        draftReplyError = String(err);
      }
    }
    if (draftMode !== 'reply') {
      GmailApp.createDraft(body.draft.to, body.draft.subject || '', body.draft.body || '');
    }
  }

  // Without this, SpreadsheetApp writes can still be buffered when this
  // response goes out - a client that immediately re-reads via the separate
  // read-only Sheets API (e.g. Focus's silentRefresh() right after adding a
  // company) can then race ahead of its own write and see stale data.
  SpreadsheetApp.flush();

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, draftMode: draftMode, draftReplyError: draftReplyError, deleteResults: deleteResults, addProspectResults: addProspectResults }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Searches Gmail for the target contact's own thread plus anyone else at the
// same company domain. Returns up to ~15 recent messages across the matching
// threads (last 3 per thread) so the drafting prompt can reference real prior
// correspondence instead of just CRM columns.
function searchGmailContext_(targetEmail, companyDomain) {
  if (!targetEmail) return [];
  var me = Session.getActiveUser().getEmail();

  // Two separate searches, target's own threads first, so newer company-domain
  // mail can never crowd the target's thread out of the result window.
  // cc: is included because "involved in a thread" often means CC'd, which
  // from:/to: alone would miss. Domain form is "from:domain.com" (no @).
  var seen = {};
  var ordered = [];

  var targetQuery = 'from:' + targetEmail + ' OR to:' + targetEmail + ' OR cc:' + targetEmail;
  GmailApp.search(targetQuery, 0, 3).forEach(function (t) {
    if (!seen[t.getId()]) {
      seen[t.getId()] = true;
      ordered.push({ thread: t, isTarget: true });
    }
  });

  if (companyDomain) {
    var domainQuery = 'from:' + companyDomain + ' OR to:' + companyDomain + ' OR cc:' + companyDomain;
    GmailApp.search(domainQuery, 0, 15).forEach(function (t) {
      if (!seen[t.getId()]) {
        seen[t.getId()] = true;
        ordered.push({ thread: t, isTarget: false });
      }
    });
  }

  var results = [];
  var totalMessages = 0;

  for (var i = 0; i < ordered.length && totalMessages < 15; i++) {
    var thread = ordered[i].thread;
    var messages = thread.getMessages();
    var recent = messages.slice(Math.max(0, messages.length - 3));

    var msgSummaries = recent.map(function (m) {
      totalMessages++;
      var from = m.getFrom() || '';
      var direction = from.toLowerCase().indexOf(me.toLowerCase()) !== -1 ? 'sent' : 'received';
      return {
        date: Utilities.formatDate(m.getDate(), Session.getScriptTimeZone(), 'dd/MM/yyyy'),
        from: from,
        direction: direction,
        body: (m.getPlainBody() || '').slice(0, 500),
      };
    });

    results.push({
      threadId: thread.getId(),
      subject: thread.getFirstMessageSubject(),
      isTargetThread: ordered[i].isTarget,
      messages: msgSummaries,
    });
  }

  return results;
}

// Debug helper — run from the editor, then check the execution log.
// Edit the address/domain to test other contacts.
function testGmailSearch() {
  var out = searchGmailContext_('patrick.p@omnea.co', 'omnea.co');
  Logger.log('threads found: ' + out.length);
  out.forEach(function (t) {
    Logger.log((t.isTargetThread ? '[TARGET] ' : '[company] ') + '"' + t.subject + '" — ' + t.messages.length + ' messages');
  });
}

// Header-driven column resolution for the Connections tab, mirroring
// buildConnectionsColumnMap in src/lib/sheets.ts. Every maintenance function
// below locates columns by header TEXT, never by fixed letter/position, so
// the sheet can be reordered without these silently reading/writing the
// wrong cells next time they're run.
function sheetHeaderIndex_(sheetName, headerText) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return null;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var target = headerText.trim().toLowerCase();
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim().toLowerCase() === target) return i + 1; // 1-based
  }
  return null;
}

// Same, but appends a new column with this header if it isn't found yet.
function sheetHeaderIndexOrAppend_(sheetName, headerText) {
  var idx = sheetHeaderIndex_(sheetName, headerText);
  if (idx) return idx;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  var newCol = sheet.getLastColumn() + 1;
  sheet.getRange(1, newCol).setValue(headerText);
  return newCol;
}

function connectionsHeaderIndex_(headerText) {
  return sheetHeaderIndex_('Connections', headerText);
}

function connectionsHeaderIndexOrAppend_(headerText) {
  return sheetHeaderIndexOrAppend_('Connections', headerText);
}

function campaignsHeaderIndex_(headerText) {
  return sheetHeaderIndex_('Campaigns', headerText);
}

function campaignsHeaderIndexOrAppend_(headerText) {
  return sheetHeaderIndexOrAppend_('Campaigns', headerText);
}

function colLetterFromIndex_(index1Based) {
  var s = '';
  var n = index1Based;
  while (n > 0) {
    var rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// PHASE 0 SETUP — run once from the editor (Run > setupPhase0), then check the log.
// Creates the Activity tab, which never existed: doPost silently no-ops its log
// writes when getSheetByName('Activity') returns null, so snoozes, streak history
// and draft dedupe have all been inert. Also adds the R/S headers and backfills
// the Priority column. Safe to re-run; every step is idempotent.
function setupPhase0() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var conn = ss.getSheetByName('Connections');
  var report = [];

  var activity = ss.getSheetByName('Activity');
  if (!activity) {
    activity = ss.insertSheet('Activity');
    report.push('Created Activity tab.');
  } else {
    report.push('Activity tab already existed.');
  }
  if (!String(activity.getRange('A1').getValue()).trim()) {
    activity.getRange('A1:G1').setValues([['Date', 'Row', 'Name', 'Company', 'Action', 'Template', 'Detail']]);
    activity.setFrozenRows(1);
    report.push('Added Activity headers.');
  }
  activity.getRange('A2:A').setNumberFormat('dd/mm/yyyy');

  var callBookedCol = connectionsHeaderIndexOrAppend_('Call booked');
  report.push('Call booked column is at ' + colLetterFromIndex_(callBookedCol) + '.');
  var priorityColIdx = connectionsHeaderIndexOrAppend_('Priority');
  report.push('Priority column is at ' + colLetterFromIndex_(priorityColIdx) + '.');

  var setupLastRow = conn.getLastRow();
  if (setupLastRow > 1) {
    conn.getRange(2, callBookedCol, setupLastRow - 1, 1).setNumberFormat('dd/mm/yyyy');
  }

  backfillPriorityColumn();
  report.push('Priority column backfilled.');

  // Prove the log path works end to end rather than assuming it — this is
  // exactly the write that was failing silently before.
  activity.appendRow([
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy'),
    '', 'SETUP TEST', '', 'setup', '', 'safe to delete this row',
  ]);
  report.push('Wrote a test row to Activity — delete it once you have seen it.');

  Logger.log(report.join('\n'));
}

// One-time data hygiene setup — run manually from the editor (Run > setupDataHygiene).
// Safe to re-run; every step is idempotent. Does NOT require redeploying the web app.
function setupDataHygiene() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var conn = ss.getSheetByName('Connections');
  var messages = ss.getSheetByName('Messages');

  // 1. Call booked date column (created wherever it is, or appended new — never assumes a fixed letter)
  var callBookedCol = connectionsHeaderIndexOrAppend_('Call booked');

  var messageCol = connectionsHeaderIndex_('Message');
  var fu1Col = connectionsHeaderIndex_('Follow Up Message 1');
  var fu2Col = connectionsHeaderIndex_('Follow Up Message 2');
  var connectedOnCol = connectionsHeaderIndex_('Connected On');
  var lastContactedCol = connectionsHeaderIndex_('Last Contacted');

  // 2. Template dropdowns on Message / Follow Up 1 / Follow Up 2, fed live from the Messages tab.
  //    WARNING mode, not reject — a strict reject would make the web app's writes throw.
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(messages.getRange('C2:C'), true)
    .setAllowInvalid(true)
    .build();
  [messageCol, fu1Col, fu2Col].forEach(function (colIdx) {
    if (!colIdx) return;
    var letter = colLetterFromIndex_(colIdx);
    conn.getRange(letter + '2:' + letter).setDataValidation(rule);
  });

  // 3. Date formats — display MUST stay DD/MM/YYYY (the app parses what the sheet displays)
  var lastRow = conn.getLastRow();
  if (lastRow > 1) {
    if (connectedOnCol) conn.getRange(2, connectedOnCol, lastRow - 1, 1).setNumberFormat('dd/mm/yyyy');
    if (lastContactedCol) conn.getRange(2, lastContactedCol, lastRow - 1, 1).setNumberFormat('dd/mm/yyyy');
    if (callBookedCol) conn.getRange(2, callBookedCol, lastRow - 1, 1).setNumberFormat('dd/mm/yyyy');
  }
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
  [messageCol, fu1Col, fu2Col].forEach(function (colIdx) {
    if (!colIdx) return;
    var numRows = conn.getLastRow() - 1;
    if (numRows < 1) return;
    var range = conn.getRange(2, colIdx, numRows, 1);
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
  if (messageCol) {
    var orphanCell = conn.getRange(153, messageCol);
    if (String(orphanCell.getValue()).trim() === 'Icing up the wrong cake') {
      orphanCell.setValue('Icing up the wrong cake Acquisition');
      fixes++;
    }
  }

  Logger.log('Done. ' + fixes + ' template values canonicalized.');
}

function normAbbr_(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// One-time backfill — run manually from the editor (Run > backfillPriorityColumn)
// after adding the "Priority" header at S1. Populates every existing row;
// going forward the app keeps individual rows in sync on company-stage
// changes and reply changes (see /api/sync-priority in the Next.js app).
function backfillPriorityColumn() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var conn = ss.getSheetByName('Connections');
  var camp = ss.getSheetByName('Campaigns');

  var priorityCol = connectionsHeaderIndexOrAppend_('Priority');
  var companyCol = connectionsHeaderIndex_('Company');
  var replyCol = connectionsHeaderIndex_('Reply?');
  if (!companyCol || !replyCol) {
    Logger.log('backfillPriorityColumn: could not find Company/Reply? headers, aborting.');
    return;
  }

  var activeCompanies = {};
  if (camp) {
    camp.getDataRange().getValues().slice(1).forEach(function (r) {
      var company = String(r[0] || '').trim();
      var status = String(r[1] || '').trim().toLowerCase();
      if (!company) return;
      var closed = status.indexOf('closed') !== -1 || status.indexOf('won') !== -1 || status.indexOf('lost') !== -1 || status.indexOf('dead') !== -1;
      var planned = status.indexOf('planned') !== -1;
      if (!closed && !planned) activeCompanies[normAbbr_(company)] = true;
    });
  }

  var numRows = conn.getLastRow() - 1;
  if (numRows < 1) return;

  var companyValues = conn.getRange(2, companyCol, numRows, 1).getValues();
  var replyValues = conn.getRange(2, replyCol, numRows, 1).getValues();
  var WORTHY = ['interested', 'yes', ''];
  var priorities = companyValues.map(function (row, i) {
    var company = String(row[0] || '').trim();
    var reply = String(replyValues[i][0] || '').trim().toLowerCase();
    var dead = WORTHY.indexOf(reply) === -1;
    if (dead) return [''];
    if (company && activeCompanies[normAbbr_(company)]) return ['\u{1F382} Cake'];
    if (reply === 'interested' || reply === 'yes') return ['\u{1F525} Interested'];
    return [''];
  });

  conn.getRange(2, priorityCol, numRows, 1).setValues(priorities);
  Logger.log('Backfilled Priority for ' + numRows + ' rows.');
}

// Run this ONCE manually from the editor (select from the function dropdown, click Run)
// to grant the script Gmail access. Redeploying does NOT trigger this prompt on its own -
// only a human running a Gmail-touching function in the editor does. Without it, GmailApp
// calls from doPost fail with a generic "Error" page instead of creating drafts.
// Creates a throwaway draft to yourself and immediately deletes it.
function authorizeGmailScope() {
  var email = Session.getActiveUser().getEmail();
  var draft = GmailApp.createDraft(email, 'Apps Script authorization test', 'Safe to ignore - deleting now.');
  draft.deleteDraft();
  Logger.log('Gmail access granted and verified.');
}

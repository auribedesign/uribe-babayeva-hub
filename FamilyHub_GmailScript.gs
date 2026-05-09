// ============================================================
// FAMILY HUB — Gmail Auto-Checker
// Runs daily at 2:00 PM, reads emmabellauribe@gmail.com
// Routes Seesaw + Steps 4 + School emails through Claude AI
// Saves results to a Google Sheet for the dashboard to read
// ============================================================

// ── CONFIGURATION ───────────────────────────────────────────
const CONFIG = {
  ANTHROPIC_API_KEY: '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',
  SHEET_ID: '1JttlR2Vm9tJyLpGNF4ZtcMcKfNapZEpWrNjeOHsq7uA',
  DAYS_TO_LOOK_BACK: 1,
  EMAIL_SENDERS: [
    'seesaw',
    'steps4',
    'noreply@web.seesaw.me',
    'do-not-reply@seesaw.me',
    'steps4@stepstosuccess.com',
    'lminkoff@stjhill.org',
  ],
};

// ── WEB APP ENTRY POINT ──────────────────────────────────────
function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : 'fetch';
    if (action === 'parse' && e.parameter.email) {
      var fakeEmail = { from: 'dashboard@manual.import', subject: 'Manual Import', body: e.parameter.email, thread: null };
      var results = { homework: [], announcements: [], aftercare: [], reminders: [] };
      var categorized = categorizeWithClaude(fakeEmail);
      if (categorized) {
        (categorized.homework || []).forEach(function(h) { results.homework.push(h); });
        (categorized.announcements || []).forEach(function(a) { results.announcements.push(a); });
        (categorized.aftercare || []).forEach(function(a) { results.aftercare.push(a); });
        (categorized.reminders || []).forEach(function(r) { results.reminders.push(r); });
      }
      saveToSheet(results);
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok', message: 'Parsed and saved' })).setMimeType(ContentService.MimeType.JSON);
    }
    if (action === 'getMeals') {
      var meals = getMealsFromSheet();
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok', meals: meals })).setMimeType(ContentService.MimeType.JSON);
    }
    if (action === 'getAllData') {
      var allData = getAllAppDataFromSheet();
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok', data: allData })).setMimeType(ContentService.MimeType.JSON);
    }
    checkEmmaEmails();
    fetchCalendarEvents();
    return ContentService.createTextOutput(JSON.stringify({ status: 'ok', message: 'Email check and calendar sync complete' })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ── MEALS SYNC (doPost) ─────────────────────────────────────
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action || '';

    if (action === 'saveMeals') {
      saveMealsToSheet(data.meals);
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok' })).setMimeType(ContentService.MimeType.JSON);
    }
    if (action === 'saveAppData') {
      saveAppDataToSheet(data.key, data.value);
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok' })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Unknown action' })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

function saveMealsToSheet(meals) {
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName('Meals');
  if (!sheet) {
    sheet = ss.insertSheet('Meals');
    sheet.appendRow(['day', 'mealType', 'items', 'updatedAt']);
  }
  // Clear existing data (keep header)
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 4).clearContent();

  // Write all meals
  var rows = [];
  Object.keys(meals).forEach(function(key) {
    var parts = key.split('||');
    if (parts.length === 2) {
      rows.push([parts[0], parts[1], JSON.stringify(meals[key]), new Date().toISOString()]);
    }
  });
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 4).setValues(rows);
  }
}

function getMealsFromSheet() {
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName('Meals');
  if (!sheet || sheet.getLastRow() < 2) return {};
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  var meals = {};
  data.forEach(function(row) {
    if (row[0] && row[1]) {
      try { meals[row[0]+'||'+row[1]] = JSON.parse(row[2]); } catch(e) {}
    }
  });
  return meals;
}


// ── MAIN ENTRY POINT ────────────────────────────────────────
function checkEmmaEmails() {
  Logger.log('🏫 Family Hub: Starting email check at ' + new Date().toLocaleString());
  const emails = fetchRelevantEmails();
  Logger.log('📧 Found ' + emails.length + ' relevant email(s)');
  if (emails.length === 0) { Logger.log('No new emails. Done.'); return; }

  const results = { homework: [], announcements: [], aftercare: [], reminders: [] };
  emails.forEach(function(email) {
    const categorized = categorizeWithClaude(email);
    if (!categorized) return;
    (categorized.homework || []).forEach(function(h) { results.homework.push(h); });
    (categorized.announcements || []).forEach(function(a) { results.announcements.push(a); });
    (categorized.aftercare || []).forEach(function(a) { results.aftercare.push(a); });
    (categorized.reminders || []).forEach(function(r) { results.reminders.push(r); });
    email.thread.addLabel(getOrCreateLabel('FamilyHub/Processed'));
  });

  saveToSheet(results);
  fetchCalendarEvents();
  Logger.log('✅ Done! Saved to Google Sheet.');
}

// ── FETCH EMAILS ────────────────────────────────────────────
function fetchRelevantEmails() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - CONFIG.DAYS_TO_LOOK_BACK);
  const dateStr = Utilities.formatDate(cutoff, Session.getScriptTimeZone(), 'yyyy/MM/dd');
  const senderQuery = CONFIG.EMAIL_SENDERS.map(function(s) { return 'from:' + s; }).join(' OR ');
  const query = '(' + senderQuery + ') after:' + dateStr + ' -label:FamilyHub/Processed';
  Logger.log('Gmail query: ' + query);
  const threads = GmailApp.search(query);
  const emails = [];
  threads.forEach(function(thread) {
    thread.getMessages().forEach(function(msg) {
      emails.push({
        subject: msg.getSubject(),
        from: msg.getFrom(),
        body: msg.getPlainBody().substring(0, 3000),
        date: msg.getDate(),
        thread: thread,
      });
    });
  });
  return emails;
}

// ── CLAUDE AI CATEGORIZATION ─────────────────────────────────
function categorizeWithClaude(email) {
  const prompt = 'You are processing a school email for a family dashboard. The email is about a child named Emma who is in 1st grade at St. John\'s Hill school.\n\n'
    + 'IMPORTANT: Only extract information relevant to 1st grade or all grades school-wide. Ignore other grade levels.\n\n'
    + 'Categorize into:\n'
    + '- homework: assignments Emma must do at home\n'
    + '- announcements: school events/news, no parent action needed\n'
    + '- aftercare: anything from Steps 4 aftercare\n'
    + '- reminders: action items for parents (forms, payments, permission slips)\n\n'
    + 'EMAIL FROM: ' + email.from + '\n'
    + 'SUBJECT: ' + email.subject + '\n'
    + 'BODY: ' + email.body + '\n\n'
    + 'Return ONLY valid JSON, no markdown:\n'
    + '{"homework":[{"title":"","subject":"","due":"","details":""}],"announcements":[{"title":"","details":""}],"aftercare":[{"title":"","details":""}],"reminders":[{"title":"","urgent":true}]}';

  try {
    const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': CONFIG.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] }),
      muteHttpExceptions: true,
    });
    const data = JSON.parse(response.getContentText());
    if (data.error) { Logger.log('Claude API error: ' + JSON.stringify(data.error)); return null; }
    const text = data.content.filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('');
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch (e) {
    Logger.log('Error calling Claude: ' + e.toString());
    return null;
  }
}

// ── SAVE TO GOOGLE SHEET ─────────────────────────────────────
function saveToSheet(results) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const now = new Date().toISOString();
  saveCategory(ss, 'Homework', results.homework, now, ['title', 'subject', 'due', 'details']);
  saveCategory(ss, 'Announcements', results.announcements, now, ['title', 'details']);
  saveCategory(ss, 'Aftercare', results.aftercare, now, ['title', 'details']);
  saveCategory(ss, 'Reminders', results.reminders, now, ['title', 'urgent']);
}

function saveCategory(ss, sheetName, items, timestamp, fields) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(['timestamp', 'done'].concat(fields));
    sheet.getRange(1, 1, 1, fields.length + 2).setFontWeight('bold');
  }

  if (sheetName === 'Homework') {
    // For homework: only add items that don't already exist (deduplicate by title)
    var existing = [];
    if (sheet.getLastRow() > 1) {
      var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, fields.length + 2).getValues();
      // title is at index 2 (after timestamp and done)
      existing = data.map(function(row) { return (row[2] || '').toString().toLowerCase().trim(); });
    }
    items.forEach(function(item) {
      var titleLower = (item.title || '').toLowerCase().trim();
      if (existing.indexOf(titleLower) === -1) {
        sheet.appendRow([timestamp, 'false'].concat(fields.map(function(f) { return item[f] || ''; })));
        existing.push(titleLower);
      }
    });
  } else {
    // For Aftercare and Reminders: always replace (fresh each run)
    if (sheet.getLastRow() > 1) {
      sheet.deleteRows(2, sheet.getLastRow() - 1);
    }
    items.forEach(function(item) {
      sheet.appendRow([timestamp, 'false'].concat(fields.map(function(f) { return item[f] || ''; })));
    });
  }
}

// ── GMAIL LABEL HELPER ───────────────────────────────────────
function getOrCreateLabel(labelName) {
  var label = GmailApp.getUserLabelByName(labelName);
  if (!label) label = GmailApp.createLabel(labelName);
  return label;
}

// ── TEST: VERIFY INBOX + SHEET ACCESS ────────────────────────
function testInbox() {
  Logger.log('Running as: ' + Session.getActiveUser().getEmail());
  var steps4 = GmailApp.search('from:steps4@stepstosuccess.com');
  Logger.log('Steps4 emails found: ' + steps4.length);
  var school = GmailApp.search('from:lminkoff@stjhill.org');
  Logger.log('School emails found: ' + school.length);
  var seesaw = GmailApp.search('from:seesaw');
  Logger.log('Seesaw emails found: ' + seesaw.length);
  var processed = GmailApp.search('label:FamilyHub/Processed');
  Logger.log('Already processed: ' + processed.length);
  steps4.slice(0, 3).forEach(function(t) { Logger.log('Steps4: ' + t.getFirstMessageSubject()); });
}

function testSheetAccess() {
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  Logger.log('✅ Sheet access OK: ' + ss.getName());
}

// ── RESET: REMOVE PROCESSED LABELS ───────────────────────────
function resetProcessed() {
  var label = GmailApp.getUserLabelByName('FamilyHub/Processed');
  if (!label) { Logger.log('No label found.'); return; }
  var threads = label.getThreads();
  threads.forEach(function(t) { t.removeLabel(label); });
  Logger.log('✅ Removed label from ' + threads.length + ' thread(s).');
}

// ── RESET: CLEAR SHEET DATA ───────────────────────────────────
function clearSheetData() {
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  ['Homework', 'Announcements', 'Aftercare', 'Reminders'].forEach(function(name) {
    var sheet = ss.getSheetByName(name);
    if (sheet && sheet.getLastRow() > 1) {
      sheet.deleteRows(2, sheet.getLastRow() - 1);
      Logger.log('Cleared ' + name);
    }
  });
  Logger.log('✅ Sheet data cleared.');
}


// ── FETCH CALENDAR EVENTS ────────────────────────────────────
function fetchCalendarEvents() {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    var sheet = ss.getSheetByName('Calendar');
    if (!sheet) {
      sheet = ss.insertSheet('Calendar');
      sheet.appendRow(['date', 'time', 'title', 'who', 'allday']);
      sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
    } else {
      // Clear old events (keep header)
      if (sheet.getLastRow() > 1) {
        sheet.deleteRows(2, sheet.getLastRow() - 1);
      }
    }

    // Get next 14 days of events
    var now = new Date();
    var end = new Date();
    end.setDate(end.getDate() + 14);

    var calendars = CalendarApp.getAllCalendars();
    var events = [];

    calendars.forEach(function(cal) {
      var calEvents = cal.getEvents(now, end);
      calEvents.forEach(function(ev) {
        events.push({
          date: Utilities.formatDate(ev.getStartTime(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
          time: ev.isAllDayEvent() ? '' : Utilities.formatDate(ev.getStartTime(), Session.getScriptTimeZone(), 'HH:mm'),
          title: ev.getTitle(),
          who: cal.getName(),
          allday: ev.isAllDayEvent() ? 'true' : 'false'
        });
      });
    });

    // Sort by date
    events.sort(function(a, b) { return a.date.localeCompare(b.date) || a.time.localeCompare(b.time); });

    // Save to sheet (max 30 events)
    events.slice(0, 30).forEach(function(ev) {
      sheet.appendRow([ev.date, ev.time, ev.title, ev.who, ev.allday]);
    });

    // Make sheet publicly readable
    var file = DriveApp.getFileById(ss.getId());
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    Logger.log('📅 Saved ' + Math.min(events.length, 30) + ' calendar events');
  } catch(e) {
    Logger.log('Calendar fetch error: ' + e.toString());
  }
}

// ── SETUP: DAILY 5AM TRIGGER ─────────────────────────────────
function setupDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('checkEmmaEmails').timeBased().everyDays(1).atHour(5).create();
  Logger.log('✅ Daily 5:00 AM trigger created!');
}

// ── SETUP: CREATE GOOGLE SHEET ────────────────────────────────
function setupGoogleSheet() {
  const ss = SpreadsheetApp.create('Family Hub — Emma Dashboard Data');
  const id = ss.getId();
  ['Homework', 'Announcements', 'Aftercare', 'Reminders'].forEach(function(name) {
    const sheet = ss.insertSheet(name);
    sheet.appendRow(['timestamp', 'done', 'title', 'details', 'extra1', 'extra2']);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#4F7DFF').setFontColor('white');
  });
  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet) ss.deleteSheet(defaultSheet);
  DriveApp.getFileById(id).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  Logger.log('✅ Sheet created! ID: ' + id);
  Logger.log('URL: ' + ss.getUrl());
}

// ── APP DATA BACKUP (Wins, Tally, Notes, Grocery) ────────────
function getOrCreateAppDataSheet() {
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName('AppData');
  if (!sheet) {
    sheet = ss.insertSheet('AppData');
    sheet.appendRow(['key', 'value', 'updatedAt']);
    sheet.setColumnWidth(1, 200);
    sheet.setColumnWidth(2, 600);
  }
  return sheet;
}

function saveAppDataToSheet(key, value) {
  var sheet = getOrCreateAppDataSheet();
  var data = sheet.getDataRange().getValues();
  // Find existing row for this key
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2, 1, 2).setValues([[value, new Date().toISOString()]]);
      return;
    }
  }
  // Key not found — append new row
  sheet.appendRow([key, value, new Date().toISOString()]);
}

function getAllAppDataFromSheet() {
  var sheet = getOrCreateAppDataSheet();
  if (sheet.getLastRow() < 2) return {};
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  var result = {};
  data.forEach(function(row) {
    if (row[0]) result[row[0]] = row[1];
  });
  return result;
}


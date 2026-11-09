/**
 * ibex Marketing Mission Control: Google Apps Script backend.
 * Bind this script to a Google Sheet (Extensions > Apps Script). The sheet "State"
 * holds every saved document as JSON: one row per path (runsheet/plan, notes/<id>, ...).
 */
const STATE_SHEET = 'State';
const MAX_CELL = 49000; // Sheets cell limit is 50,000 characters

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('ibex Marketing Mission Control')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function stateSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(STATE_SHEET);
  if (!sh) {
    sh = ss.insertSheet(STATE_SHEET);
    sh.getRange(1, 1, 1, 4).setValues([['path', 'json', 'updatedAt', 'updatedBy']]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function readAll_() {
  const sh = stateSheet_();
  const n = sh.getLastRow() - 1;
  const rows = n > 0 ? sh.getRange(2, 1, n, 4).getValues() : [];
  const map = {};
  rows.forEach(function (r, i) { if (r[0]) map[r[0]] = { row: i + 2, json: r[1], updatedAt: r[2] }; });
  return map;
}

function who_() {
  try { return Session.getActiveUser().getEmail() || 'unknown'; } catch (e) { return 'unknown'; }
}

function write_(path, obj) {
  const json = JSON.stringify(obj);
  if (json.length > MAX_CELL) throw new Error('Document too large for one cell: ' + path);
  const sh = stateSheet_();
  const all = readAll_();
  const vals = [[path, json, new Date().toISOString(), who_()]];
  if (all[path]) sh.getRange(all[path].row, 1, 1, 4).setValues(vals);
  else sh.appendRow(vals[0]);
}

function deepMerge_(a, b) {
  if (b === null || typeof b !== 'object' || Array.isArray(b)) return b;
  const out = (a && typeof a === 'object' && !Array.isArray(a)) ? Object.assign({}, a) : {};
  Object.keys(b).forEach(function (k) { out[k] = deepMerge_(out[k], b[k]); });
  return out;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/** Called by the page: every saved document plus the viewer's email. */
function mcGetAll() {
  // First open loads the current board state automatically.
  if (Object.keys(readAll_()).length === 0) withLock_(function () { if (Object.keys(readAll_()).length === 0) seedState(); });
  const all = readAll_();
  const docs = {};
  Object.keys(all).forEach(function (p) {
    try { docs[p] = { data: JSON.parse(all[p].json), updatedAt: all[p].updatedAt }; } catch (e) {}
  });
  return { docs: docs, user: who_() };
}

function mcSet(path, json) {
  return withLock_(function () { write_(path, JSON.parse(json)); return true; });
}

function mcUpdate(path, json) {
  return withLock_(function () {
    const all = readAll_();
    const cur = all[path] ? JSON.parse(all[path].json) : {};
    write_(path, deepMerge_(cur, JSON.parse(json)));
    return true;
  });
}

function mcAdd(col, json) {
  return withLock_(function () {
    const id = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
    write_(col + '/' + id, JSON.parse(json));
    return id;
  });
}

/** Run once from the editor after pasting Seed.gs: loads the board's current plan, ticks and notes. */
function seedState() {
  const existing = readAll_();
  let added = 0;
  Object.keys(SEED).forEach(function (p) {
    if (!existing[p]) { write_(p, SEED[p]); added++; }
  });
  Logger.log('Seeded ' + added + ' documents (existing ones were left alone).');
}
